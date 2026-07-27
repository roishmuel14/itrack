import { assertEquals } from "jsr:@std/assert";
import { extractPageImageCandidates, sanitizePageUrls, validateAssetPicks } from "../base44/shared/productImage.ts";

const BASE = "https://shop.example.com/products/dog-bed";

Deno.test("extractPageImageCandidates: priority order and dedup", () => {
  const html = `
    <meta property="og:image:secure_url" content="https://cdn.shop.com/hero-secure.jpg">
    <meta property="og:image" content="https://cdn.shop.com/hero.jpg">
    <meta property="og:image" content="https://cdn.shop.com/hero-secure.jpg">
    <meta name="twitter:image" content="https://cdn.shop.com/tw.jpg">
    <link rel="image_src" href="https://cdn.shop.com/legacy.jpg">`;
  assertEquals(extractPageImageCandidates(html, BASE), [
    "https://cdn.shop.com/hero-secure.jpg",
    "https://cdn.shop.com/hero.jpg",
    "https://cdn.shop.com/tw.jpg",
    "https://cdn.shop.com/legacy.jpg",
  ]);
});

Deno.test("extractPageImageCandidates: relative and protocol-relative resolve against final URL", () => {
  const html = `
    <meta property="og:image" content="/images/main.png">
    <meta name="twitter:image" content="//cdn.shop.example.com/tw.png">`;
  assertEquals(extractPageImageCandidates(html, BASE), [
    "https://shop.example.com/images/main.png",
    "https://cdn.shop.example.com/tw.png",
  ]);
});

Deno.test("extractPageImageCandidates: JSON-LD Product image shapes incl. @graph and ImageObject", () => {
  const html = `
    <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"BreadcrumbList"},
      {"@type":["Thing","Product"],"name":"Dog Bed",
       "image":[{"@type":"ImageObject","url":"https://cdn.shop.com/ld1.jpg"},"https://cdn.shop.com/ld2.jpg"]}
    ]}
    </script>`;
  assertEquals(extractPageImageCandidates(html, BASE), [
    "https://cdn.shop.com/ld1.jpg",
    "https://cdn.shop.com/ld2.jpg",
  ]);
});

Deno.test("extractPageImageCandidates: entity-encoded URLs decode, broken JSON-LD ignored", () => {
  const html = `
    <script type="application/ld+json">{not json</script>
    <meta property="og:image" content="https://cdn.shop.com/i.jpg?a=1&amp;b=2">`;
  assertEquals(extractPageImageCandidates(html, BASE), [
    "https://cdn.shop.com/i.jpg?a=1&b=2",
  ]);
});

Deno.test("extractPageImageCandidates: JSON-LD Product image outranks og:image", () => {
  const html = `
    <meta property="og:image" content="https://cdn.shop.com/store-banner.jpg">
    <script type="application/ld+json">{"@type":"Product","image":"https://cdn.shop.com/the-actual-ball.jpg"}</script>`;
  assertEquals(extractPageImageCandidates(html, BASE), [
    "https://cdn.shop.com/the-actual-ball.jpg",
    "https://cdn.shop.com/store-banner.jpg",
  ]);
});

Deno.test("extractPageImageCandidates: caps at 4 and skips non-http", () => {
  const metas = Array.from({ length: 6 }, (_, i) => `<meta property="og:image" content="https://c.com/${i}.jpg">`)
    .join("");
  assertEquals(extractPageImageCandidates(metas, BASE).length, 4);
  assertEquals(extractPageImageCandidates(`<meta property="og:image" content="data:image/png;base64,x">`, BASE), []);
});

Deno.test("sanitizePageUrls: dedupes by registrable domain, drops generic hosts and junk, caps at 3", () => {
  assertEquals(
    sanitizePageUrls([
      "https://www.ksp.co.il/web/item/1",
      "https://ksp.co.il/web/item/2",
      "https://www.google.com/search?q=x",
      "not-a-url",
      "https://www.amazon.com/dp/B0ABC",
      "https://www.apple.com/il/shop/product/x",
      "https://zap.co.il/model.aspx?m=1",
    ]),
    [
      "https://www.ksp.co.il/web/item/1",
      "https://www.amazon.com/dp/B0ABC",
      "https://www.apple.com/il/shop/product/x",
    ],
  );
  assertEquals(sanitizePageUrls("nope"), []);
});

Deno.test("validateAssetPicks: bounds-checks, duplicate image claims drop all, logo collision drops both", () => {
  const raw = {
    item_picks: [
      { item_index: 1, link_index: 2, image_index: 1 },
      { item_index: 2, link_index: null, image_index: 1 }, // duplicate image claim -> both dropped
      { item_index: 3, link_index: 99, image_index: 3 }, // link out of bounds -> null; image ok
      { item_index: 9, link_index: 1, image_index: 2 }, // item out of bounds -> ignored
    ],
    logo_image_index: 4,
  };
  assertEquals(validateAssetPicks(raw, 3, 2, 4), {
    links: [1, null, null],
    images: [null, null, 2],
    logo: 3,
  });
  // Logo pointing at a surviving item image drops both.
  assertEquals(
    validateAssetPicks(
      { item_picks: [{ item_index: 1, link_index: null, image_index: 2 }], logo_image_index: 2 },
      1,
      0,
      3,
    ),
    { links: [null], images: [null], logo: null },
  );
  // Garbage input -> all-null shape.
  assertEquals(validateAssetPicks("garbage", 2, 1, 1), { links: [null, null], images: [null, null], logo: null });
});
