// Unit tests for the pure merge decision (base44/shared/mergeEngine.ts).
// Run: deno test tests/
// Zero dependencies so the suite runs offline; assertions are inline.

import { decideMerge, policyDomainMatches } from "../base44/shared/mergeEngine.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n  got:  ${a}\n  want: ${b}`);
}

const noShipments: Array<{ id: string; order_id: string; tracking_number?: string | null }> = [];

Deno.test("domain + order number: exact match wins", () => {
  const d = decideMerge(
    { merchant_domain: "amazon.com", order_number: "111-7607719-8537017" },
    [{ id: "o1", merchant_domain: "www.amazon.com", order_number: "#111-7607719-8537017" }],
    noShipments,
  );
  eq(d, { kind: "matched_order", orderId: "o1", via: "order_number" }, "normalized domain+order# should match");
});

Deno.test("order-number fallback: candidate lacks a domain", () => {
  const d = decideMerge(
    { merchant_domain: "hazi-hinam.co.il", order_number: "8470620" },
    [{ id: "o1", merchant_domain: null, order_number: "8470620" }],
    noShipments,
  );
  eq(d, { kind: "matched_order", orderId: "o1", via: "order_number" }, "same order#, domainless candidate should match");
});

Deno.test("order-number fallback: extraction lacks a domain", () => {
  const d = decideMerge(
    { merchant_domain: null, order_number: "PO-097-10055964068471980" },
    [{ id: "o1", merchant_domain: "temu.com", order_number: "po-097-10055964068471980" }],
    noShipments,
  );
  eq(d, { kind: "matched_order", orderId: "o1", via: "order_number" }, "domainless extraction should match on order# alone");
});

Deno.test("order-number fallback never crosses two different known domains", () => {
  const d = decideMerge(
    { merchant_domain: "amazon.com", order_number: "268603" },
    [{ id: "o1", merchant_domain: "joybox.co.il", order_number: "268603" }],
    noShipments,
  );
  eq(d, { kind: "new_order" }, "same order# on a DIFFERENT known domain must not merge");
});

Deno.test("order-number fallback ignores short low-entropy numbers", () => {
  const d = decideMerge(
    { merchant_domain: null, order_number: "1234" },
    [{ id: "o1", merchant_domain: null, order_number: "1234" }],
    noShipments,
  );
  eq(d, { kind: "new_order" }, "under 5 alphanumerics must not trigger the fallback");
});

Deno.test("order-number fallback defers to arbitration on multiple hits", () => {
  const d = decideMerge(
    { merchant_domain: null, order_number: "8470620" },
    [
      { id: "o1", merchant_domain: "hazi-hinam.co.il", order_number: "8470620" },
      { id: "o2", merchant_domain: null, order_number: "8470620" },
    ],
    noShipments,
  );
  eq(d, { kind: "ambiguous", candidateOrderIds: ["o1", "o2"] }, "two candidates sharing the order# should be ambiguous");
});

Deno.test("tracking number matches through shipments (normalized)", () => {
  const d = decideMerge(
    { merchant_domain: null, order_number: null, tracking_number: "rr 1234-5678 il" },
    [{ id: "o9", merchant_domain: null, order_number: null }],
    [{ id: "s1", order_id: "o2", tracking_number: "RR12345678IL" }],
  );
  eq(d, { kind: "matched_order", orderId: "o2", via: "tracking_number" }, "spaces/dashes/case must not block tracking match");
});

Deno.test("no keys and no fuzzy candidates creates a new order", () => {
  const d = decideMerge({ merchant_domain: "wolt.com", order_number: null }, [], noShipments);
  eq(d, { kind: "new_order" }, "nothing to match should be new_order");
});

Deno.test("no keys with fuzzy candidates goes to arbitration", () => {
  const d = decideMerge(
    { merchant_domain: "wolt.com", order_number: null },
    [{ id: "o1", merchant_domain: "wolt.com", order_number: null }],
    noShipments,
    ["o1"],
  );
  eq(d, { kind: "ambiguous", candidateOrderIds: ["o1"] }, "fuzzy ids should surface as ambiguous");
});

// ---- policyDomainMatches (refunds/scan; PRD amendment v1.6) ----

Deno.test("policyDomainMatches: exact domain matches", () => {
  eq(policyDomainMatches("amazon.com", "amazon.com"), true, "identical domains should match");
});

Deno.test("policyDomainMatches: country TLD variants match the .com policy", () => {
  eq(policyDomainMatches("amazon.co.uk", "amazon.com"), true, "amazon.co.uk should match amazon.com");
  eq(policyDomainMatches("amazon.de", "amazon.com"), true, "amazon.de should match amazon.com");
});

Deno.test("policyDomainMatches: subdomain matches its brand's policy", () => {
  eq(policyDomainMatches("smile.amazon.com", "amazon.com"), true, "smile.amazon.com should match amazon.com");
});

Deno.test("policyDomainMatches: different merchants never match", () => {
  eq(policyDomainMatches("temu.com", "amazon.com"), false, "different brands must not match");
});

Deno.test("policyDomainMatches: empty domain on either side never matches", () => {
  eq(policyDomainMatches("", "amazon.com"), false, "empty order domain should not match (no generic fallback)");
  eq(policyDomainMatches("amazon.com", ""), false, "empty policy domain should not match");
  eq(policyDomainMatches(null, null), false, "both empty should not match");
});
