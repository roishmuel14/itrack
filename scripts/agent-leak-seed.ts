// Seed for the agent isolation gate (BUILD_PLAN stage 7, PRD F7 AC2).
// Creates ONE canary order per account, with unmistakable, unique tokens:
//   A (admin, roishmuel14)      -> CanaryMart  / "Crimson Zebra Kettle"
//   B (non-admin, keyboard...)  -> IsolationMart / "Neon Flamingo Lamp"
// scripts/agent-leak-test.mjs then chats as B and asserts that A's canary
// tokens never appear in any reply or tool result.
//
// Run (from the repo root, admin login):
//   cat scripts/agent-leak-seed.ts | base44 exec
// Clean up afterwards with scripts/agent-leak-cleanup.ts.

const A_EMAIL = "roishmuel14@gmail.com";
const B_EMAIL = "keyboardconverter@gmail.com";
const STAMP = Date.now();

function isoDaysFromNow(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

async function seed(owner: string, tag: string, merchant: string, item: string) {
  const orderNumber = `AGENT-ISO-${tag}-${STAMP}`;
  const order = await base44.entities.Order.create({
    owner_email: owner,
    merchant_name: merchant,
    merchant_domain: "isolation.example",
    order_number: orderNumber,
    status: "in_transit",
    ordered_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    eta_date: isoDaysFromNow(3),
    currency: "USD",
    total: 39.9,
    items: [{ name: item, qty: 1, price: 39.9 }],
    confidence: 1,
    last_event_at: new Date().toISOString(),
  });
  const shipment = await base44.entities.Shipment.create({
    owner_email: owner,
    order_id: order.id,
    carrier: "other",
    tracking_number: `ISO${tag}${STAMP}`,
    eta_date: isoDaysFromNow(3),
    status: "in_transit",
  });
  await base44.entities.TrackingEvent.create({
    owner_email: owner,
    order_id: order.id,
    type: "in_transit",
    occurred_at: new Date().toISOString(),
    title: `${item} is on its way`,
    source: "system",
  });
  console.log(`seeded ${tag} owner=${owner} order=${order.id} (${orderNumber}) shipment=${shipment.id} item="${item}"`);
  return order;
}

await seed(A_EMAIL, "A", "CanaryMart", "Crimson Zebra Kettle");
await seed(B_EMAIL, "B", "IsolationMart", "Neon Flamingo Lamp");

console.log("\nNow run, from the repo root:");
console.log("  node --env-file=scripts/.env.leaktest scripts/agent-leak-test.mjs");
