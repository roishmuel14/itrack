import { assertEquals } from "jsr:@std/assert";
import { extractImageCandidates, htmlToText, truncateForLLM } from "../../base44/shared/htmlToText.ts";

Deno.test("htmlToText: strips tags, scripts, decodes entities, keeps structure", () => {
  const html = `<html><head><title>x</title><style>.a{color:red}</style></head>
  <body><h1>Your order&nbsp;shipped!</h1><script>evil()</script>
  <p>Total: &#36;42.50 &amp; free shipping</p><div>Arrives<br>tomorrow</div></body></html>`;
  const text = htmlToText(html);
  assertEquals(text.includes("Your order shipped!"), true);
  assertEquals(text.includes("Total: $42.50 & free shipping"), true);
  assertEquals(text.includes("evil()"), false);
  assertEquals(text.includes("color:red"), false);
  assertEquals(text.includes("Arrives\ntomorrow"), true);
});

Deno.test("extractImageCandidates: keeps product images, drops pixels and dupes", () => {
  const html = `
    <img src="https://cdn.shop.com/product1.jpg" width="300">
    <img src="https://cdn.shop.com/product1.jpg">
    <img src="https://track.shop.com/open.aspx?id=1" width="1" height="1">
    <img src="https://cdn.shop.com/spacer.gif" width="1">
    <img src="cid:inline-image-not-http">
    <img src="https://cdn.shop.com/product2.png" alt="item">`;
  const candidates = extractImageCandidates(html);
  assertEquals(candidates, [
    "https://cdn.shop.com/product1.jpg",
    "https://cdn.shop.com/product2.png",
  ]);
});

Deno.test("truncateForLLM caps length", () => {
  const long = "a".repeat(20000);
  const t = truncateForLLM(long, 100);
  assertEquals(t.length < 200, true);
  assertEquals(t.endsWith("[...truncated]"), true);
});
