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

import { extractImageCandidates, extractLinkCandidates, htmlToText, truncateForLLM } from "./htmlToText.ts";
import {
  analyzeEmail,
  arbitrateSameOrder,
  canCreateOrder,
  type ExtractionResult,
  isTrackablePurchase,
} from "./extract.ts";
import {
  buildIdentityPatch,
  computeStatus,
  decideMerge,
  EVENT_TYPE_TO_RANK,
  fuzzyCandidates,
  normalizeDomain,
  type StatusSignal,
} from "./mergeEngine.ts";
import { resolveCarrier } from "./carriers.ts";
import { rehostImageMeasured } from "./rehost.ts";
import { resolveAndRehostLogo } from "./merchantLogo.ts";
import { domainFromSender, isCarrierDomain } from "./senderDomain.ts";
import { getMessage } from "./gmail.ts";

// deno-lint-ignore no-explicit-any
type Base44Client = any;

const SNIPPET_MAX = 1990;
const MAX_REHOSTED_IMAGES = 3;
const LOW_CONFIDENCE = 0.6;
// Arbitration budget per email (each is one InvokeLLM call inside a loop that
// already spends one on extraction).
const MAX_ARBITRATIONS = 3;
const MAX_CROSS_MERCHANT_ARBITRATIONS = 1;

interface OrderItem {
  name?: string;
  qty?: number;
  price?: number;
  image_url?: string;
  image_width?: number;
  image_source?: string;
  product_url?: string;
}

