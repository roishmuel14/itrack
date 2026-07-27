// mergeItems fills gaps in an order's line items from a later, richer email.
// The load-bearing rule: a photo the merchant sent outranks anything
// enrichment found on the web, because web results are regularly the wrong
// colourway or a series shot. Run: deno test tests/

import { assertEquals } from "jsr:@std/assert";
import { mergeItems } from "../base44/shared/pipeline.ts";

Deno.test("a later email fills a blank image", () => {
  const { items, changed } = mergeItems(
    [{ name: "Ball" }],
    [{ name: "Ball", image_url: "https://cdn/b.jpg", image_width: 400, image_source: "email" }],
  );
  assertEquals(changed, true);
  assertEquals(items[0].image_url, "https://cdn/b.jpg");
  assertEquals(items[0].image_source, "email");
});

Deno.test("an email photo replaces a web-sourced one", () => {
  for (const stored of ["search", "product_page"]) {
    const { items, changed } = mergeItems(
      [{ name: "Ball", image_url: "https://cdn/web.jpg", image_width: 1000, image_source: stored }],
      [{ name: "Ball", image_url: "https://cdn/email.jpg", image_width: 160, image_source: "email" }],
    );
    assertEquals(changed, true, `${stored} should yield to the merchant's own photo`);
    assertEquals(items[0].image_url, "https://cdn/email.jpg");
    assertEquals(items[0].image_width, 160, "provenance beats resolution");
  }
});

Deno.test("an email photo is never overwritten, by the web or by another email", () => {
  const stored = { name: "Ball", image_url: "https://cdn/first.jpg", image_width: 160, image_source: "email" };
  for (const source of ["email", "search", "product_page"]) {
    const { items } = mergeItems(
      [{ ...stored }],
      [{ name: "Ball", image_url: "https://cdn/other.jpg", image_width: 2000, image_source: source }],
    );
    assertEquals(items[0].image_url, "https://cdn/first.jpg", `${source} must not displace an email photo`);
  }
});

Deno.test("gap filling for the other fields is unchanged, and items are never added or removed", () => {
  const { items, changed } = mergeItems(
    [{ name: "Ball", qty: 1 }, { name: "Net" }],
    [{ name: "Ball", qty: 3, price: 42, product_url: "https://shop/p/1" }, { name: "Whistle" }],
  );
  assertEquals(changed, true);
  assertEquals(items.length, 2, "a partial shipping confirmation must not truncate the order");
  assertEquals(items[0].qty, 3);
  assertEquals(items[0].price, 42);
  assertEquals(items[0].product_url, "https://shop/p/1");
  assertEquals(items[1].name, "Net");
});
