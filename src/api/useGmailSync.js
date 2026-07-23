import { useCallback, useRef, useState } from 'react';
import { invokeFunction, FunctionError } from '@/api/functions';

// Shared Gmail sync loop: invokes inbox/syncMyMail until has_more is false.
// Batched server-side, idempotent, safe to re-trigger.
export function useGmailSync({ onBatch } = {}) {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(null); // {processed, scanned}
  const running = useRef(false);

  const sync = useCallback(async () => {
    if (running.current) return { ok: true, already: true };
    running.current = true;
    setSyncing(true);
    setProgress({ processed: 0, scanned: 0 });
    try {
      let hasMore = true;
      let total = { processed: 0, scanned: 0 };
      let rounds = 0;
      while (hasMore && rounds < 30) {
        const res = await invokeFunction('inbox/syncMyMail', {});
        const batchProcessed = Object.entries(res.results ?? {})
          .filter(([k]) => k !== 'duplicate')
          .reduce((sum, [, v]) => sum + v, 0);
        total = {
          processed: total.processed + batchProcessed,
          scanned: total.scanned + (res.scanned ?? 0),
        };
        setProgress(total);
        onBatch?.(res);
        hasMore = res.has_more === true;
        rounds++;
      }
      return { ok: true, ...total };
    } catch (err) {
      if (err instanceof FunctionError && (err.status === 409 || err.status === 503)) {
        return { ok: false, notConnected: true, error: err };
      }
      return { ok: false, error: err };
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [onBatch]);

  return { sync, syncing, progress };
}
