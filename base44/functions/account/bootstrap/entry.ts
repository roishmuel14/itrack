// account/bootstrap: idempotently create the caller's UserSettings row and
// return it, with the Gmail connection state the UI needs. Establishes the
// mutation pattern: auth -> asServiceRole write with server-stamped
// owner_email -> error contract. Frontend invokes this on first load.

import { createClientFromRequest } from "npm:@base44/sdk";
import { getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await getUserOrNull(base44);
    if (!user) return unauthorized();

    const service = base44.asServiceRole.entities;

    // owner_email comes from the token (auth.me), NEVER from the request body.
    const existing = await service.UserSettings.filter({ owner_email: user.email });
    let settings = existing[0] ?? null;
    let created = false;
    if (!settings) {
      settings = await service.UserSettings.create({
        owner_email: user.email,
        digest_enabled: true,
        digest_hour_utc: 7,
        gmail_connected: false,
      });
      created = true;

      // Self-heal a bootstrap race: keep only the oldest row for this user.
      const all = await service.UserSettings.filter({ owner_email: user.email }, "created_date");
      if (all.length > 1) {
        for (const extra of all.slice(1)) await service.UserSettings.delete(extra.id);
        settings = all[0];
        created = settings.id === all[0].id && created;
      }
    }

    // Live connection check so the UI never trusts a stale flag: if the user
    // revoked access, gmail_connected flips back on next load.
    const connectorId = Deno.env.get("GMAIL_CONNECTOR_ID") ?? null;
    let gmailConnected = false;
    if (connectorId) {
      try {
        await base44.asServiceRole.connectors.getCurrentAppUserConnection(connectorId);
        gmailConnected = true;
      } catch (_) {
        gmailConnected = false;
      }
    }
    if (settings.gmail_connected !== gmailConnected) {
      settings = await service.UserSettings.update(settings.id, { gmail_connected: gmailConnected });
    }

    return ok({
      settings,
      created,
      gmail: { configured: !!connectorId, connected: gmailConnected, connector_id: connectorId },
    });
  } catch (err) {
    return serverError(err);
  }
});
