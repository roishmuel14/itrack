// Re-host merchant CDN images into Base44 storage via UploadFile
// (PRD F1: entities store the Base44 URL, never the merchant's CDN URL,
// which also strips tracking params). Best-effort: any failure returns null
// and the caller stores no image rather than a foreign URL.

const MAX_BYTES = 5 * 1024 * 1024; // product images; well under the 50MB cap
const FETCH_TIMEOUT_MS = 10000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

// deno-lint-ignore no-explicit-any
type Base44Client = any;

export async function rehostImage(base44: Base44Client, url: string): Promise<string | null> {
  try {
    if (!/^https?:\/\//i.test(url)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; iTrack/1.0)" },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;

    const ext = type.split("/")[1].replace("jpeg", "jpg");
    const file = new File([buf], `item-${crypto.randomUUID()}.${ext}`, { type });
    const uploaded = await base44.asServiceRole.integrations.Core.UploadFile({ file });
    return uploaded?.file_url ?? null;
  } catch (_) {
    return null;
  }
}

// Merchant logo via Google's public favicon service, re-hosted.
export async function rehostMerchantLogo(base44: Base44Client, domain: string): Promise<string | null> {
  if (!domain) return null;
  const clean = domain.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  return await rehostImage(
    base44,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=128`,
  );
}
