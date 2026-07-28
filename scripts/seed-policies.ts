// Seed the 6 RefundPolicy rows (PRD F5, amendment v1.6). Idempotent: upserts
// by policy_key. There is no generic catch-all any more: the four merchant
// policies match by domain, the two payment-rail policies match only when
// Order.payment_method carries evidence (see refunds/scan).
// Run: cat scripts/seed-policies.ts | base44 exec
// Uses the exec-global `base44` client (authenticated as the logged-in admin).

const POLICIES = [
  {
    policy_key: "temu_on_time",
    merchant_domain: "temu.com",
    rule_type: "late_delivery",
    description: "Temu on-time delivery guarantee: store credit when a package arrives after the promised date",
    window_days: 30,
    claim_url: "https://www.temu.com/support-center.html",
    payment_rail: undefined,
    remedy: "store_credit",
    min_days_late: 1,
    applies_when_delivered: true,
    deadline_from: "promised_date",
  },
  {
    policy_key: "shein_late_credit",
    merchant_domain: "shein.com",
    rule_type: "late_delivery",
    description: "Shein late-shipment compensation: store credit when the package ships or arrives late",
    window_days: 30,
    claim_url: "https://www.shein.com/contact-us.html",
    payment_rail: undefined,
    remedy: "store_credit",
    min_days_late: 1,
    applies_when_delivered: true,
    deadline_from: "promised_date",
  },
  {
    policy_key: "amazon_guaranteed",
    merchant_domain: "amazon.com",
    rule_type: "late_delivery",
    description: "Amazon guaranteed delivery: shipping fee refunded when a guaranteed delivery date is missed",
    window_days: 30,
    claim_url: "https://www.amazon.com/gp/help/customer/contact-us",
    payment_rail: undefined,
    remedy: "shipping_fee",
    min_days_late: 1,
    applies_when_delivered: true,
    deadline_from: "promised_date",
  },
  {
    policy_key: "aliexpress_buyer_protection",
    merchant_domain: "aliexpress.com",
    rule_type: "buyer_protection",
    description: "AliExpress buyer protection: full refund when the order does not arrive within the guaranteed time",
    window_days: 15,
    claim_url: "https://www.aliexpress.com/p/buyer-protection/index.html",
    payment_rail: undefined,
    remedy: "order_total",
    min_days_late: 14,
    applies_when_delivered: false,
    deadline_from: "promised_date",
  },
  {
    policy_key: "paypal_180",
    merchant_domain: "",
    rule_type: "buyer_protection",
    description: "PayPal buyer protection: dispute window for items not received, when the order was paid via PayPal",
    window_days: 180,
    claim_url: "https://www.paypal.com/disputes/",
    payment_rail: "paypal",
    remedy: "order_total",
    min_days_late: 14,
    applies_when_delivered: false,
    deadline_from: "ordered_at",
  },
  {
    policy_key: "cc_chargeback",
    merchant_domain: "",
    rule_type: "chargeback_window",
    description: "Credit card chargeback: most issuers accept disputes for items not received within this window, when the order was paid by card",
    window_days: 120,
    claim_url: "",
    payment_rail: "credit_card",
    remedy: "order_total",
    min_days_late: 30,
    applies_when_delivered: false,
    deadline_from: "ordered_at",
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
