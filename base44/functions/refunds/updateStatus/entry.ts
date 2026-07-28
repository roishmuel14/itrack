// refunds/updateStatus (PRD F5, amendment v1.6): dismiss / claimed /
// recovered / restore transitions, owner-checked. Dismissed cases never
// resurface from a rescan (scan skips any existing row that is dismissed
// regardless of stage), but the user can explicitly Restore one back to
// detected so a scan pass can re-evaluate it on the next run.

import { createClientFromRequest } from "npm:@base44/sdk";
import { fail, getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";

const ALLOWED: Record<string, string[]> = {
  detected: ["dismissed", "claimed", "recovered"],
  notified: ["dismissed", "claimed", "recovered"],
  claimed: ["recovered", "dismissed"],
  dismissed: ["detected"],
  recovered: [],
};

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
    const id = typeof body.opportunity_id === "string" ? body.opportunity_id : "";
    const next = typeof body.status === "string" ? body.status : "";
    if (!id || !["detected", "dismissed", "claimed", "recovered"].includes(next)) {
      return fail(422, "Cannot update refund", [
        { code: "bad_input", message: "opportunity_id and a valid status are required" },
      ]);
    }

    const service = base44.asServiceRole.entities;
    let opp;
    try {
      opp = await service.RefundOpportunity.get(id);
    } catch (_) {
      opp = null;
    }
    if (!opp || opp.owner_email !== user.email) {
      return fail(404, "Cannot update refund", [{ code: "not_found", message: "That refund was not found" }]);
    }
    if (!(ALLOWED[opp.status] ?? []).includes(next)) {
      return fail(422, "Cannot update refund", [
        { code: "invalid_transition", message: `A ${opp.status} refund cannot become ${next}` },
      ]);
    }
    await service.RefundOpportunity.update(id, { status: next });
    return ok({ opportunity_id: id, status: next });
  } catch (err) {
    return serverError(err);
  }
});
