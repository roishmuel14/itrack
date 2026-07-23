// The ingestion pipeline core (PRD F1 + F2, amended 2026-07-23 to the
// per-user Gmail OAuth model). Entry points:
//   processOwnedGmailMessage - fetch one message from the OWNER's own inbox
//                              (their app-user connector token), then run
//   runCorePipeline          - classify/extract via LLM, merge into entities
// runCorePipeline is also called directly by orders/manualAdd (pasted text).
//
// Invariants enforced here:
// - Idempotent per (owner_email, gmail_message_id): EmailRecord checked first.
// - Ownership comes from the authenticated caller whose token fetched the
//   mail; there is no routing step and no cross-user path.
// - Statuses are monotonic; this module is their single writer.
// - EmailRecord.snippet <= 2000 chars, never the full body.

import { extractImageCandidates, htmlToText, truncateForLLM } from "./htmlToText.ts";
import { analyzeEmail, arbitrateSameOrder, type ExtractionResult } from "./extract.ts";
import {
  computeStatus,
  decideMerge,
  EVENT_TYPE_TO_RANK,
  fuzzyCandidates,
  normalizeDomain,
  type StatusSignal,
} from "./mergeEngine.ts";
import { resolveCarrier } from "./carriers.ts";
import { rehostImage, rehostMerchantLogo } from "./rehost.ts";
import { getMessage } from "./gmail.ts";

// deno-lint-ignore no-explicit-any
type Base44Client = any;

const SNIPPET_MAX = 1990;
const MAX_REHOSTED_IMAGES = 3;
const LOW_CONFIDENCE = 0.6;

export interface PipelineResult {
  status: "processed" | "duplicate" | "irrelevant" | "unroutable" | "failed";
  emailRecordId?: string;
  orderId?: string;
  detail?: string;
}

export interface CoreInput {
  ownerEmail: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  receivedAt: string; // ISO
  gmailMessageId: string; // synthetic for manual adds
  threadId?: string;
  source: "gmail" | "manual";
}

function snippetOf(text: string): string {
  return text.slice(0, SNIPPET_MAX);
}

function classificationToEventType(c: string, statusSuggestion: string | null): string {
  switch (c) {
    case "order_confirmation":
      return "order_confirmation";
    case "shipping_update":
      if (statusSuggestion === "out_for_delivery") return "out_for_delivery";
      if (statusSuggestion === "in_transit") return "transit_update";
      return "shipment";
    case "delivery":
      return "delivered";
    case "delay":
      return "delay";
    case "seller_message":
      return "seller_message";
    case "refund_update":
      return "refund_update";
    default:
      return "other";
  }
}

function signalsFromEvents(events: Array<{ type: string; occurred_at: string }>): StatusSignal[] {
  return events.map((e) => ({
    rank: EVENT_TYPE_TO_RANK[e.type] ?? null,
    isDelay: e.type === "delay",
    occurredAt: e.occurred_at,
  }));
}

function orderSummaryFor(o: {
  merchant_name?: string;
  order_number?: string | null;
  total?: number | null;
  currency?: string | null;
  ordered_at?: string | null;
  items?: Array<{ name: string }> | null;
}): string {
  return [
    `merchant: ${o.merchant_name ?? "?"}`,
    `order number: ${o.order_number ?? "unknown"}`,
    `total: ${o.total ?? "?"} ${o.currency ?? ""}`,
    `ordered at: ${o.ordered_at ?? "?"}`,
    `items: ${(o.items ?? []).map((i) => i.name).join("; ") || "?"}`,
  ].join("\n");
}

// ---------------------------------------------------------------- gmail path

// Process one message from the owner's OWN mailbox (app-user connector).
export async function processOwnedGmailMessage(
  base44: Base44Client,
  gmailToken: string,
  messageId: string,
  ownerEmail: string,
): Promise<PipelineResult> {
  const service = base44.asServiceRole.entities;

  // 1. Idempotency (PRD F1 AC3), scoped to the owner: message ids are
  // per-mailbox, so the pair is the true key.
  const existing = await service.EmailRecord.filter({
    gmail_message_id: messageId,
    owner_email: ownerEmail,
  });
  if (existing.length > 0) {
    return { status: "duplicate", emailRecordId: existing[0].id };
  }

  let msg;
  try {
    msg = await getMessage(gmailToken, messageId);
  } catch (err) {
    return { status: "failed", detail: `gmail fetch: ${err instanceof Error ? err.message : err}` };
  }

  return await runCorePipeline(base44, {
    ownerEmail,
    from: msg.headers["From"] ?? "",
    subject: msg.headers["Subject"] ?? "",
    html: msg.html,
    text: msg.text,
    receivedAt: new Date(Number(msg.internalDate)).toISOString(),
    gmailMessageId: messageId,
    threadId: msg.threadId,
    source: "gmail",
  });
}

// ----------------------------------------------------------------- core path

