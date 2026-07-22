// inbox/confirmForwarding (PRD F8): Gmail auto-forward filters make Google
// send a confirmation code/link to the DESTINATION inbox; iTrack owns that
// inbox, so this finds the confirmation for the caller's alias and surfaces
// it in onboarding. Sets forwarding_confirmed once found.

import { createClientFromRequest } from "npm:@base44/sdk";
import { fail, getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { getMessage, listMessages } from "../../../shared/gmail.ts";

const FORWARDING_SENDER = "forwarding-noreply@google.com";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await getUserOrNull(base44);
    if (!user) return unauthorized();

    const service = base44.asServiceRole.entities;
    const settings = await service.UserSettings.filter({ owner_email: user.email });
    if (settings.length === 0) {
      return fail(422, "Cannot check forwarding", [
        { code: "no_settings", message: "Open the dashboard once to set up your iTrack address first" },
      ]);
    }
    const aliasToken = settings[0].alias_token;

    let accessToken: string;
    try {
      ({ accessToken } = await base44.asServiceRole.connectors.getConnection("gmail"));
    } catch (_) {
      return fail(503, "Cannot check forwarding", [
        { code: "inbox_unavailable", message: "The iTrack inbox is not connected yet. Try again soon." },
      ]);
    }

    // Google's confirmation goes TO the exact alias; search recent mail from
    // the forwarding sender and match the alias in the To header.
    const { messages } = await listMessages(accessToken, {
      q: `from:${FORWARDING_SENDER} newer_than:2d`,
      maxResults: 20,
    });
    for (const m of messages) {
      const msg = await getMessage(accessToken, m.id);
      const to = (msg.headers["To"] ?? "").toLowerCase();
      if (!to.includes(`+${aliasToken.toLowerCase()}@`)) continue;

      const text = msg.text || msg.html;
      const codeMatch = (msg.headers["Subject"] ?? "").match(/#?(\d{9,10})/) ?? text.match(/confirmation code:?\s*#?(\d{9,10})/i);
      const linkMatch = text.match(/https:\/\/mail-settings\.google\.com\/mail\/[^\s"<>\]]+/);
      if (codeMatch || linkMatch) {
        await service.UserSettings.update(settings[0].id, { forwarding_confirmed: true });
        return ok({
          found: true,
          code: codeMatch?.[1] ?? null,
          link: linkMatch?.[0] ?? null,
          received_at: new Date(Number(msg.internalDate)).toISOString(),
        });
      }
    }
    return ok({ found: false });
  } catch (err) {
    return serverError(err);
  }
});
