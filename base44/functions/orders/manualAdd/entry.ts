// orders/manualAdd (PRD F9): authenticated. Two input modes:
//   { email_text }                      -> the same parse pipeline as forwarded mail
//   { tracking_number, merchant_name }  -> minimal Order + Shipment + event
// Serves the judge path (zero email setup), the empty-state CTA, and
// non-forwardable purchases. Also exposed as an agent tool later.

import { createClientFromRequest } from "npm:@base44/sdk";
import { fail, getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { runCorePipeline } from "../../../shared/pipeline.ts";
import { resolveCarrier } from "../../../shared/carriers.ts";

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

    const emailText = typeof body.email_text === "string" ? body.email_text.trim() : "";
    const trackingNumber = typeof body.tracking_number === "string" ? body.tracking_number.trim() : "";
    const merchantName = typeof body.merchant_name === "string" ? body.merchant_name.trim() : "";

    if (emailText) {
      if (emailText.length < 40) {
        return fail(422, "Cannot add order", [
          { code: "text_too_short", message: "Paste the full email text so we can read the order details" },
        ]);
      }
      const looksLikeHtml = /<[a-z][\s\S]*>/i.test(emailText);
      const result = await runCorePipeline(base44, {
        ownerEmail: user.email,
        from: "manual paste",
        subject: emailText.split("\n").find((l: string) => l.trim())?.slice(0, 200) ?? "Pasted email",
        html: looksLikeHtml ? emailText : "",
        text: looksLikeHtml ? "" : emailText,
        receivedAt: new Date().toISOString(),
        gmailMessageId: `manual-${crypto.randomUUID()}`,
        source: "manual",
      });
      if (result.status === "irrelevant") {
        return result.reason === "excluded_kind"
          ? fail(422, "Cannot add order", [
            {
              code: "excluded_kind",
              message:
                "iTrack tracks physical parcels only; food, grocery, digital, and booking orders are not tracked",
            },
          ])
          : fail(422, "Cannot add order", [
            { code: "not_order_email", message: "That text does not look like an order or delivery email" },
          ]);
      }
      if (result.status !== "processed") {
        return fail(422, "Cannot add order", [
          { code: "parse_failed", message: "We could not read an order out of that text. Try the tracking-number option." },
        ]);
      }
      return ok({ order_id: result.orderId, email_record_id: result.emailRecordId });
    }

    if (trackingNumber) {
      const reasons = [];
      if (!merchantName) {
        reasons.push({ code: "merchant_required", message: "Tell us which store this order is from" });
      }
      if (trackingNumber.replace(/[\s-]/g, "").length < 6) {
        reasons.push({ code: "tracking_invalid", message: "That tracking number looks too short" });
      }
      if (reasons.length) return fail(422, "Cannot add order", reasons);

      const service = base44.asServiceRole.entities;

      // Same tracking number = same parcel: return the existing order instead
      // of minting a duplicate card (agent tool calls and double submits land
      // here too).
      const cleanTracking = trackingNumber.replace(/[\s-]/g, "").toUpperCase();
      const myShipments = await service.Shipment.filter(
        { owner_email: user.email },
        "-created_date",
        1000,
      );
      const existing = myShipments.find(
        (s: any) => (s.tracking_number ?? "").replace(/[\s-]/g, "").toUpperCase() === cleanTracking,
      );
      if (existing) {
        return ok({ order_id: existing.order_id, shipment_id: existing.id, already_exists: true });
      }

      const carrier = resolveCarrier(trackingNumber);
      const now = new Date().toISOString();
      const order = await service.Order.create({
        owner_email: user.email,
        merchant_name: merchantName,
        status: "shipped",
        currency: "USD",
        last_event_at: now,
      });
      const shipment = await service.Shipment.create({
        owner_email: user.email,
        order_id: order.id,
        carrier: carrier?.name,
        tracking_number: trackingNumber,
        tracking_url: carrier?.url,
        status: "shipped",
      });
      await service.TrackingEvent.create({
        owner_email: user.email,
        order_id: order.id,
        shipment_id: shipment.id,
        type: "shipment",
        occurred_at: now,
        title: carrier?.name ? `Tracking added (${carrier.name})` : "Tracking added",
        description: `Added manually with tracking number ${trackingNumber}`,
        source: "manual",
      });
      return ok({ order_id: order.id, shipment_id: shipment.id });
    }

    return fail(422, "Cannot add order", [
      { code: "input_required", message: "Paste an order email or enter a tracking number and store" },
    ]);
  } catch (err) {
    return serverError(err);
  }
});
