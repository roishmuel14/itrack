// orders/setStatus (PRD F4): manual controls, server-side state authority.
// Actions: archive | unarchive | mark_delivered. Owner check against the
// token-derived email; monotonicity enforced by the merge engine's rules.

import { createClientFromRequest } from "npm:@base44/sdk";
import { fail, getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { canTransition, TERMINAL_STATUSES } from "../../../shared/mergeEngine.ts";

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
    const orderId = typeof body.order_id === "string" ? body.order_id : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!orderId || !["archive", "unarchive", "mark_delivered"].includes(action)) {
      return fail(422, "Cannot update order", [
        { code: "bad_input", message: "order_id and a valid action are required" },
      ]);
    }

    const service = base44.asServiceRole.entities;
    let order;
    try {
      order = await service.Order.get(orderId);
    } catch (_) {
      order = null;
    }
    if (!order || order.owner_email !== user.email) {
      // Same response for missing and foreign rows: no existence leaks.
      return fail(404, "Cannot update order", [
        { code: "not_found", message: "That order was not found" },
      ]);
    }

    if (action === "archive" || action === "unarchive") {
      await service.Order.update(orderId, { is_archived: action === "archive" });
      return ok({ order_id: orderId, is_archived: action === "archive" });
    }

    // mark_delivered
    if (order.status === "delivered") {
      return ok({ order_id: orderId, status: "delivered", unchanged: true });
    }
    if (TERMINAL_STATUSES.has(order.status) || !canTransition(order.status, "delivered")) {
      return fail(422, "Cannot update order", [
        { code: "invalid_transition", message: `A ${order.status} order cannot be marked delivered` },
      ]);
    }
    const now = new Date().toISOString();
    await service.Order.update(orderId, { status: "delivered", last_event_at: now });
    const shipments = await service.Shipment.filter({ order_id: orderId });
    for (const s of shipments) {
      if (!TERMINAL_STATUSES.has(s.status)) {
        await service.Shipment.update(s.id, { status: "delivered" });
      }
    }
    await service.TrackingEvent.create({
      owner_email: user.email,
      order_id: orderId,
      type: "delivered",
      occurred_at: now,
      title: "Marked delivered",
      description: "Marked as delivered manually from the dashboard",
      source: "manual",
    });
    return ok({ order_id: orderId, status: "delivered" });
  } catch (err) {
    return serverError(err);
  }
});
