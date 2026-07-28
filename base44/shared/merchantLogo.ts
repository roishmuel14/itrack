// Resolve a SHARP merchant logo for a bare domain, then re-host it.
//
// The old approach asked Google's s2/favicons for sz=128, which upscales a site's
// 16x16 favicon and hands back a blurry 128px PNG. Since the upscale was then
// stored permanently, no amount of frontend work could sharpen it. So instead we
// ask the merchant's own site what its icon is, measure the bytes we get back
// (imageSize.ts), and keep the largest real one. Google stays as a last resort,
// tagged as such so the backfill knows the result is upgradeable.
//
// Best-effort throughout: every failure path returns null rather than throwing,
// because a missing logo must never break ingest.

import { fetchImageBytes, uploadImage } from "./rehost.ts";
import { shortSide } from "./imageSize.ts";
import { normalizeDomain } from "./mergeEngine.ts";
import { isNonMerchantDomain, registrableDomain } from "./senderDomain.ts";

// deno-lint-ignore no-explicit-any
type Base44Client = any;

export type LogoSource =
  | "manifest"
  | "apple_touch"
  | "site_icon"
  | "well_known"
  | "duckduckgo"
  | "google_favicon"
  | "web_search"
  | "email_header";

export interface ResolvedLogo {
  url: string;
  source: LogoSource;
  width: number;
}

const TOTAL_BUDGET_MS = 6000; // per domain, hard ceiling
const HTML_TIMEOUT_MS = 3000;
const ICON_TIMEOUT_MS = 3000;
const MAX_HTML_BYTES = 256 * 1024;
const MAX_LOGO_BYTES = 512 * 1024;
const MIN_ACCEPT_PX = 48; // below this a logo counts as blurry
const GOOD_ENOUGH_PX = 96; // stop climbing the ladder here
const MIN_STEP_MS = 700; // do not start a fetch we cannot finish

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// Some CDNs 403 anything that looks automated. Claiming to be a browser here is
// about getting a public icon, not about evading a paywall; the email-thumbnail
// item-image path keeps its honest iTrack UA. Exported for productImage.ts,
// which fetches retailer product pages that bot-block the same way.
export const BROWSERISH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface IconLink {
  href: string;
  rel: string;
  size: number;
}

interface Candidate {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
  source: LogoSource;
  w: number;
}

