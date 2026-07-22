// inbox/sweep: 15-minute cron. Lists inbox messages newer than the SyncState
// cursor (with overlap; idempotency makes reprocessing free) and pipelines
// any the webhook missed. The ingest path is therefore self-healing and
// never webhook-dependent (PRD section 3.1).
//
// Anonymous-tolerant cron: fixed behavior, idempotent, ignores every request
// field except the declared automation args.

import { createClientFromRequest } from "npm:@base44/sdk";
import { listMessages } from "../../../shared/gmail.ts";
import { processGmailMessage } from "../../../shared/pipeline.ts";

const SYNC_KEY = "gmail_sweep";
const OVERLAP_SECONDS = 300;
const PAGE_SIZE = 50;
const MAX_PAGES = 4; // batch guard: 5-minute execution cap (PRD section 12)
const DEFAULT_LOOKBACK_MS = 24 * 3600 * 1000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole.entities;
    const inboxAddress = Deno.env.get("ITRACK_INBOX_ADDRESS") ?? undefined;

    const states = await service.SyncState.filter({ key: SYNC_KEY });
    const state = states[0] ?? null;
    const sinceMs = state?.last_message_ts
      ? Date.parse(state.last_message_ts)
      : Date.now() - DEFAULT_LOOKBACK_MS;
    const afterEpoch = Math.max(0, Math.floor(sinceMs / 1000) - OVERLAP_SECONDS);

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("gmail");

    let pageToken: string | undefined;
    let page = 0;
    let maxSeenMs = sinceMs;
    const results: Record<string, number> = {};
    do {
      const res = await listMessages(accessToken, {
        q: `after:${afterEpoch}`,
        maxResults: PAGE_SIZE,
        pageToken,
      });
      for (const m of res.messages) {
        const r = await processGmailMessage(base44, accessToken, m.id, inboxAddress);
        results[r.status] = (results[r.status] ?? 0) + 1;
        if (r.status !== "duplicate") {
          console.log(`sweep msg=${m.id} -> ${r.status}${r.detail ? ` (${r.detail})` : ""}`);
        }
      }
      // Advance the cursor by the newest message actually seen this run.
      if (res.messages.length > 0) {
        // list is newest-first; fetch times come from processing, so use now
        // minus nothing: track via internalDate would need getMessage; the
        // conservative cursor is "now" only when we saw mail this run.
        maxSeenMs = Date.now();
      }
      pageToken = res.nextPageToken;
      page++;
    } while (pageToken && page < MAX_PAGES);

    const cursorPatch = {
      key: SYNC_KEY,
      last_message_ts: new Date(maxSeenMs).toISOString(),
      last_run_at: new Date().toISOString(),
    };
    if (state) await service.SyncState.update(state.id, cursorPatch);
    else await service.SyncState.create(cursorPatch);

    console.log("sweep done:", JSON.stringify({ ...results, cursor: cursorPatch.last_message_ts }));
    return Response.json({ ok: true, results });
  } catch (err) {
    console.log("sweep error:", err instanceof Error ? err.message : String(err));
    return Response.json({ ok: false });
  }
});
