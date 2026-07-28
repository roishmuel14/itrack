// One-time cleanup for the duplicate-order bug (BUILD_PLAN "OPEN BUGS",
// fixed in the merge engine on this branch): merges each sparse duplicate row
// (born from a number-less shipping/delivery notice) into its full sibling.
//
// Self-contained on purpose: base44 exec reads the script from stdin and runs
// it server-side with a global `base44`, so local imports cannot resolve. The
// status helpers below are inlined copies of base44/shared/mergeEngine.ts
// (STATUS_RANK, EVENT_TYPE_TO_RANK, computeStatus, normalizeDomain,
// normalizeOrderNumber) as of 2026-07-28. They can drift: re-diff them against
// that file before trusting a later run.
//
// Run (from a checkout with base44/.app.jsonc, admin login):
//   cat scripts/dedupe-orders.ts | base44 exec            # DRY_RUN report
//   ...review the report, then flip DRY_RUN to false and run again.
// Idempotent: a merged pair leaves a single-order group, which no longer
// matches the pattern; a crash mid-pair resumes as no-ops and completes.
//
// STRICT pattern, everything else is report-only:
//   same owner + same normalized merchant_domain, EXACTLY 2 orders,
//   exactly one has an order_number (survivor); the other has neither an
//   order_number nor an ordered_at (victim, the notice-born sparse row);
//   neither is cancelled/returned. Groups with an empty domain are skipped
//   entirely (manual tracking-only adds legitimately have no domain and no
//   number and must never be pattern-matched).

const DRY_RUN = true;

// ---- inlined from base44/shared/mergeEngine.ts ----
const STATUS_RANK: Record<string, number> = {
  ordered: 0,
  shipped: 1,
  in_transit: 2,
  out_for_delivery: 3,
  delivered: 4,
};
const ADVANCING = ["ordered", "shipped", "in_transit", "out_for_delivery", "delivered"];
const EVENT_TYPE_TO_RANK: Record<string, number | undefined> = {
  order_confirmation: 0,
  shipment: 1,
  transit_update: 2,
  out_for_delivery: 3,
  delivered: 4,
};
function computeStatusFromEvents(events: Array<{ type: string; occurred_at: string }>): string {
  let bestRank = -1;
  let bestRankAt = "";
  let latestDelayAt = "";
  for (const e of events) {
    const rank = EVENT_TYPE_TO_RANK[e.type];
    const at = e.occurred_at ?? "";
    if (typeof rank === "number") {
      if (rank > bestRank || (rank === bestRank && at > bestRankAt)) {
        bestRank = rank;
        bestRankAt = at;
      }
    }
    if (e.type === "delay" && at > latestDelayAt) latestDelayAt = at;
  }
  if (bestRank < 0) return latestDelayAt ? "delayed" : "ordered";
  if (bestRank >= STATUS_RANK.delivered) return "delivered";
  if (latestDelayAt && latestDelayAt > bestRankAt) return "delayed";
  return ADVANCING[bestRank];
}
function normalizeDomain(domain: unknown): string {
  if (!domain || typeof domain !== "string") return "";
  return domain.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}
