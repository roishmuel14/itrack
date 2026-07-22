// account/wipe (PRD section 11): delete ALL rows owned by the caller across
// every per-user entity, including UserSettings (a fresh alias is issued on
// next bootstrap). Other users' data is untouched (stage 6 DoD re-runs the
// leak test after wipe).

import { createClientFromRequest } from "npm:@base44/sdk";
import { fail, getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";

const PER_USER_ENTITIES = [
  "TrackingEvent",
  "Shipment",
  "RefundOpportunity",
  "EmailRecord",
  "Order",
  "UserSettings",
] as const;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await getUserOrNull(base44);
    if (!user) return unauthorized();

    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {
      body = {};
    }
    if (body.confirm !== true) {
      return fail(422, "Cannot wipe account", [
        { code: "confirm_required", message: "Pass confirm: true to wipe all your data" },
      ]);
    }

    const service = base44.asServiceRole.entities;
    const deleted: Record<string, number> = {};
    for (const entity of PER_USER_ENTITIES) {
      const result = await service[entity].deleteMany({ owner_email: user.email });
      deleted[entity] = result?.deleted ?? 0;
    }
    console.log(`account/wipe for ${user.email}:`, JSON.stringify(deleted));
    return ok({ wiped: true, deleted });
  } catch (err) {
    return serverError(err);
  }
});
