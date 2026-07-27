import { assertEquals } from "jsr:@std/assert";
import { extractPageImageCandidates } from "../base44/shared/productImage.ts";

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
