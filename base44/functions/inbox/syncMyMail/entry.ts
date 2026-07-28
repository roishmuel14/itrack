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
import { resolveAfterEpoch } from "../../../shared/syncWindow.ts";

const BATCH = 20;

// Recall-oriented Gmail search: the LLM classifier is the precision filter,
// manual add is the net for anything this misses. Food-delivery senders (wolt
// etc.) are deliberately excluded: same-day food orders are not trackable parcels.
const ORDER_QUERY =
  '(subject:(order OR shipped OR shipping OR shipment OR delivery OR delivered OR tracking OR package OR הזמנה OR משלוח OR חבילה) ' +
  'OR from:(amazon OR temu OR aliexpress OR shein OR ebay OR asos OR next OR ikea))';

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

    // The frontend echoes next_page_token AND the after bound back so paging
    // continues with a STABLE query: a Gmail pageToken is only valid for the
    // exact q that issued it, and on first syncs the bound would otherwise
    // drift with Date.now() between rounds and invalidate the token.
    let reqPageToken: string | undefined;
    let echoedAfter: number | undefined;
    try {
      const body = await req.json();
      if (body && typeof body.page_token === "string" && body.page_token) reqPageToken = body.page_token;
      if (body && typeof body.after === "number") echoedAfter = body.after;
    } catch (_) {
      // no / empty body: start a fresh page
    }

    const service = base44.asServiceRole.entities;
    const settingsRows = await service.UserSettings.filter({ owner_email: user.email });
    const settings = settingsRows[0] ?? null;

    const now = Date.now();
    const afterEpoch = resolveAfterEpoch({
      lastSyncAt: settings?.last_gmail_sync_at,
      nowMs: now,
      echoedAfter,
      hasPageToken: !!reqPageToken,
    });

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
    // Gmail lists newest-first. Process the page OLDEST-FIRST so the
    // informative order confirmation usually creates the card before the
    // sparse shipping/delivery notices of the same thread try to merge into
    // it (a number-less notice processed first creates a sparse order the
    // later confirmation may fail to match). Cross-page order is still
    // newest-page-first; the merge engine's widened fuzzy matching covers it.
    for (const m of [...page.messages].reverse()) {
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
    return ok({
      ok: true,
      scanned,
      results,
      has_more: hasMore,
      next_page_token: nextPageToken ?? null,
      // Echoed back by the frontend with next_page_token to keep q stable.
      after: afterEpoch,
    });
  } catch (err) {
    return serverError(err);
  }
});
