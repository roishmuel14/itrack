// Cleanup for the agent isolation gate. Idempotent: safe to run any number of
// times, including when nothing was seeded.
// Run (from the repo root, admin login):
//   cat scripts/agent-leak-cleanup.ts | base44 exec

const MERCHANTS = ["CanaryMart", "IsolationMart"];
let orders = 0;
let children = 0;

for (const merchant of MERCHANTS) {
  for (const o of await base44.entities.Order.filter({ merchant_name: merchant }, "-created_date", 200)) {
    if (!String(o.order_number ?? "").startsWith("AGENT-ISO-")) continue;
    for (const e of await base44.entities.TrackingEvent.filter({ order_id: o.id }, "-created_date", 200)) {
      await base44.entities.TrackingEvent.delete(e.id);
      children++;
    }
    for (const s of await base44.entities.Shipment.filter({ order_id: o.id }, "-created_date", 200)) {
      await base44.entities.Shipment.delete(s.id);
      children++;
    }
    await base44.entities.Order.delete(o.id);
    orders++;
  }
}

console.log(`cleanup: removed ${orders} AGENT-ISO-* order(s) and ${children} child row(s)`);
