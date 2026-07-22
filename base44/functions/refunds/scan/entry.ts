// refunds/scan (PRD F5): find overdue orders across all users, match refund
// policies, upsert opportunities (unique per order+policy, dismissed never
// resurfaces), draft claim messages with the LLM.
//
// Merchant-specific policies win; generic policies (empty merchant_domain)
// apply only when no merchant policy matched, so a Temu order yields exactly
// one temu_on_time opportunity (F5 AC1).
//
// Anonymous-tolerant cron; also invokable manually for testing. Idempotent:
// re-running never duplicates (F5 AC2/AC3).

import { createClientFromRequest } from "npm:@base44/sdk";
import { buildClaimPrompt } from "../../../shared/extract.ts";
import { normalizeDomain } from "../../../shared/mergeEngine.ts";

const ACTIVE_STATUSES = ["ordered", "shipped", "in_transit", "out_for_delivery", "delayed"];
const MAX_DRAFTS_PER_RUN = 20;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole.entities;
    const today = todayISO();

    const policies = await service.RefundPolicy.list(undefined, 100);
    const merchantPolicies = policies.filter((p: any) => p.merchant_domain);
    const genericPolicies = policies.filter((p: any) => !p.merchant_domain);

    // All non-archived, non-terminal orders; overdue check in code
    // (server-side date filters are unreliable on created fields).
    const orders = await service.Order.filter({ is_archived: false }, undefined, 5000);
    const overdue = orders.filter(
      (o: any) => ACTIVE_STATUSES.includes(o.status) && o.promised_date && o.promised_date < today,
    );

    const existing = await service.RefundOpportunity.list(undefined, 5000);
    const existingKeys = new Set(existing.map((r: any) => `${r.order_id}::${r.policy_key}`));

    let created = 0;
    let skippedExisting = 0;
    let drafts = 0;
    for (const order of overdue) {
      const domain = normalizeDomain(order.merchant_domain);
      let matched = merchantPolicies.filter((p: any) => normalizeDomain(p.merchant_domain) === domain);
      if (matched.length === 0) matched = genericPolicies;

      for (const policy of matched) {
        const key = `${order.id}::${policy.policy_key}`;
        if (existingKeys.has(key)) {
          skippedExisting++;
          continue;
        }
        const deadline = addDays(order.promised_date, policy.window_days ?? 30);
        if (deadline < today) continue; // claim window already closed

        let draftMessage = "";
        if (drafts < MAX_DRAFTS_PER_RUN) {
          try {
            const orderSummary = [
              `merchant: ${order.merchant_name}`,
              `order number: ${order.order_number ?? "unknown"}`,
              `promised delivery date: ${order.promised_date}`,
              `current status: ${order.status} (not delivered as of ${today})`,
              order.total != null ? `order total: ${order.total} ${order.currency ?? "USD"}` : "",
            ].filter(Boolean).join("\n");
            const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
              prompt: buildClaimPrompt(orderSummary, `${policy.description} (claim window: ${policy.window_days} days)`),
            });
            draftMessage = typeof res === "string" ? res.slice(0, 1990) : "";
            drafts++;
          } catch (err) {
            console.log(`scan: draft failed for ${key}:`, err instanceof Error ? err.message : err);
          }
        }

        const amountEstimate =
          policy.rule_type === "buyer_protection" || policy.rule_type === "chargeback_window"
            ? order.total ?? undefined
            : undefined;

        await service.RefundOpportunity.create({
          owner_email: order.owner_email,
          order_id: order.id,
          policy_key: policy.policy_key,
          type: policy.rule_type,
          amount_estimate: amountEstimate,
          deadline,
          status: "detected",
          draft_message: draftMessage || undefined,
          claim_url: policy.claim_url || undefined,
        });
        existingKeys.add(key);
        created++;
      }
    }

    const summary = { ok: true, overdue_orders: overdue.length, created, skippedExisting };
    console.log("refunds/scan:", JSON.stringify(summary));
    return Response.json(summary);
  } catch (err) {
    console.log("refunds/scan error:", err instanceof Error ? err.message : String(err));
    return Response.json({ ok: false });
  }
});
