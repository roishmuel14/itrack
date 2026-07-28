// High-quality product images: follow the product page link mined from the
// order email (or found by web search) and pull its og:image / twitter:image /
// JSON-LD Product image, measure it, and re-host it. This is what upgrades a
// 120px email thumbnail into the real product photo.
//
// Threat model: product_url comes from email anchors picked by the LLM, and
// search results come from an internet-context LLM call, so every URL here is
// attacker-influenced. Same posture as rehost.ts: isSafePublicHttpUrl on the
// input AND on the post-redirect landing URL (email links are almost always
// tracking redirectors), content-type checks, byte caps, hard timeouts, and
// every failure returns null rather than throwing.

import { fetchImageBytes, isSafePublicHttpUrl, uploadImage, type FetchedImage } from "./rehost.ts";
import { BROWSERISH_HEADERS, readCapped, type ResolvedLogo } from "./merchantLogo.ts";
import { imageSize } from "./imageSize.ts";
import { registrableDomain } from "./senderDomain.ts";
import type { EmailImageCandidate } from "./htmlToText.ts";

// deno-lint-ignore no-explicit-any
type Base44Client = any;

export const HQ_MIN_PX = 256; // an image this sharp counts as HQ (replacement gate)
export const FILL_MIN_PX = 128; // acceptance gate when the item has no image at all
export const EMAIL_MIN_PX = 96; // floor for images restored from the order email itself (provenance-perfect)

// Banner shape: standard og share cards are 1.91:1 and always LANDSCAPE, so an
// image wider than this is more likely a store brand card than a product photo.
// The orientation check is load-bearing: a 12kg sack of dog food photographed
// upright is 384x710 (ratio 1.85), and an earlier version that ignored
// orientation threw that real product shot away as a "banner". Portrait images
// are never share cards, so they are always allowed.
export const ITEM_MAX_ASPECT = 1.8;

// Logos may be far wider than product photos (wordmarks), but a hero banner is
// not a logo: this keeps a promotional strip out of the card's logo sticker.
export const LOGO_MAX_ASPECT = 8;

// True only for wide landscape images, the shape a store banner actually takes.
export function isBannerShaped(w: number, h: number, maxAspect = ITEM_MAX_ASPECT): boolean {
  return w > h && w / Math.max(1, h) > maxAspect;
}

const PAGE_TIMEOUT_MS = 4000;
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_IMAGE_CANDIDATES = 4;
const MAX_IMAGE_FETCHES = 3;
const MIN_STEP_MS = 700;

export interface ProductPageImage {
  url: string; // Base44 storage URL
  width: number; // measured min(w,h) px
}

const META_RE = /<meta\b[^>]*>/gi;
const LINK_TAG_RE = /<link\b[^>]*>/gi;
const LD_JSON_RE = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const ATTR_RE = /([a-z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let a: RegExpExecArray | null;
  while ((a = ATTR_RE.exec(tag))) {
    attrs[a[1].toLowerCase()] = (a[3] ?? a[4] ?? a[5] ?? "").trim();
  }
  return attrs;
}

// URLs in meta content are entity-encoded surprisingly often.
function decodeUrlEntities(s: string): string {
  return s.replaceAll("&amp;", "&").replaceAll("&#38;", "&").replaceAll("&#x26;", "&");
}

function absolutize(href: string, base: string): string | null {
  try {
    const u = new URL(href.startsWith("//") ? `https:${href}` : href, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch (_) {
    return null;
  }
}

// image values in JSON-LD Product nodes: string | string[] | ImageObject | mixes.
function imageUrlsFromLdValue(value: unknown): string[] {
  const out: string[] = [];
  const list = Array.isArray(value) ? value : [value];
  for (const v of list) {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object" && typeof (v as Record<string, unknown>).url === "string") {
      out.push((v as Record<string, unknown>).url as string);
    }
  }
  return out;
}

function jsonLdProductImages(html: string): string[] {
  LD_JSON_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LD_JSON_RE.exec(html))) {
    let json: unknown;
    try {
      json = JSON.parse(m[1].trim());
    } catch (_) {
      continue;
    }
    // Flatten top-level arrays and @graph containers into one node list.
    const nodes: Record<string, unknown>[] = [];
    const push = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) {
        n.forEach(push);
        return;
      }
      const rec = n as Record<string, unknown>;
      nodes.push(rec);
      if (Array.isArray(rec["@graph"])) rec["@graph"].forEach(push);
    };
    push(json);
    for (const node of nodes) {
      const type = node["@type"];
      const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
      if (!isProduct) continue;
      const urls = imageUrlsFromLdValue(node.image);
      if (urls.length) return urls; // first Product node wins
    }
  }
  return [];
}

