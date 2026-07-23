// Companion to leak-test.mjs: fired (as the admin CLI user, service role) WHILE
// B's realtime window is open. Produces two kinds of churn:
//   - A-owned Order + TrackingEvent -> B must receive NONE of these (isolation)
//   - B-owned Order + TrackingEvent -> B MUST receive these (positive control:
//     proves subscribe() actually delivers, so "0 foreign events" cannot be a
//     false pass caused by a silently-dead subscription; PRD risk #2)
// Every row is created, updated, then deleted again.
// Run (from the MAIN repo, admin login): cat scripts/leak-test-trigger.ts | base44 exec

const A_EMAIL = "roishmuel14@gmail.com";
const B_EMAIL = "keyboardconverter@gmail.com";

async function churn(owner, tag) {
  const order = await base44.entities.Order.create({
    owner_email: owner,
    merchant_name: `LeakTest ${tag}`,
    merchant_domain: "leaktest.example",
    order_number: `LT-${tag}-${Date.now()}`,
    status: "ordered",
  });
  const event = await base44.entities.TrackingEvent.create({
    owner_email: owner,
    order_id: order.id,
    type: "order_confirmation",
    occurred_at: new Date().toISOString(),
    title: `Leak test event ${tag}`,
    source: "system",
  });
  await base44.entities.Order.update(order.id, { status: "shipped" });
  console.log(`churned ${tag} (owner=${owner}) order=${order.id} event=${event.id}`);
  return { order, event };
}

const a = await churn(A_EMAIL, "A");
const b = await churn(B_EMAIL, "B");

// Give realtime a generous moment to fan out create+update before we delete.
await new Promise((r) => setTimeout(r, 6000));

for (const x of [a, b]) {
  await base44.entities.TrackingEvent.delete(x.event.id);
  await base44.entities.Order.delete(x.order.id);
}
console.log("cleaned up all leak-test rows (A + B)");
