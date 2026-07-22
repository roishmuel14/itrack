// deno test scripts/tests/  (local only; never deployed)
import { assertEquals } from "jsr:@std/assert";
import {
  canTransition,
  computeStatus,
  decideMerge,
  fuzzyCandidates,
  normalizeDomain,
  normalizeOrderNumber,
  orderStatusFromShipments,
  type StatusSignal,
} from "../../base44/shared/mergeEngine.ts";

const sig = (rank: number | null, occurredAt: string, extra: Partial<StatusSignal> = {}): StatusSignal => ({
  rank,
  occurredAt,
  ...extra,
});

Deno.test("computeStatus: in-order confirmation -> shipped -> delivered", () => {
  const s = computeStatus([sig(0, "2026-07-01"), sig(1, "2026-07-02"), sig(4, "2026-07-05")]);
  assertEquals(s, "delivered");
});

Deno.test("computeStatus: ANY arrival order still ends delivered (PRD F2 AC1)", () => {
  const s = computeStatus([sig(4, "2026-07-05"), sig(0, "2026-07-01"), sig(1, "2026-07-02")]);
  assertEquals(s, "delivered");
});

Deno.test("computeStatus: late-arriving lower-rank email never regresses (AC3)", () => {
  // in_transit known, then an old 'shipped' email arrives late
  const s = computeStatus([sig(2, "2026-07-03"), sig(1, "2026-07-02")]);
  assertEquals(s, "in_transit");
});

Deno.test("computeStatus: delay annotates while newest, clears when overtaken", () => {
  const delayedNow = computeStatus([sig(2, "2026-07-03"), sig(null, "2026-07-04", { isDelay: true })]);
  assertEquals(delayedNow, "delayed");
  const progressed = computeStatus([
    sig(2, "2026-07-03"),
    sig(null, "2026-07-04", { isDelay: true }),
    sig(3, "2026-07-05"),
  ]);
  assertEquals(progressed, "out_for_delivery");
});

Deno.test("computeStatus: delay never shows on a delivered order", () => {
  const s = computeStatus([sig(4, "2026-07-03"), sig(null, "2026-07-04", { isDelay: true })]);
  assertEquals(s, "delivered");
});

Deno.test("computeStatus: cancelled is terminal and wins", () => {
  const s = computeStatus([
    sig(2, "2026-07-03"),
    sig(null, "2026-07-04", { terminal: "cancelled" }),
    sig(3, "2026-07-05"),
  ]);
  assertEquals(s, "cancelled");
});

Deno.test("computeStatus: only a delay signal -> delayed; nothing -> ordered", () => {
  assertEquals(computeStatus([sig(null, "2026-07-04", { isDelay: true })]), "delayed");
  assertEquals(computeStatus([]), "ordered");
});

Deno.test("orderStatusFromShipments: max rank wins; all-terminal propagates", () => {
  assertEquals(orderStatusFromShipments(["in_transit", "delivered"]), "delivered");
  assertEquals(orderStatusFromShipments(["shipped", "in_transit"]), "in_transit");
  assertEquals(orderStatusFromShipments(["delayed", "shipped"]), "delayed");
  assertEquals(orderStatusFromShipments(["cancelled", "returned"]), "returned");
  assertEquals(orderStatusFromShipments([]), null);
});

Deno.test("canTransition: monotonic manual moves", () => {
  assertEquals(canTransition("in_transit", "delivered"), true);
  assertEquals(canTransition("delivered", "in_transit"), false);
  assertEquals(canTransition("delivered", "returned"), true);
  assertEquals(canTransition("cancelled", "delivered"), false);
  assertEquals(canTransition("delayed", "delivered"), true);
  assertEquals(canTransition("delivered", "delayed"), false);
});

Deno.test("normalize helpers", () => {
  assertEquals(normalizeDomain("https://www.Amazon.com/gp/help"), "amazon.com");
  assertEquals(normalizeOrderNumber("#114-3941689-London "), "114-3941689-LONDON");
});

Deno.test("decideMerge: order-number key beats tracking; tracking matches shipment's order", () => {
  const orders = [{ id: "o1", merchant_domain: "amazon.com", order_number: "114-555" }];
  const shipments = [{ id: "s1", order_id: "o1", tracking_number: "TBA123" }];
  assertEquals(
    decideMerge({ merchant_domain: "www.amazon.com", order_number: "#114-555" }, orders, shipments),
    { kind: "matched_order", orderId: "o1", via: "order_number" },
  );
  assertEquals(
    decideMerge({ tracking_number: "tba-123" }, orders, shipments),
    { kind: "matched_order", orderId: "o1", via: "tracking_number" },
  );
  assertEquals(decideMerge({ order_number: "999" }, orders, shipments), { kind: "new_order" });
  assertEquals(
    decideMerge({ merchant_domain: "amazon.com" }, orders, shipments, ["o1"]),
    { kind: "ambiguous", candidateOrderIds: ["o1"] },
  );
});

Deno.test("fuzzyCandidates: same merchant within window only", () => {
  const orders = [
    { id: "near", merchant_domain: "temu.com", ordered_at: "2026-07-01" },
    { id: "far", merchant_domain: "temu.com", ordered_at: "2026-01-01" },
    { id: "other", merchant_domain: "shein.com", ordered_at: "2026-07-01" },
  ];
  assertEquals(fuzzyCandidates({ merchant_domain: "temu.com", occurredAt: "2026-07-10" }, orders), ["near"]);
});
