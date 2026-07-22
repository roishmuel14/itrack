// The single-writer status/merge engine (PRD F2). Pure functions only:
// no SDK calls, fully unit-testable. The ingest and mutation functions are
// the only callers; no client ever sets a status directly.

export const ADVANCING_STATUSES = ["ordered", "shipped", "in_transit", "out_for_delivery", "delivered"] as const;
export type AdvancingStatus = (typeof ADVANCING_STATUSES)[number];
export type BranchStatus = "delayed" | "cancelled" | "returned";
export type OrderStatus = AdvancingStatus | BranchStatus;

export const STATUS_RANK: Record<AdvancingStatus, number> = {
  ordered: 0,
  shipped: 1,
  in_transit: 2,
  out_for_delivery: 3,
  delivered: 4,
};

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["cancelled", "returned"]);

export function rankOf(status: string): number | null {
  return status in STATUS_RANK ? STATUS_RANK[status as AdvancingStatus] : null;
}

// Map TrackingEvent.type / classification to a status signal.
export const EVENT_TYPE_TO_RANK: Record<string, number | undefined> = {
  order_confirmation: 0,
  shipment: 1,
  transit_update: 2,
  out_for_delivery: 3,
  delivered: 4,
};

export interface StatusSignal {
  // Advancing rank 0-4, if this signal carries one.
  rank?: number | null;
  // Branch flags.
  isDelay?: boolean;
  terminal?: "cancelled" | "returned" | null;
  // When the underlying event happened (ISO). Arrival order is irrelevant;
  // occurred_at decides "newest information".
  occurredAt: string;
}

// Compute a status from the FULL signal history. Monotonic by construction:
// the base rank is the max rank ever seen, so late-arriving lower-rank
// signals never regress the status (PRD F2 AC1/AC3). "delayed" annotates:
// it shows only while it is the newest information and the order is not
// delivered. cancelled/returned are terminal, latest one wins.
export function computeStatus(signals: StatusSignal[]): OrderStatus {
  let terminal: { status: "cancelled" | "returned"; at: string } | null = null;
  let bestRank = -1;
  let bestRankAt = "";
  let latestDelayAt = "";

  for (const s of signals) {
    if (s.terminal) {
      if (!terminal || s.occurredAt > terminal.at) {
        terminal = { status: s.terminal, at: s.occurredAt };
      }
    }
    if (typeof s.rank === "number" && s.rank >= 0) {
      if (s.rank > bestRank || (s.rank === bestRank && s.occurredAt > bestRankAt)) {
        bestRank = s.rank;
        bestRankAt = s.occurredAt;
      }
    }
    if (s.isDelay && s.occurredAt > latestDelayAt) {
      latestDelayAt = s.occurredAt;
    }
  }

  if (terminal) return terminal.status;
  if (bestRank < 0) {
    // No advancing signal at all; a delay alone still shows as delayed.
    return latestDelayAt ? "delayed" : "ordered";
  }
  if (bestRank >= STATUS_RANK.delivered) return "delivered";
  if (latestDelayAt && latestDelayAt > bestRankAt) return "delayed";
  return ADVANCING_STATUSES[bestRank];
}

// Order status from shipment statuses (PRD F2: max of shipment statuses),
// with branch handling: any active delay shows if nothing is delivered yet;
// all-terminal propagates.
export function orderStatusFromShipments(shipmentStatuses: OrderStatus[]): OrderStatus | null {
  if (shipmentStatuses.length === 0) return null;
  const allTerminal = shipmentStatuses.every((s) => TERMINAL_STATUSES.has(s));
  if (allTerminal) {
    return shipmentStatuses.includes("returned") ? "returned" : "cancelled";
  }
  let best = -1;
  let anyDelay = false;
  for (const s of shipmentStatuses) {
    const r = rankOf(s);
    if (r !== null && r > best) best = r;
    if (s === "delayed") anyDelay = true;
  }
  if (best >= STATUS_RANK.delivered) return "delivered";
  if (anyDelay) return "delayed";
  return best >= 0 ? ADVANCING_STATUSES[best] : "delayed";
}

