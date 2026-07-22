// Seed the 6 RefundPolicy rows (PRD F5). Idempotent: upserts by policy_key.
// Run: cat scripts/seed-policies.ts | base44 exec
// Uses the exec-global `base44` client (authenticated as the logged-in admin).

const POLICIES = [
  {
    policy_key: "temu_on_time",
    merchant_domain: "temu.com",
    rule_type: "late_delivery",
    description: "Temu on-time delivery guarantee: credit when a package arrives after the promised date",
    window_days: 30,
    claim_url: "https://www.temu.com/support-center.html",
  },
  {
    policy_key: "aliexpress_buyer_protection",
    merchant_domain: "aliexpress.com",
    rule_type: "buyer_protection",
    description: "AliExpress buyer protection: refund when the order does not arrive within the guaranteed time",
    window_days: 15,
    claim_url: "https://www.aliexpress.com/p/buyer-protection/index.html",
  },
  {
    policy_key: "amazon_guaranteed",
    merchant_domain: "amazon.com",
    rule_type: "late_delivery",
    description: "Amazon guaranteed delivery: shipping fees refunded when a guaranteed delivery date is missed",
    window_days: 30,
    claim_url: "https://www.amazon.com/gp/help/customer/contact-us",
  },
  {
    policy_key: "shein_late_credit",
    merchant_domain: "shein.com",
    rule_type: "late_delivery",
    description: "Shein late-shipment compensation points when the package ships or arrives late",
    window_days: 30,
    claim_url: "https://www.shein.com/contact-us.html",
  },
  {
    policy_key: "paypal_180",
    merchant_domain: "",
    rule_type: "buyer_protection",
    description: "PayPal buyer protection: dispute window for items not received (any merchant paid via PayPal)",
    window_days: 180,
    claim_url: "https://www.paypal.com/disputes/",
  },
  {
    policy_key: "cc_chargeback",
    merchant_domain: "",
    rule_type: "chargeback_window",
    description: "Credit card chargeback: most issuers accept disputes for items not received within this window",
    window_days: 120,
    claim_url: "",
  },
];

const existing = await base44.entities.RefundPolicy.list();
const byKey = new Map(existing.map((p: any) => [p.policy_key, p]));

let created = 0, updated = 0, unchanged = 0;
for (const policy of POLICIES) {
  const current = byKey.get(policy.policy_key);
  if (!current) {
    await base44.entities.RefundPolicy.create(policy);
    created++;
    continue;
  }
  const drifted = Object.entries(policy).some(([k, v]) => (current as any)[k] !== v);
  if (drifted) {
    await base44.entities.RefundPolicy.update((current as any).id, policy);
    updated++;
  } else {
    unchanged++;
  }
}

const finalCount = (await base44.entities.RefundPolicy.list()).length;
console.log(JSON.stringify({ created, updated, unchanged, total: finalCount }));
