# iTrack: Concept & Architecture

> **Superseded for spec purposes (2026-07-22): [PRD.md](PRD.md) is the requirements source of
> truth and [BUILD_PLAN.md](BUILD_PLAN.md) the execution plan.** This document remains as the
> rationale and decision history behind them.

The what-to-build companion to [BASE44_BUILDOFF_REFERENCE.md](BASE44_BUILDOFF_REFERENCE.md) (the
how-to-build manual). Written 2026-07-22 after verifying the Gmail/connector/WhatsApp facts against
the Base44 developer docs.

---

## 1. The product in one paragraph

**iTrack** is a personal delivery command center. You connect your Gmail once, and every order you
have in flight (Amazon, Temu, Revolve, AliExpress, the local dog-food vendor) appears as a live card:
what you bought with its image, where it is now, a progress bar running toward the promised date,
every update the seller or carrier ever sent you, and, when a package is late, whether you are owed
money for it and a ready-to-send claim. Ask about any package on WhatsApp and the app answers.

**One-line pitch (draft):** "Connect your inbox once. See every package you're waiting for, live,
and get paid when they're late."

Strictly per-user: each user sees only their own orders, enforced by RLS, not by UI.

---

## 2. The Gmail question (the thing you asked about)

This is the crux, so here is the verified landscape and the decision.

### What Base44 gives us (verified in docs 2026-07-22)

1. **App-user connectors**: each signed-in app user connects their own Gmail; Base44 stores a
   separate OAuth token per user. Frontend: `base44.connectors.connectAppUser(connectorId)` returns
   a redirect URL. Backend: `base44.asServiceRole.connectors.getCurrentAppUserConnection(connectorId)`
   returns `{ accessToken }` for the user making the current request, and you call the Gmail REST API
   with it. **Requires a Builder plan or higher** (verify your plan).
2. **BUT the OAuth app is ours, not Base44's.** Docs: "The OAuth flow runs under your registered
   OAuth application, so app users see your app's name on the provider's consent screen." You
   register a Google client ID + secret in Workspace Settings. So the Google-verification burden is
   ours, which brings us to the cost question.
3. **Gmail connector scopes** (from the connector catalog): `gmail.readonly`, `gmail.modify`,
   `gmail.compose`, `gmail.send`, `gmail.labels`. All of these are Google **restricted scopes**.

### The approvals/cost reality you were worried about

- **Any** app (web OR extension) calling the Gmail API with restricted scopes needs, for production:
  Google OAuth verification + an **annual CASA security assessment** (roughly $540 at the cheapest
  self-scan tier to $4,500+ for a full audit, plus weeks of process).
- **The escape hatch that makes the competition free:** a Google Cloud OAuth client in **Testing**
  publishing status needs NO verification and NO CASA. Limits: max 100 test users (each added
  manually to the test-user list), and refresh tokens expire after 7 days. **The competition window
  is 6 days.** The 7-day expiry is literally harmless here.
- So: for the Build-Off we run our own OAuth client in Testing mode, at $0. The write-up states the
  production path honestly (CASA budget, or the forwarding-address ingest below, which needs no
  Google approval at all). Judges reward a credible path to production under "usefulness"; hiding
  the constraint would be worse than owning it.

### Why NOT a Chrome extension (your instinct was right)

- An extension reading Gmail via the API has the exact same restricted-scope/CASA problem, PLUS
  Chrome Web Store review, PLUS Manifest V3 background-worker limits.
- An extension scraping the Gmail DOM avoids the API but is brittle, ToS-gray, and reads as a hack
  to a judge, not as backend depth.
- Most importantly: the ingestion should happen **server-side** so it works while the browser is
  closed. An extension puts the core logic in the wrong place. Extensions are a post-competition
  "add this order from any page" helper at best.

### Correction (2026-07-22, after re-reading the connector docs)

Two earlier claims in this section were wrong, and the fix is a better architecture. Superseded:

- ~~"Testing mode is the escape hatch."~~ It is not: Testing mode requires manually listing every
  user's Gmail address (max 100) and expires refresh tokens after 7 days. Base44's own Gmail
  troubleshooting says to publish the OAuth app out of testing mode so anyone can connect.
  **In production + unverified** is strictly better: no manual list, no 7-day expiry, users click
  through an "unverified app" warning, hard cap of 100 users for the lifetime of the Cloud project
  (reportedly unresettable, so use a throwaway project).
