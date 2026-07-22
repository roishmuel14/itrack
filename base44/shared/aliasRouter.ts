// Alias-token recovery from message headers (PRD section 3.1).
// Exact-match-or-quarantine is enforced by the CALLER (token must match an
// existing UserSettings.alias_token); this module only extracts candidates.
//
// Priority order (stage 2 spike verifies which header fires per path):
//   Delivered-To -> X-Forwarded-To -> X-Forwarded-For -> To -> Cc
//
// A candidate is the <token> in <base>+<token>@<domain>. When the shared
// inbox address is known (ITRACK_INBOX_ADDRESS secret, e.g.
// "itrackapp44@gmail.com"), only plus-aliases of THAT address count;
// otherwise any plus-address token is a candidate (still gated by the exact
// UserSettings match downstream).

const HEADER_PRIORITY = ["delivered-to", "x-forwarded-to", "x-forwarded-for", "to", "cc"];

export interface AliasCandidate {
  token: string;
  header: string;
  address: string;
}

// Pull every email address out of a header value (handles "Name <a@b>", lists).
function addressesIn(value: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  for (const m of value.matchAll(re)) out.push(m[0].toLowerCase());
  return out;
}

function splitPlusAddress(address: string): { base: string; token: string } | null {
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus < 0) return null;
  const token = local.slice(plus + 1);
  if (!token) return null;
  return { base: `${local.slice(0, plus)}@${domain}`, token };
}

export function extractAliasCandidates(
  headers: Record<string, string>,
  inboxAddress?: string,
): AliasCandidate[] {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) normalized[k.toLowerCase()] = v;
  const baseFilter = inboxAddress?.toLowerCase() || null;

  const candidates: AliasCandidate[] = [];
  const seenTokens = new Set<string>();
  for (const header of HEADER_PRIORITY) {
    const value = normalized[header];
    if (!value) continue;
    for (const address of addressesIn(value)) {
      const parts = splitPlusAddress(address);
      if (!parts) continue;
      if (baseFilter && parts.base !== baseFilter) continue;
      if (seenTokens.has(parts.token)) continue;
      seenTokens.add(parts.token);
      candidates.push({ token: parts.token, header, address });
    }
  }
  return candidates;
}

// Fallback net: scan raw text (e.g. a forwarded body's "To:" line) for
// plus-aliases of the known inbox address. Only used when headers fail AND
// the inbox address is configured (never guess across domains).
export function extractAliasCandidatesFromText(
  text: string,
  inboxAddress: string,
): AliasCandidate[] {
  const base = inboxAddress.toLowerCase();
  const at = base.indexOf("@");
  if (at < 0) return [];
  const local = base.slice(0, at).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const domain = base.slice(at + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${local}\\+([A-Za-z0-9._-]+)@${domain}`, "gi");
  const candidates: AliasCandidate[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    const token = m[1].toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    candidates.push({ token, header: "body-scan", address: m[0].toLowerCase() });
  }
  return candidates;
}
