// deno test scripts/tests/  (local only; never deployed)
// Policy gates from PRD amendment v1.4: only physical parcels become cards,
// and weak classifications can never open one.
import { assertEquals } from "jsr:@std/assert";
import { canCreateOrder, isTrackablePurchase } from "../../base44/shared/extract.ts";

type GateInput = Parameters<typeof isTrackablePurchase>[0];
const kind = (
  product_kind: GateInput["product_kind"],
  extra: Partial<GateInput> = {},
): GateInput => ({
  product_kind,
  tracking_number: null,
  carrier: null,
  ...extra,
});

Deno.test("isTrackablePurchase: physical goods always pass", () => {
  assertEquals(isTrackablePurchase(kind("physical_goods")), true);
  assertEquals(isTrackablePurchase(kind("physical_goods", { tracking_number: "RU0138163407Z" })), true);
});

Deno.test("isTrackablePurchase: named exclusion kinds are final, evidence never overrides", () => {
  // A Wolt receipt with courier metadata must still drop (v1.4 ruling).
  assertEquals(isTrackablePurchase(kind("food_or_grocery_delivery", { tracking_number: "123456" })), false);
  assertEquals(isTrackablePurchase(kind("food_or_grocery_delivery")), false);
  assertEquals(isTrackablePurchase(kind("digital_or_saas", { carrier: "DHL" })), false);
  assertEquals(isTrackablePurchase(kind("service_or_booking")), false);
});

Deno.test("isTrackablePurchase: 'other'/missing kinds need hard logistics evidence", () => {
  // Terse carrier notices (Israel Post, FedEx) name no product but carry
  // tracking; they must survive.
  assertEquals(isTrackablePurchase(kind("other", { tracking_number: "874775854036" })), true);
  assertEquals(isTrackablePurchase(kind("other", { carrier: "Israel Post" })), true);
  assertEquals(isTrackablePurchase(kind(null, { carrier: "FedEx" })), true);
  // No evidence at all: drop.
  assertEquals(isTrackablePurchase(kind("other")), false);
  assertEquals(isTrackablePurchase(kind(null)), false);
});

Deno.test("canCreateOrder: only order-flow classifications open a card", () => {
  for (const c of ["order_confirmation", "shipping_update", "delivery", "delay"]) {
    assertEquals(canCreateOrder(c), true, c);
  }
  // The Israir flight card came from other_order_related creating an order.
  for (const c of ["seller_message", "refund_update", "other_order_related", "irrelevant", ""]) {
    assertEquals(canCreateOrder(c), false, c || "(empty)");
  }
});
