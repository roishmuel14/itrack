// Test fixture (BUILD_PLAN stage 6, extended for PRD amendment v1.6's staged
// escalation): backdate a demo order's promised_date so refunds/scan finds
// it a chosen number of days late. `base44 exec` takes no CLI arguments (see
// `base44 exec --help`: stdin-only), so DAYS_LATE is an editable constant,
// same pattern as DRY_RUN in scripts/purge-bogus-refunds.ts.
//
// Stage reference (refunds/scan): 1-13 days late = "late", 14-29 =
// "likely_lost", 30+ = "dispute". Targets the LEAST recently created active
// order with a Temu domain (has a merchant policy, easy to eyeball), else
// any active order; set TARGET_DOMAIN to aim at a specific merchant instead.
//
// Run: cat scripts/force-overdue.ts | base44 exec
// Then trigger a scan: curl -X POST https://<app>.base44.app/api/apps/<id>/functions/refunds/scan

const DAYS_LATE = 6;
const TARGET_DOMAIN = "temu.com"; // set to another merchant_domain, or "" for any active order

const orders = await base44.entities.Order.list("-created_date", 100);
const active = orders.filter((o: any) =>
  ["ordered", "shipped", "in_transit", "out_for_delivery", "delayed"].includes(o.status) && !o.is_archived
);
const target = (TARGET_DOMAIN ? active.find((o: any) => o.merchant_domain === TARGET_DOMAIN) : null) ?? active[0];
if (!target) {
  console.log("no active order to backdate; add one first");
} else {
  const past = new Date();
  past.setUTCDate(past.getUTCDate() - DAYS_LATE);
  const promised = past.toISOString().slice(0, 10);
  await base44.entities.Order.update(target.id, { promised_date: promised });
  const stage = DAYS_LATE >= 30 ? "dispute" : DAYS_LATE >= 14 ? "likely_lost" : "late";
  console.log(JSON.stringify({
    backdated: target.id,
    merchant: target.merchant_name,
    promised_date: promised,
    days_late: DAYS_LATE,
    expected_stage: stage,
    status: target.status,
  }));
}
