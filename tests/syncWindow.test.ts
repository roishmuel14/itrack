// Unit tests for the sync window/paging math (base44/shared/syncWindow.ts).
// Run: deno test tests/
// The load-bearing invariant: within one paging session the after: bound must
// be IDENTICAL on every call, because a Gmail pageToken is only valid for the
// exact query that issued it. First syncs derive the bound from the clock, so
// without the echo the bound would drift between the frontend's loop rounds.

import { FIRST_SYNC_LOOKBACK_DAYS, OVERLAP_SECONDS, resolveAfterEpoch } from "../base44/shared/syncWindow.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`${msg}\n  got:  ${actual}\n  want: ${expected}`);
}

Deno.test("paging session keeps the bound stable across a drifting clock", () => {
  const t0 = Date.parse("2026-07-23T12:00:00Z");
  const first = resolveAfterEpoch({ lastSyncAt: null, nowMs: t0, hasPageToken: false });
  // Round 2 arrives 40s later WITH the token + echoed bound: must not move.
  const second = resolveAfterEpoch({
    lastSyncAt: null,
    nowMs: t0 + 40_000,
    echoedAfter: first,
    hasPageToken: true,
  });
  const third = resolveAfterEpoch({
    lastSyncAt: null,
    nowMs: t0 + 95_000,
    echoedAfter: second,
    hasPageToken: true,
  });
  eq(second, first, "round 2 must reuse round 1's bound");
  eq(third, first, "round 3 must reuse round 1's bound");
});

Deno.test("incremental bound derives from the cursor minus overlap", () => {
  const cursor = "2026-07-20T10:00:00Z";
  const got = resolveAfterEpoch({ lastSyncAt: cursor, nowMs: Date.parse("2026-07-23T00:00:00Z"), hasPageToken: false });
  eq(got, Math.floor(Date.parse(cursor) / 1000) - OVERLAP_SECONDS, "cursor - overlap");
});

Deno.test("first sync looks back the configured window", () => {
  const nowMs = Date.parse("2026-07-23T12:00:00Z");
  const got = resolveAfterEpoch({ lastSyncAt: undefined, nowMs, hasPageToken: false });
  const want = Math.floor((nowMs - FIRST_SYNC_LOOKBACK_DAYS * 24 * 3600 * 1000) / 1000) - OVERLAP_SECONDS;
  eq(got, want, "lookback - overlap");
});

Deno.test("page token without an echoed bound falls back to computing", () => {
  const cursor = "2026-07-20T10:00:00Z";
  const got = resolveAfterEpoch({ lastSyncAt: cursor, nowMs: Date.now(), echoedAfter: undefined, hasPageToken: true });
  eq(got, Math.floor(Date.parse(cursor) / 1000) - OVERLAP_SECONDS, "degrade gracefully for old clients");
});

Deno.test("garbage echoed bounds are rejected", () => {
  const cursor = "2026-07-20T10:00:00Z";
  const want = Math.floor(Date.parse(cursor) / 1000) - OVERLAP_SECONDS;
  for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const got = resolveAfterEpoch({ lastSyncAt: cursor, nowMs: Date.now(), echoedAfter: bad, hasPageToken: true });
    eq(got, want, `echoedAfter=${bad} must be ignored`);
  }
});

Deno.test("echoed bound of zero is valid", () => {
  const got = resolveAfterEpoch({ lastSyncAt: null, nowMs: Date.now(), echoedAfter: 0, hasPageToken: true });
  eq(got, 0, "0 is a legitimate epoch bound");
});