// Resolve a possibly-relative href against the page's FINAL url (post-redirect),
// and drop data:/javascript: hrefs.
function absolutize(href: string, base: string): string | null {
  try {
    const u = new URL(href.startsWith("//") ? `https:${href}` : href, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch (_) {
    return null;
  }
}

const LINK_RE = /<link\b[^>]*>/gi;
const ATTR_RE = /([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

export function parseIconLinks(html: string, baseUrl: string): IconLink[] {
  // Truncate at </head> so a <link> inside body content cannot win.
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html;
  const out: IconLink[] = [];
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(head))) {
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    let a: RegExpExecArray | null;
    while ((a = ATTR_RE.exec(m[0]))) {
      attrs[a[1].toLowerCase()] = (a[3] ?? a[4] ?? a[5] ?? "").trim();
    }
    const rel = (attrs.rel ?? "").toLowerCase();
    if (!attrs.href) continue;
    if (!/(^|\s)(icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed|manifest)(\s|$)/.test(rel)) {
      continue;
    }
    // Skip SVG icons: they render fine in <img> but would be stored on a Base44
    // origin, and an attacker-authored SVG opened directly is not worth the win.
    if ((attrs.type ?? "").toLowerCase().includes("svg")) continue;
    if (/\.svg(\?|#|$)/i.test(attrs.href)) continue;

    const sizes = (attrs.sizes ?? "").toLowerCase();
    const declared = Math.max(0, ...(sizes.match(/\d+/g) ?? ["0"]).map(Number));
    const href = absolutize(attrs.href, baseUrl);
    if (!href) continue;
    // apple-touch-icon usually omits sizes but is never 16px, so bias it upward.
    out.push({ href, rel, size: rel.includes("apple-touch") ? declared + 64 : declared });
  }
  return out;
}

export async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (n < max) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      n += value.length;
    }
  }
  try {
    await reader.cancel();
  } catch (_) {
    // already finished
  }
  const merged = new Uint8Array(n);
  let off = 0;
  for (const c of chunks) {
    merged.set(c.subarray(0, Math.min(c.length, n - off)), off);
    off += c.length;
    if (off >= n) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

async function fetchText(
  url: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ text: string; finalUrl: string } | null> {
  if (timeoutMs < MIN_STEP_MS) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: BROWSERISH_HEADERS,
    });
    if (!res.ok) return null;
    return { text: await readCapped(res, maxBytes), finalUrl: res.url || url };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function manifestIcons(manifestUrl: string, timeoutMs: number): Promise<string[]> {
  const got = await fetchText(manifestUrl, timeoutMs, 128 * 1024);
  if (!got) return [];
  try {
    const json = JSON.parse(got.text);
    const icons = Array.isArray(json?.icons) ? json.icons : [];
    return icons
      .map((i: Record<string, unknown>) => ({
        // Manifest icon src resolves against the MANIFEST url, not the page.
        src: absolutize(String(i.src ?? ""), got.finalUrl),
        size: Math.max(0, ...(String(i.sizes ?? "").match(/\d+/g) ?? ["0"]).map(Number)),
        type: String(i.type ?? ""),
      }))
      .filter((i: { src: string | null; type: string }) => i.src && !i.type.includes("svg"))
      .sort((a: { size: number }, b: { size: number }) => b.size - a.size)
      .slice(0, 2)
      .map((i: { src: string }) => i.src);
  } catch (_) {
    return [];
  }
}

export async function resolveAndRehostLogo(
  base44: Base44Client,
  domain: string,
  opts: { budgetMs?: number } = {},
): Promise<ResolvedLogo | null> {
  const clean = normalizeDomain(domain);
  if (!clean) return null;

  const deadline = Date.now() + Math.max(0, opts.budgetMs ?? TOTAL_BUDGET_MS);
  const left = () => deadline - Date.now();

  // Held in an object so TypeScript keeps the type across the closures below.
  const state: { best: Candidate | null } = { best: null };
  const bestWidth = () => state.best?.w ?? 0;

  // Returns true when the candidate is good enough to stop looking.
  const consider = async (url: string, source: LogoSource): Promise<boolean> => {
    if (left() < MIN_STEP_MS) return false;
    const img = await fetchImageBytes(url, {
      timeoutMs: Math.min(ICON_TIMEOUT_MS, left()),
      maxBytes: MAX_LOGO_BYTES,
      allowed: LOGO_TYPES,
      headers: BROWSERISH_HEADERS,
    });
    if (!img) return false;
    const w = shortSide(img.bytes);
    if (w > bestWidth() || !state.best) {
      state.best = { bytes: img.bytes, type: img.type, source, w };
    }
    return w >= GOOD_ENOUGH_PX;
  };

  const finish = async (): Promise<ResolvedLogo | null> => {
    const best = state.best;
    if (!best) return null;
    const url = await uploadImage(base44, { bytes: best.bytes, type: best.type, finalUrl: "" }, "logo");
    return url ? { url, source: best.source, width: best.w } : null;
  };

  // Tiers 1-3 all come out of a single homepage fetch.
  const html = await fetchText(`https://${clean}/`, Math.min(HTML_TIMEOUT_MS, left()), MAX_HTML_BYTES);
  if (html) {
    const links = parseIconLinks(html.text, html.finalUrl);
    const manifest = links.find((l) => l.rel.includes("manifest"));
    const icons = links
      .filter((l) => !l.rel.includes("manifest"))
      .sort((a, b) => b.size - a.size);

    for (const l of icons.slice(0, 3)) {
      const source: LogoSource = l.rel.includes("apple-touch") ? "apple_touch" : "site_icon";
      if (await consider(l.href, source)) return await finish();
    }

    if (manifest && bestWidth() < GOOD_ENOUGH_PX && left() > 1500) {
      for (const url of await manifestIcons(manifest.href, Math.min(ICON_TIMEOUT_MS, left()))) {
        if (await consider(url, "manifest")) return await finish();
      }
    }
  }

  // Tier 4: convention, for sites whose homepage 403s or is a JS shell.
  for (const p of ["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"]) {
    if (bestWidth() >= GOOD_ENOUGH_PX) break;
    if (await consider(`https://${clean}${p}`, "well_known")) return await finish();
  }

  // Tier 5: DuckDuckGo's icon service serves the site's ORIGINAL icon file (no
  // upscaling), so a measured width here is honest, unlike Google s2. When the
  // origin file is a real ICO the image/x-icon content type fails the LOGO_TYPES
  // allowlist; acceptable, since imageSize.ts cannot measure ICO anyway.
  if (bestWidth() < GOOD_ENOUGH_PX) {
    if (await consider(`https://icons.duckduckgo.com/ip3/${clean}.ico`, "duckduckgo")) return await finish();
  }

  // Tier 6: the blurry fallback, only when we have nothing usable. Still tagged
  // google_favicon regardless of measured size: s2 upscales tiny favicons, so
  // its dimensions are not evidence of sharpness and the backfill must keep
  // treating the result as upgradeable.
  if (bestWidth() < MIN_ACCEPT_PX) {
    await consider(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=256`,
      "google_favicon",
    );
  }

  return await finish();
}

export interface DomainGuessHints {
  merchantName: string;
  senderDomain?: string | null; // even a blocklisted ESP sender is a useful hint
  currency?: string | null; // ILS implies an Israeli retailer, likely .co.il
  itemNames?: string[];
}

// Hosts a lazy web search loves to return that are never a merchant's own site.
const GUESS_DENYLIST = new Set([
  "google.com", "facebook.com", "instagram.com", "wikipedia.org", "youtube.com",
  "twitter.com", "x.com", "linkedin.com", "tiktok.com", "pinterest.com",
]);

// Ask the LLM (with live web context) for the merchant's official site when the
// emails never revealed one, e.g. KSP -> ksp.co.il. The answer is only ever
// written to Order.logo_domain, and only AFTER the ladder actually produced a
// logo from it, so a wrong guess is never sticky and can never touch merge keys.
export async function guessMerchantDomain(
  base44: Base44Client,
  hints: DomainGuessHints,
): Promise<string | null> {
  const name = (hints.merchantName ?? "").trim();
  if (!name || /^unknown merchant$/i.test(name)) return null;
  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: [
        "Return the OFFICIAL website registrable domain for this retail merchant, bare, like ksp.co.il or joybox.co.il.",
        "Israeli merchants are common here (ILS currency, Hebrew product names): prefer the .co.il domain when that is the real site.",
        "Never return marketplaces, social networks, mail providers, or search engines. Use null unless you are confident.",
        "",
        `Merchant name: ${name}`,
        hints.senderDomain ? `Their emails came via: ${hints.senderDomain}` : "",
        hints.currency ? `Purchase currency: ${hints.currency}` : "",
        hints.itemNames?.length ? `Items they sold: ${hints.itemNames.slice(0, 3).join("; ")}` : "",
      ].filter(Boolean).join("\n"),
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          domain: { type: ["string", "null"], description: "Bare registrable domain, or null" },
          confidence: { type: "number", description: "0-1" },
        },
        required: ["domain", "confidence"],
      },
    });
    if (!result || typeof result !== "object") return null;
    const rec = result as { domain?: unknown; confidence?: unknown };
    if (typeof rec.domain !== "string" || typeof rec.confidence !== "number") return null;
    if (rec.confidence < 0.6) return null;
    const clean = normalizeDomain(rec.domain);
    if (!clean || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) return null;
    if (GUESS_DENYLIST.has(registrableDomain(clean))) return null;
    if (isNonMerchantDomain(clean)) return null;
    return clean;
  } catch (_) {
    return null;
  }
}

// Back-compat shim for the previous helper name. Prefer resolveAndRehostLogo,
// which also reports how sharp the result actually is.
export async function rehostMerchantLogo(base44: Base44Client, domain: string): Promise<string | null> {
  const resolved = await resolveAndRehostLogo(base44, domain);
  return resolved?.url ?? null;
}