// Ranked image-URL candidates from a product page, absolutized against the
// FINAL (post-redirect) page URL. JSON-LD Product images rank FIRST: they are
// per-product by construction, while og:image is sometimes the store's
// sitewide brand banner. Exported for unit tests.
export function extractPageImageCandidates(html: string, baseUrl: string): string[] {
  // priority buckets: JSON-LD Product, og:image:secure_url, og:image, twitter, link rel=image_src
  const buckets: string[][] = [[], [], [], [], []];

  META_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = META_RE.exec(html))) {
    const attrs = parseAttrs(m[0]);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    const content = decodeUrlEntities(attrs.content ?? "");
    if (!content) continue;
    if (key === "og:image:secure_url") buckets[1].push(content);
    else if (key === "og:image" || key === "og:image:url") buckets[2].push(content);
    else if (key === "twitter:image" || key === "twitter:image:src") buckets[3].push(content);
  }

  for (const u of jsonLdProductImages(html)) buckets[0].push(decodeUrlEntities(u));

  LINK_TAG_RE.lastIndex = 0;
  while ((m = LINK_TAG_RE.exec(html))) {
    const attrs = parseAttrs(m[0]);
    if ((attrs.rel ?? "").toLowerCase() === "image_src" && attrs.href) {
      buckets[4].push(decodeUrlEntities(attrs.href));
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const bucket of buckets) {
    for (const raw of bucket) {
      const abs = absolutize(raw, baseUrl);
      if (!abs || seen.has(abs)) continue;
      seen.add(abs);
      out.push(abs);
      if (out.length >= MAX_IMAGE_CANDIDATES) return out;
    }
  }
  return out;
}

