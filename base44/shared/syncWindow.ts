// Pure window/paging math for inbox/syncMyMail, split out so it is
// unit-testable (tests/syncWindow.test.ts).

export const OVERLAP_SECONDS = 600;
export const FIRST_SYNC_LOOKBACK_DAYS = 60;

// A Gmail pageToken is only valid for the EXACT query that issued it, so a
// paging session must reuse the same `after:` bound on every page. On a first
// sync the bound is derived from Date.now(); recomputing it per call would
// drift the query between the frontend's loop rounds (each round takes tens of
// seconds of LLM work) and invalidate the token. The first call resolves the
// bound from the cursor (or the first-sync lookback); later calls echo it back
// alongside the page token and it wins here.
export function resolveAfterEpoch(opts: {
  lastSyncAt: string | null | undefined;
  nowMs: number;
  echoedAfter?: number;
  hasPageToken: boolean;
}): number {
  if (
    opts.hasPageToken &&
    typeof opts.echoedAfter === "number" &&
    Number.isFinite(opts.echoedAfter) &&
    opts.echoedAfter >= 0
  ) {
    return Math.floor(opts.echoedAfter);
  }
  const lastMs = opts.lastSyncAt ? Date.parse(opts.lastSyncAt) : NaN;
  const sinceMs = Number.isNaN(lastMs)
    ? opts.nowMs - FIRST_SYNC_LOOKBACK_DAYS * 24 * 3600 * 1000
    : lastMs;
  return Math.max(0, Math.floor(sinceMs / 1000) - OVERLAP_SECONDS);
}
