// inbox/syncMyMail (per-user Gmail OAuth model, 2026-07-23): sync the
// SIGNED-IN user's own mailbox through the ingest pipeline using their
// app-user connector token. There is no background path: app-user tokens are
// request-scoped, so sync happens on app load, on demand, and on an interval
// while the app is open.
//
// Incremental: queries mail after (last_gmail_sync_at - overlap), first sync
// looks back 60 days. One Gmail page (<= BATCH messages) per invocation; the
// frontend loops, echoing next_page_token, so successive calls page through
// strictly older mail and NEVER re-list what a prior call already handled.
// (Re-listing from a fixed cursor + entity read-after-write lag used to
// reprocess messages into duplicate rows across the frontend's loop.)
// Idempotent per (owner, message id) as a belt-and-braces net for the overlap.

import { createClientFromRequest } from "npm:@base44/sdk";
import { fail, getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { listMessages } from "../../../shared/gmail.ts";
import { processOwnedGmailMessage, type RunCache } from "../../../shared/pipeline.ts";

const BATCH = 20;
const OVERLAP_SECONDS = 600;
const FIRST_SYNC_LOOKBACK_DAYS = 60;

// Recall-oriented Gmail search: the LLM classifier is the precision filter,
// manual add is the net for anything this misses.
const ORDER_QUERY =
  '(subject:(order OR shipped OR shipping OR delivery OR delivered OR tracking OR package OR הזמנה OR משלוח OR חבילה) ' +
  'OR from:(amazon OR temu OR aliexpress OR shein OR ebay OR asos OR next OR ikea OR wolt))';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await getUserOrNull(base44);
    if (!user) return unauthorized();

    const connectorId = Deno.env.get("GMAIL_CONNECTOR_ID");
    if (!connectorId) {
      return fail(503, "Gmail sync unavailable", [
        { code: "not_configured", message: "Gmail connection is not configured yet. Use manual add meanwhile." },
      ]);
    }

    let accessToken: string;
    try {
      ({ accessToken } = await base44.asServiceRole.connectors.getCurrentAppUserConnection(connectorId));
    } catch (_) {
      return fail(409, "Gmail not connected", [
        { code: "not_connected", message: "Connect your Gmail from the dashboard to sync your orders" },
      ]);
    }

    // The frontend echoes next_page_token back so we continue Gmail's own
    // pagination across calls instead of restarting from the cursor each time.
    let reqPageToken: string | undefined;
    try {
      const body = await req.json();
      if (body && typeof body.page_token === "string" && body.page_token) reqPageToken = body.page_token;
    } catch (_) {
      // no / empty body: start a fresh page
    }

    const service = base44.asServiceRole.entities;
    const settingsRows = await service.UserSettings.filter({ owner_email: user.email });
    const settings = settingsRows[0] ?? null;

    const now = Date.now();
    const lastSyncMs = settings?.last_gmail_sync_at ? Date.parse(settings.last_gmail_sync_at) : NaN;
    const sinceMs = Number.isNaN(lastSyncMs)
      ? now - FIRST_SYNC_LOOKBACK_DAYS * 24 * 3600 * 1000
      : lastSyncMs;
    const afterEpoch = Math.max(0, Math.floor(sinceMs / 1000) - OVERLAP_SECONDS);

    // One dedup cache per invocation: orders created earlier in this page stay
    // visible as merge candidates despite entity read-after-write lag.
    const runCache: RunCache = { orders: [], shipments: [] };
    const results: Record<string, number> = {};
    let scanned = 0;

    // Exactly one Gmail page per call (maxResults bounds per-call LLM work). The
    // frontend loops on next_page_token, so each call advances to older mail and
    // never re-lists what an earlier call already processed.
    const page = await listMessages(accessToken, {
      q: `after:${afterEpoch} ${ORDER_QUERY}`,
      maxResults: BATCH,
      pageToken: reqPageToken,
    });
    for (const m of page.messages) {
      scanned++;
      const r = await processOwnedGmailMessage(base44, accessToken, m.id, user.email, runCache);
      results[r.status] = (results[r.status] ?? 0) + 1;
      if (r.status === "failed") {
        console.log(`syncMyMail ${user.email} msg=${m.id} failed: ${r.detail ?? ""}`);
      }
    }
    const nextPageToken = page.nextPageToken;
    const hasMore = !!nextPageToken;

    // Advance the persistent high-water mark only when the result set is fully
    // drained (Gmail returned no next page). Until then we keep paging.
    const patch: Record<string, unknown> = { gmail_connected: true };
    if (!hasMore) patch.last_gmail_sync_at = new Date(now).toISOString();
    if (settings) await service.UserSettings.update(settings.id, patch);

    console.log(
      `syncMyMail ${user.email}: scanned=${scanned} ${JSON.stringify(results)} has_more=${hasMore}`,
    );
    return ok({ ok: true, scanned, results, has_more: hasMore, next_page_token: nextPageToken ?? null });
  } catch (err) {
    return serverError(err);
  }
});
