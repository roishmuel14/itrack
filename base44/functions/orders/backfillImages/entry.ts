// orders/backfillImages: give existing orders a sharp merchant logo.
//
// Two problems this repairs on rows that already exist:
//   1. logo_url was only ever written at order CREATION, and only when the LLM
//      guessed a merchant_domain, so orders whose first email had neither stayed
//      permanently imageless.
//   2. logos that did land came from Google's favicon service, which upscales a
//      16px favicon; those are stored blurry and are re-resolved here.
//
// Bounded and re-runnable: the frontend calls it in a loop until has_more is
// false. Every route is anonymously reachable, so anonymous callers are rejected
// before any work, and all reads/writes are scoped to the caller's own rows.

import { createClientFromRequest } from "npm:@base44/sdk";
import { getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { normalizeDomain } from "../../../shared/mergeEngine.ts";
import { domainFromSender } from "../../../shared/senderDomain.ts";
import { resolveAndRehostLogo, type ResolvedLogo } from "../../../shared/merchantLogo.ts";

const DEADLINE_MS = 20_000; // wall clock per invocation
const MAX_ORDERS = 8; // rows touched per invocation
const MAX_RESOLVES = 6; // distinct domains resolved per invocation
const MAX_ATTEMPTS = 3; // per order, lifetime: stops hopeless domains looping
const RECHECK_MS = 7 * 24 * 60 * 60 * 1000; // do not retry the same order within a week
const PER_DOMAIN_BUDGET_MS = 6000;
const BLURRY_PX = 48;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await getUserOrNull(base44);
    if (!user) return unauthorized();

    // Optional, clamped. Anything else in the body is ignored so the route stays
    // safe to call with no args at all.
    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {
      body = {};
    }
    const maxOrders = Math.max(1, Math.min(MAX_ORDERS, Number(body?.max_orders) || MAX_ORDERS));

    const startedAt = Date.now();
    const service = base44.asServiceRole.entities;

    const orders = await service.Order.filter({ owner_email: user.email });

    const now = Date.now();
    const needsWork = (o: any) => {
      if ((o.logo_attempts ?? 0) >= MAX_ATTEMPTS) return false;
      if (o.logo_checked_at && now - Date.parse(o.logo_checked_at) < RECHECK_MS) return false;
      if (!o.logo_url) return true; // gap fill
      // upgrade pass: the blurry fallback, or a measured-tiny icon
      return o.logo_source === "google_favicon" || (o.logo_width ?? 0) < BLURRY_PX;
    };

    const queue = orders
      .filter((o: any) => !o.is_archived && needsWork(o))
      .sort((a: any, b: any) =>
        String(b.last_event_at ?? b.created_date ?? "").localeCompare(
          String(a.last_event_at ?? a.created_date ?? ""),
        )
      );

    if (queue.length === 0) {
      return ok({ ok: true, processed: 0, updated: 0, remaining: 0, has_more: false });
    }

    // One EmailRecord read for the whole run, grouped in memory: a per-order
    // filter() would be N round trips inside the deadline.
    const needsSender = queue.some((o: any) => !normalizeDomain(o.merchant_domain) && !normalizeDomain(o.logo_domain));
    const newestFrom = new Map<string, { from: string; at: string }>();
    if (needsSender) {
      const emails = await service.EmailRecord.filter({ owner_email: user.email });
      for (const e of emails) {
        if (!e.order_id || !e.from_address) continue;
        const at = String(e.received_at ?? "");
        const cur = newestFrom.get(e.order_id);
        if (!cur || at > cur.at) newestFrom.set(e.order_id, { from: e.from_address, at });
      }
    }

    // Sibling orders from the same merchant share one resolution and one upload.
    const domainCache = new Map<string, ResolvedLogo | null>();
    let processed = 0;
    let updated = 0;
    let resolves = 0;

    for (const o of queue) {
      if (processed >= maxOrders || Date.now() - startedAt > DEADLINE_MS) break;
      processed++;

      const patch: Record<string, unknown> = {
        logo_attempts: (o.logo_attempts ?? 0) + 1,
        // Written even on failure: this stamp is what makes the loop terminate.
        logo_checked_at: new Date().toISOString(),
      };

      let domain = normalizeDomain(o.merchant_domain) || normalizeDomain(o.logo_domain);
      if (!domain) {
        const rec = newestFrom.get(o.id);
        const inferred = rec ? domainFromSender(rec.from, { ownerEmail: user.email }).domain : null;
        if (inferred) domain = inferred;
      }
      if (domain && !o.logo_domain) patch.logo_domain = domain;

      if (domain && resolves < MAX_RESOLVES) {
        let resolved = domainCache.get(domain);
        if (resolved === undefined) {
          resolves++;
          const remainingMs = DEADLINE_MS - (Date.now() - startedAt);
          resolved = await resolveAndRehostLogo(base44, domain, {
            budgetMs: Math.min(PER_DOMAIN_BUDGET_MS, remainingMs),
          });
          domainCache.set(domain, resolved);
        }
        // Never downgrade: only replace a stored logo with a strictly sharper one.
        if (resolved && (!o.logo_url || resolved.width > (o.logo_width ?? 0))) {
          patch.logo_url = resolved.url;
          patch.logo_source = resolved.source;
          patch.logo_width = resolved.width;
          patch.logo_attempts = 0; // success resets the budget
          updated++;
        }
      }

      await service.Order.update(o.id, patch);
    }

    const remaining = Math.max(0, queue.length - processed);
    console.log(
      `backfillImages ${user.email}: processed=${processed} updated=${updated} remaining=${remaining}`,
    );
    return ok({ ok: true, processed, updated, remaining, has_more: remaining > 0 });
  } catch (err) {
    return serverError(err);
  }
});
