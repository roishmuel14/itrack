// settings/update (PRD F10): digest preferences for the caller only.

import { createClientFromRequest } from "npm:@base44/sdk";
import { fail, getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await getUserOrNull(base44);
    if (!user) return unauthorized();

    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {
      return fail(400, "Invalid request", [{ code: "bad_json", message: "Request body must be JSON" }]);
    }

    const patch: Record<string, unknown> = {};
    const reasons = [];
    if (body.digest_enabled !== undefined) {
      if (typeof body.digest_enabled !== "boolean") {
        reasons.push({ code: "bad_digest_enabled", message: "digest_enabled must be true or false" });
      } else {
        patch.digest_enabled = body.digest_enabled;
      }
    }
    if (body.digest_hour_utc !== undefined) {
      const h = Number(body.digest_hour_utc);
      if (!Number.isInteger(h) || h < 0 || h > 23) {
        reasons.push({ code: "bad_digest_hour", message: "digest_hour_utc must be a whole hour between 0 and 23" });
      } else {
        patch.digest_hour_utc = h;
      }
    }
    if (reasons.length) return fail(422, "Cannot save settings", reasons);
    if (Object.keys(patch).length === 0) {
      return fail(422, "Cannot save settings", [{ code: "empty", message: "Nothing to update" }]);
    }

    const service = base44.asServiceRole.entities;
    const settings = await service.UserSettings.filter({ owner_email: user.email });
    if (settings.length === 0) {
      return fail(422, "Cannot save settings", [
        { code: "no_settings", message: "Open the dashboard once to initialize your account first" },
      ]);
    }
    const updated = await service.UserSettings.update(settings[0].id, patch);
    return ok({ settings: updated });
  } catch (err) {
    return serverError(err);
  }
});
