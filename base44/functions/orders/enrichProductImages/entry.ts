// orders/enrichProductImages: upgrade item thumbnails to real product photos
// and rescue merchant logos from the order emails themselves.
//
// Per needy item (no image, or image measured under HQ_MIN_PX):
//   Tier B: re-fetch the ORIGINAL email from the caller's own Gmail. One cheap
//           LLM call maps items to product LINKS and to the email's embedded
//           product IMAGES, and spots the merchant's header logo. Blank items
//           are restored straight from the email (provenance-perfect, floor
//           EMAIL_MIN_PX); Amazon CDN thumbs are rewritten to their full-size
//           originals via the size token; a deficient merchant logo is filled
//           from the email header (logo_source "email_header").
//   Tier A: follow the item's product page link and pull the page's JSON-LD /
//           og image in high resolution. Banners never become item images.
//   Tier C: web search: the LLM names up to 3 product pages on DIFFERENT
//           sites (merchant, marketplace, manufacturer; Hebrew names searched
//           in both languages) and we og-fetch them in order, because any
//           single retail host may bot-block server fetches.
// Every stored URL is fetched, measured, and re-hosted into Base44 storage;
// replacements must be strictly sharper than what they replace.
//
// image_enrich_version mirrors backfill's logo_ladder_version: bumping
// ENRICH_VERSION reopens attempt-exhausted rows exactly once so pipeline
// improvements get one fresh shot at previously hopeless orders.
//
// Bounded and re-runnable like orders/backfillImages: the frontend loops on
// has_more. Caller-scoped: anonymous callers rejected, all rows filtered by
// the caller's email, and the Gmail token is the CALLER's app-user connector
// token, request-scoped per the per-user OAuth model (no shared inbox).

