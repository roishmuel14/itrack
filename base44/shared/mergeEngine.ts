// The single-writer status/merge engine (PRD F2). Pure functions only:
// no SDK calls, fully unit-testable. The ingest and mutation functions are
// the only callers; no client ever sets a status directly.

import { isCarrierDomain, registrableDomain } from "./senderDomain.ts";
import { carrierKeyFromName } from "./carriers.ts";

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

// Brand token for refund-policy matching ONLY (refunds/scan): reduces a
// domain to its registrable brand, ignoring country TLD and subdomain, so
// amazon.co.uk, amazon.de, and smile.amazon.com all match a amazon.com
// policy. Builds on senderDomain's registrable-domain suffix table (single
// source of truth for multi-part TLDs like co.uk/co.il) rather than a second
// copy of that list. Deliberately NOT used by normalizeDomain/decideMerge:
// merchant_domain is half the order merge key, and loosening ITS matching
// would change which emails merge into which order for every future email
// (see normalizeDomain above). Policy matching has no such blast radius.
function policyBrandToken(domain: string): string {
  const normalized = normalizeDomain(domain);
  if (!normalized) return "";
  return registrableDomain(normalized).split(".")[0] ?? "";
}

export function policyDomainMatches(
  orderDomain: string | null | undefined,
  policyDomain: string | null | undefined,
): boolean {
  const orderBrand = policyBrandToken(orderDomain ?? "");
  const policyBrand = policyBrandToken(policyDomain ?? "");
  return !!orderBrand && !!policyBrand && orderBrand === policyBrand;
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
  // Safety net: match on the order number alone when the domain-keyed match
  // was unavailable (domain missing or extracted inconsistently across a
  // merchant's emails). Order numbers are high-entropy, so within one user's
  // orders an exact normalized match is reliable; require >= 5 alphanumerics to
  // avoid trivial collisions, never cross two DIFFERENT known domains, and defer
  // to arbitration if more than one candidate shares it.
  if (orderNo && orderNo.replace(/[^A-Z0-9]/g, "").length >= 5) {
    const hits = candidates.filter((o) => {
      if (normalizeOrderNumber(o.order_number) !== orderNo) return false;
      const od = normalizeDomain(o.merchant_domain);
      return !od || !domain || od === domain;
    });
    if (hits.length === 1) return { kind: "matched_order", orderId: hits[0].id, via: "order_number" };
    if (hits.length > 1) return { kind: "ambiguous", candidateOrderIds: hits.map((o) => o.id) };
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

// Orders within a date window that could be the incoming email's order, for
// LLM "same order?" arbitration when hard keys fail (PRD F2). Returned BEST
// FIRST (matching order number, then same domain, then date proximity): the
// pipeline arbitrates only the top few, so ordering decides which candidates
// get a hearing. Order number outranks proximity because it is far stronger
// evidence; this path sees number matches whenever decideMerge's rungs could
// not use them, e.g. short numbers below its 5-alphanumeric floor.
//
// Domain gate: same normalized domain matches; a missing or carrier domain on
// EITHER side is a wildcard (carriers ship for everyone, so fedex.com never
// identifies the merchant; a carrier-created row must stay findable by the
// real merchant's later emails and vice versa). `widen` marks an incoming
// email whose own domain is missing or a carrier; without it, a domainless
// incoming email matches nothing, preserving the conservative default for
// ordinary merchant mail.
//
// Window anchor: ordered_at, else last_event_at, else created_date. Rows born
// from a number-less delivery notice have no ordered_at, and during a first
// sync their created_date is "now" while the emails are weeks old; anchoring
// on last_event_at keeps them inside the window (the Salomon duplicate).
//
// Hard exclusion: when both sides state an order number and the numbers
// differ, they are different orders, never candidates.
export interface FuzzyFacts {
  merchant_domain?: string | null;
  order_number?: string | null;
  occurredAt: string;
}

export type FuzzyOrderCandidate = OrderLike & {
  ordered_at?: string | null;
  last_event_at?: string | null;
  created_date?: string;
};

// Identity repair for an email merging into an EXISTING order (PRD F2). A row
// opened by a shipping/delivery notice carries weak identity: no ordered_at
// (which also breaks the fuzzy window anchor and the card's progress bar), and
// often the carrier's name and domain instead of the store's. A later, stronger
// email must repair those, but must never downgrade good values:
// - order_number / ordered_at: fill only when absent.
// - merchant_domain: fill when absent, and upgrade a carrier domain to a real
//   store domain; a real domain is never overwritten (it is half the merge key).
// - merchant_name: an order confirmation is authoritative for a row that never
//   saw one; otherwise replace only a carrier name with a non-carrier one.
// Pure so the conditions are testable without the SDK; the caller adds the
// non-identity fields (dates, totals, items, logo) around it.
export interface IdentityFacts {
  merchant_name?: string | null;
  merchant_domain?: string | null;
  order_number?: string | null;
  classification?: string | null;
}

export interface IdentityOrder {
  merchant_name?: string | null;
  merchant_domain?: string | null;
  order_number?: string | null;
  ordered_at?: string | null;
}

export interface IdentityPatch {
  order_number?: string;
  merchant_domain?: string;
  ordered_at?: string;
  merchant_name?: string;
}

export function buildIdentityPatch(
  order: IdentityOrder,
  facts: IdentityFacts,
  occurredAt: string,
): IdentityPatch {
  const patch: IdentityPatch = {};
  if (!order.order_number && facts.order_number) patch.order_number = facts.order_number;
  if (
    facts.merchant_domain && !isCarrierDomain(facts.merchant_domain) &&
    (!order.merchant_domain || isCarrierDomain(order.merchant_domain))
  ) {
    patch.merchant_domain = normalizeDomain(facts.merchant_domain);
  }
  const nameDiffers = !!facts.merchant_name && facts.merchant_name !== order.merchant_name;
  if (!order.ordered_at && facts.classification === "order_confirmation") {
    patch.ordered_at = occurredAt;
    if (nameDiffers) patch.merchant_name = facts.merchant_name!;
  }
  if (
    !patch.merchant_name && nameDiffers &&
    carrierKeyFromName(order.merchant_name) !== null &&
    carrierKeyFromName(facts.merchant_name) === null
  ) {
    patch.merchant_name = facts.merchant_name!;
  }
  return patch;
}

export function fuzzyCandidates(
  facts: FuzzyFacts,
  candidates: FuzzyOrderCandidate[],
  opts: { windowDays?: number; widen?: boolean } = {},
): string[] {
  const windowDays = opts.windowDays ?? 45;
  const domain = normalizeDomain(facts.merchant_domain);
  if (!domain && !opts.widen) return [];
  const orderNo = normalizeOrderNumber(facts.order_number);
  const t = Date.parse(facts.occurredAt);
  const scored: Array<{ id: string; sameNumber: boolean; sameDomain: boolean; distance: number }> = [];
  for (const o of candidates) {
    const od = normalizeDomain(o.merchant_domain);
    const sameDomain = !!domain && !!od && od === domain;
    const wildcard = !!opts.widen || !od || isCarrierDomain(od);
    if (!sameDomain && !wildcard) continue;
    const candidateNo = normalizeOrderNumber(o.order_number);
    if (orderNo && candidateNo && candidateNo !== orderNo) continue;
    const anchor = Date.parse(o.ordered_at ?? o.last_event_at ?? o.created_date ?? "");
    const distance = Number.isNaN(anchor) || Number.isNaN(t) ? Infinity : Math.abs(t - anchor);
    if (distance !== Infinity && distance > windowDays * 24 * 3600 * 1000) continue;
    scored.push({ id: o.id, sameNumber: !!orderNo && candidateNo === orderNo, sameDomain, distance });
  }
  scored.sort((a, b) =>
    a.sameNumber !== b.sameNumber
      ? (a.sameNumber ? -1 : 1)
      : a.sameDomain !== b.sameDomain
      ? (a.sameDomain ? -1 : 1)
      : a.distance - b.distance
  );
  return scored.map((s) => s.id);
}
