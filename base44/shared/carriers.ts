// Tracking-number pattern -> carrier detection + deep-link builder.
// PRD F4 AC2: correct pages for at least UPS, USPS, DHL, FedEx, Israel Post,
// and a generic fallback otherwise.

export interface CarrierInfo {
  key: string;
  name: string;
  url: string;
}

function clean(num: string): string {
  return num.replace(/[\s-]/g, "").toUpperCase();
}

const CARRIER_URLS: Record<string, (n: string) => string> = {
  ups: (n) => `https://www.ups.com/track?tracknum=${n}`,
  usps: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  dhl: (n) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}`,
  israel_post: (n) => `https://israelpost.co.il/en/itemtrace/?itemcode=${n}`,
  generic: (n) => `https://www.aftership.com/track/${n}`,
};

const CARRIER_NAMES: Record<string, string> = {
  ups: "UPS",
  usps: "USPS",
  fedex: "FedEx",
  dhl: "DHL",
  israel_post: "Israel Post",
  generic: "Carrier",
};

// Order matters: most specific formats first.
const PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: "ups", re: /^1Z[0-9A-Z]{16}$/ },
  // Universal Postal Union registered format, IL suffix -> Israel Post.
  { key: "israel_post", re: /^[A-Z]{2}\d{9}IL$/ },
  // USPS domestic: 20-22 digits starting 9 (94/93/92/95...), or legacy 91.
  { key: "usps", re: /^9[12345]\d{18,20}$/ },
  // DHL Express: 10 digits, or JD + 18 digits, or JJD prefix.
  { key: "dhl", re: /^JD\d{18}$/ },
  { key: "dhl", re: /^JJD\d{16,20}$/ },
  { key: "dhl", re: /^\d{10}$/ },
  // FedEx: 12, 15, or 20 digits (12 first so 10-digit DHL wins above).
  { key: "fedex", re: /^\d{12}$/ },
  { key: "fedex", re: /^\d{15}$/ },
  { key: "fedex", re: /^\d{20}$/ },
  // Other UPU international (RR123456789CN etc): generic international post.
  { key: "generic", re: /^[A-Z]{2}\d{9}[A-Z]{2}$/ },
];

export function detectCarrier(trackingNumber: string): string | null {
  const n = clean(trackingNumber);
  if (!n) return null;
  for (const { key, re } of PATTERNS) {
    if (re.test(n)) return key;
  }
  return null;
}

// Normalize a carrier name string from an email ("UPS Ground", "FedEx Home
// Delivery", "israel post") to a carrier key, if recognizable.
export function carrierKeyFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/\bups\b/.test(lower)) return "ups";
  if (/usps|postal service/.test(lower)) return "usps";
  if (/fedex/.test(lower)) return "fedex";
  if (/dhl/.test(lower)) return "dhl";
  if (/israel ?post|doar/.test(lower)) return "israel_post";
  return null;
}

// Best-effort resolution from whatever the email gave us.
export function resolveCarrier(
  trackingNumber: string | null | undefined,
  carrierName?: string | null,
): CarrierInfo | null {
  const num = trackingNumber ? clean(trackingNumber) : "";
  if (!num) return null;
  const key = carrierKeyFromName(carrierName) ?? detectCarrier(num) ?? "generic";
  const displayName = carrierKeyFromName(carrierName)
    ? CARRIER_NAMES[key]
    : (carrierName?.trim() || CARRIER_NAMES[key]);
  return { key, name: displayName, url: CARRIER_URLS[key](num) };
}