- ~~"Connector automations don't help us."~~ They do, once the inbox model flips (below).

### The better architecture: shared inbox + per-user plus-aliases

The decisive fact I initially missed: **shared connectors need no Google Cloud project at all.**
A shared connector is a `base44/connectors/gmail.jsonc` with `type` + `scopes`, pushed with
`connectors push`, authorized once in the browser under **Base44's** OAuth app. No client ID, no
client secret, no consent-screen ownership, no CASA, no user cap. And shared connectors are exactly
the ones that support **connector automations**: `integration_type: "gmail"`, `events: ["mailbox"]`,
with a documented trigger condition `{ "field": "has_new_messages", "operator": "equals", "value":
true }` so the function runs only on genuinely new mail. Payload arrives as
`payload.data` (null if over ~200 KB, flagged by `payload.payload_too_large`).

So iTrack owns **one** Gmail inbox, and each user gets a unique plus-alias into it:

```
iTrack's inbox:     itrackapp@gmail.com
User A's address:   itrackapp+a7f3d2@gmail.com
User B's address:   itrackapp+91c4e0@gmail.com
```

Users forward order mail there (manual forward, a Gmail filter, or by using the alias at checkout).
New mail fires the connector automation -> function reads the message via `getConnection("gmail")` ->
routes to the owning user by the alias token in `Delivered-To` -> parses -> writes that user's Order.

**Why this wins for a 6-day build:**

- **Zero Google Cloud work.** Removes the whole verification/cap/CASA storyline and ~30 minutes of
  Roi's hands-on setup.
- **Real push, not polling.** This is *better* backend depth than the sync-on-open model, and it
  fixes the background-sync hole outright: the automation is server-side, so updates land while the
  user's browser is closed.
- **Provider-agnostic.** Outlook, Yahoo, corporate mail: anything that can forward.
- **Judge-friendly.** A judge forwards one order email and watches the card appear live. No OAuth
  consent, no test-user list, no warning screen.

**Day-1 verifications (do not assume):**

1. That `Delivered-To` (or `X-Forwarded-To`) actually carries the plus-alias on both manually
   forwarded and filter-forwarded mail. This is the routing key; test it before building on it.
2. Gmail auto-forwarding to an external address requires a confirmation code sent to the
   destination. Since we own that inbox and can read it through the connector, we can surface the
   code (or auto-confirm) in onboarding. Nice demoable backend work, but budget for it. Manual
   forwarding needs none of this and is enough for the demo.
3. Automation credit cost per run, and whether `mailbox` fires often enough to be noisy.

### Decision

**Primary: shared Gmail inbox + per-user plus-aliases + connector automation (push).** Zero Google
Cloud, works for any provider, real server-side ingest.

**Optional upgrade if days 5-6 are ahead of schedule: "Connect your Gmail" via the app-user
connector** (BYO OAuth client, published in production, unverified). Better UX since it needs no
forwarding setup, at the cost of the warning screen and a 100-user ceiling. Not required for the
competition; a strong roadmap paragraph either way.

---

## 3. Surface decision

**Web app (responsive) + WhatsApp agent companion. Submit as surface type "Web app".**

- The product IS a visual dashboard: images, progress bars, timelines. That needs screen real
  estate; a bot-only surface would throw away the best part.
- The **WhatsApp agent** is the creativity differentiator, and it is platform-native (verified):
  Base44 in-app agents connect to WhatsApp, free on all plans, each agent gets its own WhatsApp
  number, and a WhatsApp-connected agent can do everything the in-app agent can: read entities,
  trigger backend functions. Users must log in to the app first (so the agent knows whose data to
  read) and must send the first message (anti-spam), so WhatsApp is a **reactive Q&A surface**
  ("where's my dog food?"), not a proactive push channel. Proactive notifications go via email
  digest + in-app realtime instead. Limit: 3 WhatsApp-connected agents across ALL your apps; check
  how many you already use.
- `base44.agents.getWhatsAppConnectURL('itrack_assistant')` gives the connect link for a button in
  the app; `whatsapp_greeting` in the agent config sets the welcome message.
- Chrome extension: rejected above. Mobile native: rejected for the window; the responsive web app
  plus WhatsApp covers phones.

---

## 4. Feature map

### MVP (build these, in this order of importance)

