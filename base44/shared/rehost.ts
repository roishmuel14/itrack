// Re-host merchant CDN images into Base44 storage via UploadFile
// (PRD F1: entities store the Base44 URL, never the merchant's CDN URL,
// which also strips tracking params). Best-effort: any failure returns null
// and the caller stores no image rather than a foreign URL.
//
// Split into fetch and upload halves so the logo resolver (merchantLogo.ts) can
// measure the bytes it fetched before deciding whether to keep them, without
// downloading every candidate twice.

const MAX_BYTES = 5 * 1024 * 1024; // product images; well under the 50MB cap
const FETCH_TIMEOUT_MS = 10000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

// deno-lint-ignore no-explicit-any
type Base44Client = any;

export interface FetchedImage {
  // Pinned to ArrayBuffer (not ArrayBufferLike) so the bytes are a valid BlobPart
  // when handed to File() below.
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
  finalUrl: string;
}

// Blocks the obvious SSRF shapes. merchant_domain originates from LLM output over
// email content, and logo_domain from From: headers, so both are attacker-influenced.
// This does NOT defend against DNS rebinding to a private IP; accepted because the
// only thing that ever comes back to the caller is "did we get image bytes".
export function isSafePublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch (_) {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) {
    return false;
  }
  // IP literals (v4 and bracketed v6) never name a merchant.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  return true;
}

export async function fetchImageBytes(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; allowed?: Set<string>; headers?: Record<string, string> } = {},
): Promise<FetchedImage | null> {
  try {
    if (!isSafePublicHttpUrl(url)) return null;
    const allowed = opts.allowed ?? ALLOWED_TYPES;
    const maxBytes = opts.maxBytes ?? MAX_BYTES;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: opts.headers ?? { "User-Agent": "Mozilla/5.0 (compatible; iTrack/1.0)" },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    // A redirect can land somewhere the original check would have rejected.
    if (!isSafePublicHttpUrl(res.url || url)) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!allowed.has(type)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return { bytes: new Uint8Array(buf), type, finalUrl: res.url || url };
  } catch (_) {
    return null;
  }
}

export async function uploadImage(
  base44: Base44Client,
  img: FetchedImage,
  prefix = "img",
): Promise<string | null> {
  try {
    const ext = img.type.split("/")[1].replace("jpeg", "jpg");
    const file = new File([img.bytes], `${prefix}-${crypto.randomUUID()}.${ext}`, { type: img.type });
    const uploaded = await base44.asServiceRole.integrations.Core.UploadFile({ file });
    return uploaded?.file_url ?? null;
  } catch (_) {
    return null;
  }
}

export async function rehostImage(base44: Base44Client, url: string): Promise<string | null> {
  const img = await fetchImageBytes(url);
  return img ? await uploadImage(base44, img, "item") : null;
}