export async function runCorePipeline(
  base44: Base44Client,
  input: CoreInput,
): Promise<PipelineResult> {
  const service = base44.asServiceRole.entities;
  const plainText = input.text?.trim() ? input.text : htmlToText(input.html);
  const snippet = snippetOf(plainText);

  try {
    // 3. Classify + extract (one LLM call).
    const imageCandidates = input.html ? extractImageCandidates(input.html) : [];
    const extraction: ExtractionResult = await analyzeEmail(base44, {
      from: input.from,
      subject: input.subject,
      text: truncateForLLM(plainText),
      imageCandidates,
      today: input.receivedAt.slice(0, 10),
    });

    // 4. Irrelevant mail: record and stop (keeps re-forwards idempotent).
    if (!extraction.is_order_related || extraction.classification === "irrelevant") {
      const rec = await service.EmailRecord.create({
        owner_email: input.ownerEmail,
        gmail_message_id: input.gmailMessageId,
        thread_id: input.threadId,
        from_address: input.from,
        subject: input.subject.slice(0, 490),
        received_at: input.receivedAt,
        classification: "irrelevant",
        parse_status: "irrelevant",
        confidence: extraction.confidence,
        snippet,
      });
      return { status: "irrelevant", emailRecordId: rec.id };
    }

    const occurredAt = extraction.event_date ?? input.receivedAt;

    // 5. Merge into an Order.
    const myOrders = await service.Order.filter({ owner_email: input.ownerEmail });
    const myShipments = await service.Shipment.filter({ owner_email: input.ownerEmail });
    const fuzzy = fuzzyCandidates(
      { merchant_domain: extraction.merchant_domain, occurredAt },
      myOrders,
    );
    let decision = decideMerge(
      {
        merchant_domain: extraction.merchant_domain,
        order_number: extraction.order_number,
        tracking_number: extraction.tracking_number,
      },
      myOrders,
      myShipments,
      fuzzy,
    );

    if (decision.kind === "ambiguous") {
      // LLM arbitration against the closest candidates (max 2 calls).
      let matched: string | null = null;
      const incomingSummary = orderSummaryFor({
        merchant_name: extraction.merchant_name ?? undefined,
        order_number: extraction.order_number,
        total: extraction.total,
        currency: extraction.currency,
        ordered_at: occurredAt,
        items: extraction.items ?? undefined,
      });
      for (const candidateId of decision.candidateOrderIds.slice(0, 2)) {
        const candidate = myOrders.find((o: any) => o.id === candidateId);
        if (!candidate) continue;
        if (await arbitrateSameOrder(base44, incomingSummary, orderSummaryFor(candidate))) {
          matched = candidateId;
          break;
        }
      }
      decision = matched
        ? { kind: "matched_order", orderId: matched, via: "order_number" }
        : { kind: "new_order" };
    }

    // Re-host item images (bounded) before writing items.
    const items = [];
    let rehostedCount = 0;
    for (const item of extraction.items ?? []) {
      let imageUrl: string | null = null;
      if (item.image_url && rehostedCount < MAX_REHOSTED_IMAGES) {
        imageUrl = await rehostImage(base44, item.image_url);
        if (imageUrl) rehostedCount++;
      }
      items.push({
        name: item.name,
        qty: item.qty ?? 1,
        price: item.price ?? undefined,
        image_url: imageUrl ?? undefined,
      });
    }

    let orderId: string;
    if (decision.kind === "matched_order") {
      orderId = decision.orderId;
      const order = myOrders.find((o: any) => o.id === orderId)!;
      // Fill gaps; never blank existing values with nulls.
      const patch: Record<string, unknown> = {};
      if (!order.order_number && extraction.order_number) patch.order_number = extraction.order_number;
      if (!order.merchant_domain && extraction.merchant_domain) {
        patch.merchant_domain = normalizeDomain(extraction.merchant_domain);
      }
      if (extraction.promised_date) patch.promised_date = extraction.promised_date;
      if (extraction.eta_date) patch.eta_date = extraction.eta_date;
      if (order.total == null && extraction.total != null) patch.total = extraction.total;
      if (extraction.currency && !order.currency) patch.currency = extraction.currency;
      if ((order.items ?? []).length === 0 && items.length > 0) patch.items = items;
      if (Object.keys(patch).length > 0) await service.Order.update(orderId, patch);
    } else {
      const domain = normalizeDomain(extraction.merchant_domain) || undefined;
      const logoUrl = domain ? await rehostMerchantLogo(base44, domain) : null;
      const created = await service.Order.create({
        owner_email: input.ownerEmail,
        merchant_name: extraction.merchant_name ?? "Unknown merchant",
        merchant_domain: domain,
        logo_url: logoUrl ?? undefined,
        order_number: extraction.order_number ?? undefined,
        ordered_at: extraction.classification === "order_confirmation" ? occurredAt : undefined,
        currency: extraction.currency ?? "USD",
        total: extraction.total ?? undefined,
        status: "ordered",
        promised_date: extraction.promised_date ?? undefined,
        eta_date: extraction.eta_date ?? undefined,
        items,
        confidence: extraction.confidence,
      });
      orderId = created.id;
    }

    // 6. Shipment upsert by tracking number.
    let shipmentId: string | undefined;
    if (extraction.tracking_number) {
      const cleanTracking = extraction.tracking_number.replace(/[\s-]/g, "").toUpperCase();
      const existingShipment = myShipments.find(
        (s: any) => (s.tracking_number ?? "").replace(/[\s-]/g, "").toUpperCase() === cleanTracking,
      );
      const carrier = resolveCarrier(extraction.tracking_number, extraction.carrier);
      if (existingShipment) {
        shipmentId = existingShipment.id;
        const patch: Record<string, unknown> = {};
        if (extraction.eta_date) patch.eta_date = extraction.eta_date;
        if (!existingShipment.carrier && carrier) patch.carrier = carrier.name;
        if (Object.keys(patch).length > 0) await service.Shipment.update(shipmentId, patch);
      } else {
        const created = await service.Shipment.create({
          owner_email: input.ownerEmail,
          order_id: orderId,
          carrier: carrier?.name,
          tracking_number: extraction.tracking_number,
          tracking_url: carrier?.url,
          eta_date: extraction.eta_date ?? undefined,
          status: "shipped",
        });
        shipmentId = created.id;
      }
    }

    // 7. EmailRecord (before the event so provenance links resolve).
    const parseStatus = extraction.confidence < LOW_CONFIDENCE ? "low_confidence" : "parsed";
    const emailRecord = await service.EmailRecord.create({
      owner_email: input.ownerEmail,
      gmail_message_id: input.gmailMessageId,
      thread_id: input.threadId,
      from_address: input.from,
      subject: input.subject.slice(0, 490),
      received_at: input.receivedAt,
      classification: extraction.classification,
      parse_status: parseStatus,
      confidence: extraction.confidence,
      snippet,
      order_id: orderId,
    });

    // 8. Timeline event.
    const eventType = classificationToEventType(extraction.classification, extraction.status_suggestion);
    const carrierLabel = extraction.carrier ? ` via ${extraction.carrier}` : "";
    const titles: Record<string, string> = {
      order_confirmation: "Order confirmed",
      shipment: `Shipped${carrierLabel}`,
      transit_update: `In transit${carrierLabel}`,
      out_for_delivery: "Out for delivery",
      delivered: "Delivered",
      delay: "Delay reported",
      seller_message: "Message from seller",
      refund_update: "Refund update",
      other: "Order update",
    };
    await service.TrackingEvent.create({
      owner_email: input.ownerEmail,
      order_id: orderId,
      shipment_id: shipmentId,
      type: eventType,
      occurred_at: occurredAt,
      title: titles[eventType] ?? "Order update",
      description: snippet.slice(0, 990),
      source: input.source,
      email_record_id: emailRecord.id,
    });

    // 9. Recompute the order status from the FULL event history (single
    // writer, monotonic by construction) + shipment status for this shipment.
    const allEvents = await service.TrackingEvent.filter({ order_id: orderId });
    const signals = signalsFromEvents(allEvents);
    if (extraction.status_suggestion) {
      // Belt and braces: the suggestion itself is a signal too.
      const rank = EVENT_TYPE_TO_RANK[classificationToEventType(extraction.classification, extraction.status_suggestion)];
      signals.push({
        rank: extraction.status_suggestion === "delayed" ? null : rank ?? null,
        isDelay: extraction.status_suggestion === "delayed",
        terminal: extraction.status_suggestion === "cancelled"
          ? "cancelled"
          : extraction.status_suggestion === "returned"
          ? "returned"
          : null,
        occurredAt,
      });
    }
    const newStatus = computeStatus(signals);
    await service.Order.update(orderId, {
      status: newStatus,
      last_event_at: occurredAt,
    });
    if (shipmentId) {
      const shipmentEvents = allEvents.filter((e: any) => e.shipment_id === shipmentId);
      const shipmentStatus = computeStatus([
        ...signalsFromEvents(shipmentEvents),
        { rank: 1, occurredAt }, // a shipment exists, so it is at least shipped
      ]);
      await service.Shipment.update(shipmentId, { status: shipmentStatus });
    }

    return { status: "processed", emailRecordId: emailRecord.id, orderId };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    try {
      const rec = await service.EmailRecord.create({
        owner_email: input.ownerEmail,
        gmail_message_id: input.gmailMessageId,
        thread_id: input.threadId,
        from_address: input.from,
        subject: input.subject.slice(0, 490),
        received_at: input.receivedAt,
        parse_status: "failed",
        snippet,
        error: detail.slice(0, 900),
      });
      return { status: "failed", emailRecordId: rec.id, detail };
    } catch (_) {
      return { status: "failed", detail };
    }
  }
}