async function fetchPageHtml(
  pageUrl: string,
  budgetMs: number,
): Promise<{ html: string; finalUrl: string } | null> {
  if (budgetMs < MIN_STEP_MS) return null;
  if (!isSafePublicHttpUrl(pageUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(PAGE_TIMEOUT_MS, budgetMs));
  try {
    const res = await fetch(pageUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: BROWSERISH_HEADERS,
    });
    if (!res.ok) return null;
    const finalUrl = res.url || pageUrl;
    // The guard must hold where we LANDED, not where the redirector started.
    if (!isSafePublicHttpUrl(finalUrl)) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type && type !== "text/html" && type !== "application/xhtml+xml") return null;
    const html = await readCapped(res, MAX_PAGE_BYTES);
    return html ? { html, finalUrl } : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch one image URL directly; keep it only if it measures at least minPx on
// the short side (measured BEFORE upload, so rejects cost no storage). Pass
// maxAspect to also reject banner-shaped images (item photos), leave unset for
// logos where wide wordmarks are fine.
export async function fetchAndUploadIfLarge(
  base44: Base44Client,
  imageUrl: string,
  minPx: number,
  budgetMs: number,
  prefix = "item",
  maxAspect?: number,
): Promise<ProductPageImage | null> {
  if (budgetMs < MIN_STEP_MS) return null;
  const img = await fetchImageBytes(imageUrl, {
    timeoutMs: Math.min(PAGE_TIMEOUT_MS, budgetMs),
    headers: BROWSERISH_HEADERS,
  });
  if (!img) return null;
  const dims = imageSize(img.bytes);
  if (!dims) return null;
  const width = Math.min(dims.w, dims.h);
  if (width < minPx) return null;
  if (maxAspect && isBannerShaped(dims.w, dims.h, maxAspect)) return null;
  const hosted = await uploadImage(base44, img, prefix);
  return hosted ? { url: hosted, width } : null;
}

// Tier A: product page -> best candidate sharp enough -> Base44 storage.
// A banner-shaped candidate is only ever a last resort, and only when the
// caller opts in via allowBanner (learned from a 1200x589 store banner
// replacing a real product photo). The default is FALSE so an item photo can
// never silently become a store banner; the logo route, where a share card
// usually IS the brand mark, is the one caller that opts in.
export async function fetchProductPageImage(
  base44: Base44Client,
  pageUrl: string,
  opts: { minPx?: number; budgetMs?: number; prefix?: string; allowBanner?: boolean } = {},
): Promise<ProductPageImage | null> {
  const minPx = opts.minPx ?? HQ_MIN_PX;
  const deadline = Date.now() + Math.max(0, opts.budgetMs ?? 10_000);
  const left = () => deadline - Date.now();

  const page = await fetchPageHtml(pageUrl, left());
  if (!page) return null;

  let bannerFallback: { img: FetchedImage; width: number } | null = null;
  let fetches = 0;
  for (const candidate of extractPageImageCandidates(page.html, page.finalUrl)) {
    if (fetches >= MAX_IMAGE_FETCHES || left() < MIN_STEP_MS) break;
    fetches++;
    const img = await fetchImageBytes(candidate, {
      timeoutMs: Math.min(PAGE_TIMEOUT_MS, left()),
      headers: BROWSERISH_HEADERS,
    });
    if (!img) continue;
    const dims = imageSize(img.bytes);
    if (!dims) continue;
    const width = Math.min(dims.w, dims.h);
    if (width < minPx) continue;
    if (!isBannerShaped(dims.w, dims.h)) {
      const hosted = await uploadImage(base44, img, opts.prefix ?? "item");
      return hosted ? { url: hosted, width } : null;
    }
    if ((opts.allowBanner ?? false) && !bannerFallback) bannerFallback = { img, width };
  }
  if (bannerFallback) {
    const hosted = await uploadImage(base44, bannerFallback.img, opts.prefix ?? "item");
    return hosted ? { url: hosted, width: bannerFallback.width } : null;
  }
  return null;
}

export interface ProductSearchHit {
  image_url: string | null;
  product_page_urls: string[]; // 0-3 pages, distinct registrable domains
}

// Hosts a web search loves to return that never serve a usable product URL.
const GENERIC_SEARCH_HOSTS = new Set([
  "google.com", "bing.com", "duckduckgo.com", "facebook.com", "instagram.com",
  "wikipedia.org", "youtube.com", "pinterest.com", "twitter.com", "x.com",
]);

function usableSearchUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  if (!isSafePublicHttpUrl(raw)) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    const reg = registrableDomain(host);
    if (GENERIC_SEARCH_HOSTS.has(host) || GENERIC_SEARCH_HOSTS.has(reg)) return null;
  } catch (_) {
    return null;
  }
  return raw;
}

// Registrable domain for dedupe and exclusion checks. Uses senderDomain.ts's
// suffix-aware helper: naive "last two labels" would fold every .co.il store
// into "co.il", which would both mis-exclude and silently dedupe two different
// Israeli retailers down to one in the fan-out. Accepts a full URL or a bare
// host, so a dead product link can be passed straight through.
export function pageDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = String(raw).trim().toLowerCase();
  if (/^https?:\/\//.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch (_) {
      return null;
    }
  }
  host = host.replace(/^www\./, "").split("/")[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  return registrableDomain(host);
}

// Validate + dedupe LLM-returned page URLs: one page per registrable domain
// (the whole point of the fan-out is diversifying past a bot-blocked host),
// order preserved, capped. `exclude` drops domains already proven unusable for
// this item so a search cannot keep proposing the same dead host.
// Exported for unit tests.
export function sanitizePageUrls(raw: unknown, cap = 3, exclude: string[] = []): string[] {
  if (!Array.isArray(raw)) return [];
  const banned = new Set(exclude.map((d) => pageDomain(d) ?? d.toLowerCase().replace(/^www\./, "")));
  const out: string[] = [];
  const domains = new Set<string>();
  for (const entry of raw) {
    const url = usableSearchUrl(entry);
    if (!url) continue;
    const reg = pageDomain(url);
    if (!reg) continue;
    if (banned.has(reg)) continue;
    if (domains.has(reg)) continue;
    domains.add(reg);
    out.push(url);
    if (out.length >= cap) break;
  }
  return out;
}

