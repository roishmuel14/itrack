// HTML -> plain text + <img src> candidate extraction, dependency-free.
// The LLM gets clean text plus a bounded list of image URL candidates
// (never raw HTML), per PRD section 8.

const BLOCK_TAGS = /<\/(p|div|tr|table|h[1-6]|li|ul|ol|blockquote|section|article|header|footer)>/gi;
const BREAK_TAGS = /<(br|hr)\s*\/?>/gi;
const SCRIPT_STYLE = /<(script|style|head|title|noscript)[\s\S]*?<\/\1>/gi;
const HTML_COMMENTS = /<!--[\s\S]*?-->/g;
const ALL_TAGS = /<[^>]+>/g;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&hellip;": "...",
  "&mdash;": "-",
  "&ndash;": "-",
  "&rsquo;": "'",
  "&lsquo;": "'",
  "&rdquo;": '"',
  "&ldquo;": '"',
  "&copy;": "(c)",
  "&reg;": "(R)",
  "&trade;": "(TM)",
};

function decodeEntities(text: string): string {
  let out = text;
  for (const [entity, replacement] of Object.entries(ENTITIES)) {
    out = out.replaceAll(entity, replacement);
  }
  // Numeric entities: &#123; and &#x1F600;
  out = out.replace(/&#(\d+);/g, (_, code) => {
    const n = Number(code);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
  });
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const n = parseInt(hex, 16);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
  });
  return out;
}

export function htmlToText(html: string): string {
  let text = html
    .replace(SCRIPT_STYLE, " ")
    .replace(HTML_COMMENTS, " ")
    .replace(BREAK_TAGS, "\n")
    .replace(BLOCK_TAGS, "$&\n")
    .replace(ALL_TAGS, " ");
  text = decodeEntities(text);
  // Collapse horizontal whitespace, keep line structure, cap blank runs.
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

export interface EmailImageCandidate {
  src: string;
  alt: string; // entity-decoded; "" when absent
  width: number | null; // declared width attribute; null when absent
  height: number | null;
}

// Image candidates from <img> tags with their alt text and declared size,
// filtered to plausible content images: absolute http(s), not obvious tracking
// pixels / spacers / icons. The alt + declared size feed the LLM that maps
// email images to line items and spots the merchant's header logo. NOTE:
// cid:-referenced MIME attachments never appear here (gmail.ts reads body
// parts only); that is an accepted gap, not a bug.
export function extractImageCandidatesDetailed(html: string, limit = 10): EmailImageCandidate[] {
  const candidates: EmailImageCandidate[] = [];
  const seen = new Set<string>();
  const imgRe = /<img\b[^>]*>/gi;
  for (const match of html.matchAll(imgRe)) {
    const tag = match[0];
    const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const src = decodeEntities(srcMatch[1]).trim();
    if (!/^https?:\/\//i.test(src)) continue;
    if (seen.has(src)) continue;
    // Skip 1px tracking pixels and tiny declared sizes.
    const w = tag.match(/\bwidth\s*=\s*["']?(\d+)/i);
    const h = tag.match(/\bheight\s*=\s*["']?(\d+)/i);
    if ((w && Number(w[1]) <= 2) || (h && Number(h[1]) <= 2)) continue;
    if (/\b(pixel|spacer|blank|beacon|open\.aspx|track(ing)?)\b/i.test(src)) continue;
    if (/\.(gif)(\?|$)/i.test(src) && /1x1|pixel/i.test(src)) continue;
    const altMatch = tag.match(/\balt\s*=\s*["']([^"']*)["']/i);
    seen.add(src);
    candidates.push({
      src,
      alt: altMatch ? decodeEntities(altMatch[1]).trim() : "",
      width: w ? Number(w[1]) : null,
      height: h ? Number(h[1]) : null,
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

// Back-compat: bare src list (the extraction prompt only needs URLs).
export function extractImageCandidates(html: string, limit = 10): string[] {
  return extractImageCandidatesDetailed(html, limit).map((c) => c.src);
}

// Non-product link shapes: navigation, legal, account, social, app stores.
// Kept intentionally loose; the LLM does the final "is this THE product" pick.
const LINK_SKIP_RE =
  /(unsubscribe|email[-_]?preferences|preference[-_]?cent|privacy|terms|conditions|contact[-_]?us|help|support|faq|login|signin|sign[-_]?in|account|password|apps\.apple\.com|play\.google\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|tiktok\.com|linkedin\.com|pinterest\.com|whatsapp\.com)/i;

// Product-page link candidates from <a href>, in document order (position in the
// email correlates with the product block). Redirector/tracker hosts (click.*,
// awstrack, links.*) are deliberately KEPT: merchants wrap nearly every product
// link, and productImage.ts resolves redirects with the SSRF guard re-applied.
export function extractLinkCandidates(html: string, limit = 15): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const aRe = /<a\b[^>]*>/gi;
  for (const match of html.matchAll(aRe)) {
    const hrefMatch = match[0].match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const href = decodeEntities(hrefMatch[1]).trim();
    if (!/^https?:\/\//i.test(href)) continue; // drops mailto:, tel:, #, relative
    if (href.length > 1500) continue;
    if (LINK_SKIP_RE.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    candidates.push(href);
    if (candidates.length >= limit) break;
  }
  return candidates;
}

export function truncateForLLM(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[...truncated]";
}
