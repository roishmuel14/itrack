import { assertEquals } from "jsr:@std/assert";
import {
  extractImageCandidates,
  extractImageCandidatesDetailed,
  extractLinkCandidates,
  htmlToText,
  truncateForLLM,
} from "../../base44/shared/htmlToText.ts";

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

Deno.test("extractImageCandidatesDetailed: alt decoded, declared dims parsed, filters intact", () => {
  const html = `
    <img src="https://cdn.shop.com/ball.jpg" alt="Mikasa FT-5 &amp; pump" width="300" height='300'>
    <img width=180 src="https://cdn.shop.com/logo.png" alt="LaPelota">
    <img src="https://cdn.shop.com/noattrs.png">
    <img src="https://track.shop.com/pixel.gif" width="1" height="1">
    <img src="cid:inline-attachment">`;
  assertEquals(extractImageCandidatesDetailed(html), [
    { src: "https://cdn.shop.com/ball.jpg", alt: "Mikasa FT-5 & pump", width: 300, height: 300 },
    { src: "https://cdn.shop.com/logo.png", alt: "LaPelota", width: 180, height: null },
    { src: "https://cdn.shop.com/noattrs.png", alt: "", width: null, height: null },
  ]);
});

Deno.test("extractImageCandidates wrapper equals detailed srcs on the shared fixture", () => {
  const html = `
    <img src="https://cdn.shop.com/product1.jpg" width="300">
    <img src="https://track.shop.com/open.aspx?id=1" width="1" height="1">
    <img src="https://cdn.shop.com/product2.png" alt="item">`;
  assertEquals(extractImageCandidates(html), extractImageCandidatesDetailed(html).map((c) => c.src));
});

Deno.test("extractLinkCandidates: keeps product links incl. redirectors, drops nav/legal/social", () => {
  const html = `
    <a href="https://click.email.shop.com/f/a/AbC123?u=https%3A%2F%2Fshop.com%2Fp%2F42">Buy again</a>
    <a href="https://shop.com/products/dog-bed?variant=7&amp;utm_source=email">EHEYCIGA Dog Bed</a>
    <a href="https://shop.com/products/dog-bed?variant=7&amp;utm_source=email">dup</a>
    <a href="https://shop.com/unsubscribe?id=1">Unsubscribe</a>
    <a href="https://shop.com/email-preferences">Preferences</a>
    <a href="https://shop.com/privacy">Privacy policy</a>
    <a href="https://shop.com/help/contact-us">Help</a>
    <a href="https://www.facebook.com/shop">Facebook</a>
    <a href="https://apps.apple.com/app/id1">App Store</a>
    <a href="mailto:support@shop.com">Mail us</a>
    <a href="#top">Top</a>
    <a name="anchor-no-href">x</a>`;
  assertEquals(extractLinkCandidates(html), [
    "https://click.email.shop.com/f/a/AbC123?u=https%3A%2F%2Fshop.com%2Fp%2F42",
    "https://shop.com/products/dog-bed?variant=7&utm_source=email",
  ]);
});

Deno.test("extractLinkCandidates: caps count and drops oversized URLs", () => {
  const many = Array.from({ length: 20 }, (_, i) => `<a href="https://s.com/p/${i}">x</a>`).join("");
  assertEquals(extractLinkCandidates(many, 15).length, 15);
  const huge = `<a href="https://s.com/${"a".repeat(1600)}">x</a>`;
  assertEquals(extractLinkCandidates(huge), []);
});

Deno.test("truncateForLLM caps length", () => {
  const long = "a".repeat(20000);
  const t = truncateForLLM(long, 100);
  assertEquals(t.length < 200, true);
  assertEquals(t.endsWith("[...truncated]"), true);
});
