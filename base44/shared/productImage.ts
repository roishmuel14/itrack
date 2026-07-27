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
import { imageSize, shortSide } from "./imageSize.ts";

// deno-lint-ignore no-explicit-any
type Base44Client = any;

export const HQ_MIN_PX = 256; // an image this sharp counts as HQ (replacement gate)
export const FILL_MIN_PX = 128; // acceptance gate when the item has no image at all

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
// the short side (measured BEFORE upload, so rejects cost no storage).
export async function fetchAndUploadIfLarge(
  base44: Base44Client,
  imageUrl: string,
  minPx: number,
  budgetMs: number,
  prefix = "item",
): Promise<ProductPageImage | null> {
  if (budgetMs < MIN_STEP_MS) return null;
  const img = await fetchImageBytes(imageUrl, {
    timeoutMs: Math.min(PAGE_TIMEOUT_MS, budgetMs),
    headers: BROWSERISH_HEADERS,
  });
  if (!img) return null;
  const width = shortSide(img.bytes);
  if (width < minPx) return null;
  const hosted = await uploadImage(base44, img, prefix);
  return hosted ? { url: hosted, width } : null;
}

// Banner shape: standard og share cards are 1.91:1. A candidate this wide is
// more likely the store's brand card than the product photo.
const BANNER_ASPECT = 1.8;

// Tier A: product page -> best candidate sharp enough -> Base44 storage.
// Ultra-wide candidates only win when nothing squarer qualifies (learned from
// a 1200x589 store banner replacing a real product photo). Callers replacing
// an EXISTING image should pass allowBanner: false so a banner can only ever
// fill a blank, never displace a real photo.
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
    if (Math.max(dims.w, dims.h) / Math.max(1, width) <= BANNER_ASPECT) {
      const hosted = await uploadImage(base44, img, opts.prefix ?? "item");
      return hosted ? { url: hosted, width } : null;
    }
    if ((opts.allowBanner ?? true) && !bannerFallback) bannerFallback = { img, width };
  }
  if (bannerFallback) {
    const hosted = await uploadImage(base44, bannerFallback.img, opts.prefix ?? "item");
    return hosted ? { url: hosted, width: bannerFallback.width } : null;
  }
  return null;
}

export interface ProductSearchHit {
  image_url: string | null;
  product_page_url: string | null;
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
    const reg = host.split(".").slice(-2).join(".");
    if (GENERIC_SEARCH_HOSTS.has(host) || GENERIC_SEARCH_HOSTS.has(reg)) return null;
  } catch (_) {
    return null;
  }
  return raw;
}

// Tier C: internet-context LLM search. Returns raw candidate URLs; callers must
// fetch + measure + rehost them (never store a search URL directly).
export async function searchProductOnline(
  base44: Base44Client,
  q: { itemName: string; merchantName?: string | null; merchantDomain?: string | null; currency?: string | null },
): Promise<ProductSearchHit | null> {
  const item = (q.itemName ?? "").trim();
  if (!item) return null;
  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: [
        "Find this exact retail product on the web and return:",
        "- product_page_url: the URL of its product page, preferably on the merchant's own site (a marketplace listing also counts)",
        "- image_url: a DIRECT product photo URL (an actual image file / CDN image URL, roughly 400px or larger). Only a URL you actually saw on a page; NEVER construct or guess a CDN path.",
        "Return null for any field you are not confident about. Never return search-result, social, or homepage URLs.",
        "",
        `Product: ${item}`,
        q.merchantName ? `Sold by: ${q.merchantName}` : "",
        q.merchantDomain ? `Merchant site: ${q.merchantDomain}` : "",
        q.currency === "ILS" ? "Purchased in ILS, so this is likely an Israeli retailer (.co.il sites are common)." : "",
      ].filter(Boolean).join("\n"),
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          image_url: { type: ["string", "null"] },
          product_page_url: { type: ["string", "null"] },
        },
        required: ["image_url", "product_page_url"],
      },
    });
    if (!result || typeof result !== "object") return null;
    const rec = result as Record<string, unknown>;
    const hit: ProductSearchHit = {
      image_url: usableSearchUrl(rec.image_url),
      product_page_url: usableSearchUrl(rec.product_page_url),
    };
    return hit.image_url || hit.product_page_url ? hit : null;
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
    });
    if (got) return { url: got.url, width: got.width, source: "web_search" };
  }
  return null;
}

// Tier B helper: map legacy items to link candidates re-mined from the original
// email. One cheap LLM call (no internet context). Returns an array aligned
// with itemNames; entries are 0-based indexes into linkCandidates, or null.
export async function mapItemsToLinks(
  base44: Base44Client,
  itemNames: string[],
  linkCandidates: string[],
): Promise<Array<number | null>> {
  const none: Array<number | null> = itemNames.map(() => null);
  if (itemNames.length === 0 || linkCandidates.length === 0) return none;
  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: [
        "An order email contained these product line items and these links.",
        "For each item, pick the link that opens that exact product's page on the store",
        "(usually the link that wrapped the product image or name). Tracking-wrapped links",
        "(click.*, awstrack, etc.) are fine. Never pick order-status, package-tracking,",
        "unsubscribe, account, or help links. Use null when unsure.",
        "",
        "Items (by index):",
        ...itemNames.map((n, i) => `${i + 1}. ${n}`),
        "",
        "Links (by index):",
        ...linkCandidates.map((u, i) => `${i + 1}. ${u}`),
      ].join("\n"),
      response_json_schema: {
        type: "object",
        properties: {
          picks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item_index: { type: "integer", description: "1-based index into the items list" },
                link_index: { type: ["integer", "null"], description: "1-based index into the links list, or null" },
              },
              required: ["item_index", "link_index"],
            },
          },
        },
        required: ["picks"],
      },
    });
    const picks = (result as { picks?: Array<{ item_index?: unknown; link_index?: unknown }> })?.picks;
    if (!Array.isArray(picks)) return none;
    const out: Array<number | null> = itemNames.map(() => null);
    for (const p of picks) {
      const item = Number(p?.item_index);
      if (!Number.isInteger(item) || item < 1 || item > itemNames.length) continue;
      if (p?.link_index == null) continue;
      const link = Number(p.link_index);
      if (!Number.isInteger(link) || link < 1 || link > linkCandidates.length) continue;
      out[item - 1] = link - 1;
    }
    return out;
  } catch (_) {
    return none;
  }
}
