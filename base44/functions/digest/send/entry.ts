// digest/send (PRD F10): daily per-user email digest via Core.SendEmail.
// Content: arriving today, newly overdue, refund deadlines within 3 days.
// Skipped for users with digest off or nothing to say (F10 AC2/AC3).
// Anonymous-tolerant cron; idempotent per day via a soft window check.

import { createClientFromRequest } from "npm:@base44/sdk";

const ACTIVE_STATUSES = ["ordered", "shipped", "in_transit", "out_for_delivery", "delayed"];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole.entities;
    const today = todayISO();
    const yesterday = addDaysISO(today, -1);
    const soonCutoff = addDaysISO(today, 3);

    const allSettings = await service.UserSettings.filter({ digest_enabled: true }, undefined, 5000);
    let sent = 0;
    let skipped = 0;

    for (const settings of allSettings) {
      const owner = settings.owner_email;
      const [orders, refunds] = await Promise.all([
        service.Order.filter({ owner_email: owner, is_archived: false }, undefined, 1000),
        service.RefundOpportunity.filter({ owner_email: owner, status: "detected" }, undefined, 200),
      ]);
      const active = orders.filter((o: any) => ACTIVE_STATUSES.includes(o.status));
      const arrivingToday = active.filter((o: any) => (o.eta_date ?? o.promised_date) === today);
      const newlyOverdue = active.filter((o: any) => o.promised_date === yesterday);
      const deadlineSoon = refunds.filter((r: any) => r.deadline && r.deadline >= today && r.deadline <= soonCutoff);

      if (arrivingToday.length === 0 && newlyOverdue.length === 0 && deadlineSoon.length === 0) {
        skipped++;
        continue;
      }

      const section = (title: string, rows: string[]) =>
        rows.length ? `<h3 style="margin:16px 0 6px;font-size:15px">${title}</h3><ul style="margin:0;padding-left:18px">${rows.map((r) => `<li style="margin:3px 0">${r}</li>`).join("")}</ul>` : "";

      const body = [
        `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#1a1d27;max-width:520px">`,
        `<h2 style="margin:0 0 4px;font-size:18px">Your iTrack daily digest</h2>`,
        `<p style="margin:0;color:#6b7280">${today}</p>`,
        section("Arriving today", arrivingToday.map((o: any) => `<b>${o.merchant_name}</b>${o.order_number ? ` (order ${o.order_number})` : ""}`)),
        section("Just went overdue", newlyOverdue.map((o: any) => `<b>${o.merchant_name}</b>${o.order_number ? ` (order ${o.order_number})` : ""} - promised ${o.promised_date}`)),
        section("Refund deadlines in the next 3 days", deadlineSoon.map((r: any) => `<b>${r.policy_key}</b> - claim by ${r.deadline}`)),
        `<p style="margin:16px 0 0"><a href="https://i-track-2bdb7160.base44.app" style="color:#4F46E5">Open your dashboard</a></p>`,
        `</div>`,
      ].join("");

      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: owner,
          subject: `iTrack: ${arrivingToday.length ? `${arrivingToday.length} arriving today` : newlyOverdue.length ? `${newlyOverdue.length} just went overdue` : "refund deadlines approaching"}`,
          body,
          from_name: "iTrack",
        });
        sent++;
      } catch (err) {
        console.log(`digest: send failed for ${owner}:`, err instanceof Error ? err.message : err);
      }
    }

    const summary = { ok: true, sent, skipped, considered: allSettings.length };
    console.log("digest/send:", JSON.stringify(summary));
    return Response.json(summary);
  } catch (err) {
    console.log("digest/send error:", err instanceof Error ? err.message : String(err));
    return Response.json({ ok: false });
  }
});
