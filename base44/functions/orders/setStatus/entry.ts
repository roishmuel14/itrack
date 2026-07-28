// orders/setStatus (PRD F4): manual controls, server-side state authority.
// Actions: archive | unarchive | mark_delivered | delete. Owner check against
// the token-derived email; monotonicity enforced by the merge engine's rules.

import { createClientFromRequest } from "npm:@base44/sdk";
import { fail, getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { canTransition, TERMINAL_STATUSES } from "../../../shared/mergeEngine.ts";

const ACTIONS = ["archive", "unarchive", "mark_delivered", "delete"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Child rows of an order, deleted with it. EmailRecord is deliberately absent:
// it is the ingest idempotency anchor, so keeping it is what stops the next
// Gmail sync from re-minting the order the user just deleted.
const CHILD_ENTITIES = ["TrackingEvent", "Shipment", "RefundOpportunity"] as const;

// The delivery day the user picked, validated. Rejecting rather than silently
// clamping: a wrong date the user cannot see is worse than an error they can.
function resolveDeliveredAt(
  raw: unknown,
  orderedAt: string | undefined,
): { date: string } | { reason: { code: string; message: string } } {
  const today = new Date().toISOString().slice(0, 10);
  if (raw == null || raw === "") return { date: today };
  if (typeof raw !== "string" || !DATE_RE.test(raw)) {
    return { reason: { code: "bad_delivered_at", message: "Delivery date must look like YYYY-MM-DD" } };
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    return { reason: { code: "bad_delivered_at", message: "That is not a real date" } };
  }
  if (raw > today) {
    return { reason: { code: "future_delivered_at", message: "A delivery date cannot be in the future" } };
  }
  if (orderedAt && raw < orderedAt.slice(0, 10)) {
    return {
      reason: {
        code: "delivered_before_ordered",
        message: "The delivery date cannot be before the order was placed",
      },
    };
  }
  return { date: raw };
}

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
    if (!orderId || !ACTIONS.includes(action)) {
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

    if (action === "delete") {
      // Children first, order last: a crash mid-way leaves the card visible with
      // a thinner timeline, which the user can retry. The reverse order would
      // strand invisible child rows forever.
      const removed: Record<string, number> = {};
      for (const entity of CHILD_ENTITIES) {
        const rows = await service[entity].filter({ order_id: orderId }, "-created_date", 1000);
        let count = 0;
        for (const row of rows) {
          // Belt and braces: the order is already owner-checked, but a child row
          // is only ever deleted under the caller's own email.
          if (row.owner_email && row.owner_email !== user.email) continue;
          await service[entity].delete(row.id);
          count++;
        }
        removed[entity] = count;
      }
      // EmailRecords survive as the idempotency anchor (see CHILD_ENTITIES), but
      // their pointer must not dangle onto a row that no longer exists.
      const emails = await service.EmailRecord.filter({ order_id: orderId }, "-created_date", 1000);
      let unlinked = 0;
      for (const rec of emails) {
        if (rec.owner_email && rec.owner_email !== user.email) continue;
        await service.EmailRecord.update(rec.id, { order_id: "" });
        unlinked++;
      }
      await service.Order.delete(orderId);
      console.log(
        `orders/setStatus delete ${orderId} for ${user.email}:`,
        JSON.stringify({ ...removed, EmailRecord_unlinked: unlinked }),
      );
      return ok({ order_id: orderId, deleted: true, removed, email_records_unlinked: unlinked });
    }

    // mark_delivered
    const resolved = resolveDeliveredAt(body.delivered_at, order.ordered_at);
    if ("reason" in resolved) return fail(422, "Cannot update order", [resolved.reason]);
    const deliveredAt = resolved.date;

    if (order.status === "delivered") {
      // Already home: still honour a corrected date rather than no-op silently.
      if (order.delivered_at === deliveredAt) {
        return ok({ order_id: orderId, status: "delivered", delivered_at: deliveredAt, unchanged: true });
      }
      await service.Order.update(orderId, { delivered_at: deliveredAt });
      return ok({ order_id: orderId, status: "delivered", delivered_at: deliveredAt });
    }
    if (TERMINAL_STATUSES.has(order.status) || !canTransition(order.status, "delivered")) {
      return fail(422, "Cannot update order", [
        { code: "invalid_transition", message: `A ${order.status} order cannot be marked delivered` },
      ]);
    }
    const now = new Date().toISOString();
    // The timeline event is dated by the delivery, not by the click: a parcel
    // logged three days late still sits in the right place in the history.
    const occurredAt = deliveredAt === now.slice(0, 10) ? now : `${deliveredAt}T12:00:00.000Z`;
    await service.Order.update(orderId, {
      status: "delivered",
      delivered_at: deliveredAt,
      // last_event_at is forward-only (the dashboard sorts on it).
      last_event_at: order.last_event_at && order.last_event_at > occurredAt ? order.last_event_at : occurredAt,
    });
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
      occurred_at: occurredAt,
      title: "Marked delivered",
      description: "Marked as delivered manually from the dashboard",
      source: "manual",
    });
    return ok({ order_id: orderId, status: "delivered", delivered_at: deliveredAt });
  } catch (err) {
    return serverError(err);
  }
});
