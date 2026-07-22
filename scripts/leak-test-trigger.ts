// Companion to leak-test.mjs: while B's realtime window is open, create,
// update, and delete an Order + TrackingEvent owned by A (the admin/CLI user).
// B must receive NONE of these events.
// Run (as the admin CLI login): cat scripts/leak-test-trigger.ts | base44 exec

const A_EMAIL = "roishmuel14@gmail.com";

const order = await base44.entities.Order.create({
  owner_email: A_EMAIL,
  merchant_name: "LeakTest Store",
  merchant_domain: "leaktest.example",
  order_number: "LT-1",
  status: "ordered",
});
console.log(`created A-owned order ${order.id}`);

const event = await base44.entities.TrackingEvent.create({
  owner_email: A_EMAIL,
  order_id: order.id,
  type: "order_confirmation",
  occurred_at: new Date().toISOString(),
  title: "Leak test event",
  source: "system",
});
console.log(`created A-owned tracking event ${event.id}`);

await base44.entities.Order.update(order.id, { status: "shipped" });
console.log("updated A-owned order status");

await new Promise((r) => setTimeout(r, 2000));

await base44.entities.TrackingEvent.delete(event.id);
await base44.entities.Order.delete(order.id);
console.log("cleaned up leak-test rows");
