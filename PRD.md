# iTrack: Product Requirements Document

| | |
|---|---|
| Version | 1.5 (2026-07-27); amendments v1.1-v1.5 follow the overview below |
| Status | Approved for build |
| Product | iTrack: a personal delivery command center |
| Platform | Base44 developer platform (CLI), Vite + React frontend, Deno backend functions |
| Execution plan | [BUILD_PLAN.md](BUILD_PLAN.md) (stages, DoD, progress tracking) |
| Rationale/history | [ITRACK_CONCEPT.md](ITRACK_CONCEPT.md), [BASE44_BUILDOFF_REFERENCE.md](BASE44_BUILDOFF_REFERENCE.md) |

This document is the source of truth for requirements. When it conflicts with the concept doc, this
document wins.

> **AMENDMENT v1.1 (2026-07-23, Roi's decision): per-user Gmail OAuth replaces the shared-inbox
> forwarding model.** Roi rejected the dedicated-app-Gmail-account approach: each user connects
> their OWN Gmail via a Base44 app-user connector (read-only scope). Consequences: section 3.1's
> forwarding/alias/quarantine design is RETIRED (no shared inbox, no alias tokens, no
> `inbox/onNewMail` webhook, no sweep cron, no quarantine screen); ingest is `inbox/syncMyMail`,
> which runs the same parse pipeline over the signed-in user's own mailbox on app load, on demand,
> and on an interval while the app is open (app-user tokens are request-scoped, so there is NO
> background sync when the user is away; this is the accepted trade-off). First sync imports the
> last 60 days. F8's "personal address" onboarding becomes "Connect your Gmail". Setup requires a
> Google OAuth app (Client ID/Secret registered in Base44 Workspace Settings); with the consent
> screen in Testing mode only allowlisted test users can connect, so the judge path is the demo
> account + manual add (F9), unchanged. Idempotency key is now (owner_email, gmail_message_id).
> Everything else (data model minus SyncState/alias fields, merge engine, refund radar, digest,
> agent, realtime, manual add) stands as written.

> **AMENDMENT v1.2 (2026-07-23, Roi's decision): manual add is the competition ingest path;
> per-user Gmail auto-sync ships gated-off.** The per-user Gmail OAuth from v1.1 is fully built and
> tested (`inbox/syncMyMail`, the Base44 app-user Gmail connector, the `GMAIL_CONNECTOR_ID` secret,
> the Google OAuth client) but cannot complete: Base44's app-user connector hardcodes its OAuth
> callback to the public-suffix apex `https://base44.app/api/external-auth/callback`, which no
> Google OAuth client can register (a custom domain, itrack.inboxfiles.com, was set up and did not
> change it). Confirmed a Base44 platform bug and reported (FEEDBACK.md). Consequence: the
> `GMAIL_CONNECT_ENABLED` flag in `src/lib/config.js` is `false`; onboarding leads with manual add
> (F9), which drives the identical parse/merge pipeline, and the Gmail card shows "coming soon".
> Judges evaluate via the demo account + manual add (already the planned judge path, section 13).
> Flip the flag to enable Gmail sync when Base44 fixes the connector redirect. All F1-F6/F8-F10
> functionality is unaffected; only the automatic Gmail *trigger* is deferred.

> **AMENDMENT v1.3 (2026-07-23, later same day): per-user Gmail auto-sync is LIVE; v1.2 reversed.**
> The v1.2 blocker was misdiagnosed. The connect redirect_uri is not hardcoded: Base44's
> connect-initiate endpoint mirrors the *request host* into the OAuth callback, and the SDK client
> defaults its `serverUrl` to the `base44.app` apex, so `connectAppUser` minted an unregisterable
> callback. Fixed app-side (`src/api/auth.jsx` now calls initiate on `window.location.origin`, whose
> slug callback is registered); no Base44 change was needed. `GMAIL_CONNECT_ENABLED = true`. Each
> user connects their OWN Gmail (readonly `gmail.readonly`); `inbox/syncMyMail` reads that user's
> mailbox request-scoped. Verified end-to-end on the live app (Roi's account: 48 orders imported,
> idempotent re-sync). Manual add (F9) remains available as an equal path. Root cause + Base44 asks
> in FEEDBACK.md. (Open Stage-3 quality item, not a connector issue: the merge engine produces
> ~9 duplicate Order rows and splits orders when the LLM extracts inconsistent merchant names;
> dedup fix tracked separately.)

> **AMENDMENT v1.4 (2026-07-26, Roi's decision): only physical parcels become cards; relevance
> gates in code, not in the prompt.** Live data showed InvokeLLM ignores prose exclusion lists
> whenever an email looks like an order receipt (Wolt food, Atlassian/Namecheap SaaS, an Israir
> flight all kept at 0.9+ confidence), so the section-8 extraction schema gains a REQUIRED
> `product_kind` enum (`physical_goods` / `food_or_grocery_delivery` / `digital_or_saas` /
> `service_or_booking` / `other`) and the pipeline enforces policy on it: cards only for
> `physical_goods`; `other`/missing kinds survive only with a tracking number or carrier (terse
> carrier notices name no product); a named exclusion kind is never overridden by evidence.
> Additionally `seller_message` / `refund_update` / `other_order_related` emails may only attach
> to an existing order, never create one (recorded `unroutable` otherwise). Product rulings:
> restaurant AND supermarket/grocery orders are out (per-ruling: Wolt removed from the sync
> sender query); store-pickup orders are in (physical goods awaiting collection). Verified on the
> live app via full wipe + 60-day resync: 10 cards, all parcels; 14 drops, all correct.

> **AMENDMENT v1.5 (2026-07-27): section 9 config drift, and the isolation gate is CLOSED.** Three
> corrections to the section-9 listing, all forced by the platform rather than chosen: (a) the CLI
> 0.1.5 agent schema accepts no `model` field, so model selection is the dashboard's "Automatic"
> and the pinned `anthropic/claude-sonnet-4` line is gone; (b) a `memory_config` block was added
> with `scope: "user"` and `include_other_conversation_context: false`, since agent memory is
> otherwise a second, non-obvious way for one user's data to reach another; (c) the instructions
> grew an explicit "always query the tools before answering" preamble and a DD/MM/YYYY date rule,
> because the terser v1.0 wording let the agent answer from conversation context alone.
> **F7 AC2 is closed as a PASS:** agent entity tools DO inherit RLS, verified from a non-admin
> second account, so the function-tools-only fallback was never needed and the four entity tools
> stay. The WhatsApp paragraph below is also wrong about the enable step: there is no dashboard
> toggle and no cap was ever surfaced (see FEEDBACK.md 2026-07-27); the channel is live for the
> agent already, and the only app-side work is the `WHATSAPP_ENABLED` flag guarding the in-app
> affordances so they cannot dead-end.

---

## 1. Overview

**iTrack** turns a messy inbox full of order confirmations, shipping notices, and delivery updates
into one live dashboard. A user gets a personal iTrack email address, forwards order mail to it (or
sets a one-time Gmail filter), and every purchase becomes a card: what they bought with its image,
where it is now, a progress bar toward the promised date, the full communication timeline, and,
when a package runs late, whether they are owed money and a ready-to-send claim. A WhatsApp
assistant answers "where's my order?" from their phone.

**One-line pitch:** "Forward your order emails once. See every package you're waiting for, live,
and get paid when they're late."

### Competition context

Built for the Base44 Dev Build-Off (window: July 21-28, 2026; submission target July 28). Judged
100 points: backend depth 40, frontend creativity 25, usefulness 20, polish 10, documentation 5.

**Backend features checklist mapping** (verified against the repo by judges):

| Checklist item | Where it is used in iTrack |
|---|---|
| Authentication & user management | Built-in Base44 auth (email/password + Google), per-user data isolation |
| Database / entities | 8 entities with row-level + field-level security |
| Backend functions (Deno) | 9 functions: ingest webhook, crons, mutations (all writes are functions) |
| AI / LLM / agents | Email classification + extraction with JSON schema, claim drafting, WhatsApp agent with tools |
| Real-time subscriptions | Dashboard live-updates on Order/TrackingEvent changes, toasts |
| File & media storage | Product images and merchant logos re-hosted via UploadFile |

---

## 2. Users and jobs

**Primary: the individual online shopper.** Orders from several merchants in parallel (Amazon,
Temu, Revolve, AliExpress, a local pet-food vendor). Job: "I have N packages in flight; tell me
where everything is, when it lands, and whether anyone owes me money, without me digging through
email."

**Secondary: the competition judge.** Job: evaluate the app in minutes with zero setup friction.
Served by a pre-seeded demo account and a no-OAuth manual-add path (section 13).

Single-tenant per user: a user sees only their own orders. Enforced by RLS (section 11), not by UI.

---

## 3. System architecture

```mermaid
flowchart LR
  U[User's mailbox\nGmail / Outlook / any] -- "forward to\nitrack...+token@gmail.com" --> G[(Shared iTrack\nGmail inbox)]
  G -- "connector automation\n(gmail / mailbox, has_new_messages)" --> F1[inbox/onNewMail]
  G -- "cron sweep every 15 min" --> F2[inbox/sweep]
  F1 --> P[shared parse pipeline\nclassify -> extract -> merge]
  F2 --> P
  P -- asServiceRole writes --> DB[(Entities:\nOrder, Shipment, TrackingEvent,\nEmailRecord, RefundOpportunity)]
  DB -- realtime subscribe --> W[Web app\nVite + React]
  A[itrack_assistant agent\n(in-app + WhatsApp)] -- entity tools --> DB
  C1[refunds/scan cron] --> DB
  C2[digest/send cron] --> E[Email digest]
```

### 3.1 Ingest: shared inbox + per-user plus-aliases

- iTrack owns **one** Gmail account (created by Roi, e.g. `itrackapp@gmail.com`), connected as a
  Base44 **shared connector** (`base44/connectors/gmail.jsonc`, authorized once under Base44's own
  OAuth app: no Google Cloud project, no verification, no user cap).
- Each user gets a unique alias on signup: `itrackapp+<token>@gmail.com`, where `<token>` is 8
  lowercase alphanumerics stored in `UserSettings.alias_token`. The alias IS the routing key.
- New mail fires a **connector automation**: `integration_type: "gmail"`, `events: ["mailbox"]`,
  trigger condition `{ "field": "has_new_messages", "operator": "equals", "value": true }`.
- `inbox/onNewMail` fetches the new message(s) via the connector token, resolves the alias from the
  `Delivered-To` header (fallback chain: `X-Forwarded-To`, then envelope `To`), and hands off to
  the parse pipeline.
- `inbox/sweep` (cron, every 15 minutes) re-lists messages newer than the `SyncState` cursor and
  processes any the webhook missed. Ingest is therefore self-healing, never webhook-dependent.

**Routing invariants (non-negotiable):**
1. Route ONLY on an exact alias-token match against an existing `UserSettings.alias_token`.
2. Anything unresolved becomes an `EmailRecord` with `parse_status: "unroutable"` (quarantine),
   visible to admin only. Never assign to a "closest" or "most recent" user.
3. Idempotency: the Gmail `message_id` is checked against `EmailRecord` before any processing;
   duplicates are skipped silently.

**Forwarding onboarding:** manual forwarding needs nothing. Gmail auto-forwarding (a filter) makes
Google send a confirmation code to the destination inbox; since iTrack owns that inbox,
`inbox/confirmForwarding` finds that code/link for the requesting user's alias and surfaces it in
onboarding, so the user completes filter setup without leaving the app.

**Explicit non-goal (roadmap only):** per-user Gmail OAuth (Base44 app-user connectors). It
requires a BYO Google OAuth app, carries Google's restricted-scope verification burden (CASA) or a
100-user unverified cap, and has no per-user webhook. The forwarding model avoids all of it and is
provider-agnostic. See ITRACK_CONCEPT.md section 2 for the full analysis.

### 3.2 Write path: functions only

The frontend SDK is **read-only + invoke + subscribe**. Every entity write goes through a backend
function using `asServiceRole`, which stamps `owner_email` server-side. Rationale: ingested rows
are created by service-role functions where `created_by` is not the end user, so ownership must be
an explicit field; making ALL writes go through functions gives one consistent, server-validated
mutation path (and a stronger backend-depth story). RLS details in section 11.

---

## 4. Feature specifications

Each feature lists acceptance criteria (AC). A feature is done when every AC passes on the deployed
app.

### F1. AI ingestion pipeline (backend centerpiece)

Forwarded emails become structured data with no user action.

- Pipeline per message: strip HTML to text -> classify (order-related? which kind?) -> extract
  structured fields via `InvokeLLM` with `response_json_schema` (section 8) -> merge into entities
  (F2) -> record an `EmailRecord` with `parse_status` and `confidence`.
- Low-confidence extractions (confidence < 0.6) create the `EmailRecord` with
  `parse_status: "low_confidence"` and still create/update the Order, flagged in the UI with a
  "check this" badge. Irrelevant mail is recorded as `irrelevant` (so re-forwards stay idempotent)
  and creates nothing else.
- Product images found in the email are re-hosted via `UploadFile`; the entity stores the Base44
  URL, never the merchant's CDN URL.

**AC:**
1. Forwarding a real order-confirmation email produces an Order with merchant, order number,
   items (with at least one image when the email has one), total, and promised/ETA date when present.
2. Forwarding the matching shipping-notice email updates the SAME Order (no duplicate) and adds a
   TrackingEvent with carrier + tracking number.
3. Re-forwarding any already-processed email changes nothing (zero new rows).
4. A newsletter forwarded to the alias yields one `irrelevant` EmailRecord and no Order.
5. Every EmailRecord stores a snippet of at most 2,000 characters, never the full body.

### F2. Order state machine and merging

- Merge keys, in order: (merchant_domain + order_number) -> tracking_number -> LLM "same order?"
  arbitration for ambiguous pairs -> otherwise create new.
- One Order has 1..N Shipments (split orders); each shipment carries its own carrier, tracking
  number, and status.
- Order status is **monotonic** along: ordered(0) -> shipped(1) -> in_transit(2) ->
  out_for_delivery(3) -> delivered(4). Branch statuses: `delayed` (annotates, does not advance),
  `cancelled`, `returned` (terminal, allowed from any state). A late-arriving lower-rank email
  never regresses status; it still appends its TrackingEvent to the timeline.
- Order status = max(shipment statuses) for multi-shipment orders, computed at write time by the
  merge engine (single writer, so no drift).

**AC:**
1. Confirmation + shipped + delivered emails for one order, forwarded in ANY arrival order, end
   with status `delivered` and a 3-event timeline in correct chronological order.
2. An Amazon-style split (two shipping notices, different tracking numbers, one order number)
   yields one Order with two Shipments.
3. Status never moves backward in any test sequence.

### F3. Dashboard

- Card grid of active orders. Each card: product image (first item), merchant name + logo, status
  chip, **progress bar from `ordered_at` to `promised_date` with a today marker**, countdown text
  ("arrives in 3 days"), items summary, total.
- Overdue orders: red border accent, countdown becomes "X days overdue", refund badge when an open
  RefundOpportunity exists.
- Filters (tabs): All, In transit, Arriving soon (<= 3 days), Overdue, Delivered. Default: All
  active (non-delivered, non-archived).
- Stats row: Active packages, Arriving this week, Overdue, Refunds found ($ sum of open
  opportunities).
- Sort: soonest ETA first; delivered section collapsed at the bottom.

**AC:**
1. A judge who has never seen the app can tell what is arriving next within 10 seconds of login.
2. Cards without a promised date show a neutral bar ("no ETA yet") rather than a broken one.
3. Narrow viewport (375px): cards stack, nothing overflows horizontally.

### F4. Order timeline (detail view)

- Click a card -> detail: full item list with images, shipment blocks (carrier, tracking number
  with copy button + deep link to the carrier's tracking page), the complete TrackingEvent
  timeline, each event showing its source email snippet, and the refund panel (F5) when relevant.
- Manual controls: archive, mark delivered (calls a function; keeps state machine authority
  server-side).

**AC:**
1. Every event on the timeline shows a human date, a title, and its source snippet.
2. Tracking-number copy button works; carrier link opens the right carrier page for at least UPS,
   USPS, DHL, FedEx, Israel Post, and a generic AfterShip-style fallback URL otherwise.
3. "Mark delivered" moves the card to Delivered and appends a manual TrackingEvent.

### F5. Refund radar (usefulness centerpiece)

- `refunds/scan` (daily cron, also runnable on demand) finds orders where
  `today > promised_date` and status is not delivered/cancelled/returned, matches them against
  `RefundPolicy` (seeded: Temu on-time-delivery credit, AliExpress buyer protection, Amazon
  guaranteed delivery, Shein late credit, PayPal 180-day window, generic credit-card chargeback
  window), and creates one `RefundOpportunity` per order+policy with a deadline and an AI-drafted
  claim message.
- UI: refund badge on cards, a Refunds screen listing open opportunities with deadline countdowns,
  claim text with one-click copy, claim-page link, and Dismiss / Mark claimed / Mark recovered
  actions.
- Re-running the scan never duplicates an existing opportunity for the same order+policy.

**AC:**
1. Forcing an order overdue (test fixture) and running the scan creates exactly one opportunity
   with a drafted, merchant-specific claim message mentioning the order number.
2. Running the scan twice creates no duplicates.
3. Dismissed opportunities never resurface for the same order+policy.
4. The dashboard stats row reflects the sum of open opportunities.

### F6. Realtime

- The dashboard and detail views subscribe to Order and TrackingEvent changes; new/updated cards
  appear without refresh, with a toast ("Your Revolve order just shipped").
- The onboarding "watch it work" moment: forward an email, see the card appear live.

**AC:**
1. Two-window test: forwarding an email (or running manual add in window A) updates window B
   without refresh in under 10 seconds.
2. RLS holds over realtime: user B's session receives no events for user A's rows (verified with
   two accounts).

### F7. WhatsApp + in-app assistant

- Agent `itrack_assistant` (section 9): answers "where is my dog food?", lists arriving-soon
  packages, reports refund opportunities, triggers manual add. In-app chat button; WhatsApp connect
  via `base44.agents.getWhatsAppConnectURL('itrack_assistant')`.
- Reactive only (user messages first): proactive pushes stay in email digest + in-app feed.

**AC:**
1. "Where's my [item keyword]?" returns the right order's status and ETA for the signed-in user.
2. A second account asking the same question gets ONLY its own orders (agent-level isolation test).
3. The WhatsApp round-trip works end to end on a real phone for the demo account.

### F8. Onboarding: your iTrack address

- First login triggers `account/bootstrap`: creates UserSettings with a fresh `alias_token` and
  returns the personal address. Screen shows: the address with copy button, "try it now" (forward
  any order email, watch the dashboard), and optional Gmail auto-forward setup with the
  `inbox/confirmForwarding` assist (fetches Google's confirmation code for the user's alias).
- Empty dashboard state repeats the address + a "paste an email instead" (F9) shortcut.

**AC:**
1. A fresh account sees its unique address within 2 seconds of first login.
2. Two accounts never receive the same alias (uniqueness check server-side).
3. The forwarding-confirmation assist surfaces the code for a filter created during the demo.

### F9. Manual add

- `orders/manualAdd` accepts either pasted email text (runs the same parse pipeline) or a bare
  tracking number + merchant (creates a minimal Order+Shipment).
- Serves three roles: judge path with zero email setup, empty-state CTA, and fallback for
  non-forwardable purchases.

**AC:**
1. Pasting a real order email's text produces the same Order the forwarded version would.
2. Adding a bare tracking number yields a card with carrier detected from the number format when
   possible.
3. Both paths appear live via realtime (F6) with no refresh.

### F10. Notifications

- In-app activity feed: latest TrackingEvents + refund detections, newest first (reads the same
  entities; no separate notification entity in MVP).
- Daily email digest (`digest/send` cron, per user, opt-in via Settings, default on at 07:00 UTC):
  arriving today, newly overdue, refund deadlines within 3 days. Sent via `Core.SendEmail`. Skipped
  when there is nothing to say.

**AC:**
1. The demo account receives a digest listing exactly its arriving/overdue items.
2. Turning the digest off in Settings stops it (next cron run skips the user).
3. A user with no active orders gets no email.

---

## 5. Data model

8 custom entities. Naming: PascalCase entity files (`Order.jsonc` -> `base44.entities.Order`).
Every record automatically carries `id`, `created_date`, `updated_date`, `created_by`; we never
define those. All per-user entities carry an explicit `owner_email` (see section 3.2).

### 5.1 Order (full JSONC, the reference pattern)

```jsonc
{
  "name": "Order",
  "type": "object",
  "title": "Order",
  "description": "A purchase aggregated from one or more emails",
  "properties": {
    "owner_email":     { "type": "string", "format": "email", "description": "App user who owns this order" },
    "merchant_name":   { "type": "string", "minLength": 1 },
    "merchant_domain": { "type": "string", "description": "e.g. amazon.com; merge key part" },
    "logo_url":        { "type": "string", "description": "Re-hosted merchant logo" },
    "order_number":    { "type": "string", "description": "Merchant order id; merge key part" },
    "ordered_at":      { "type": "string", "format": "date-time" },
    "currency":        { "type": "string", "default": "USD" },
    "total":           { "type": "number" },
    "status": {
      "type": "string",
      "enum": ["ordered", "shipped", "in_transit", "out_for_delivery", "delivered", "delayed", "cancelled", "returned"],
      "default": "ordered",
      "description": "Monotonic rank 0-4; delayed annotates; cancelled/returned terminal"
    },
    "promised_date":   { "type": "string", "format": "date", "description": "Merchant-promised delivery date" },
    "eta_date":        { "type": "string", "format": "date", "description": "Latest carrier/merchant ETA" },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name":      { "type": "string" },
          "qty":       { "type": "integer", "default": 1 },
          "price":     { "type": "number" },
          "image_url": { "type": "string", "description": "Re-hosted via UploadFile" }
        }
      }
    },
    "confidence":     { "type": "number", "description": "0-1 from extraction; <0.6 shows a badge" },
    "last_event_at":  { "type": "string", "format": "date-time" },
    "is_archived":    { "type": "boolean", "default": false }
  },
  "required": ["owner_email", "merchant_name", "status"],
  "rls": {
    "create": { "user_condition": { "role": "admin" } },
    "read": {
      "$or": [
        { "data.owner_email": "{{user.email}}" },
        { "user_condition": { "role": "admin" } }
      ]
    },
    "update": { "user_condition": { "role": "admin" } },
    "delete": { "user_condition": { "role": "admin" } }
  }
}
```

Writes are admin/service-role only (functions bypass RLS via `asServiceRole`; admin condition also
keeps dashboard data tools usable). Reads: owner or admin. **This exact RLS block is the template
for every per-user entity below.**

### 5.2 EmailRecord (full JSONC: the idempotency + quarantine anchor)

```jsonc
{
  "name": "EmailRecord",
  "type": "object",
  "title": "Email Record",
  "description": "One processed inbound email; idempotency key and audit trail",
  "properties": {
    "owner_email":      { "type": "string", "format": "email", "description": "Empty when unroutable" },
    "gmail_message_id": { "type": "string", "minLength": 1, "description": "IDEMPOTENCY KEY: skip if already recorded" },
    "thread_id":        { "type": "string" },
    "from_address":     { "type": "string" },
    "subject":          { "type": "string", "maxLength": 500 },
    "received_at":      { "type": "string", "format": "date-time" },
    "alias_token":      { "type": "string", "description": "Token extracted from Delivered-To, if any" },
    "classification":   { "type": "string", "enum": ["order_confirmation", "shipping_update", "delivery", "delay", "seller_message", "refund_update", "other_order_related", "irrelevant"] },
    "parse_status":     { "type": "string", "enum": ["pending", "parsed", "low_confidence", "irrelevant", "unroutable", "failed"], "default": "pending" },
    "confidence":       { "type": "number" },
    "snippet":          { "type": "string", "maxLength": 2000, "description": "Plain-text excerpt; NEVER the full body" },
    "order_id":         { "type": "string", "description": "Order this email merged into, if any" },
    "error":            { "type": "string", "description": "Set when parse_status=failed" }
  },
  "required": ["gmail_message_id", "parse_status"],
  "rls": {
    "create": { "user_condition": { "role": "admin" } },
    "read": {
      "$or": [
        { "data.owner_email": "{{user.email}}" },
        { "user_condition": { "role": "admin" } }
      ]
    },
    "update": { "user_condition": { "role": "admin" } },
    "delete": { "user_condition": { "role": "admin" } }
  }
}
```

Unroutable/quarantined records have no `owner_email`, so only admin ever reads them.

### 5.3 Remaining entities (field tables; JSONC follows the Order pattern)

**Shipment** (per-user; RLS = Order pattern)

| Field | Type | Notes |
|---|---|---|
| owner_email | string (email) | required |
| order_id | string | required; parent Order |
| carrier | string | detected or extracted |
| tracking_number | string | merge key |
| tracking_url | string | deep link, generated |
| eta_date | string (date) | |
| status | enum: same 8 values as Order | shipment-level status |

**TrackingEvent** (per-user; RLS = Order pattern)

| Field | Type | Notes |
|---|---|---|
| owner_email | string (email) | required |
| order_id | string | required |
| shipment_id | string | optional |
| type | enum: order_confirmation, shipment, transit_update, out_for_delivery, delivered, delay, seller_message, refund_update, manual, other | required |
| occurred_at | string (date-time) | required; email date or carrier timestamp |
| title | string | "Shipped via UPS" |
| description | string, maxLength 1000 | |
| source | enum: gmail, manual, system | default gmail |
| email_record_id | string | provenance link |

**RefundOpportunity** (per-user; RLS = Order pattern)

| Field | Type | Notes |
|---|---|---|
| owner_email | string (email) | required |
| order_id | string | required; unique with policy_key per order |
| policy_key | string | required; e.g. "temu_on_time" |
| type | enum: late_delivery, buyer_protection, chargeback_window | |
| amount_estimate | number | may be null (credit-type policies) |
| deadline | string (date) | claim-by date |
| status | enum: detected, notified, dismissed, claimed, recovered | default detected |
| draft_message | string, maxLength 2000 | AI-drafted claim |
| claim_url | string | from policy |

**RefundPolicy** (global reference data)

| Field | Type | Notes |
|---|---|---|
| policy_key | string | required, unique; "temu_on_time" |
| merchant_domain | string | empty = generic policy |
| rule_type | enum: late_delivery, buyer_protection, chargeback_window | |
| description | string | shown in UI |
| window_days | integer | claim window after promised/order date |
| claim_url | string | where to file |

RLS: read `true`, create/update/delete admin only.

**UserSettings** (per-user; one row per user)

| Field | Type | Notes |
|---|---|---|
| owner_email | string (email) | required, unique per user |
| alias_token | string, minLength 8 | required, unique; THE routing key |
| digest_enabled | boolean | default true |
| digest_hour_utc | integer 0-23 | default 7 |
| forwarding_confirmed | boolean | default false |

RLS: read owner-or-admin; writes admin only (mutations via `account/bootstrap` / `settings/update`
function paths).

**SyncState** (global singleton for the sweep cursor)

| Field | Type | Notes |
|---|---|---|
| key | string | "gmail_sweep", unique |
| last_history_id | string | Gmail history cursor |
| last_message_ts | string (date-time) | fallback cursor |
| last_run_at | string (date-time) | monitoring |

RLS: read admin, writes admin. Frontend never touches it.

**User** (built-in): no schema changes needed. `role` (admin/user) built in; Roi = admin.

---

## 6. Backend functions and automations

All functions follow the skeleton: try/catch to a 500 JSON error; `auth.me()` wrapped in its own
try/catch (it throws on anonymous); business failures return
`{ "error": string, "reasons": [{ "code", "message" }] }` with a 4xx status; the frontend maps
`reasons` to toasts. Every function route is anonymously reachable by design of the platform, so
each declares its auth model explicitly below and enforces it in code.

| Function | Trigger | Auth model | Behavior |
|---|---|---|---|
| `inbox/onNewMail` | Connector automation: gmail/mailbox + has_new_messages | Anonymous-tolerant (webhook); acts via service role; ignores request body except automation payload | Fetch new messages via `getConnection("gmail")`, resolve alias, run pipeline per message. Unroutable -> quarantine EmailRecord. Idempotent per message id. |
| `inbox/sweep` | Cron automation, every 15 min | Anonymous-tolerant (cron); fixed args only | List messages newer than SyncState cursor; process any not in EmailRecord; advance cursor. Self-healing net under the webhook. |
| `inbox/confirmForwarding` | Frontend invoke | Authenticated user | Search the shared inbox for Google's forwarding-confirmation mail addressed to the caller's alias; return code/link. Sets `forwarding_confirmed` on success. |
| `account/bootstrap` | Frontend invoke (first load) | Authenticated user | Idempotently create UserSettings with a unique alias_token; return settings. |
| `settings/update` | Frontend invoke | Authenticated user | Update digest prefs for the caller only. |
| `orders/manualAdd` | Frontend invoke + agent tool | Authenticated user | Pasted email text -> parse pipeline as the caller; or tracking number + merchant -> minimal Order+Shipment. |
| `orders/setStatus` | Frontend invoke | Authenticated user (owner check server-side) | Archive / mark delivered; appends a manual TrackingEvent; respects monotonicity. |
| `refunds/scan` | Cron automation, daily 03:00 UTC; also frontend invoke (admin/test) | Anonymous-tolerant (cron) | Find overdue orders across users; match RefundPolicy; upsert RefundOpportunity (unique order_id+policy_key; skip dismissed); draft claim via LLM. |
| `refunds/updateStatus` | Frontend invoke + agent tool | Authenticated user (owner check) | Dismiss / claimed / recovered transitions. |
| `digest/send` | Cron automation, daily (hourly cron checking digest_hour_utc is acceptable simplification: run daily 07:00 UTC in MVP) | Anonymous-tolerant (cron) | Per opted-in user with content: compose digest, `Core.SendEmail`. |
| `account/wipe` | Frontend invoke | Authenticated user | Delete all rows owned by the caller across all per-user entities. |

That is 11 functions (9 in the concept draft plus `settings/update` and `orders/setStatus` split
out for clean auth models): well under the 50-function cap.

**Shared modules** (`base44/shared/`, bundled into every function):
`aliasRouter.ts` (header parsing + token extraction), `htmlToText.ts`, `classify.ts`,
`extract.ts` (LLM call + schema), `mergeEngine.ts` (pure functions: merge keys, monotonic status,
shipment aggregation; unit-testable), `rehost.ts` (image re-hosting), `carriers.ts` (tracking
number pattern -> carrier + deep link), `responses.ts` (error contract helpers).

**Automation configs** (in each function's `function.jsonc`; cron uses `*` wildcards, never `?`;
times UTC):

```jsonc
// inbox/onNewMail/function.jsonc
{
  "name": "inbox/onNewMail",
  "entry": "entry.ts",
  "automations": [{
    "type": "connector",
    "name": "on_new_gmail",
    "description": "New mail in the shared iTrack inbox",
    "is_active": true,
    "integration_type": "gmail",
    "events": ["mailbox"],
    "trigger_conditions": {
      "conditions": [{ "field": "has_new_messages", "operator": "equals", "value": true }]
    }
  }]
}
```

```jsonc
// inbox/sweep/function.jsonc (cron every 15 minutes)
{ "type": "scheduled", "name": "sweep_15m", "is_active": true,
  "schedule_mode": "recurring", "schedule_type": "cron", "cron_expression": "*/15 * * * *" }
// refunds/scan: "0 3 * * *"   digest/send: "0 7 * * *"
```

---

## 7. Connector

`base44/connectors/gmail.jsonc`:

```jsonc
{
  "type": "gmail",
  "scopes": ["https://www.googleapis.com/auth/gmail.readonly"]
}
```

Request read-only if the platform accepts it (least privilege for a shared inbox holding every
user's forwarded mail); if the connector requires its full scope set, accept and note it in
FEEDBACK.md. Authorized once by Roi via `base44 connectors push` with the iTrack Gmail account.

---

## 8. AI specification

**Classification + extraction** (one combined `InvokeLLM` call per email, from backend functions):

- Input: from, subject, plain-text body (truncated to a safe token budget), today's date.
- Output (`response_json_schema`): `{ is_order_related: boolean, classification: enum (section
  5.2 values), merchant_name, merchant_domain, order_number, event_type, items: [{ name, qty,
  price, image_url }], currency, total, promised_date, eta_date, carrier, tracking_number,
  status_suggestion: enum, confidence: number 0-1, notes }`.
- All fields nullable except is_order_related, classification, confidence. Dates ISO. The prompt
  demands: extract only what the email states; no guessing; image URLs only from `<img src>` in
  the original HTML (passed as a candidate list, not raw HTML).

**Same-order arbitration**: when merge keys fail but merchant + date window suggest a match, a
second small `InvokeLLM` call compares the two summaries -> `{ same_order: boolean }`.

**Claim drafting** (`refunds/scan` and `refunds/draftClaim` path): input order summary + policy
description; output a 3-5 sentence polite claim message citing order number, promised date, actual
status, and the policy; no invented amounts.

Fallback if `InvokeLLM` output quality or schema compliance disappoints: the `aiGateway`
(OpenAI-compatible) with the same schemas. Decision recorded in BUILD_PLAN stage 3.

---

## 9. Agent: `itrack_assistant`

`base44/agents/itrack_assistant.jsonc`, pushed with `base44 agents push`:

```jsonc
{
  "name": "itrack_assistant",
  "description": "Answers questions about the user's packages, deliveries, and refunds",
  "instructions": "You are iTrack's delivery assistant. Answer only from the signed-in user's own data via your tools. Be brief and concrete: status, ETA, days left or overdue, refund deadlines. If asked about an item, search order items by keyword. Never reveal other users' data. If no data matches, say so and suggest forwarding the order email to their iTrack address.",
  "model": "anthropic/claude-sonnet-4-20250514",
  "tool_configs": [
    { "entity_name": "Order", "allowed_operations": ["read"] },
    { "entity_name": "Shipment", "allowed_operations": ["read"] },
    { "entity_name": "TrackingEvent", "allowed_operations": ["read"] },
    { "entity_name": "RefundOpportunity", "allowed_operations": ["read"] },
    { "function_name": "orders/manualAdd", "description": "Add an order from pasted email text or a tracking number" },
    { "function_name": "refunds/updateStatus", "description": "Dismiss or mark a refund opportunity claimed/recovered" }
  ],
  "whatsapp_greeting": "Hi! I'm your iTrack assistant. Ask me where any of your packages are, what's arriving soon, or about refunds you can claim."
}
```

WhatsApp channel: enabled from the app dashboard (Agents -> Edit -> WhatsApp; Roi's hands; check
the 3-agents-across-all-apps limit first). In-app: chat button + connect-on-WhatsApp button using
`getWhatsAppConnectURL`. **Isolation AC (F7.2) is a release gate**: agent entity tools must scope
to the signed-in user (verify with two accounts; if tools bypass RLS, restrict the agent to
function tools only and add owner filtering in those functions; log to FEEDBACK.md).

---

## 10. UI specification

**Design direction: clean consumer light.** White/near-white background (#FAFAFA), white cards
with soft shadows and 16px radius, product imagery forward, friendly rounded sans (Inter or
similar), generous whitespace. Accent: indigo (default #4F46E5) for actions and progress; status
colors: green delivered, blue in-transit, amber arriving-soon, red overdue. English only. No dark
mode in MVP. Responsive down to 375px.

Screens:

1. **Login/Register**: built-in Base44 auth (email/password + Google). Minimal branding.
2. **Onboarding** (first login, and reachable from Settings): personal address + copy button,
   "forward one email and watch" hint, optional Gmail-filter walkthrough with confirmation-code
   assist, "or paste an email" shortcut.
3. **Dashboard** (home): stats row, filter tabs, card grid, activity feed rail (desktop) /
   collapsed (mobile). Empty state: the address + manual-add CTA. Loading: skeleton cards. Error:
   toast + retry.
4. **Order detail**: header (merchant, order number, total, status), shipment blocks, progress
   bar large, timeline, refund panel, archive / mark-delivered actions.
5. **Refunds**: open opportunities with countdowns, claim text copy, dismissed/claimed history.
6. **Settings**: digest toggle + hour, your address (again), account wipe (confirm dialog),
   WhatsApp connect button.
7. **Admin quarantine** (admin role only): unroutable EmailRecords list, snippet view,
   assign-to-user (re-runs pipeline) or delete.
8. **Assistant chat** (floating button on all screens): in-app agent conversation + WhatsApp link.

Global states: every list has empty/loading/error designs; every mutation shows optimistic or
spinner feedback and a success/failure toast; failures map `reasons[]` messages verbatim.

---

## 11. Security and privacy

**RLS matrix** (S = service-role functions, which bypass RLS):

| Entity | create | read | update | delete |
|---|---|---|---|---|
| Order, Shipment, TrackingEvent, EmailRecord, RefundOpportunity, UserSettings | admin (S in practice) | owner_email match OR admin | admin (S) | admin (S) |
| RefundPolicy | admin | everyone | admin | admin |
| SyncState | admin | admin | admin | admin |

- Frontend SDK: read + subscribe only; all mutations via `functions.invoke`.
- Functions derive the caller from the token (`auth.me()`), never from the body. Owner checks
  compare `user.email` to `owner_email` server-side before any privileged write.
- Quarantine invariants per section 3.1. Cron/webhook functions are idempotent and ignore
  caller-supplied parameters beyond declared automation args (routes are anonymously reachable).
- Data minimization: snippets (<= 2KB) only; full bodies processed transiently, never stored.
  Images re-hosted (strips merchant tracking params).
- `account/wipe` deletes all caller-owned rows across all per-user entities.
- Secrets: none required in MVP (connector tokens are platform-managed). Anything added later goes
  through `base44 secrets set`, never the repo. `.app.jsonc` stays gitignored; repo goes public
  only after a secrets audit.

---

## 12. Non-functional requirements and platform limits

| Platform limit | Design response |
|---|---|
| 50 functions max | 11 functions |
| 5-minute function execution | Sweep/scan process in batches with cursors; onNewMail handles one webhook burst at a time |
| 5,000 rows per list/filter | All list calls filtered by owner_email; sweep paginates by cursor |
| ~20KB registered string fields | snippet maxLength 2000; draft_message 2000; bodies never stored |
| 50MB upload cap | Product images only (far below) |
| Automations don't run locally | Automation-dependent behavior verified on the deployed app via `base44 logs` (BUILD_PLAN cross-cutting rule) |
| Automation/integration credits | Sweep at 15-min cadence (~96 runs/day) + 2 daily crons; acceptable for the window; revisit cadence post-competition |
| SPA-only hosting | Vite SPA; no SSR assumptions |

Performance targets: dashboard interactive < 2s on a normal connection with 50 orders; ingest
email -> visible card < 60s via webhook path, < 16 min worst-case via sweep.

---

## 13. Judge access and demo plan

- **Demo account** (credentials in the submission's access-instructions field): pre-seeded via
  forwarded real order emails from the demo merchants (Amazon, Temu, Revolve, AliExpress, local
  pet-food vendor), showing every state: in transit, arriving soon, overdue with refund, delivered.
- **Zero-setup evaluation path**: log in -> populated dashboard in seconds. **No OAuth of any kind
  is required by anyone**: judges' own accounts work too via manual add (paste any order email).
- **Demo video (2-3 min) beats**: (1) the inbox problem, 5s; (2) onboarding address + forward a
  real email, dashboard card appears live; (3) card anatomy: image, progress bar, countdown;
  (4) timeline view; (5) overdue card -> refund radar -> drafted claim copy; (6) WhatsApp: "where's
  my dog food?" answered on a phone; (7) architecture slide: the six checklist features, 10s.
- README: architecture diagram (section 3), feature-to-checklist table (section 1), how to run,
  honest production-path section (per-user OAuth roadmap, CASA analysis), link to PRD + FEEDBACK.

---

## 14. Out of scope (MVP) / roadmap

Out of scope for the competition, listed in the write-up as roadmap: per-user Gmail OAuth
(app-user connector, BYO OAuth app), Outlook/other-provider connectors, carrier-API enrichment
(17track/AfterShip), browser extension ("add from order page"), price-drop detection, shared
household boards, Hebrew/RTL localization, dark mode, native mobile, custom domain.

---

## 15. Open risks and day-1 gates

| # | Risk | Gate / mitigation |
|---|---|---|
| 1 | Alias token not recoverable from forwarded-mail headers (Delivered-To) | BUILD_PLAN stage 2 spike BEFORE the pipeline is built; fallback chain X-Forwarded-To -> envelope To -> From-matching; worst case: per-user unique subject tag instructions |
| 2 | `subscribe()` not respecting RLS | Stage 1 DoD two-account test; if leaky: poll instead of subscribe + FEEDBACK.md headline entry |
| 3 | Plan gate: connectors need Builder+ | Roi confirms plan before stage 0 completes |
| 4 | Gmail connector rejects readonly-only scope config | Accept full scope set; note in FEEDBACK.md |
| 5 | Agent entity tools not user-scoped | **CLOSED 2026-07-27, PASS.** `scripts/agent-leak-test.mjs` exit 0 as non-admin B: unfiltered `read_Order` returned only B's row, memory stayed user-scoped. Fallback never needed |
| 6 | WhatsApp 3-agent limit already consumed | **CLOSED 2026-07-27, moot.** No cap surfaced anywhere in the UI and there is no channel toggle to consume; the dashboard "Connect" button is an end-user deep link, not an admin action (FEEDBACK.md). Residual risk handled by the `WHATSAPP_ENABLED` flag |
| 7 | `has_new_messages` condition or payload shape differs in practice | Stage 2 spike logs the raw payload first; sweep cron guarantees ingest regardless |
| 8 | InvokeLLM schema compliance weak on messy emails | aiGateway fallback (section 8); confidence gating keeps bad parses visible, not silent |