| # | Feature | What it is | Rubric axis it feeds |
|---|---|---|---|
| 1 | **AI ingestion pipeline** | Gmail messages -> classify (order-related?) -> extract structured JSON (merchant, order number, items+images, amounts, promised date, carrier, tracking number, event type) -> merge into existing orders. Idempotent by Gmail message id. Confidence scores; low-confidence lands in an "unparsed" queue with a badge, not silently dropped. | Backend depth (the centerpiece) |
| 2 | **Order model + status state machine** | Many emails = one order. Merge by (merchant, order number), fall back to tracking number, last resort LLM "same order?" check. Status is monotonic: ordered -> shipped -> in_transit -> out_for_delivery -> delivered (delayed/cancelled/returned as branches). A late "shipped" email must never regress a delivered order. | Backend depth |
| 3 | **Dashboard** | Card per order: product image, merchant logo, status chip, **progress bar from order date toward promised date with a "today" marker**, countdown ("arrives in 3 days" / "2 days overdue" in red). Filters: In transit, Arriving soon, Overdue, Delivered. Stats row: active, arriving this week, overdue, refund $ found. | Frontend creativity, polish |
| 4 | **Order timeline** | Detail view: every TrackingEvent in order, each with its source email snippet ("what the seller/carrier told you and when"), communications in one place. | Usefulness, polish |
| 5 | **Refund radar** | Daily cron scans for orders past their promised date and not delivered -> matches against a seeded RefundPolicy table (Temu on-time-delivery credit, AliExpress buyer protection window, Amazon guaranteed-delivery refunds, Shein late credits, PayPal 180-day, generic chargeback window) -> creates a RefundOpportunity with a deadline countdown and an **AI-drafted claim message** (one-click copy). "You may be owed $23; 12 days left to claim." | Usefulness (the killer), backend depth |
| 6 | **Realtime dashboard** | `entities.subscribe()` on Order + TrackingEvent: cards appear/update live during sync with a toast ("Your Revolve order just shipped"). The backfill demo moment: connect Gmail on an empty dashboard and watch cards stream in one by one. | Backend depth, demo wow |
| 7 | **WhatsApp assistant** | Agent with read tools on Order/Shipment/RefundOpportunity and function tools (syncNow, draftRefundClaim). "Where's my dog food?" from your phone. | Frontend creativity/surface, AI |
| 8 | **Onboarding: your iTrack address** | Issue the user's plus-alias, show copy-paste forwarding setup (with the auto-read confirmation-code assist), plus a "forward one email to try it" fast path. Optional later: one-click Connect Gmail + 90-day backfill. Drives feature 6's demo. | Backend depth |
| 9 | **Notifications** | In-app activity feed (realtime) + optional daily digest email via `Core.SendEmail` cron: "2 packages arriving today, 1 refund deadline in 3 days." | Usefulness |
| 10 | **Manual add** | Paste a tracking number or an email's text -> same parse pipeline. Works before Gmail is connected; doubles as the judge-friendly no-OAuth path and the empty-state CTA. | Polish, judge access |

Storage checklist box: product images referenced in emails are re-hosted via `UploadFile` (email
image URLs rot and carry tracking params), merchant logos cached the same way. Legitimate use, not a
token one.

### Explicitly cut from MVP (list them in the write-up as roadmap)

- Outlook/other providers (the Outlook connector exists; same architecture, another day of work)
- Carrier-API enrichment (17track/AfterShip): costs an external key; deep links to carrier pages
  instead
- Forwarding-alias ingest (slot reserved, build only if days 5-6 are ahead of schedule)
- Browser extension, price-drop detection, shared household boards, Hebrew merchants UI

---

## 5. Data model (draft v1)

All per-user entities: `rls` create `true`, read/update/delete `{"created_by": "{{user.email}}"}`.

- **Order**: merchant_name, merchant_domain, logo_url, order_number, ordered_at, currency, total,
  status (enum: ordered, shipped, in_transit, out_for_delivery, delivered, delayed, cancelled,
  returned), promised_date, eta_date, items (array of {name, qty, price, image_url}), confidence,
  last_event_at
- **Shipment**: order_id, carrier, tracking_number, tracking_url, eta, status. Separate from Order
  because merchants split orders into multiple shipments (Amazon does constantly); this is also an
  honest relational-modeling signal for judges.
- **TrackingEvent**: order_id, shipment_id, type (enum: confirmation, shipped, in_transit,
  out_for_delivery, delivered, delay, seller_message, refund_update, other), occurred_at, title,
  description, source (gmail, manual, system), email_message_id