// Tier C: internet-context LLM search. Returns raw candidate URLs; callers must
// fetch + measure + rehost them (never store a search URL directly).
//
// PRODUCT-FIRST, MERCHANT-AGNOSTIC (the lesson from JoyBox): what the card
// needs is a picture of the THING, not a picture hosted by the shop that sold
// it. An earlier version told the model to prefer the selling merchant's own
// site, so a Hebrew pet-food line item kept resolving to joybox.co.il, whose
// email link lands on the store homepage and whose product pages are not
// server-fetchable, and the item stayed blank. The merchant is now only a hint
// for IDENTIFYING the product; manufacturer and large-marketplace pages are
// preferred because they carry clean product photography and answer bots.
export async function searchProductOnline(
  base44: Base44Client,
  q: {
    itemName: string;
    merchantName?: string | null;
    merchantDomain?: string | null;
    currency?: string | null;
    excludeDomains?: string[]; // domains already proven unusable for this item
  },
): Promise<ProductSearchHit | null> {
  const item = (q.itemName ?? "").trim();
  if (!item) return null;
  const exclude = (q.excludeDomains ?? []).map((d) => pageDomain(d) ?? d).filter(Boolean) as string[];
  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: [
        "Find a photograph of this exact product anywhere on the web.",
        "First work out what the product actually IS: brand, product line, variant, and size. The name is a retail line item and may be in Hebrew or abbreviated; translate and normalize it (for example \"מונג' סלמון ואורז בוגר - 12 ק\\\"ג\" is Monge dog food, Salmon and Rice, adult, 12 kg).",
        "The image does NOT have to come from the store that sold it: ANY reputable source showing this exact product is fine.",
        "Return:",
        "- product_page_urls: up to 3 URLs of pages showing this EXACT product (same brand, line, variant; size may differ if nothing else exists), each on a DIFFERENT website, preferring in order: (1) the manufacturer's or brand's official product page, (2) a large retailer or marketplace listing (Amazon, zooplus, Chewy, eBay, AliExpress, zap.co.il), (3) the selling merchant's own site. Only pages you actually saw in results; never search-result pages, category pages, social posts, or homepages.",
        "- image_url: a DIRECT product photo URL (an actual image file on a CDN, roughly 400px or larger). Only a file URL you actually saw on a page; NEVER construct or guess a CDN path. Usually null.",
        "",
        `Product: ${item}`,
        q.merchantName ? `Bought from: ${q.merchantName} (identification hint only, not where the image must come from)` : "",
        q.currency === "ILS" ? "Bought in Israel, so Hebrew listings and .co.il retailers are likely, but international sources are equally good." : "",
        exclude.length ? `Do NOT return pages on these domains, they were already tried and are unusable: ${exclude.join(", ")}` : "",
      ].filter(Boolean).join("\n"),
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          image_url: { type: ["string", "null"] },
          product_page_urls: { type: "array", items: { type: "string" } },
        },
        required: ["image_url", "product_page_urls"],
      },
    });
    if (!result || typeof result !== "object") return null;
    const rec = result as Record<string, unknown>;
    const hit: ProductSearchHit = {
      image_url: usableSearchUrl(rec.image_url),
      product_page_urls: sanitizePageUrls(rec.product_page_urls, 3, exclude),
    };
    return hit.image_url || hit.product_page_urls.length ? hit : null;
  } catch (_) {
    return null;
  }
}

// ---- Brand logo web search (used by orders/backfillImages) ----
//
// Lesson learned the hard way: an internet-context LLM reliably identifies
// PAGES (a Wikipedia article, a product page) but hallucinates deep asset
// URLs (Wikimedia thumb paths carry an MD5 hash prefix the model invents).
// So the model names the article; the wiki API resolves the real file URL.

// Wikimedia policy wants a descriptive UA, not a fake browser.
const WIKI_UA = "iTrack/1.0 (+https://i-track-2bdb7160.base44.app)";

