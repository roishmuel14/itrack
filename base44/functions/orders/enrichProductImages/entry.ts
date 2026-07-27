// orders/enrichProductImages: upgrade item thumbnails to real product photos.
//
// The email thumbnail an order is born with is usually 100-150px. This loop,
// per needy item (no image, or image measured under HQ_MIN_PX):
//   Tier A: follow the item's product page link (mined from the email) and pull
//           the page's og:image / JSON-LD Product image in high resolution.
//   Tier B: for orders that predate link mining, re-fetch the ORIGINAL email
//           from the caller's own Gmail by message id, mine links now, and let
//           a cheap LLM call map items to links (persisted even if the image
//           fetch then fails, so the next round skips Gmail and the LLM).
//   Tier C: no link at all: an internet-context LLM call finds the product
//           page or a direct photo URL.
// Every stored URL is fetched, measured (>= 256px short side to REPLACE an
// existing image, >= 128px to fill a blank; always strictly sharper than what
// is stored), and re-hosted into Base44 storage. Never a foreign URL.
//
// Bounded and re-runnable like orders/backfillImages: the frontend loops on
// has_more. Caller-scoped: anonymous callers rejected, all rows filtered by
// the caller's email, and the Gmail token is the CALLER's app-user connector
// token, request-scoped per the per-user OAuth model (no shared inbox).

