// Test fixture (BUILD_PLAN stage 6): backdate the demo Temu order so the
// refund scan finds it overdue. Targets the LEAST recently created active
// order with a Temu domain, else any active order.
// Run: cat scripts/force-overdue.ts | base44 exec

const orders = await base44.entities.Order.list("-created_date", 100);
const active = orders.filter((o: any) =>
  ["ordered", "shipped", "in_transit", "out_for_delivery", "delayed"].includes(o.status) && !o.is_archived
);
const target = active.find((o: any) => o.merchant_domain === "temu.com") ?? active[0];
if (!target) {
  console.log("no active order to backdate; add one first");
} else {
  const past = new Date();
  past.setUTCDate(past.getUTCDate() - 6);
  const promised = past.toISOString().slice(0, 10);
  await base44.entities.Order.update(target.id, { promised_date: promised });
  console.log(JSON.stringify({ backdated: target.id, merchant: target.merchant_name, promised_date: promised, status: target.status }));
}
