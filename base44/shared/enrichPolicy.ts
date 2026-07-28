// The bookkeeping half of orders/enrichProductImages, kept pure so it can be
// unit tested. Every bug this loop has had lived in exactly this decision:
// which of "counted an attempt", "started a cooldown", and "stamped the
// generation" applies after a pass over one order.
//
// Vocabulary:
//   upgraded       an ITEM image was replaced or filled this pass
//   logoWin        the email header yielded a sharper merchant logo
//   attempted      at least one real network/LLM route ran for this order
//   starved        a route this order wanted was blocked by a run budget
//   searchStarved  a BLANK item's last route (web search) never ran
//   learnedNewUrl  a search named a page we have not fetched yet

export interface EnrichSignals {
  upgraded: boolean;
  logoWin: boolean;
  attempted: boolean;
  starved: boolean;
  searchStarved: boolean;
  learnedNewUrl: boolean;
  attempts: number; // the row's current image_attempts
  reopened: boolean; // row carried an older image_enrich_version
}

export interface EnrichDecision {
  defer: boolean; // do not count this order as processed
  // null means "leave the field alone"; a number is the value to write.
  imageAttempts: number | null;
  stampCheckedAt: boolean; // start the recheck cooldown
  stampVersion: boolean; // record the generation that ran
  countsUpdated: boolean; // something user-visible changed
}

export function decideEnrichOutcome(s: EnrichSignals): EnrichDecision {
  const countsUpdated = s.upgraded || s.logoWin;

  // Defer when a route this order still needs never ran. Counting an attempt
  // there would cooldown-lock the item for a week over a scheduling accident
  // rather than a real failure. The generation is still stamped so a row can
  // never bypass the attempt and cooldown gates forever.
  const defer = !s.upgraded && (s.searchStarved || s.learnedNewUrl || (!s.attempted && s.starved));
  if (defer) {
    return {
      defer: true,
      // A freshly learned page is cheap tier A work next round, so it counts
      // (bounding the fresh-URL chase by MAX_ATTEMPTS) but starts no cooldown.
      imageAttempts: s.learnedNewUrl ? s.attempts + 1 : null,
      stampCheckedAt: false,
      stampVersion: true,
      countsUpdated,
    };
  }

  return {
    defer: false,
    // Monotonic progress: an item upgrade permanently shrinks the queue
    // predicate, so resetting the budget cannot loop. A logo-only win must NOT
    // reset it, because the item queue is unchanged. A generation bump grants
    // one fresh budget.
    imageAttempts: s.upgraded ? 0 : s.reopened ? 1 : s.attempts + 1,
    stampCheckedAt: true,
    stampVersion: true,
    countsUpdated,
  };
}

// Queue order: least-recently-attempted first, so an order that lost a
// per-invocation budget race (and therefore kept its old, or absent, stamp)
// wins the next round instead of losing to the same head of the queue every
// time. Ties break on recency so fresh orders still lead among equals.
export function enrichQueueSort(
  a: { image_checked_at?: string | null; last_event_at?: string | null; created_date?: string | null },
  b: { image_checked_at?: string | null; last_event_at?: string | null; created_date?: string | null },
): number {
  const stamp = (o: typeof a) => String(o.image_checked_at ?? "");
  const byStamp = stamp(a).localeCompare(stamp(b));
  if (byStamp !== 0) return byStamp;
  return String(b.last_event_at ?? b.created_date ?? "").localeCompare(
    String(a.last_event_at ?? a.created_date ?? ""),
  );
}
