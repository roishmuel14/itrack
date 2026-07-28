// One-time cleanup for the refund-radar correctness rework (plan: "the
// refund page is glimmering"). Every existing RefundOpportunity row is a
// product of the old per-order+policy logic with a generic PayPal/chargeback
// catch-all (the LaPelota/KSP false-claims bug); the uniqueness key is also
// changing (order_id+policy_key -> owner_email+order_id). There is nothing
// worth salvaging: delete all of them and let the corrected refunds/scan
// rebuild from scratch. This loses prior dismissal history, which is
// acceptable because none of those dismissals referred to a valid claim.
//
// Self-contained on purpose (see scripts/dedupe-orders.ts precedent): base44
// exec reads this from stdin and runs it server-side with a global `base44`,
// so local imports cannot resolve.
//
// Run (from a checkout with base44/.app.jsonc, admin login):
//   cat scripts/purge-bogus-refunds.ts | base44 exec        # DRY_RUN report
//   ...review the report, then flip DRY_RUN to false and run again.
// Idempotent: a second run (DRY_RUN or not) reports/deletes zero once the
// table is empty.

const DRY_RUN = true;

const LIMIT = 5000;
const rows = await base44.entities.RefundOpportunity.list("-created_date", LIMIT);
if (rows.length === LIMIT) {
  console.log(
    `WARNING: read exactly ${LIMIT} rows, the table may be larger. Re-run after this pass empties it ` +
      `to confirm nothing was left behind.`,
  );
}

const byPolicy = new Map<string, number>();
const byStatus = new Map<string, number>();
for (const r of rows as any[]) {
  byPolicy.set(r.policy_key, (byPolicy.get(r.policy_key) ?? 0) + 1);
  byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
}

console.log(`${DRY_RUN ? "[DRY RUN] would delete" : "deleting"} ${rows.length} RefundOpportunity row(s)`);
console.log("by policy_key:", JSON.stringify(Object.fromEntries(byPolicy)));
console.log("by status:", JSON.stringify(Object.fromEntries(byStatus)));

if (!DRY_RUN) {
  let deleted = 0;
  for (const r of rows as any[]) {
    await base44.entities.RefundOpportunity.delete(r.id);
    deleted++;
  }
  console.log(`deleted ${deleted} row(s)`);
} else {
  console.log("");
  console.log("DRY_RUN is true: nothing was deleted. Review the counts above, flip DRY_RUN to false, and re-run.");
}
