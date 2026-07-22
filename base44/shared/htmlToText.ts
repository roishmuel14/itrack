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

// Image URL candidates from <img src>, filtered to plausible product images:
// absolute http(s), not obvious tracking pixels / spacers / icons.
export function extractImageCandidates(html: string, limit = 10): string[] {
  const candidates: string[] = [];
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
    seen.add(src);
    candidates.push(src);
    if (candidates.length >= limit) break;
  }
  return candidates;
}

export function truncateForLLM(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[...truncated]";
}
