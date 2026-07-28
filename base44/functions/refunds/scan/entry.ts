// refunds/scan (PRD F5, amendment v1.6): find late orders across all users
// and build ONE RefundOpportunity CASE per order (never per policy), holding
// a ranked list of next-step routes. No generic catch-all: a route only
// appears when it is backed by evidence (merchant-domain match, or a
// payment-rail match against Order.payment_method). Staged by lateness:
// late (1+ days) -> likely_lost (14+) -> dispute (30+), or delivered_late for
// a parcel that arrived past its promised date.
//
// Anonymous-tolerant cron; also invokable manually for testing. Idempotent:
// re-running never duplicates (unique per owner_email+order_id) and never
// resurrects a dismissed case (F5 AC2/AC3).

import { createClientFromRequest } from "npm:@base44/sdk";
import { buildClaimPrompt } from "../../../shared/extract.ts";
import { policyDomainMatches } from "../../../shared/mergeEngine.ts";

const ACTIVE_STATUSES = ["ordered", "shipped", "in_transit", "out_for_delivery", "delayed"];
const MAX_DRAFTS_PER_RUN = 20;
// A freshly-late order with no merchant policy entitled yet is not worth a
// card before a week; the deadline/likely_lost/dispute stages always create
// regardless (they are already worth the user's attention).
const FRESH_LATE_GRACE_DAYS = 7;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  return Math.floor((to - from) / 86400000);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function deadlineFor(policy: any, order: any): string {
  const anchor = policy.deadline_from === "ordered_at" && order.ordered_at
    ? String(order.ordered_at).slice(0, 10)
    : order.promised_date;
  return addDays(anchor, policy.window_days ?? 30);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole.entities;
    const today = todayISO();

    const policies = await service.RefundPolicy.list(undefined, 100);
    const policiesByKey = new Map(policies.map((p: any) => [p.policy_key, p]));
    const merchantPolicies = policies.filter((p: any) => p.merchant_domain);
    const railPolicies = policies.filter((p: any) => p.payment_rail);

    const ORDER_LIMIT = 5000;
    const OPPORTUNITY_LIMIT = 5000;
    const orders = await service.Order.filter({ is_archived: false }, undefined, ORDER_LIMIT);
    const relevant = orders.filter(
      (o: any) => o.promised_date && (ACTIVE_STATUSES.includes(o.status) || o.status === "delivered"),
    );

    // Delivery dates come from the `delivered` TrackingEvent, never from
    // Order.last_event_at: that field is the latest event of ANY type, so a
    // seller message or refund note arriving after delivery drags it forward
    // (and a manual add sets it to ingest time), which would overstate how
    // late the parcel actually arrived. Earliest delivered event wins: that
    // is when it landed, a later re-scan is not a second delivery.
    const deliveredEvents = await service.TrackingEvent.filter({ type: "delivered" }, "-occurred_at", 5000);
    const deliveredAtByOrder = new Map<string, string>();
    for (const e of deliveredEvents) {
      const prev = deliveredAtByOrder.get(e.order_id);
      if (!prev || e.occurred_at < prev) deliveredAtByOrder.set(e.order_id, e.occurred_at);
    }

    const existing = await service.RefundOpportunity.list(undefined, OPPORTUNITY_LIMIT);
    const existingByKey = new Map(existing.map((r: any) => [`${r.owner_email}::${r.order_id}`, r]));

    let created = 0;
    let updated = 0;
    let retired = 0;
    let skippedDismissed = 0;
    let drafts = 0;

    // Does this order warrant a case right now, and on what evidence?
    // Returns null when it does not, so the caller can RETIRE a stale case
    // instead of skipping past it: an order that arrives, or whose promised
    // date is revised forward, must not leave behind a card still asserting
    // "N days late, still not delivered".
    const qualify = (order: any) => {
      const delivered = order.status === "delivered";
      const deliveredAt = delivered
        ? String(deliveredAtByOrder.get(order.id) ?? order.last_event_at ?? "")
        : "";
      if (delivered && !deliveredAt) return null; // no delivery date to measure against
      const anchorDate = delivered ? deliveredAt.slice(0, 10) : today;

      const daysLate = daysBetween(order.promised_date, anchorDate);
      if (daysLate < 1) return null;

      if (delivered) {
        const merchantMatches = merchantPolicies.filter(
          (p: any) => p.applies_when_delivered && policyDomainMatches(order.merchant_domain, p.merchant_domain),
        );
        // Nothing to claim on a parcel that already arrived.
        if (merchantMatches.length === 0) return null;
        return { delivered, stage: "delivered_late" as const, daysLate, anchorDate, merchantMatches, railMatches: [] as any[] };
      }

      const stage = daysLate >= 30 ? ("dispute" as const) : daysLate >= 14 ? ("likely_lost" as const) : ("late" as const);
      const merchantMatches = merchantPolicies.filter(
        (p: any) => !p.applies_when_delivered && policyDomainMatches(order.merchant_domain, p.merchant_domain),
      );
      const railMatches = order.payment_method
        ? railPolicies.filter((p: any) => p.payment_rail === order.payment_method)
        : [];
      const entitled = merchantMatches.some((p: any) => daysLate >= (p.min_days_late ?? 1));
      if (!entitled && daysLate < FRESH_LATE_GRACE_DAYS && stage === "late") return null;
      return { delivered, stage, daysLate, anchorDate, merchantMatches, railMatches };
    };

    // A case the user has acted on is their record; only auto-generated rows
    // they have not touched are ever retired.
    const isRetirable = (row: any) => ["detected", "notified"].includes(row.status);

    const visitedKeys = new Set<string>();

    for (const order of relevant) {
      const key = `${order.owner_email}::${order.id}`;
      visitedKeys.add(key);
      const existingRow = existingByKey.get(key);

      if (existingRow && existingRow.status === "dismissed") {
        skippedDismissed++;
        continue; // dismissed stays dismissed even if it escalates (F5 AC3)
      }

      const q = qualify(order);
      if (!q) {
        if (existingRow && isRetirable(existingRow)) {
          await service.RefundOpportunity.delete(existingRow.id);
          retired++;
        }
        continue;
      }
      const { delivered, stage, daysLate, anchorDate, merchantMatches, railMatches } = q;

      // Routes: merchant_contact always first (never a claim, just an update
      // request), then evidenced merchant-policy routes, then evidenced
      // payment-dispute routes. A route becomes unavailable once its own
      // claim window has closed, even if it was reachable by lateness alone.
      const routes: any[] = [
        {
          kind: "merchant_contact",
          policy_key: "generic_late",
          label: `Ask ${order.merchant_name} for an update`,
          available: true,
        },
      ];

      const pushPolicyRoute = (kind: "merchant_policy" | "payment_dispute", p: any) => {
        const deadline = deadlineFor(p, order);
        let available = daysLate >= (p.min_days_late ?? 1);
        let blockedBy: string | undefined = available ? undefined : "not_late_enough";
        if (available && deadline < today) {
          available = false;
          blockedBy = "window_closed";
        }
        routes.push({
          kind,
          policy_key: p.policy_key,
          label: p.description,
          url: p.claim_url || undefined,
          deadline,
          available,
          blocked_by: blockedBy,
          min_days_late: p.min_days_late ?? 1,
        });
      };

      for (const p of merchantMatches) pushPolicyRoute("merchant_policy", p);

      if (!delivered) {
        if (order.payment_method) {
          for (const p of railMatches) pushPolicyRoute("payment_dispute", p);
        } else {
          // No payment evidence yet: one locked placeholder so the UI can
          // offer to unlock it, instead of silently omitting the option.
          routes.push({
            kind: "payment_dispute",
            policy_key: "payment_dispute_locked",
            label: "Payment dispute (PayPal or credit card)",
            available: false,
            blocked_by: "unknown_payment_method",
          });
        }
      }

      const claimRoutes = routes.filter((r) => r.kind !== "merchant_contact");
      const bestAvailable = claimRoutes.find((r) => r.available);
      const bestPolicyKey = bestAvailable?.policy_key ?? merchantMatches[0]?.policy_key ??
        railMatches[0]?.policy_key ?? "generic_late";
      const bestPolicy = policiesByKey.get(bestPolicyKey) as any;

      const remedy = bestAvailable ? (bestPolicy?.remedy ?? "unknown") : "unknown";
      const amountEstimate = remedy === "order_total" ? (order.total ?? undefined) : undefined;
      const availableDeadlines = routes.filter((r) => r.available && r.deadline).map((r) => r.deadline).sort();
      const deadline = availableDeadlines[0];
      const recipient: "merchant" | "payment_provider" = bestAvailable?.kind === "payment_dispute"
        ? "payment_provider"
        : "merchant";
      const oppType = bestPolicy?.rule_type ?? "late_delivery";

      const patch: Record<string, unknown> = {
        policy_key: bestPolicyKey,
        type: oppType,
        stage,
        days_late: daysLate,
        delivered_at: delivered ? anchorDate : undefined,
        amount_estimate: amountEstimate,
        currency: order.currency ?? "USD",
        amount_basis: remedy,
        routes,
        deadline,
        draft_recipient: recipient,
        claim_url: bestAvailable?.url,
      };

      const wasOpen = !existingRow || ["detected", "notified"].includes(existingRow.status);
      // Regenerate when the stage OR the party the draft must be addressed to
      // changed. Recipient can flip while the stage holds constant: adding a
      // payment method unlocks a dispute route at, say, an unchanged `dispute`
      // stage, and a merchant-addressed draft would then sit under a
      // "addressed to your payment provider" label. A missing draft (an
      // earlier LLM failure) is also retried.
      const draftStale = !existingRow ||
        existingRow.draft_stage !== stage ||
        existingRow.draft_recipient !== recipient ||
        !existingRow.draft_message;
      let draftPatch: Record<string, unknown> = {};
      if (wasOpen && draftStale && drafts < MAX_DRAFTS_PER_RUN) {
        try {
          const remedyDescription = bestAvailable
            ? (bestPolicy?.description ?? "")
            : "No specific merchant or payment-provider policy is confirmed yet; just ask for a status update.";
          const amountText = remedy === "order_total" && amountEstimate != null
            ? `${amountEstimate} ${order.currency ?? "USD"}`
            : undefined;
          const orderSummary = [
            `merchant: ${order.merchant_name}`,
            `order number: ${order.order_number ?? "unknown"}`,
            `promised delivery date: ${order.promised_date}`,
            delivered
              ? `delivered on: ${anchorDate} (${daysLate} day(s) after the promised date)`
              : `current status: ${order.status} (not delivered as of ${today}, ${daysLate} day(s) late)`,
          ].join("\n");
          const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: buildClaimPrompt({ orderSummary, stage, recipient, remedyDescription, amountText }),
          });
          const draftMessage = typeof res === "string" ? res.slice(0, 1990) : "";
          draftPatch = { draft_message: draftMessage || undefined, draft_stage: stage };
          drafts++;
        } catch (err) {
          console.log(`scan: draft failed for ${key}:`, err instanceof Error ? err.message : err);
        }
      }

      if (!existingRow) {
        await service.RefundOpportunity.create({
          owner_email: order.owner_email,
          order_id: order.id,
          status: "detected",
          ...patch,
          ...draftPatch,
        });
        created++;
      } else {
        await service.RefundOpportunity.update(existingRow.id, { ...patch, ...draftPatch });
        updated++;
      }
    }

    // Sweep: an open case whose order was not even a candidate this run is
    // stale in exactly the same way as one the loop retired - the order was
    // archived, cancelled/returned, lost its promised_date, or was deleted.
    // Guarded on truncation: if either read hit its cap, "not seen this run"
    // could just mean "past the limit", and deleting on that basis would
    // destroy live cases. Skip the sweep and say so rather than guess.
    const ordersTruncated = orders.length >= ORDER_LIMIT;
    const opportunitiesTruncated = existing.length >= OPPORTUNITY_LIMIT;
    let sweepSkipped = false;
    if (ordersTruncated || opportunitiesTruncated) {
      sweepSkipped = true;
      console.log(
        `refunds/scan: SWEEP SKIPPED - reads hit their cap (orders=${orders.length}/${ORDER_LIMIT}, ` +
          `opportunities=${existing.length}/${OPPORTUNITY_LIMIT}); raise the limits or page these reads.`,
      );
    } else {
      for (const row of existing) {
        const key = `${row.owner_email}::${row.order_id}`;
        if (visitedKeys.has(key) || !isRetirable(row)) continue;
        await service.RefundOpportunity.delete(row.id);
        retired++;
      }
    }

    const summary = { ok: true, late_orders: relevant.length, created, updated, retired, skippedDismissed, drafts, sweepSkipped };
    console.log("refunds/scan:", JSON.stringify(summary));
    return Response.json(summary);
  } catch (err) {
    console.log("refunds/scan error:", err instanceof Error ? err.message : String(err));
    return Response.json({ ok: false });
  }
});
