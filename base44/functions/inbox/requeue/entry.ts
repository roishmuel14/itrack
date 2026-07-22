// inbox/requeue (PRD section 10.7, admin only): resolve a quarantined
// (unroutable) EmailRecord by assigning it to a user (re-runs the pipeline
// for that message as them) or deleting it.

import { createClientFromRequest } from "npm:@base44/sdk";
import { fail, getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { getMessage } from "../../../shared/gmail.ts";
import { runCorePipeline } from "../../../shared/pipeline.ts";
import { htmlToText } from "../../../shared/htmlToText.ts";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await getUserOrNull(base44);
    if (!user) return unauthorized();
    if (user.role !== "admin") {
      return fail(403, "Not allowed", [{ code: "admin_only", message: "Admin access required" }]);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {
      return fail(400, "Invalid request", [{ code: "bad_json", message: "Request body must be JSON" }]);
    }
    const recordId = typeof body.email_record_id === "string" ? body.email_record_id : "";
    const targetEmail = typeof body.owner_email === "string" ? body.owner_email.trim().toLowerCase() : "";
    const remove = body.delete === true;
    if (!recordId || (!targetEmail && !remove)) {
      return fail(422, "Cannot requeue", [
        { code: "bad_input", message: "email_record_id plus owner_email (or delete: true) required" },
      ]);
    }

    const service = base44.asServiceRole.entities;
    let record;
    try {
      record = await service.EmailRecord.get(recordId);
    } catch (_) {
      record = null;
    }
    if (!record || record.parse_status !== "unroutable") {
      return fail(404, "Cannot requeue", [
        { code: "not_found", message: "No quarantined email with that id" },
      ]);
    }

    if (remove) {
      await service.EmailRecord.delete(recordId);
      return ok({ deleted: true });
    }

    const settings = await service.UserSettings.filter({ owner_email: targetEmail });
    if (settings.length === 0) {
      return fail(422, "Cannot requeue", [
        { code: "unknown_user", message: `${targetEmail} has no iTrack account settings` },
      ]);
    }

    // Refetch the original message for full content; fall back to the stored
    // snippet if the inbox is unavailable.
    let from = record.from_address ?? "";
    let subject = record.subject ?? "";
    let html = "";
    let text = record.snippet ?? "";
    let receivedAt = record.received_at ?? new Date().toISOString();
    try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection("gmail");
      const msg = await getMessage(accessToken, record.gmail_message_id);
      from = msg.headers["From"] ?? from;
      subject = msg.headers["Subject"] ?? subject;
      html = msg.html;
      text = msg.text || htmlToText(msg.html) || text;
      receivedAt = new Date(Number(msg.internalDate)).toISOString();
    } catch (_) {
      // proceed with the snippet
    }

    // Remove the quarantine row first so the idempotency check cannot skip.
    await service.EmailRecord.delete(recordId);
    const result = await runCorePipeline(base44, {
      ownerEmail: targetEmail,
      aliasToken: settings[0].alias_token,
      from,
      subject,
      html,
      text,
      receivedAt,
      gmailMessageId: record.gmail_message_id,
      threadId: record.thread_id,
      source: "gmail",
    });
    return ok({ requeued: true, result });
  } catch (err) {
    return serverError(err);
  }
});