import { createClientFromRequest } from "npm:@base44/sdk";
import { getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { getMessage } from "../../../shared/gmail.ts";
import { extractImageCandidates, extractLinkCandidates } from "../../../shared/htmlToText.ts";
import {
  fetchAndUploadIfLarge,
  fetchProductPageImage,
  FILL_MIN_PX,
  HQ_MIN_PX,
  mapItemsToLinks,
  searchProductOnline,
} from "../../../shared/productImage.ts";

const DEADLINE_MS = 20_000; // wall clock per invocation
const MAX_ORDERS = 4; // rows touched per invocation (page + image fetches are slow)
const PER_ORDER_BUDGET_MS = 12_000;
const MAX_ATTEMPTS = 3; // per order, lifetime (image_attempts): stops hopeless orders looping
const RECHECK_MS = 7 * 24 * 60 * 60 * 1000; // do not retry the same order within a week
const MAX_ITEMS_PER_ORDER = 3;
const MAX_SEARCHES = 2; // internet-context LLM calls per invocation
const MAX_GMAIL_FETCHES = 4;

// Amazon's image CDN is open even where its product pages bot-block, and its
// URLs carry a size token that can be rewritten: images/I/<id>._AC_SL300_.jpg
// is the same asset as images/I/<id>.jpg at original resolution.
const AMZN_CDN_RE =
  /^(https:\/\/(?:m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\/images\/I\/)([^._/]+)(?:\._[^/]*_)?\.(jpe?g|png|webp)(?:\?.*)?$/i;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await getUserOrNull(base44);
    if (!user) return unauthorized();

    // Optional, clamped. Anything else in the body is ignored so the route stays
    // safe to call with no args at all.
    // deno-lint-ignore no-explicit-any
    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {
      body = {};
    }
    const maxOrders = Math.max(1, Math.min(MAX_ORDERS, Number(body?.max_orders) || MAX_ORDERS));

    // Tier B needs the caller's Gmail token; enrichment must keep working
    // without it (manual orders, disconnected Gmail), so failure is non-fatal.
    let gmailToken: string | null = null;
    const connectorId = Deno.env.get("GMAIL_CONNECTOR_ID");
    if (connectorId) {
      try {
        ({ accessToken: gmailToken } = await base44.asServiceRole.connectors.getCurrentAppUserConnection(connectorId));
      } catch (_) {
        gmailToken = null;
      }
    }

    const startedAt = Date.now();
    const service = base44.asServiceRole.entities;
    const orders = await service.Order.filter({ owner_email: user.email });

    const now = Date.now();
    // deno-lint-ignore no-explicit-any
    const itemNeeds = (it: any) => !!it?.name && (!it.image_url || (it.image_width ?? 0) < HQ_MIN_PX);
    // deno-lint-ignore no-explicit-any
    const needsWork = (o: any) =>
      !o.is_archived &&
      (o.items ?? []).some(itemNeeds) &&
      (o.image_attempts ?? 0) < MAX_ATTEMPTS &&
      !(o.image_checked_at && now - Date.parse(o.image_checked_at) < RECHECK_MS);

    const queue = orders
      .filter(needsWork)
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) =>
        String(b.last_event_at ?? b.created_date ?? "").localeCompare(
          String(a.last_event_at ?? a.created_date ?? ""),
        )
      );

    if (queue.length === 0) {
      return ok({ ok: true, processed: 0, updated: 0, remaining: 0, has_more: false });
    }

    // One EmailRecord read for the whole run, only when tier B is even possible.
    // Per order prefer the newest order_confirmation (that email carries the
    // product links); manual-* synthetic ids can never be re-fetched from Gmail.
    const emailByOrder = new Map<string, { gmail_message_id: string; classification: string; at: string }>();
    // deno-lint-ignore no-explicit-any
    const cdnCandidate = (o: any) => /(^|\.)amazon\./i.test(String(o.merchant_domain ?? o.logo_domain ?? ""));
    const tierBWanted = !!gmailToken &&
      // deno-lint-ignore no-explicit-any
      queue.some((o: any) =>
        // deno-lint-ignore no-explicit-any
        (o.items ?? []).some((it: any) => itemNeeds(it) && !it.product_url) ||
        // deno-lint-ignore no-explicit-any
        (cdnCandidate(o) && (o.items ?? []).some((it: any) => itemNeeds(it)))
      );
    if (tierBWanted) {
      const emails = await service.EmailRecord.filter({ owner_email: user.email });
      for (const e of emails) {
        if (!e.order_id || !e.gmail_message_id) continue;
        if (String(e.gmail_message_id).startsWith("manual-")) continue;
        const at = String(e.received_at ?? "");
        const cur = emailByOrder.get(e.order_id);
        const isConf = e.classification === "order_confirmation";
        const curConf = cur?.classification === "order_confirmation";
        if (!cur || (isConf && !curConf) || (isConf === curConf && at > cur.at)) {
          emailByOrder.set(e.order_id, {
            gmail_message_id: e.gmail_message_id,
            classification: e.classification ?? "",
            at,
          });
        }
      }
    }

    let processed = 0; // rows actually stamped/updated this invocation
    let deferred = 0; // rows skipped untouched because a per-invocation budget ran out
    let updated = 0;
    let searches = 0;
    let gmailFetches = 0;
    const tiers = { product_page: 0, search: 0, gmail_refetch: 0, cdn: 0 };
    const host = (u: string | null | undefined) => {
      try {
        return u ? new URL(u).hostname : "-";
      } catch (_) {
        return "?";
      }
    };

    for (const o of queue) {
      if (processed >= maxOrders || Date.now() - startedAt > DEADLINE_MS) break;

      const orderDeadline = Math.min(Date.now() + PER_ORDER_BUDGET_MS, startedAt + DEADLINE_MS);
      const left = () => orderDeadline - Date.now();

      // deno-lint-ignore no-explicit-any
      const items = (o.items ?? []).map((it: any) => ({ ...it }));
      let changed = false;
      let upgraded = false;
      // attempted: at least one REAL try ran for this order (Gmail refetch,
      // product-page fetch, or web search). starved: a tier this order wanted
      // was blocked by a per-invocation budget. Rows that starved without a
      // single real attempt are left untouched (no attempt count, no cooldown)
      // so the next invocation retries them with fresh budgets.
      let attempted = false;
      let starved = false;

      // Tier B: re-fetch the original email to mine product links (legacy
      // orders) and to try the Amazon-CDN size-token upgrade. Worth a Gmail
      // round trip when any needy item lacks a link, or the merchant is Amazon.
      // deno-lint-ignore no-explicit-any
      const needyItems = items.filter((it: any) => itemNeeds(it));
      // deno-lint-ignore no-explicit-any
      const needyWithoutLink = needyItems.filter((it: any) => !it.product_url);
      const emailRef = emailByOrder.get(o.id);
      if (needyItems.length > 0 && (needyWithoutLink.length > 0 || cdnCandidate(o)) && gmailToken && emailRef) {
        if (gmailFetches >= MAX_GMAIL_FETCHES || left() < 2000) {
          starved = true;
        } else {
          gmailFetches++;
          attempted = true;
          try {
            const msg = await getMessage(gmailToken, emailRef.gmail_message_id);
            const links = msg.html ? extractLinkCandidates(msg.html) : [];
            let picked = 0;
            if (needyWithoutLink.length > 0 && links.length > 0) {
              tiers.gmail_refetch++;
              // deno-lint-ignore no-explicit-any
              const picks = await mapItemsToLinks(base44, needyWithoutLink.map((it: any) => it.name), links);
              // deno-lint-ignore no-explicit-any
              needyWithoutLink.forEach((it: any, i: number) => {
                const pick = picks[i];
                if (pick != null) {
                  // Persisted even when the image fetch below fails, so the next
                  // round goes straight to tier A without Gmail or the LLM.
                  it.product_url = links[pick];
                  changed = true;
                  picked++;
                }
              });
            }
            console.log(`enrich tierB ${o.merchant_name}: links=${links.length} picked=${picked}`);

            // Amazon-CDN upgrade: only when exactly ONE item needs an image, so
            // an email thumbnail cannot be attached to the wrong line item.
            if (needyItems.length === 1 && msg.html && left() > 2000) {
              const it = needyItems[0];
              const minPx = it.image_url ? Math.max(HQ_MIN_PX, (it.image_width ?? 0) + 1) : FILL_MIN_PX;
              for (const cand of extractImageCandidates(msg.html)) {
                const cm = cand.match(AMZN_CDN_RE);
                if (!cm || left() < 1500) continue;
                const got = (await fetchAndUploadIfLarge(base44, `${cm[1]}${cm[2]}.${cm[3]}`, minPx, left())) ??
                  (await fetchAndUploadIfLarge(base44, `${cm[1]}${cm[2]}._AC_SL1500_.${cm[3]}`, minPx, left()));
                console.log(`enrich tierB-cdn ${o.merchant_name}: ${got ? got.width + "px" : "no"}`);
                if (got) {
                  it.image_url = got.url;
                  it.image_width = got.width;
                  it.image_source = "email";
                  changed = upgraded = true;
                  tiers.cdn++;
                  break;
                }
              }
            }
          } catch (err) {
            console.log(`enrich tierB ${o.merchant_name}: gmail fetch failed (${err instanceof Error ? err.message.slice(0, 80) : err})`);
          }
        }
      }

      // Tiers A + C, per needy item.
      let itemsTried = 0;
      for (const it of items) {
        if (!itemNeeds(it)) continue;
        if (itemsTried >= MAX_ITEMS_PER_ORDER) break;
        if (left() < 1500) {
          starved = true;
          break;
        }
        itemsTried++;

        // A replacement must be HQ AND strictly sharper than what is stored;
        // filling a blank accepts anything reasonably crisp.
        const minPx = it.image_url ? Math.max(HQ_MIN_PX, (it.image_width ?? 0) + 1) : FILL_MIN_PX;

        if (it.product_url) {
          attempted = true;
          const got = await fetchProductPageImage(base44, it.product_url, {
            minPx,
            budgetMs: left(),
            allowBanner: !it.image_url, // a store banner may fill a blank, never displace a real photo
          });
          if (got) {
            it.image_url = got.url;
            it.image_width = got.width;
            it.image_source = "product_page";
            changed = upgraded = true;
            tiers.product_page++;
            continue;
          }
          console.log(`enrich tierA ${o.merchant_name}: no image >= ${minPx}px from ${host(it.product_url)}`);
        }

        if (searches >= MAX_SEARCHES || left() < 3000) {
          starved = true;
          continue;
        }
        searches++;
        attempted = true;
        const hit = await searchProductOnline(base44, {
          itemName: it.name,
          merchantName: o.merchant_name,
          merchantDomain: o.merchant_domain || o.logo_domain,
          currency: o.currency,
        });
        let got = hit?.image_url ? await fetchAndUploadIfLarge(base44, hit.image_url, minPx, left()) : null;
        if (!got && hit?.product_page_url) {
          got = await fetchProductPageImage(base44, hit.product_page_url, {
            minPx,
            budgetMs: left(),
            allowBanner: !it.image_url,
          });
          if (got) it.product_url = hit.product_page_url; // provenance for future upgrades
        }
        console.log(
          `enrich tierC ${o.merchant_name}: hit img=${host(hit?.image_url)} page=${host(hit?.product_page_url)} kept=${got ? got.width + "px" : "no"}`,
        );
        if (got) {
          it.image_url = got.url;
          it.image_width = got.width;
          it.image_source = "search";
          changed = upgraded = true;
          tiers.search++;
        }
      }

      if (!upgraded && !attempted && starved) {
        deferred++;
        continue;
      }

      processed++;
      const patch: Record<string, unknown> = {
        // Monotonic progress on success: each success permanently removes an
        // item from the queue predicate, so resetting the budget cannot loop.
        image_attempts: upgraded ? 0 : (o.image_attempts ?? 0) + 1,
        // Written even on failure: this stamp is what terminates the loop.
        image_checked_at: new Date().toISOString(),
      };
      if (changed) patch.items = items;
      if (upgraded) updated++;
      await service.Order.update(o.id, patch);
    }

    const remaining = Math.max(0, queue.length - processed);
    console.log(
      `enrichProductImages ${user.email}: processed=${processed} updated=${updated} deferred=${deferred} ` +
        `remaining=${remaining} tiers=${JSON.stringify(tiers)} gmail_fetches=${gmailFetches} searches=${searches}`,
    );
    return ok({ ok: true, processed, updated, remaining, has_more: remaining > 0 });
  } catch (err) {
    return serverError(err);
  }
});
