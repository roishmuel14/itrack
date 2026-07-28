// orders/setPaymentMethod (PRD amendment v1.6, plan 3.3): manual override for
// how an order was paid. This is the ONLY write path for existing orders
// (EmailRecord never stores full bodies, so email extraction can only carry
// payment_method for newly synced mail; see pipeline.ts). Owner-checked,
// manual always wins: payment_method_source is always "manual" here, and
// pipeline.ts's gap-fill write never overwrites a manual value.

import { createClientFromRequest } from "npm:@base44/sdk";
import { fail, getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { PAYMENT_METHODS } from "../../../shared/extract.ts";

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
    const paymentMethod = typeof body.payment_method === "string" ? body.payment_method : "";
    if (!orderId || !(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
      return fail(422, "Cannot save payment method", [
        { code: "bad_input", message: "order_id and a valid payment_method are required" },
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
      return fail(404, "Cannot save payment method", [
        { code: "not_found", message: "That order was not found" },
      ]);
    }

    await service.Order.update(orderId, {
      payment_method: paymentMethod,
      payment_method_source: "manual",
    });
    return ok({ order_id: orderId, payment_method: paymentMethod });
  } catch (err) {
    return serverError(err);
  }
});
