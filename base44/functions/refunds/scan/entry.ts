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

    const orders = await service.Order.filter({ is_archived: false }, undefined, 5000);
    const relevant = orders.filter(
      (o: any) => o.promised_date && (ACTIVE_STATUSES.includes(o.status) || o.status === "delivered"),
    );

    const existing = await service.RefundOpportunity.list(undefined, 5000);
    const existingByKey = new Map(existing.map((r: any) => [`${r.owner_email}::${r.order_id}`, r]));

    let created = 0;
    let updated = 0;
    let skippedDismissed = 0;
    let drafts = 0;

    for (const order of relevant) {
      const delivered = order.status === "delivered";
      const anchorDate = delivered ? (order.last_event_at ?? "").slice(0, 10) : today;
      if (delivered && !anchorDate) continue; // no delivery date to measure lateness from

      const daysLate = daysBetween(order.promised_date, anchorDate);
      if (daysLate < 1) continue;

      let stage: "late" | "likely_lost" | "dispute" | "delivered_late";
      let merchantMatches: any[];
      let railMatches: any[] = [];

      if (delivered) {
        stage = "delivered_late";
        merchantMatches = merchantPolicies.filter(
          (p: any) => p.applies_when_delivered && policyDomainMatches(order.merchant_domain, p.merchant_domain),
        );
        if (merchantMatches.length === 0) continue; // nothing to claim on an arrived parcel otherwise
      } else {
        stage = daysLate >= 30 ? "dispute" : daysLate >= 14 ? "likely_lost" : "late";
        merchantMatches = merchantPolicies.filter(
          (p: any) => !p.applies_when_delivered && policyDomainMatches(order.merchant_domain, p.merchant_domain),
        );
        railMatches = order.payment_method
          ? railPolicies.filter((p: any) => p.payment_rail === order.payment_method)
          : [];

        const entitled = merchantMatches.some((p: any) => daysLate >= (p.min_days_late ?? 1));
        if (!entitled && daysLate < FRESH_LATE_GRACE_DAYS && stage === "late") continue;
      }

      const key = `${order.owner_email}::${order.id}`;
      const existingRow = existingByKey.get(key);
      if (existingRow && existingRow.status === "dismissed") {
        skippedDismissed++;
        continue; // dismissed stays dismissed even if it escalates (F5 AC3)
      }

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
        amount_estimate: amountEstimate,
        currency: order.currency ?? "USD",
        amount_basis: remedy,
        routes,
        deadline,
        draft_recipient: recipient,
        claim_url: bestAvailable?.url,
      };

      const wasOpen = !existingRow || ["detected", "notified"].includes(existingRow.status);
      const stageChanged = !existingRow || existingRow.draft_stage !== stage;
      let draftPatch: Record<string, unknown> = {};
      if (wasOpen && stageChanged && drafts < MAX_DRAFTS_PER_RUN) {
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

    const summary = { ok: true, late_orders: relevant.length, created, updated, skippedDismissed, drafts };
    console.log("refunds/scan:", JSON.stringify(summary));
    return Response.json(summary);
  } catch (err) {
    console.log("refunds/scan error:", err instanceof Error ? err.message : String(err));
    return Response.json({ ok: false });
  }
});
