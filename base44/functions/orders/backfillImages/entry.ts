// orders/backfillImages: give existing orders a sharp merchant logo.
//
// Three problems this repairs on rows that already exist:
//   1. logo_url was only ever written at order CREATION, and only when the LLM
//      guessed a merchant_domain, so orders whose first email had neither stayed
//      permanently imageless.
//   2. logos that did land came from Google's favicon service, which upscales a
//      16px favicon; those are stored blurry and are re-resolved here.
//   3. merchants whose emails never reveal a usable domain (KSP via an ESP):
//      an internet-context LLM call guesses the official site, the ladder runs
//      on the guess, and the guess is persisted ONLY when it actually produced
//      a logo, so a bad guess is never sticky.
//
// LOGO_LADDER_VERSION: rows are stamped with the ladder generation that last
// touched them. Bumping the constant reopens attempt-exhausted rows exactly
// once, so new ladder tiers (duckduckgo, s2 sz=256, the LLM guess) get one
// fresh shot at previously hopeless merchants.
//
// Bounded and re-runnable: the frontend calls it in a loop until has_more is
// false. Every route is anonymously reachable, so anonymous callers are rejected
// before any work, and all reads/writes are scoped to the caller's own rows.

import { createClientFromRequest } from "npm:@base44/sdk";
import { getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { normalizeDomain } from "../../../shared/mergeEngine.ts";
import { domainFromSender, registrableDomain } from "../../../shared/senderDomain.ts";
import { guessMerchantDomain, resolveAndRehostLogo, type ResolvedLogo } from "../../../shared/merchantLogo.ts";
import { searchMerchantLogo } from "../../../shared/productImage.ts";

const DEADLINE_MS = 20_000; // wall clock per invocation
const MAX_ORDERS = 8; // rows touched per invocation
const MAX_RESOLVES = 6; // distinct domains resolved per invocation
const MAX_ATTEMPTS = 3; // per order, lifetime: stops hopeless domains looping
const RECHECK_MS = 7 * 24 * 60 * 60 * 1000; // do not retry the same order within a week
const PER_DOMAIN_BUDGET_MS = 6000;
const BLURRY_PX = 48;
const LOGO_LADDER_VERSION = 3; // v3: web_search tier + defer-not-stamp semantics
const MAX_GUESSES = 2; // LLM domain guesses per invocation
const MAX_LOGO_SEARCHES = 2; // LLM web-search logo lookups per invocation
const GUESS_MIN_REMAINING_MS = 7000; // no LLM call without time to also fetch the result

// The raw registrable sender domain, ignoring the ESP/carrier blocklists: even
// "via mailchimp" is a useful HINT for the guesser, just never a logo source.
function rawSenderRegistrable(from: string): string | null {
  const angle = from.match(/<([^>]*)>\s*$/);
  const addr = (angle ? angle[1] : from).trim();
  const at = addr.lastIndexOf("@");
  if (at < 0) return null;
  const host = addr.slice(at + 1).toLowerCase().trim().replace(/[>\s.]+$/g, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  return registrableDomain(host);
}

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
      const deficient = !o.logo_url || // gap fill
        o.logo_source === "google_favicon" || // upgrade pass: the blurry fallback
        (o.logo_width ?? 0) < BLURRY_PX; // or a measured-tiny icon
      if (!deficient) return false;
      // New ladder tiers since this row was last tried: reopen attempts and
      // cooldown exactly once (the patch below stamps the current version).
      if ((o.logo_ladder_version ?? 1) < LOGO_LADDER_VERSION) return true;
      if ((o.logo_attempts ?? 0) >= MAX_ATTEMPTS) return false;
      if (o.logo_checked_at && now - Date.parse(o.logo_checked_at) < RECHECK_MS) return false;
      return true;
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
    // filter() would be N round trips inside the deadline. Built unconditionally
    // because the guess step wants sender hints even when a domain exists.
    const newestFrom = new Map<string, { from: string; at: string }>();
    {
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
    const searchCache = new Map<string, ResolvedLogo | null>(); // by merchant name
    let processed = 0; // rows actually stamped/updated this invocation
    let deferred = 0; // rows skipped untouched because a per-invocation budget ran out
    let updated = 0;
    let resolves = 0;
    let guesses = 0;
    let logoSearches = 0;
    const timeLeft = () => DEADLINE_MS - (Date.now() - startedAt);

    // undefined = could not even try (resolve budget spent): starvation, not failure.
    const tryResolve = async (d: string): Promise<ResolvedLogo | null | undefined> => {
      let resolved = domainCache.get(d);
      if (resolved === undefined) {
        if (resolves >= MAX_RESOLVES) return undefined;
        resolves++;
        resolved = await resolveAndRehostLogo(base44, d, {
          budgetMs: Math.min(PER_DOMAIN_BUDGET_MS, Math.max(0, timeLeft())),
        });
        domainCache.set(d, resolved);
      }
      return resolved;
    };

    for (const o of queue) {
      if (processed >= maxOrders || timeLeft() < 0) break;

      const rec = newestFrom.get(o.id);
      let domain = normalizeDomain(o.merchant_domain) || normalizeDomain(o.logo_domain);
      if (!domain && rec) {
        const inferred = domainFromSender(rec.from, { ownerEmail: user.email }).domain;
        if (inferred) domain = inferred;
      }

      // Never downgrade: only replace a stored logo with a strictly sharper one.
      const acceptable = (r: ResolvedLogo | null | undefined): r is ResolvedLogo =>
        !!r && (!o.logo_url || r.width > (o.logo_width ?? 0));

      const nameOk = !!o.merchant_name && !/^unknown merchant$/i.test(o.merchant_name);
      let winner: ResolvedLogo | null = null;
      let guessedDomain: string | null = null;
      // True when a tier this order WANTED was blocked by a per-invocation
      // budget. Such rows are left untouched (no attempt count, no cooldown
      // stamp) so the next invocation retries them with fresh budgets.
      let starved = false;

      // Tier 1: the icon ladder on the known domain.
      if (domain) {
        const resolved = await tryResolve(domain);
        if (resolved === undefined) starved = true;
        else if (acceptable(resolved)) winner = resolved;
      }

      // Tier 2: the known domains produced nothing at all: ask the LLM for the
      // official site (KSP -> ksp.co.il) and ladder the guess.
      if (!winner && nameOk && (!domain || domainCache.get(domain) === null)) {
        if (guesses >= MAX_GUESSES || timeLeft() < GUESS_MIN_REMAINING_MS) {
          starved = true;
        } else {
          guesses++;
          const guess = await guessMerchantDomain(base44, {
            merchantName: o.merchant_name,
            senderDomain: rec ? rawSenderRegistrable(rec.from) : null,
            currency: o.currency,
            // deno-lint-ignore no-explicit-any
            itemNames: (o.items ?? []).map((i: any) => i?.name).filter(Boolean).slice(0, 3),
          });
          if (guess && guess !== domain) {
            const resolved = await tryResolve(guess);
            if (resolved === undefined) starved = true;
            else if (acceptable(resolved)) {
              winner = resolved;
              guessedDomain = guess; // persisted ONLY on success; a bad guess is never sticky
            }
          }
        }
      }

      // Tier 3: web-search the brand logo itself. This is what rescues
      // merchants whose sites only publish 16-32px favicons or bot-block icon
      // fetches entirely (KSP, JoyBox, FedEx): press-kit and Wikimedia logo
      // images are sharp and never blocked.
      if (!winner && nameOk) {
        const cached = searchCache.get(o.merchant_name);
        if (cached !== undefined) {
          if (acceptable(cached)) winner = cached;
        } else if (logoSearches >= MAX_LOGO_SEARCHES || timeLeft() < GUESS_MIN_REMAINING_MS) {
          starved = true;
        } else {
          logoSearches++;
          const found = await searchMerchantLogo(
            base44,
            { merchantName: o.merchant_name, domain: domain || null, currency: o.currency },
            Math.max(96, (o.logo_width ?? 0) + 1),
          );
          searchCache.set(o.merchant_name, found);
          console.log(`backfillImages logo-search "${o.merchant_name}": ${found ? `${found.width}px` : "none"}`);
          if (acceptable(found)) winner = found;
        }
      }

      if (!winner && starved) {
        deferred++;
        continue;
      }

      processed++;
      const reopened = (o.logo_ladder_version ?? 1) < LOGO_LADDER_VERSION;
      const patch: Record<string, unknown> = {
        // A ladder-version bump grants one fresh attempt budget; otherwise count up.
        logo_attempts: winner ? 0 : reopened ? 1 : (o.logo_attempts ?? 0) + 1,
        // Written even on failure: this stamp is what makes the loop terminate.
        logo_checked_at: new Date().toISOString(),
        logo_ladder_version: LOGO_LADDER_VERSION,
      };
      if (guessedDomain) patch.logo_domain = guessedDomain;
      else if (domain && !o.logo_domain) patch.logo_domain = domain;
      if (winner) {
        patch.logo_url = winner.url;
        patch.logo_source = winner.source;
        patch.logo_width = winner.width;
        updated++;
      }

      await service.Order.update(o.id, patch);
    }

    const remaining = Math.max(0, queue.length - processed);
    console.log(
      `backfillImages ${user.email}: processed=${processed} updated=${updated} deferred=${deferred} ` +
        `remaining=${remaining} guesses=${guesses} logo_searches=${logoSearches}`,
    );
    return ok({ ok: true, processed, updated, remaining, has_more: remaining > 0 });
  } catch (err) {
    return serverError(err);
  }
});
