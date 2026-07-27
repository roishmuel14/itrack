import { invokeFunction } from '@/api/functions';

// Drives the two bounded image-repair functions (merchant logos, then product
// photos) in a loop until each reports nothing left. Stop on zero progress too:
// rows inside their recheck cooldown keep `remaining` positive and would
// otherwise spin forever. Single-flight: a run triggered from Settings and one
// auto-fired after a Gmail sync must not overlap, or attempt budgets would be
// double-counted server-side.
let inFlight = null;

async function drain(name, rounds, tally, onProgress) {
  for (let round = 0; round < rounds; round++) {
    const res = await invokeFunction(name, {});
    tally.processed += res.processed ?? 0;
    tally.updated += res.updated ?? 0;
    onProgress?.({ ...tally });
    if (!res.has_more || (res.processed ?? 0) === 0) break;
  }
}

export function runImageEnrichment({ rounds = 12, onProgress } = {}) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const logos = { processed: 0, updated: 0 };
    const photos = { processed: 0, updated: 0 };
    try {
      await drain('orders/backfillImages', rounds, logos, onProgress && ((t) => onProgress({ phase: 'logos', ...t })));
      await drain('orders/enrichProductImages', rounds, photos, onProgress && ((t) => onProgress({ phase: 'photos', ...t })));
    } finally {
      inFlight = null;
    }
    return {
      logosUpdated: logos.updated,
      photosUpdated: photos.updated,
      processed: logos.processed + photos.processed,
    };
  })();
  return inFlight;
}