import { createClientFromRequest } from "npm:@base44/sdk";
import { getUserOrNull, ok, serverError, unauthorized } from "../../../shared/responses.ts";
import { getMessage } from "../../../shared/gmail.ts";
import { extractImageCandidatesDetailed, extractLinkCandidates } from "../../../shared/htmlToText.ts";
import {
  EMAIL_MIN_PX,
  fetchAndUploadIfLarge,
  fetchProductPageImage,
  FILL_MIN_PX,
  HQ_MIN_PX,
  ITEM_MAX_ASPECT,
  mapEmailAssets,
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
const ENRICH_VERSION = 2; // v2: email restore + email-header logo + search fan-out + banner ban
const LOGO_BLURRY_PX = 48; // mirror of backfill's BLURRY_PX for the piggyback logo tier
const PER_PAGE_FANOUT_MS = 4000; // one hanging host must not eat the order budget

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
    const needsWork = (o: any) => {
      if (o.is_archived || !(o.items ?? []).some(itemNeeds)) return false;
      // New enrichment tiers since this row was last tried: reopen attempts and
      // cooldown exactly once (the patch below stamps the current version).
      if ((o.image_enrich_version ?? 1) < ENRICH_VERSION) return true;
      if ((o.image_attempts ?? 0) >= MAX_ATTEMPTS) return false;
      if (o.image_checked_at && now - Date.parse(o.image_checked_at) < RECHECK_MS) return false;
      return true;
    };
    // Same deficiency predicate as backfillImages: the email-header logo tier
    // piggybacks on emails fetched for item work, it never enqueues by itself.
    // deno-lint-ignore no-explicit-any
    const logoDeficient = (o: any) =>
      !o.logo_url || o.logo_source === "google_favicon" || (o.logo_width ?? 0) < LOGO_BLURRY_PX;

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

    // deno-lint-ignore no-explicit-any
    const cdnCandidate = (o: any) => /(^|\.)amazon\./i.test(String(o.merchant_domain ?? o.logo_domain ?? ""));
    // Is a Gmail round trip worth it for this order?
    // deno-lint-ignore no-explicit-any
    const wantsEmail = (o: any, needy: any[]) =>
      // deno-lint-ignore no-explicit-any
      needy.some((it: any) => !it.product_url) || // link mining
      (cdnCandidate(o) && needy.length > 0) || // Amazon CDN size-token upgrade
      // deno-lint-ignore no-explicit-any
      needy.some((it: any) => !it.image_url) || // blank restore from the email's own images
      logoDeficient(o); // email-header logo piggyback

    // One EmailRecord read for the whole run, only when tier B is even possible.
    // Per order prefer the newest order_confirmation (that email carries the
    // product links); manual-* synthetic ids can never be re-fetched from Gmail.
    const emailByOrder = new Map<string, { gmail_message_id: string; classification: string; at: string }>();
    const tierBWanted = !!gmailToken &&
      // deno-lint-ignore no-explicit-any
      queue.some((o: any) => wantsEmail(o, (o.items ?? []).filter(itemNeeds)));
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
    const tiers = { product_page: 0, search: 0, gmail_refetch: 0, cdn: 0, email_restore: 0, email_logo: 0 };
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
      let logoWin: { url: string; width: number } | null = null;
      // attempted: at least one REAL try ran for this order (Gmail refetch,
      // product-page fetch, or web search). starved: a tier this order wanted
      // was blocked by a per-invocation budget. Rows that starved without a
      // single real attempt are left untouched (no attempt count, no cooldown)
      // so the next invocation retries them with fresh budgets.
      let attempted = false;
      let starved = false;

      // Try one email image candidate for an item: Amazon CDN size-token
      // variants first (full-size original), then the raw thumb for blanks.
      // Blanks accept EMAIL_MIN_PX (provenance-perfect source); stored-but-
      // small items only upgrade through the CDN variants (re-fetching the raw
      // candidate would just yield the thumb already stored).
      // deno-lint-ignore no-explicit-any
      const tryEmailImage = async (it: any, srcCandidate: string) => {
        const blank = !it.image_url;
        const minPx = blank ? EMAIL_MIN_PX : Math.max(HQ_MIN_PX, (it.image_width ?? 0) + 1);
        const urls: string[] = [];
        const cm = srcCandidate.match(AMZN_CDN_RE);
        if (cm) urls.push(`${cm[1]}${cm[2]}.${cm[3]}`, `${cm[1]}${cm[2]}._AC_SL1500_.${cm[3]}`);
        if (blank) urls.push(srcCandidate);
        for (const u of urls) {
          if (left() < 1500) return null;
          const got = await fetchAndUploadIfLarge(base44, u, minPx, left(), "item", ITEM_MAX_ASPECT);
          if (got) return got;
        }
        return null;
      };

      // Tier B: re-fetch the original email and mine everything it holds.
      // deno-lint-ignore no-explicit-any
      const needyItems = items.filter((it: any) => itemNeeds(it));
      const emailRef = emailByOrder.get(o.id);
      if (needyItems.length > 0 && wantsEmail(o, needyItems) && gmailToken && emailRef) {
        if (gmailFetches >= MAX_GMAIL_FETCHES || left() < 2000) {
          // The email is this order's highest-value source. Burning the
          // attempt on leftover tiers with no time (or fetch budget) would
          // cooldown-lock the order before its best shot ever ran, so defer
          // the WHOLE order untouched; the next round starts with a fresh
          // clock and a shorter queue.
          deferred++;
          continue;
        } else {
          gmailFetches++;
          attempted = true;
          try {
            const msg = await getMessage(gmailToken, emailRef.gmail_message_id);
            const links = msg.html ? extractLinkCandidates(msg.html) : [];
            const images = msg.html ? extractImageCandidatesDetailed(msg.html) : [];
            const wantLogo = logoDeficient(o);
            // deno-lint-ignore no-explicit-any
            const needLinks = needyItems.some((it: any) => !it.product_url) && links.length > 0;
            // deno-lint-ignore no-explicit-any
            const needImages = images.length > 0 && (wantLogo || needyItems.some((it: any) => !it.image_url));
            let picked = 0;
            let restored = 0;
            if ((needLinks || needImages) && left() > 2000) {
              tiers.gmail_refetch++;
              const picks = await mapEmailAssets(base44, {
                merchantName: o.merchant_name ?? "",
                // deno-lint-ignore no-explicit-any
                itemNames: needyItems.map((it: any) => it.name),
                linkCandidates: links,
                imageCandidates: images,
                wantLogo,
              });

              for (let i = 0; i < needyItems.length; i++) {
                const it = needyItems[i];
                const linkIdx = picks.links[i];
                if (linkIdx != null && !it.product_url) {
                  // Persisted even when image fetches fail, so the next round
                  // goes straight to tier A without Gmail or the LLM.
                  it.product_url = links[linkIdx];
                  changed = true;
                  picked++;
                }
                const imgIdx = picks.images[i];
                if (imgIdx != null && itemNeeds(it) && left() > 1500) {
                  const got = await tryEmailImage(it, images[imgIdx].src);
                  if (got) {
                    it.image_url = got.url;
                    it.image_width = got.width;
                    it.image_source = "email";
                    changed = upgraded = true;
                    restored++;
                    tiers.email_restore++;
                  }
                }
              }

              // Email-header logo: the merchant's own mark, shipped in their
              // own email. No aspect cap (wordmarks are wide); floor 48 and
              // strictly sharper than whatever is stored (never downgrade).
              if (wantLogo && picks.logo != null && left() > 1500) {
                const got = await fetchAndUploadIfLarge(
                  base44,
                  images[picks.logo].src,
                  Math.max(LOGO_BLURRY_PX, (o.logo_width ?? 0) + 1),
                  left(),
                  "logo",
                );
                if (got) {
                  logoWin = got;
                  tiers.email_logo++;
                }
              }
            }
            console.log(
              `enrich tierB ${o.merchant_name}: links=${links.length} imgs=${images.length} picked=${picked} ` +
                `restored=${restored} logo=${logoWin ? `${logoWin.width}px` : wantLogo ? "no" : "-"}`,
            );

            // Unmapped Amazon-CDN fallback: when the mapper returned nothing
            // for a SINGLE needy item, scan raw candidates (attribution is
            // unambiguous with one item, so a wrong attach is impossible).
            // deno-lint-ignore no-explicit-any
            const stillNeedy = items.filter((it: any) => itemNeeds(it));
            if (stillNeedy.length === 1 && msg.html && left() > 2000) {
              const it = stillNeedy[0];
              for (const cand of images) {
                if (!AMZN_CDN_RE.test(cand.src) || left() < 1500) continue;
                const got = await tryEmailImage(it, cand.src);
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
            console.log(
              `enrich tierB ${o.merchant_name}: gmail fetch failed (${err instanceof Error ? err.message.slice(0, 80) : err})`,
            );
          }
        }
      }

      // Tiers A + C, per still-needy item.
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
            allowBanner: false, // banners never become item images; the logo hero owns brand display
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
        let got = hit?.image_url
          ? await fetchAndUploadIfLarge(base44, hit.image_url, minPx, left(), "item", ITEM_MAX_ASPECT)
          : null;
        let pagesTried = 0;
        for (const pageUrl of hit?.product_page_urls ?? []) {
          if (got || left() < 1500) break;
          pagesTried++;
          got = await fetchProductPageImage(base44, pageUrl, {
            minPx,
            budgetMs: Math.min(PER_PAGE_FANOUT_MS, left()),
            allowBanner: false,
          });
          if (got) it.product_url = pageUrl; // provenance for future tier A upgrades
        }
        console.log(
          `enrich tierC ${o.merchant_name}: img=${host(hit?.image_url)} pages=${pagesTried}/${hit?.product_page_urls?.length ?? 0} kept=${got ? got.width + "px" : "no"}`,
        );
        if (got) {
          it.image_url = got.url;
          it.image_width = got.width;
          it.image_source = "search";
          changed = upgraded = true;
          tiers.search++;
        } else {
          // The ~10s search often completes with pages but leaves no time to
          // fetch them. Persist the first named page on a DIFFERENT domain
          // than the purl tier A just failed on (that one is proven dead), so
          // the next round's cheap tier A retries the fresh page instead of
          // paying for another search. Converges toward a fetchable host.
          const reg = (u: string | undefined | null) => {
            try {
              return u ? new URL(u).hostname.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".") : null;
            } catch (_) {
              return null;
            }
          };
          const deadDomain = reg(it.product_url);
          const fresh = (hit?.product_page_urls ?? []).find((p) => reg(p) && reg(p) !== deadDomain);
          if (fresh && it.product_url !== fresh) {
            it.product_url = fresh;
            changed = true;
          }
        }
      }

      if (!upgraded && !logoWin && !attempted && starved) {
        deferred++;
        continue;
      }

      processed++;
      const reopened = (o.image_enrich_version ?? 1) < ENRICH_VERSION;
      const patch: Record<string, unknown> = {
        // upgraded is strictly about ITEM images: each success permanently
        // removes an item from the queue predicate, so resetting the budget
        // cannot loop. A logo-only win must NOT reset attempts (it does not
        // shrink the item queue). A version bump grants one fresh budget.
        image_attempts: upgraded ? 0 : reopened ? 1 : (o.image_attempts ?? 0) + 1,
        // Written even on failure: this stamp is what terminates the loop.
        image_checked_at: new Date().toISOString(),
        image_enrich_version: ENRICH_VERSION,
      };
      if (changed) patch.items = items;
      if (logoWin) {
        patch.logo_url = logoWin.url;
        patch.logo_width = logoWin.width;
        patch.logo_source = "email_header";
      }
      if (upgraded || logoWin) updated++;
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