- **EmailRecord**: gmail_message_id (the idempotency key: unique-check before parse), thread_id,
  from_address, subject, received_at, classification, parse_status (parsed, low_confidence,
  irrelevant, failed), snippet (CAPPED: store a snippet, never the full body; registered string
  fields cap ~20KB), order_id
- **RefundOpportunity**: order_id, type (late_delivery, buyer_protection, chargeback_window),
  policy_merchant, amount_estimate, deadline, status (detected, notified, dismissed, claimed,
  recovered), draft_message
- **RefundPolicy** (global, seeded): merchant, rule_type, description, window_days, claim_url.
  RLS: read `true`, write admin only.
- **UserSettings**: digest_enabled, digest_hour_utc, whatsapp_connected

FLS candidate: `EmailRecord.snippet` readable only by owner (already covered by RLS, but an explicit
FLS example on something like `Order.total` vs a future "share with household" reader role can wait).

---

## 6. Functions (draft v1)

| Function | Trigger | Does |
|---|---|---|
| `inbox/onNewMail` | **Connector automation** (`gmail` / `mailbox`, condition `has_new_messages == true`) | The main ingest. Service role: `getConnection("gmail")` -> fetch new message ids -> for each, read `Delivered-To` to resolve the plus-alias to a User -> hand to the parse pipeline. Idempotent by Gmail message id; unroutable mail goes to a quarantine queue, never another user's account. |
| `inbox/sweep` | **Cron automation, every 15 min** | Safety net for missed webhooks: list messages newer than the last processed id, run any not already in EmailRecord. Makes ingest self-healing rather than webhook-dependent. |
| `inbox/confirmForwarding` | Frontend (onboarding) | Reads the Gmail forwarding confirmation code that Google mails to our inbox and returns it (or auto-visits the confirm link) so the user can finish setting up auto-forwarding. |
| `gmail/connectSync` | Frontend (optional upgrade path) | Only if the app-user connector ships: `getCurrentAppUserConnection` + incremental search + 90-day backfill, batched under the 5-minute cap. |
| `email/parse` | Internal (imported by sync) | The heart: classify -> extract (LLM with `response_json_schema`) -> merge state machine -> upsert Order/Shipment/TrackingEvent/EmailRecord. Lives in `base44/shared/` modules; unit-testable pure functions for merge logic. |
| `refunds/scan` | **Cron automation, daily** | Service role: all users' overdue orders -> policy match -> create RefundOpportunity + drafted claim (LLM). |
| `digest/send` | **Cron automation, daily** | Service role: per opted-in user, compose "arriving today / overdue / deadlines" digest -> `Core.SendEmail`. |
| `refunds/draftClaim` | Agent tool + UI button | (Re)draft the claim message for one opportunity. |
| `account/wipe` | UI (settings) | Delete all my rows (the privacy story; one paragraph in the README). |
| `ingest/forward` | Public HTTP webhook (stretch) | Inbound-parse endpoint for the forwarding alias; anonymous-safe, idempotent, routes by alias. |

Automations: one connector automation (new mail) + three crons (inbox sweep, refund scan, digest).
That is three of Base44's four automation types in one app, which is a strong depth signal on its own.

AI: `InvokeLLM` with `response_json_schema` for extraction and claim drafting. If it fights us, the
AI gateway (OpenAI-compatible) is the fallback with a proper schema-validated loop.

---

## 7. Why this can win (rubric map)

- **Backend depth 40**: webhook-driven email ingest via a connector automation, alias-based tenant
  routing with a quarantine path, schema-validated AI extraction, a real merge/state machine with
  idempotency and monotonic statuses, three of the four automation types, a self-healing sweep, an
  agent with entity+function tools, realtime subscriptions, file re-hosting, RLS everywhere, honest
  privacy wipe. Every checklist box ticked for a reason a judge can find in the repo.
- **Frontend creativity 25**: the progress-to-ETA card wall is visual and personal; WhatsApp as a
  second surface is something few entries will have, and it's platform-native.
- **Usefulness 20**: everyone with an inbox has this problem; refund radar turns the app from "nice
  dashboard" into "found me money."
- **Polish 10**: the demo account (below) means a judge sees a full, live dashboard in 10 seconds
  without connecting anything.
- **Docs 5**: architecture README with a diagram, honest production-path section, FEEDBACK.md.

### Judge access plan (decide day 1, execute day 5)

