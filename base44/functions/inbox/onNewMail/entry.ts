// inbox/onNewMail: connector-automation webhook for new mail in the shared
// iTrack inbox. Lists the most recent messages and runs each through the
// ingest pipeline (idempotent per gmail_message_id, so overlap with the
// sweep cron is free).
//
// STAGE 2 GATE evidence: logs the FULL raw automation payload on every fire,
// and the pipeline logs per-message routing headers (Delivered-To / To /
// X-Forwarded-To) + extracted alias candidates.
// RAW PAYLOAD SHAPE: TBD - paste from `base44 logs` after the first live fire.
//
// Anonymous-tolerant webhook (PRD section 6): never requires auth, acts via
// service role, ignores every request field, always returns 200 so the
// automation does not retry-spam.

import { createClientFromRequest } from "npm:@base44/sdk";
import { listMessages } from "../../../shared/gmail.ts";
import { processGmailMessage } from "../../../shared/pipeline.ts";

const BATCH = 10;

Deno.serve(async (req) => {
  try {
    let payload: unknown = null;
    try {
      payload = await req.json();
    } catch (_) {
      payload = { note: "no JSON body" };
    }
    console.log("onNewMail automation payload:", JSON.stringify(payload));

    const base44 = createClientFromRequest(req);
    const { accessToken } = await base44.asServiceRole.connectors.getConnection("gmail");
    const inboxAddress = Deno.env.get("ITRACK_INBOX_ADDRESS") ?? undefined;

    const { messages } = await listMessages(accessToken, { maxResults: BATCH });
    const results: Record<string, number> = {};
    for (const m of messages) {
      const r = await processGmailMessage(base44, accessToken, m.id, inboxAddress);
      results[r.status] = (results[r.status] ?? 0) + 1;
      if (r.status !== "duplicate") {
        console.log(`onNewMail msg=${m.id} -> ${r.status}${r.detail ? ` (${r.detail})` : ""}`);
      }
    }
    console.log("onNewMail done:", JSON.stringify(results));
    return Response.json({ ok: true, results });
  } catch (err) {
    console.log("onNewMail error:", err instanceof Error ? err.message : String(err));
    return Response.json({ ok: false });
  }
});