async function wikiApi(
  lang: string,
  params: Record<string, string>,
  budgetMs: number,
): Promise<Record<string, unknown> | null> {
  if (budgetMs < MIN_STEP_MS) return null;
  if (!/^[a-z-]{2,12}$/.test(lang)) return null;
  const qs = new URLSearchParams({ format: "json", redirects: "1", ...params });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(3000, budgetMs));
  try {
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${qs}`, {
      signal: controller.signal,
      headers: { "User-Agent": WIKI_UA },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Decorative junk that litters article file lists (infobox arrows, flags, maps).
const WIKI_JUNK_RE = /increase|decrease|steady|flag[ _]|map|locator|commons-logo|edit|question|symbol|star[ _.]|chart|graph|barnstar/i;

// The article's file list is alphabetized and full of social icons and
// sub-brand logos ("Amazon Live logo.png"), and non-English wikis use local
// namespace prefixes, so pure name heuristics misfire. A cheap LLM call (no
// internet) picks the brand's MAIN logo file from the real list; the answer is
// validated against the list, with the heuristic as fallback.
async function pickLogoFile(base44: Base44Client, brand: string, files: string[]): Promise<string | null> {
  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: [
        `A Wikipedia article about the retail brand "${brand}" contains these image files.`,
        "Return the file title of the brand's MAIN logo (not sub-brand logos, not social network icons, not photos, not wiki UI icons). Copy the title EXACTLY as listed. Null if none is the main logo.",
        "",
        ...files.map((f, i) => `${i + 1}. ${f}`),
      ].join("\n"),
      response_json_schema: {
        type: "object",
        properties: { file: { type: ["string", "null"], description: "Exact file title from the list, or null" } },
        required: ["file"],
      },
    });
    const picked = (result as { file?: unknown })?.file;
    return typeof picked === "string" && files.includes(picked) ? picked : null;
  } catch (_) {
    return null;
  }
}

// prop=pageimages returns the article's LEAD image, which for companies is
// often a photo (FedEx's is an airplane). Walk the article's file list for the
// brand's main logo instead, then resolve a real scaled thumb URL via
// imageinfo (SVG logos become PNG thumbs at iiurlwidth).
async function wikipediaLogoThumb(
  base44: Base44Client,
  pageUrl: string,
  brandName: string,
  budgetMs: number,
): Promise<string | null> {
  const m = pageUrl.match(/^https?:\/\/([a-z-]{2,12})(?:\.m)?\.wikipedia\.org\/wiki\/([^?#]+)/i);
  if (!m) return null;
  const lang = m[1].toLowerCase();
  let title = m[2];
  try {
    title = decodeURIComponent(title);
  } catch (_) {
    // keep the raw title
  }
  const deadline = Date.now() + budgetMs;
  const left = () => deadline - Date.now();

  // deno-lint-ignore no-explicit-any
  const listRes = await wikiApi(lang, { action: "query", prop: "images", imlimit: "50", titles: title }, left()) as any;
  const pages = listRes?.query?.pages;
  // deno-lint-ignore no-explicit-any
  const files: string[] = pages ? ((Object.values(pages)[0] as any)?.images ?? []).map((i: any) => String(i?.title ?? "")) : [];
  const usable = files.filter((f) => /\.(svg|png|jpe?g|webp)$/i.test(f) && !WIKI_JUNK_RE.test(f));
  if (usable.length === 0) return null;

  let best = await pickLogoFile(base44, brandName, usable);
  if (!best) {
    const brand = brandName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const score = (f: string) =>
      (/logo/i.test(f) ? 8 : 0) +
      (brand.length >= 3 && f.toLowerCase().includes(brand) ? 6 : 0) +
      (/\.svg$/i.test(f) ? 2 : 0);
    const ranked = usable.map((f) => ({ f, s: score(f) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    best = ranked[0]?.f ?? null;
  }
  if (!best) return null;

  const infoRes = await wikiApi(lang, {
    action: "query",
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "512",
    titles: best,
    // deno-lint-ignore no-explicit-any
  }, left()) as any;
  const infoPages = infoRes?.query?.pages;
  // deno-lint-ignore no-explicit-any
  const info = infoPages ? (Object.values(infoPages)[0] as any)?.imageinfo?.[0] : null;
  return typeof info?.thumburl === "string" && info.thumburl ? info.thumburl : null;
}

export interface LogoSearchHints {
  merchantName: string;
  domain?: string | null; // a VERIFIED merchant domain only, never a raw sender host
  currency?: string | null;
}

// Last-resort logo tier for merchants whose sites only publish 16-32px
// favicons (KSP, JoyBox) or bot-block icon fetches entirely (FedEx). Order:
// Wikipedia article logo (deterministic thumb URL), then a direct press-kit
// URL the model actually saw, then the merchant homepage's og:image (share
// images are usually the logo card, and unlike product pages the homepage og
// route is only tried for domains whose favicon was already fetchable).
export async function searchMerchantLogo(
  base44: Base44Client,
  hints: LogoSearchHints,
  minPx = 96,
): Promise<ResolvedLogo | null> {
  const name = (hints.merchantName ?? "").trim();
  if (!name || /^unknown merchant$/i.test(name)) return null;
  const deadline = Date.now() + 15_000;
  const left = () => deadline - Date.now();

  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: [
        "Identify this retail brand online. Return:",
        "- wikipedia_page_url: the brand's Wikipedia ARTICLE URL in any language (https://<lang>.wikipedia.org/wiki/<Title>), or null if it has no article",
        "- image_url: a DIRECT .png/.jpg/.webp URL of the official logo from the brand's own site or press kit. Only a URL you actually saw on a page; never favicon services and never a guessed CDN path. Usually null.",
        "Israeli brands are common here (Hebrew names, ILS currency); the Hebrew Wikipedia counts.",
        "",
        `Brand: ${name}`,
        hints.domain ? `Official site (verified): ${hints.domain}` : "",
        hints.currency ? `Purchase currency: ${hints.currency}` : "",
      ].filter(Boolean).join("\n"),
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          wikipedia_page_url: { type: ["string", "null"] },
          image_url: { type: ["string", "null"] },
        },
        required: ["wikipedia_page_url", "image_url"],
      },
    });
    const rec = (result ?? {}) as Record<string, unknown>;

    if (typeof rec.wikipedia_page_url === "string" && rec.wikipedia_page_url) {
      const thumb = await wikipediaLogoThumb(base44, rec.wikipedia_page_url, name, Math.min(10_000, left()));
      if (thumb) {
        const got = await fetchAndUploadIfLarge(base44, thumb, minPx, left(), "logo");
        if (got) return { url: got.url, width: got.width, source: "web_search" };
      }
    }

    if (typeof rec.image_url === "string" && rec.image_url && !/\.svg(\?|#|$)/i.test(rec.image_url)) {
      const got = await fetchAndUploadIfLarge(base44, rec.image_url, minPx, left(), "logo");
      if (got) return { url: got.url, width: got.width, source: "web_search" };
    }
  } catch (_) {
    // fall through to the homepage route
  }

  if (hints.domain) {
    const got = await fetchProductPageImage(base44, `https://${hints.domain}/`, {
      minPx,
      budgetMs: Math.max(0, left()),
      prefix: "logo",
      // A homepage share card is usually the brand mark itself, so this is the
      // one route where a wide landscape image is the thing we actually want.
      allowBanner: true,
    });
    if (got) return { url: got.url, width: got.width, source: "web_search" };
  }
  return null;
}