Judges must not need Google OAuth to evaluate. Provide in "access instructions": a demo iTrack login
(test credentials field exists on the form) whose Gmail (a dedicated demo account you create,
pre-added as an OAuth test user) is already connected and seeded with real order emails
(Amazon/Temu/Revolve/AliExpress/dog food vendor). The video shows the live connect + backfill
moment. Optional: the manual-add path lets a judge paste an order email and watch it parse live.

---

## 8. Risk register / day-1 verifications

1. **Alias routing** (the load-bearing assumption): confirm `Delivered-To` carries the plus-alias
   for BOTH a manual forward and a Gmail-filter auto-forward. If it does not, fall back to
   `X-Forwarded-To`, then to matching the forwarder's address in `From`. Test with a real message
   before building the pipeline on top. **No routing key = no multi-user product**, so this is the
   first thing to check on day 1.
2. **Plan gate**: connectors need Builder+; confirm your workspace plan before anything.
3. **Shared-connector authorization**: `connectors push` opens a browser to authorize the iTrack
   Gmail account. Roi needs to create that Gmail account and click through once. I cannot create
   Google accounts; budget 10 minutes of your hands (down from 30 in the old plan).
4. **Scope narrowing**: request `gmail.readonly` only in `gmail.jsonc` if the connector permits it.
   Read-only is both a better trust story and a smaller blast radius for a shared inbox.
5. **WhatsApp agent slots**: 3 across all your apps. Check current usage in the dashboard.
6. **Agent data isolation**: verify with a second account that the WhatsApp/in-app agent only sees
   the logged-in user's rows through its entity tools.
7. **LLM input size**: emails are bloated HTML; strip to text before the LLM, store only snippets
   (20KB string cap), keep full bodies transient.
8. **Backfill vs 5-minute function cap**: batch any bulk scan with a cursor; never one giant run.
9. **Shared-inbox blast radius**: one inbox holds every user's forwarded mail, so a routing bug
   leaks data across tenants. Non-negotiables: route only on an exact alias-token match, quarantine
   anything unresolved, and never fall back to "assign to the most recent user". Write the
   second-account leak test on day 1, not day 5.
10. **Automation noise and credits**: `mailbox` fires on any mailbox change (label edits, read
    status), so the `has_new_messages` trigger condition is required, not optional. Watch the
    integration-credit burn during backfill testing.

---

## 9. Build order (revised for concept, overrides the generic plan in the reference doc)

| Day | Focus |
|---|---|
| **Jul 23 (Wed)** | Roi: enroll + create the iTrack Gmail account + confirm plan (~10 min). Me: `base44 create`, all entity schemas + RLS, `entities push`, `connectors push` (authorize Gmail), **risk check #1 (alias routing) first**, then #5, start FEEDBACK.md. |
| **Jul 24 (Thu)** | Ingestion: `inbox/onNewMail` connector automation + `inbox/sweep` + the parse/merge pipeline in `base44/shared/`. Verified by forwarding real order mail. Seed RefundPolicy. |
| **Jul 25 (Fri)** | Dashboard + timeline UI over real parsed data, realtime subscribe, manual add. |
| **Jul 26 (Sat)** | Refund radar (cron + UI), digest cron, WhatsApp agent + connect button, demo Gmail seeding. |
| **Jul 27 (Sun)** | Polish: empty states, error paths, second-account RLS check, narrow viewport, deploy, README + write-up draft. |
| **Jul 28 (Mon)** | Demo video (2-3 min: connect -> cards stream in -> overdue card shows refund claim -> WhatsApp answer), final deploy, repo public, **submit**, paste FEEDBACK.md. |

Buffer is gone (the concept day cost it), so day 4's WhatsApp agent is the first thing to simplify
if behind: the agent works in-app even without the WhatsApp channel connected.

---

## 10. Open questions for Roi

1. **Demo merchants**: video/demo data reads best international (Amazon, Temu, Revolve, AliExpress,
   a local pet-food shop). Any merchant you specifically want shown (the dog food vendor makes it
   feel real)?
2. **Demo Gmail account**: you'll need to create one (I can't create accounts). Name idea:
   `itrack.demo@gmail.com` or similar.
3. **Name check**: "iTrack" collides with Apple-adjacent naming and several existing trackers; fine
   for the competition, but if you want a rename (e.g. "Parcelly", "Inboxed", "WaitFor"), day 1 is
   the last cheap moment. Default: keep iTrack.
4. **NPS honesty**: the feedback form defaults NPS to 7; we'll set it to whatever you actually feel
   at the end.
