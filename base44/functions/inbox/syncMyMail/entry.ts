// inbox/syncMyMail (per-user Gmail OAuth model, 2026-07-23): sync the
// SIGNED-IN user's own mailbox through the ingest pipeline using their
// app-user connector token. There is no background path: app-user tokens are
// request-scoped, so sync happens on app load, on demand, and on an interval
// while the app is open.
//
// Incremental: queries mail after (last_gmail_sync_at - overlap), first sync
// looks back 60 days. Batched: at most BATCH messages per invocation; returns
// has_more so the frontend loops with visible progress. Idempotent per
// (owner, message id), so overlaps and loops are free.

import { createClientFromRequest } from "npm:@base44/sdk";
import { fail, getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { listMessages } from "../../../shared/gmail.ts";
import { processOwnedGmailMessage } from "../../../shared/pipeline.ts";

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

    const service = base44.asServiceRole.entities;
    const settingsRows = await service.UserSettings.filter({ owner_email: user.email });
    const settings = settingsRows[0] ?? null;

    const now = Date.now();
    const lastSyncMs = settings?.last_gmail_sync_at ? Date.parse(settings.last_gmail_sync_at) : NaN;
    const sinceMs = Number.isNaN(lastSyncMs)
      ? now - FIRST_SYNC_LOOKBACK_DAYS * 24 * 3600 * 1000
      : lastSyncMs;
    const afterEpoch = Math.max(0, Math.floor(sinceMs / 1000) - OVERLAP_SECONDS);

    // Page through matches; process up to BATCH non-duplicate messages.
    const results: Record<string, number> = {};
    let processed = 0;
    let pageToken: string | undefined;
    let hasMore = false;
    let scanned = 0;
    do {
      const page = await listMessages(accessToken, {
        q: `after:${afterEpoch} ${ORDER_QUERY}`,
        maxResults: 50,
        pageToken,
      });
      for (const m of page.messages) {
        scanned++;
        if (processed >= BATCH) {
          hasMore = true;
          break;
        }
        const r = await processOwnedGmailMessage(base44, accessToken, m.id, user.email);
        results[r.status] = (results[r.status] ?? 0) + 1;
        if (r.status !== "duplicate") processed++;
        if (r.status === "failed") {
          console.log(`syncMyMail ${user.email} msg=${m.id} failed: ${r.detail ?? ""}`);
        }
      }
      pageToken = hasMore ? undefined : page.nextPageToken;
    } while (pageToken);

    // Advance the cursor only when this run drained everything it found.
    const patch: Record<string, unknown> = { gmail_connected: true };
    if (!hasMore) patch.last_gmail_sync_at = new Date(now).toISOString();
    if (settings) await service.UserSettings.update(settings.id, patch);

    console.log(
      `syncMyMail ${user.email}: scanned=${scanned} ${JSON.stringify(results)} has_more=${hasMore}`,
    );
    return ok({ ok: true, scanned, results, has_more: hasMore });
  } catch (err) {
    return serverError(err);
  }
});