function normalizeOrderNumber(orderNumber: unknown): string {
  if (!orderNumber || typeof orderNumber !== "string") return "";
  return orderNumber.trim().toUpperCase().replace(/^#/, "");
}
// ---- end inlined helpers ----

const REFUND_STATUS_PRECEDENCE: Record<string, number> = {
  recovered: 4,
  claimed: 3,
  dismissed: 2,
  notified: 1,
  detected: 0,
};
const CHILD_ENTITIES = ["TrackingEvent", "EmailRecord", "Shipment", "RefundOpportunity"] as const;

const ORDER_LIMIT = 1000;
const orders = await base44.entities.Order.list("-created_date", ORDER_LIMIT);
if (orders.length === ORDER_LIMIT) {
  console.log(
    `WARNING: read exactly ${ORDER_LIMIT} orders, so the list may be truncated and some duplicate ` +
      `pairs invisible. Raise ORDER_LIMIT and re-run before treating a clean report as complete.`,
  );
}
const groups = new Map<string, any[]>();
for (const o of orders) {
  const domain = normalizeDomain(o.merchant_domain);
  if (!domain) continue; // never touch domainless rows (manual tracking adds)
  const key = `${o.owner_email}::${domain}`;
  groups.set(key, [...(groups.get(key) ?? []), o]);
}

let merged = 0;
const reportOnly: string[] = [];

for (const [key, group] of groups) {
  if (group.length === 1) continue;
  if (group.length !== 2) {
    reportOnly.push(`${key}: ${group.length} orders, needs manual review`);
    continue;
  }
  const [a, b] = group;
  const aNo = normalizeOrderNumber(a.order_number);
  const bNo = normalizeOrderNumber(b.order_number);
  if (!!aNo === !!bNo) {
    reportOnly.push(`${key}: ${aNo ? "both have" : "neither has"} an order number, skipping`);
    continue;
  }
  const survivor = aNo ? a : b;
  const victim = aNo ? b : a;
  if (victim.ordered_at) {
    reportOnly.push(`${key}: number-less row has ordered_at (saw a confirmation), skipping`);
    continue;
  }
  if (["cancelled", "returned"].includes(survivor.status) || ["cancelled", "returned"].includes(victim.status)) {
    reportOnly.push(`${key}: terminal status in pair, skipping`);
    continue;
  }

  console.log(`MERGE ${key}: victim ${victim.id} (${victim.status}) -> survivor ${survivor.id} (#${survivor.order_number}, ${survivor.status})`);

  // 1. Repoint every child row.
  for (const entity of CHILD_ENTITIES) {
    const rows = await base44.entities[entity].filter({ order_id: victim.id }, "-created_date", 500);
    for (const row of rows) {
      console.log(`  repoint ${entity} ${row.id}`);
      if (!DRY_RUN) await base44.entities[entity].update(row.id, { order_id: survivor.id });
    }
  }

  // 2. Fill survivor gaps from the victim; never overwrite non-null values.
  const patch: Record<string, unknown> = {};
  for (const field of ["ordered_at", "total", "currency", "promised_date", "eta_date", "logo_domain", "logo_url", "logo_source", "logo_width"]) {
    if (survivor[field] == null && victim[field] != null) patch[field] = victim[field];
  }
  if ((survivor.items ?? []).length === 0 && (victim.items ?? []).length > 0) patch.items = victim.items;
  const maxLastEvent = [survivor.last_event_at, victim.last_event_at].filter(Boolean).sort().pop();
  if (maxLastEvent && maxLastEvent !== survivor.last_event_at) patch.last_event_at = maxLastEvent;

  // 3. Recompute status from the union of tracking events, monotonic:
  // never demote the survivor below its current rank. Fetch under BOTH ids
  // and union by row id: entity reads can lag the repoints from step 1.
  const unionById = (a: any[], b: any[]) => {
    const seen = new Set<string>();
    return [...a, ...b].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  };
  const unionEvents = unionById(
    await base44.entities.TrackingEvent.filter({ order_id: survivor.id }, "-created_date", 500),
    await base44.entities.TrackingEvent.filter({ order_id: victim.id }, "-created_date", 500),
  );
  const computed = computeStatusFromEvents(unionEvents);
  const survivorRank = STATUS_RANK[survivor.status] ?? -1;
  const computedRank = STATUS_RANK[computed] ?? -1;
  let finalStatus = survivor.status;
  if (computedRank > survivorRank) finalStatus = computed;
  else if (computed === "delayed" && survivor.status !== "delivered") finalStatus = computed;
  if (finalStatus !== survivor.status) patch.status = finalStatus;

  console.log(`  patch survivor: ${JSON.stringify(patch)}`);
  if (!DRY_RUN && Object.keys(patch).length > 0) await base44.entities.Order.update(survivor.id, patch);

  // 4. Dedupe refund opportunities now sharing the survivor: one per
  // policy_key, keeping the most progressed status so a user-dismissed or
  // claimed opportunity is never resurrected by a "detected" twin.
  const allOpps = unionById(
    await base44.entities.RefundOpportunity.filter({ order_id: survivor.id }, "-created_date", 200),
    await base44.entities.RefundOpportunity.filter({ order_id: victim.id }, "-created_date", 200),
  );
  const byPolicy = new Map<string, any[]>();
  for (const opp of allOpps) byPolicy.set(opp.policy_key, [...(byPolicy.get(opp.policy_key) ?? []), opp]);
  for (const [policyKey, rows] of byPolicy) {
    if (rows.length < 2) continue;
    rows.sort((x, y) =>
      (REFUND_STATUS_PRECEDENCE[y.status] ?? -1) - (REFUND_STATUS_PRECEDENCE[x.status] ?? -1) ||
      String(x.created_date).localeCompare(String(y.created_date))
    );
    for (const extra of rows.slice(1)) {
      console.log(`  delete duplicate RefundOpportunity ${extra.id} (${policyKey}, ${extra.status})`);
      if (!DRY_RUN) await base44.entities.RefundOpportunity.delete(extra.id);
    }
  }

  // 5. Delete the victim only when it is verifiably childless.
  if (!DRY_RUN) {
    let leftovers = 0;
    for (const entity of CHILD_ENTITIES) {
      leftovers += (await base44.entities[entity].filter({ order_id: victim.id }, "-created_date", 10)).length;
    }
    if (leftovers > 0) {
      console.log(`  ABORT delete: victim ${victim.id} still has ${leftovers} child row(s); re-run the script`);
      continue;
    }
    await base44.entities.Order.delete(victim.id);
  }
  console.log(`  delete victim order ${victim.id}`);
  merged++;
}

console.log("");
console.log(`${DRY_RUN ? "[DRY RUN] would merge" : "merged"} ${merged} duplicate pair(s) out of ${orders.length} order(s)`);
for (const line of reportOnly) console.log(`report-only: ${line}`);
