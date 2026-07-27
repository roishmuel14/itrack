// The attempt/cooldown/generation bookkeeping of orders/enrichProductImages.
// Every bug that loop has had lived here: an attempt counted for a scheduling
// accident cooldown-locks a card for a week, and a cooldown skipped forever
// makes the same order re-pay a Gmail fetch and an LLM call every round.
// Run: deno test tests/

import { assertEquals } from "jsr:@std/assert";
import { decideEnrichOutcome, enrichQueueSort, type EnrichSignals } from "../base44/shared/enrichPolicy.ts";

const base: EnrichSignals = {
  upgraded: false,
  logoWin: false,
  attempted: false,
  starved: false,
  searchStarved: false,
  learnedNewUrl: false,
  attempts: 0,
  reopened: false,
};
const signals = (over: Partial<EnrichSignals> = {}): EnrichSignals => ({ ...base, ...over });

Deno.test("an item upgrade resets the attempt budget and starts the cooldown", () => {
  assertEquals(decideEnrichOutcome(signals({ upgraded: true, attempted: true, attempts: 2 })), {
    defer: false,
    imageAttempts: 0,
    stampCheckedAt: true,
    stampVersion: true,
    countsUpdated: true,
  });
});

Deno.test("a genuine failure counts an attempt and starts the cooldown", () => {
  assertEquals(decideEnrichOutcome(signals({ attempted: true, attempts: 1 })), {
    defer: false,
    imageAttempts: 2,
    stampCheckedAt: true,
    stampVersion: true,
    countsUpdated: false,
  });
});

Deno.test("a reopened generation grants exactly one fresh attempt budget", () => {
  assertEquals(decideEnrichOutcome(signals({ attempted: true, reopened: true, attempts: 3 })).imageAttempts, 1);
});

Deno.test("a starved search defers without counting an attempt or a cooldown", () => {
  // The regression that cost JoyBox a week: its last route never ran, yet the
  // order was stamped as a completed attempt.
  assertEquals(decideEnrichOutcome(signals({ attempted: true, starved: true, searchStarved: true })), {
    defer: true,
    imageAttempts: null,
    stampCheckedAt: false,
    stampVersion: true,
    countsUpdated: false,
  });
});

Deno.test("an order blocked before any real work defers untouched", () => {
  assertEquals(decideEnrichOutcome(signals({ starved: true })).defer, true);
  assertEquals(decideEnrichOutcome(signals({ starved: true })).imageAttempts, null);
});

Deno.test("a newly learned page retries at once but is bounded by the attempt count", () => {
  const d = decideEnrichOutcome(signals({ attempted: true, learnedNewUrl: true, attempts: 1 }));
  assertEquals(d.defer, true);
  assertEquals(d.imageAttempts, 2, "counts, so chasing fresh URLs cannot loop forever");
  assertEquals(d.stampCheckedAt, false, "no cooldown: the next round should fetch the new page");
});

Deno.test("a logo-only win counts as an update but never resets the item budget", () => {
  const d = decideEnrichOutcome(signals({ logoWin: true, attempted: true, attempts: 1 }));
  assertEquals(d.countsUpdated, true);
  assertEquals(d.imageAttempts, 2, "the item queue is unchanged, so the budget must keep shrinking");
});

Deno.test("an item upgrade outranks starvation flags", () => {
  assertEquals(decideEnrichOutcome(signals({ upgraded: true, starved: true, searchStarved: true })).defer, false);
});

Deno.test("every path stamps the generation, so no row can bypass the gates forever", () => {
  const cases = [
    signals({ attempted: true }),
    signals({ starved: true }),
    signals({ attempted: true, searchStarved: true, starved: true }),
    signals({ attempted: true, learnedNewUrl: true }),
    signals({ upgraded: true }),
  ];
  for (const c of cases) assertEquals(decideEnrichOutcome(c).stampVersion, true);
});

Deno.test("queue sort puts least-recently-attempted first so budget losers lead next round", () => {
  const deferred = { image_checked_at: null, last_event_at: "2026-07-01" };
  const old = { image_checked_at: "2026-07-20T00:00:00Z", last_event_at: "2026-07-27" };
  const fresh = { image_checked_at: "2026-07-27T10:00:00Z", last_event_at: "2026-07-27" };
  assertEquals([fresh, old, deferred].sort(enrichQueueSort), [deferred, old, fresh]);
});

Deno.test("queue sort breaks ties on recency", () => {
  const older = { image_checked_at: null, last_event_at: "2026-07-01" };
  const newer = { image_checked_at: null, last_event_at: "2026-07-26" };
  assertEquals([older, newer].sort(enrichQueueSort), [newer, older]);
});