// ---- Email asset mapping (tier B of orders/enrichProductImages) ----

export interface EmailAssetPicks {
  links: Array<number | null>; // aligned with itemNames; 0-based into linkCandidates
  images: Array<number | null>; // aligned with itemNames; 0-based into imageCandidates
  logo: number | null; // 0-based into imageCandidates
}

function emptyPicks(itemCount: number): EmailAssetPicks {
  return { links: Array(itemCount).fill(null), images: Array(itemCount).fill(null), logo: null };
}

// Validate raw LLM picks: bounds-check every 1-based index into 0-based, drop
// garbage to null. An image claimed by MORE THAN ONE item is dropped from all
// of them, and a logo colliding with a surviving item image drops both:
// attaching the wrong photo to a product is worse than leaving it blank.
// Exported for unit tests.
export function validateAssetPicks(
  raw: unknown,
  itemCount: number,
  linkCount: number,
  imageCount: number,
): EmailAssetPicks {
  const out = emptyPicks(itemCount);
  const rec = raw as { item_picks?: unknown; logo_image_index?: unknown } | null;
  const picks = Array.isArray(rec?.item_picks) ? rec.item_picks : [];
  for (const p of picks as Array<Record<string, unknown>>) {
    const item = Number(p?.item_index);
    if (!Number.isInteger(item) || item < 1 || item > itemCount) continue;
    if (p?.link_index != null) {
      const link = Number(p.link_index);
      if (Number.isInteger(link) && link >= 1 && link <= linkCount) out.links[item - 1] = link - 1;
    }
    if (p?.image_index != null) {
      const img = Number(p.image_index);
      if (Number.isInteger(img) && img >= 1 && img <= imageCount) out.images[item - 1] = img - 1;
    }
  }
  const counts = new Map<number, number>();
  for (const idx of out.images) if (idx != null) counts.set(idx, (counts.get(idx) ?? 0) + 1);
  out.images = out.images.map((idx) => (idx != null && (counts.get(idx) ?? 0) > 1 ? null : idx));

  if (rec?.logo_image_index != null) {
    const logo = Number(rec.logo_image_index);
    if (Number.isInteger(logo) && logo >= 1 && logo <= imageCount) out.logo = logo - 1;
  }
  if (out.logo != null && out.images.includes(out.logo)) {
    out.images = out.images.map((idx) => (idx === out.logo ? null : idx));
    out.logo = null;
  }
  return out;
}