// Pairwise guard used by manual mutations (orders/setStatus): may the order
// move current -> next under monotonicity? Manual "mark delivered" and
// archive-adjacent transitions only.
export function canTransition(current: OrderStatus, next: OrderStatus): boolean {
  if (TERMINAL_STATUSES.has(current)) return false;
  if (TERMINAL_STATUSES.has(next)) return true;
  if (next === "delayed") return current !== "delivered";
  const currentRank = rankOf(current);
  const nextRank = rankOf(next);
  if (nextRank === null) return false;
  if (currentRank === null) return true; // out of delayed to any advancing status
  return nextRank > currentRank;
}

// ---- Merge keys (PRD F2): (merchant_domain + order_number) -> tracking ----

export function normalizeDomain(domain: string | null | undefined): string {
  if (!domain) return "";
  return domain
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

export function normalizeOrderNumber(orderNumber: string | null | undefined): string {
  if (!orderNumber) return "";
  return orderNumber.trim().toUpperCase().replace(/^#/, "");
}

export interface ExtractedOrderFacts {
  merchant_domain?: string | null;
  order_number?: string | null;
  tracking_number?: string | null;
}

export interface OrderLike {
  id: string;
  merchant_domain?: string | null;
  order_number?: string | null;
}

export interface ShipmentLike {
  id: string;
  order_id: string;
  tracking_number?: string | null;
}

export type MergeDecision =
  | { kind: "matched_order"; orderId: string; via: "order_number" | "tracking_number" }
  | { kind: "ambiguous"; candidateOrderIds: string[] }
  | { kind: "new_order" };

// Decide which existing order an extracted email belongs to.
// candidates: the user's non-archived orders; shipments: the user's shipments.
export function decideMerge(
  facts: ExtractedOrderFacts,
  candidates: OrderLike[],
  shipments: ShipmentLike[],
  fuzzyCandidateIds: string[] = [],
): MergeDecision {
  const domain = normalizeDomain(facts.merchant_domain);
  const orderNo = normalizeOrderNumber(facts.order_number);
  if (domain && orderNo) {
    const hit = candidates.find(
      (o) => normalizeDomain(o.merchant_domain) === domain && normalizeOrderNumber(o.order_number) === orderNo,
    );
    if (hit) return { kind: "matched_order", orderId: hit.id, via: "order_number" };
  }
  const tracking = (facts.tracking_number ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (tracking) {
    const hit = shipments.find(
      (s) => (s.tracking_number ?? "").replace(/[\s-]/g, "").toUpperCase() === tracking,
    );
    if (hit) return { kind: "matched_order", orderId: hit.order_id, via: "tracking_number" };
  }
  if (fuzzyCandidateIds.length > 0) {
    return { kind: "ambiguous", candidateOrderIds: fuzzyCandidateIds };
  }
  return { kind: "new_order" };
}

// Same-merchant orders within a date window are arbitration candidates when
// hard keys fail (PRD F2: LLM "same order?" arbitration).
export function fuzzyCandidates(
  facts: { merchant_domain?: string | null; occurredAt: string },
  candidates: Array<OrderLike & { ordered_at?: string | null; created_date?: string }>,
  windowDays = 45,
): string[] {
  const domain = normalizeDomain(facts.merchant_domain);
  if (!domain) return [];
  const t = Date.parse(facts.occurredAt);
  return candidates
    .filter((o) => normalizeDomain(o.merchant_domain) === domain)
    .filter((o) => {
      const anchor = Date.parse(o.ordered_at ?? o.created_date ?? "");
      if (Number.isNaN(anchor) || Number.isNaN(t)) return true;
      return Math.abs(t - anchor) <= windowDays * 24 * 3600 * 1000;
    })
    .map((o) => o.id);
}