// Fill gaps in an existing item list from a later, richer email. Deliberately
// never adds or removes items: a shipping confirmation that lists 1 of 3 shipped
// items must not truncate the order it merged into.
export function mergeItems(
  existing: OrderItem[],
  incoming: OrderItem[],
): { items: OrderItem[]; changed: boolean } {
  if (existing.length === 0) return { items: incoming, changed: incoming.length > 0 };
  const key = (n?: string) => (n ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const byName = new Map(incoming.map((i) => [key(i.name), i]));
  let changed = false;
  const items = existing.map((e) => {
    const inc = byName.get(key(e.name));
    if (!inc) return e;
    const next = { ...e };
    // A photo from the merchant's own email outranks anything enrichment found
    // on the web (a web result is regularly the wrong colourway or a series
    // shot), so a later email may overwrite a product_page/search image as well
    // as fill a blank. It never overwrites another email image.
    const webSourced = e.image_source === "product_page" || e.image_source === "search";
    const incomingIsEmail = inc.image_source === "email";
    if (inc.image_url && (!e.image_url || (webSourced && incomingIsEmail))) {
      next.image_url = inc.image_url;
      next.image_width = inc.image_width;
      next.image_source = inc.image_source;
      changed = true;
    }
    if (!e.product_url && inc.product_url) {
      next.product_url = inc.product_url;
      changed = true;
    }
    if (e.price == null && inc.price != null) {
      next.price = inc.price;
      changed = true;
    }
    if ((e.qty ?? 1) === 1 && (inc.qty ?? 1) > 1) {
      next.qty = inc.qty;
      changed = true;
    }
    return next;
  });
  return { items, changed };
}

export interface PipelineResult {
  status: "processed" | "duplicate" | "irrelevant" | "unroutable" | "failed";
  emailRecordId?: string;
  orderId?: string;
  detail?: string;
  // "excluded_kind": a real order, but not a physical parcel (food/grocery,
  // SaaS/digital, booking). Lets manual add explain the policy instead of
  // claiming the text is not an order email.
  reason?: "excluded_kind";
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

// Per-sync-run dedup cache. Base44 entity reads are not guaranteed to reflect a
// write from a few hundred ms earlier, so two emails about the SAME order
// processed back-to-back in one syncMyMail run would each miss the other's
// freshly-created Order and create a duplicate (observed: 10 duplicate order
// groups, all created 0-1s apart). The batch loop threads this cache so orders
// and shipments created earlier in the run are immediately visible as merge
// candidates, independent of read-after-write lag. Manual add passes none.
export interface RunCache {
  // FULL Order rows created (or patched) this run, not a slim projection.
  // Fidelity matters: these rows feed the arbitration candidate summaries and
  // the matched-order patch branch, so a projection that dropped items/total
  // would make a same-run candidate read as a sparse order and re-create the
  // exact duplicates this cache exists to prevent.
  orders: Array<{ id: string } & Record<string, unknown>>;
  shipments: Array<{ id: string; order_id: string; tracking_number?: string | null; carrier?: string | null }>;
}

// Cache rows are this run's own writes (kept current via mirroring after each
// Order.update), strictly fresher than a possibly-lagging DB read, so on an id
// collision the cache row wins.
export function unionById<T extends { id: string }>(dbRows: T[], cacheRows: T[] = []): T[] {
  if (cacheRows.length === 0) return dbRows;
  const cacheById = new Map(cacheRows.map((r) => [r.id, r]));
  const dbIds = new Set(dbRows.map((r) => r.id));
  return dbRows
    .map((r) => cacheById.get(r.id) ?? r)
    .concat(cacheRows.filter((r) => !dbIds.has(r.id)) as unknown as T[]);
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

// Arbitration summaries. Everything the email/order actually knows goes in;
// absent values render as "unknown" and the arbitration prompt instructs the
// model to read those as missing data, not as a difference.
function incomingSummaryFor(
  extraction: ExtractionResult,
  input: CoreInput,
  occurredAt: string,
  snippet: string,
): string {
  return [
    `merchant: ${extraction.merchant_name ?? "unknown"}`,
    `order number: ${extraction.order_number ?? "unknown"}`,
    `total: ${extraction.total ?? "unknown"} ${extraction.currency ?? ""}`.trimEnd(),
    `items: ${(extraction.items ?? []).map((i) => i.name).join("; ") || "unknown"}`,
    `email type: ${extraction.classification}`,
    `event date: ${occurredAt}`,
    `tracking number: ${extraction.tracking_number ?? "unknown"}`,
    `carrier: ${extraction.carrier ?? "unknown"}`,
    `subject: ${input.subject || "unknown"}`,
    `email excerpt: ${snippet.slice(0, 400) || "unknown"}`,
  ].join("\n");
}

function candidateSummaryFor(
  o: {
    id: string;
    merchant_name?: string | null;
    order_number?: string | null;
    total?: number | null;
    currency?: string | null;
    ordered_at?: string | null;
    status?: string | null;
    last_event_at?: string | null;
    items?: Array<{ name: string }> | null;
  },
  shipments: Array<{ order_id: string; tracking_number?: string | null }>,
): string {
  const trackingNumbers = shipments
    .filter((s) => s.order_id === o.id)
    .map((s) => s.tracking_number)
    .filter(Boolean);
  return [
    `merchant: ${o.merchant_name ?? "unknown"}`,
    `order number: ${o.order_number ?? "unknown"}`,
    `total: ${o.total ?? "unknown"} ${o.currency ?? ""}`.trimEnd(),
    `ordered at: ${o.ordered_at ?? "unknown"}`,
    `status: ${o.status ?? "unknown"}`,
    `last event at: ${o.last_event_at ?? "unknown"}`,
    `items: ${(o.items ?? []).map((i) => i.name).join("; ") || "unknown"}`,
    `tracking numbers: ${trackingNumbers.join("; ") || "unknown"}`,
  ].join("\n");
}

// Single writer for EmailRecord provenance rows: the pipeline's exit paths
// differ only in classification / parse_status / linkage.
async function recordEmail(
  // deno-lint-ignore no-explicit-any
  service: any,
  input: CoreInput,
  snippet: string,
  fields: {
    classification?: string;
    parse_status: string;
    confidence?: number;
    order_id?: string;
    error?: string;
  },
) {
  return await service.EmailRecord.create({
    owner_email: input.ownerEmail,
    gmail_message_id: input.gmailMessageId,
    thread_id: input.threadId,
    from_address: input.from,
    subject: input.subject.slice(0, 490),
    received_at: input.receivedAt,
    snippet,
    ...fields,
  });
}

// ---------------------------------------------------------------- gmail path

// Process one message from the owner's OWN mailbox (app-user connector).
export async function processOwnedGmailMessage(
  base44: Base44Client,
  gmailToken: string,
  messageId: string,
  ownerEmail: string,
  runCache?: RunCache,
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
  }, runCache);
}

// ----------------------------------------------------------------- core path

export async function runCorePipeline(
  base44: Base44Client,
  input: CoreInput,
  runCache?: RunCache,
): Promise<PipelineResult> {
  const service = base44.asServiceRole.entities;
  const plainText = input.text?.trim() ? input.text : htmlToText(input.html);
  const snippet = snippetOf(plainText);

  try {
    // 3. Classify + extract (one LLM call).
    const imageCandidates = input.html ? extractImageCandidates(input.html) : [];
    const linkCandidates = input.html ? extractLinkCandidates(input.html) : [];
    const extraction: ExtractionResult = await analyzeEmail(base44, {
      from: input.from,
      subject: input.subject,
      text: truncateForLLM(plainText),
      imageCandidates,
      linkCandidates,
      today: input.receivedAt.slice(0, 10),
    });

    // 4. Irrelevant mail: record and stop (keeps re-forwards idempotent).
    // isTrackablePurchase is the code-level backstop for the classifier's
    // exclusion rules: the LLM reliably NAMES what was bought (product_kind)
    // but unreliably folds exclusions into is_order_related, so the
    // combination happens here. The record keeps the model's true
    // classification; parse_status carries the drop.
    if (!extraction.is_order_related || extraction.classification === "irrelevant" || !isTrackablePurchase(extraction)) {
      const excludedKind = extraction.is_order_related && extraction.classification !== "irrelevant";
      const rec = await recordEmail(service, input, snippet, {
        classification: extraction.classification,
        parse_status: "irrelevant",
        confidence: extraction.confidence,
      });
      return excludedKind
        ? { status: "irrelevant", emailRecordId: rec.id, reason: "excluded_kind" }
        : { status: "irrelevant", emailRecordId: rec.id };
    }

    const occurredAt = extraction.event_date ?? input.receivedAt;

    // 5. Merge into an Order.
    // Include orders/shipments created earlier in THIS run (read-after-write
    // lag would otherwise hide them and produce duplicates). Reads are
    // bounded explicitly: a silently truncated candidate list would disable
    // matching for older orders and mint duplicates.
    const myOrders = unionById(
      await service.Order.filter({ owner_email: input.ownerEmail }, "-created_date", 1000),
      runCache?.orders,
    );
    const myShipments = unionById(
      await service.Shipment.filter({ owner_email: input.ownerEmail }, "-created_date", 1000),
      runCache?.shipments,
    );
    // A missing or carrier merchant_domain never identifies the store, so such
    // emails widen the fuzzy search to every in-window order instead of
    // matching nothing (carrier notices are exactly the emails with no other
    // usable merge key).
    const widen = !normalizeDomain(extraction.merchant_domain) ||
      isCarrierDomain(extraction.merchant_domain);
    const fuzzy = fuzzyCandidates(
      {
        merchant_domain: extraction.merchant_domain,
        order_number: extraction.order_number,
        occurredAt,
      },
      myOrders,
      { widen },
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
      // LLM arbitration against the best candidates (the list arrives
      // best-first from fuzzyCandidates). Same-merchant comparisons lean
      // toward merging; wildcard (carrier/domainless) comparisons demand
      // positive linking evidence. See buildArbitrationPrompt.
      //
      // Budgets: each call is an InvokeLLM round trip inside a per-message
      // loop, so they are capped. Cross-merchant calls get the tighter budget
      // because widening can nominate every in-window order and those
      // comparisons almost never match.
      let matched: string | null = null;
      let crossMerchantCalls = 0;
      const incomingSummary = incomingSummaryFor(extraction, input, occurredAt, snippet);
      const incomingDomain = normalizeDomain(extraction.merchant_domain);
      for (const candidateId of decision.candidateOrderIds.slice(0, MAX_ARBITRATIONS)) {
        // deno-lint-ignore no-explicit-any
        const candidate: any = myOrders.find((o: any) => o.id === candidateId);
        if (!candidate) continue;
        const candidateDomain = normalizeDomain(candidate.merchant_domain);
        const crossMerchant = !incomingDomain || !candidateDomain ||
          incomingDomain !== candidateDomain ||
          isCarrierDomain(incomingDomain) || isCarrierDomain(candidateDomain);
        if (crossMerchant && crossMerchantCalls >= MAX_CROSS_MERCHANT_ARBITRATIONS) continue;
        if (crossMerchant) crossMerchantCalls++;
        const same = await arbitrateSameOrder(base44, {
          incoming: incomingSummary,
          existing: candidateSummaryFor(candidate, myShipments),
          crossMerchant,
        });
        if (same) {
          matched = candidateId;
          // Cross-merchant merges rest on the LLM alone (no hard key agreed),
          // so they are logged: this is the line to grep when an over-merge is
          // suspected on the live app.
          if (crossMerchant) {
            console.log(
              `arbitration cross-merchant merge: msg=${input.gmailMessageId} order=${candidateId} ` +
                `incoming_domain=${incomingDomain || "none"} candidate_domain=${candidateDomain || "none"}`,
            );
          }
          break;
        }
      }
      decision = matched
        ? { kind: "matched_order", orderId: matched, via: "order_number" }
        : { kind: "new_order" };
    }

    // Weak classifications (review nags, tips, refund notes, misc) may only
    // ATTACH to an order that already exists; they never open a card. A flight
    // "confirmation" tagged other_order_related stops here, not on the board.
    if (decision.kind === "new_order" && !canCreateOrder(extraction.classification)) {
      const rec = await recordEmail(service, input, snippet, {
        classification: extraction.classification,
        parse_status: "unroutable",
        confidence: extraction.confidence,
      });
      return { status: "unroutable", emailRecordId: rec.id };
    }

    // Re-host item images (bounded) before writing items. product_url is stored
    // for EVERY item regardless of the rehost cap (it is just a string); the
    // heavy HQ upgrade via that link happens later in orders/enrichProductImages.
    const items: OrderItem[] = [];
    let rehostedCount = 0;
    for (const item of extraction.items ?? []) {
      let rehosted = null;
      if (item.image_url && rehostedCount < MAX_REHOSTED_IMAGES) {
        rehosted = await rehostImageMeasured(base44, item.image_url);
        if (rehosted) rehostedCount++;
      }
      items.push({
        name: item.name,
        qty: item.qty ?? 1,
        price: item.price ?? undefined,
        image_url: rehosted?.url ?? undefined,
        image_width: rehosted?.width || undefined,
        image_source: rehosted ? "email" : undefined,
        product_url: item.product_url ?? undefined,
      });
    }

    // Logo lookup domain. Kept SEPARATE from merchant_domain on purpose: that
    // field is half the merge key and drives fuzzyCandidates, so a guessed value
    // there would change matching for every future email.
    const senderDomain = domainFromSender(input.from, { ownerEmail: input.ownerEmail }).domain;

    let orderId: string;
    if (decision.kind === "matched_order") {
      orderId = decision.orderId;
      // deno-lint-ignore no-explicit-any
      const order: any = myOrders.find((o: any) => o.id === orderId)!;
      // Fill gaps; never blank existing values with nulls. Identity fields
      // (order number, domain, ordered_at, merchant name) follow the repair
      // rules in buildIdentityPatch; everything below is simple gap-filling.
      const patch: Record<string, unknown> = {
        ...buildIdentityPatch(order, {
          merchant_name: extraction.merchant_name,
          merchant_domain: extraction.merchant_domain,
          order_number: extraction.order_number,
          classification: extraction.classification,
        }, occurredAt),
      };
      if (extraction.promised_date) patch.promised_date = extraction.promised_date;
      if (extraction.eta_date) patch.eta_date = extraction.eta_date;
      if (order.total == null && extraction.total != null) patch.total = extraction.total;
      if (extraction.currency && !order.currency) patch.currency = extraction.currency;
      if (items.length > 0) {
        // A later, richer email can now fill in images the first one missed.
        const merged = mergeItems(order.items ?? [], items);
        if (merged.changed) patch.items = merged.items;
      }
      const logoDomain = normalizeDomain(order.merchant_domain) ||
        normalizeDomain(order.logo_domain) ||
        normalizeDomain(extraction.merchant_domain) ||
        senderDomain ||
        "";
      if (!order.logo_domain && logoDomain) patch.logo_domain = logoDomain;
      // Backfill the logo when this order never got one (first email had no
      // domain, or the fetch failed back then).
      if (!order.logo_url && logoDomain) {
        const resolved = await resolveAndRehostLogo(base44, logoDomain);
        if (resolved) {
          patch.logo_url = resolved.url;
          patch.logo_source = resolved.source;
          patch.logo_width = resolved.width;
        }
        patch.logo_checked_at = new Date().toISOString();
      }
      if (Object.keys(patch).length > 0) {
        await service.Order.update(orderId, patch);
        // Keep the run cache current so later emails in this run see the
        // patched identity despite entity read-after-write lag. Orders that
        // existed BEFORE this run are not in the cache yet, so they are added
        // here: without this, a second email in the same run re-reads the
        // stale pre-patch row and can fail to match it.
        const cachedOrder = runCache?.orders.find((o) => o.id === orderId);
        if (cachedOrder) Object.assign(cachedOrder, patch);
        else runCache?.orders.push({ ...order, ...patch, id: orderId });
      }
    } else {
      const domain = normalizeDomain(extraction.merchant_domain) || undefined;
      const logoDomain = domain || senderDomain || "";
      const resolved = logoDomain ? await resolveAndRehostLogo(base44, logoDomain) : null;
      const orderPayload = {
        owner_email: input.ownerEmail,
        merchant_name: extraction.merchant_name ?? "Unknown merchant",
        merchant_domain: domain,
        logo_domain: logoDomain || undefined,
        logo_url: resolved?.url ?? undefined,
        logo_source: resolved?.source ?? undefined,
        logo_width: resolved?.width ?? undefined,
        logo_checked_at: logoDomain ? new Date().toISOString() : undefined,
        order_number: extraction.order_number ?? undefined,
        ordered_at: extraction.classification === "order_confirmation" ? occurredAt : undefined,
        currency: extraction.currency ?? "USD",
        total: extraction.total ?? undefined,
        status: "ordered",
        promised_date: extraction.promised_date ?? undefined,
        eta_date: extraction.eta_date ?? undefined,
        items,
        confidence: extraction.confidence,
      };
      const created = await service.Order.create(orderPayload);
      orderId = created.id;
      // Cache the FULL row (payload fields plus whatever the create echoed):
      // later emails in this run summarize, arbitrate, and patch against it.
      runCache?.orders.push({
        ...orderPayload,
        ...created,
        id: created.id,
        merchant_domain: domain ?? null,
        order_number: extraction.order_number ?? null,
        ordered_at: extraction.classification === "order_confirmation" ? occurredAt : null,
        created_date: created.created_date ?? input.receivedAt,
      });
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
        runCache?.shipments.push({
          id: created.id,
          order_id: orderId,
          tracking_number: extraction.tracking_number ?? null,
        });
      }
    }

    // 7. EmailRecord (before the event so provenance links resolve).
    const emailRecord = await recordEmail(service, input, snippet, {
      classification: extraction.classification,
      parse_status: extraction.confidence < LOW_CONFIDENCE ? "low_confidence" : "parsed",
      confidence: extraction.confidence,
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
    const allEvents = await service.TrackingEvent.filter({ order_id: orderId }, "-occurred_at", 1000);
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
    // last_event_at is forward-only (the dashboard sorts on it): with pages
    // processed oldest-first this is a no-op, but an older email merging into
    // an existing order later must not rewind it. ISO UTC strings compare
    // lexicographically.
    // deno-lint-ignore no-explicit-any
    const priorOrder: any = myOrders.find((o: any) => o.id === orderId);
    const prevLast: string | undefined = priorOrder?.last_event_at;
    const lastEventAt = prevLast && prevLast > occurredAt ? prevLast : occurredAt;
    // delivered_at is write-once: the first email that puts the order in the
    // delivered state dates the arrival, and later mail (a review request, a
    // receipt) must not redate it. A user's manual pick is preserved too.
    const orderPatch: Record<string, unknown> = { status: newStatus, last_event_at: lastEventAt };
    if (newStatus === "delivered" && !priorOrder?.delivered_at) {
      orderPatch.delivered_at = occurredAt.slice(0, 10);
    }
    await service.Order.update(orderId, orderPatch);
    // Invariant: after an email is processed, its order is in the run cache
    // with current values, so the next email of this run never re-reads a
    // stale row through read-after-write lag.
    const cacheRow = runCache?.orders.find((o) => o.id === orderId);
    if (cacheRow) Object.assign(cacheRow, orderPatch);
    else if (priorOrder) {
      runCache?.orders.push({ ...priorOrder, id: orderId, ...orderPatch });
    }
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
      const rec = await recordEmail(service, input, snippet, {
        parse_status: "failed",
        error: detail.slice(0, 900),
      });
      return { status: "failed", emailRecordId: rec.id, detail };
    } catch (_) {
      return { status: "failed", detail };
    }
  }
}