// ONE cheap no-internet LLM call answering everything tier B needs from a
// re-fetched email: per item the product-page LINK, per item the product PHOTO
// among the embedded images, and which image is the merchant's own brand logo.
export async function mapEmailAssets(
  base44: Base44Client,
  args: {
    merchantName: string;
    itemNames: string[];
    linkCandidates: string[];
    imageCandidates: EmailImageCandidate[];
    wantLogo: boolean;
  },
): Promise<EmailAssetPicks> {
  const { merchantName, itemNames, linkCandidates, imageCandidates, wantLogo } = args;
  const none = emptyPicks(itemNames.length);
  const nothingToMap = (itemNames.length === 0 && !wantLogo) ||
    (linkCandidates.length === 0 && imageCandidates.length === 0);
  if (nothingToMap) return none;
  try {
    const imageLine = (c: EmailImageCandidate, i: number) =>
      `${i + 1}. ${c.src}` +
      (c.alt ? ` | alt="${c.alt}"` : "") +
      (c.width || c.height ? ` | declared ${c.width ?? "?"}x${c.height ?? "?"}` : "");
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: [
        `An order email from the store "${merchantName}" contained these product line items, links, and embedded images.`,
        "1) For each item, pick the link that opens that exact product's page on the store (usually the link wrapping the product image or name). Tracking-wrapped links (click.*, awstrack, etc.) are fine. Never order-status, package-tracking, unsubscribe, account, or help links.",
        "2) For each item, pick the image that is a PHOTO OF THAT PRODUCT itself. Never the store's logo, banners, promos, icons, payment or social badges, and never a photo of a different line item. An image may be assigned to at most ONE item.",
        wantLogo
          ? `3) logo_image_index: which image is "${merchantName}"'s own brand logo (usually in the email header or footer; the alt text often names the brand; often a wide wordmark). Null if none clearly is.`
          : "",
        "Use null anywhere you are not sure.",
        "",
        "Items (by index):",
        ...itemNames.map((n, i) => `${i + 1}. ${n}`),
        "",
        "Links (by index):",
        ...(linkCandidates.length ? linkCandidates.map((u, i) => `${i + 1}. ${u}`) : ["(none)"]),
        "",
        "Images (by index):",
        ...(imageCandidates.length ? imageCandidates.map(imageLine) : ["(none)"]),
      ].filter(Boolean).join("\n"),
      response_json_schema: {
        type: "object",
        properties: {
          item_picks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item_index: { type: "integer", description: "1-based index into the items list" },
                link_index: { type: ["integer", "null"], description: "1-based index into the links list, or null" },
                image_index: { type: ["integer", "null"], description: "1-based index into the images list, or null" },
              },
              required: ["item_index", "link_index", "image_index"],
            },
          },
          logo_image_index: {
            type: ["integer", "null"],
            description: "1-based index of the merchant's brand logo in the images list, or null",
          },
        },
        required: ["item_picks", "logo_image_index"],
      },
    });
    return validateAssetPicks(result, itemNames.length, linkCandidates.length, imageCandidates.length);
  } catch (_) {
    return none;
  }
}
