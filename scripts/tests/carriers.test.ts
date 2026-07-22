import { assertEquals } from "jsr:@std/assert";
import { carrierKeyFromName, detectCarrier, resolveCarrier } from "../../base44/shared/carriers.ts";

Deno.test("detectCarrier: known formats", () => {
  assertEquals(detectCarrier("1Z999AA10123456784"), "ups");
  assertEquals(detectCarrier("9400111899223197428490"), "usps");
  assertEquals(detectCarrier("RR123456789IL"), "israel_post");
  assertEquals(detectCarrier("EE987654321IL"), "israel_post");
  assertEquals(detectCarrier("1234567890"), "dhl");
  assertEquals(detectCarrier("123456789012"), "fedex");
  assertEquals(detectCarrier("123456789012345"), "fedex");
  assertEquals(detectCarrier("RB123456789CN"), "generic");
  assertEquals(detectCarrier("not-a-number!"), null);
});

Deno.test("carrierKeyFromName: fuzzy names", () => {
  assertEquals(carrierKeyFromName("UPS Ground"), "ups");
  assertEquals(carrierKeyFromName("United States Postal Service"), "usps");
  assertEquals(carrierKeyFromName("FedEx Home Delivery"), "fedex");
  assertEquals(carrierKeyFromName("DHL eCommerce"), "dhl");
  assertEquals(carrierKeyFromName("Israel Post"), "israel_post");
  assertEquals(carrierKeyFromName("Some Local Courier"), null);
});

Deno.test("resolveCarrier: name beats pattern, generic fallback, links well-formed", () => {
  const ups = resolveCarrier("1Z999AA10123456784");
  assertEquals(ups?.name, "UPS");
  assertEquals(ups?.url.includes("ups.com"), true);
  assertEquals(ups?.url.includes("1Z999AA10123456784"), true);

  // 12-digit number would pattern-match FedEx, but the email said DHL.
  const dhl = resolveCarrier("123456789012", "DHL Express");
  assertEquals(dhl?.key, "dhl");

  const unknown = resolveCarrier("XX-77-UNKNOWN-99", "Some Local Courier");
  assertEquals(unknown?.key, "generic");
  assertEquals(unknown?.name, "Some Local Courier");
  assertEquals(unknown?.url.includes("aftership.com"), true);

  assertEquals(resolveCarrier(""), null);
  assertEquals(resolveCarrier(null), null);
});
