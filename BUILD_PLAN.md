# iTrack: Build Plan

Internal working document, derived from [PRD.md](PRD.md) v1.0 per the `prd-to-build-plan` skill
(Base44 CLI branch). Every stage ends with a running, testable system, not partial code. A checkbox
gets ticked only after the stage's DoD passes on the DEPLOYED app (not just locally).

Competition deadline: **submit by July 28, 2026**. Day mapping at the bottom.

## PIVOT 2026-07-23 (Roi's decision): per-user Gmail OAuth, no shared inbox

Roi rejected the dedicated iTrack Gmail account; each user connects their OWN Gmail (PRD
amendment v1.1). Executed same morning: `inbox/syncMyMail` (batched, incremental, idempotent per
owner+message) replaces onNewMail/sweep; alias routing, forwarding assist, quarantine, SyncState,
and the shared connector are DELETED (code + remote); bootstrap no longer issues aliases and
reports Gmail connection state; onboarding/dashboard/settings rebuilt around Connect Gmail ->
first-sync-with-progress; "Inbox sweep" workflow deleted (Refund scan + Daily digest stay).

**ROI MANUAL (the new, smaller list - no new Gmail account needed). ALL 5 STEPS DONE 2026-07-23;
kept as the reproduction recipe for a fresh environment:**
1. Google Cloud Console: create an OAuth consent screen (External, **Testing** mode), add scope
   `gmail.readonly`, add test users: roishmuel14@gmail.com + the demo/test accounts.
2. Create an OAuth Client (type: Web application). The redirect URIs to paste come from Base44:
   Workspace Settings -> Integrations -> Connectors -> Gmail -> App user credential -> Add
   Connection (it shows the exact callback URLs; add both live and preview if offered).
3. Finish that Base44 dialog with the Client ID + Client Secret -> copy the **connector ID**.
4. Run: `base44 secrets set GMAIL_CONNECTOR_ID=<the-connector-id>` (or paste it here and I run it).
5. In the app, click Connect Gmail with your own account -> I verify the end-to-end sync.
   Note: with the consent screen in Testing mode, ONLY allowlisted test users can connect (judges
   use the demo account + manual add; the video shows the real OAuth flow).

**RESOLUTION 2026-07-23 (all of the above steps 1-5 DONE by Claude in Roi's browser; then BLOCKED
by a Base44 bug).** SUPERSEDED THE SAME DAY - the "Base44 bug" diagnosis was WRONG and the flag is
now `true`; read the next section before acting on anything in this paragraph. Kept for the
debugging trail: Google OAuth Web client "iTrack (Base44 app-user Gmail)" created (project
gmail-attachment-tool, scopes email+gmail.readonly), Base44 Gmail app-user connector configured
(connector id 6a61b3f0c8c9d8fba4b414c1), `GMAIL_CONNECTOR_ID` secret set, bootstrap returns
gmail.configured:true. But Connect Gmail fails: Base44's app-user connector hardcodes the OAuth
callback to the public-suffix apex `https://base44.app/api/external-auth/callback`, which Google
refuses to register. Tried the custom-domain fix (Roi's choice): itrack.inboxfiles.com connected
(CNAME at Namecheap, live + TLS, appBaseUrl repointed, logged in on it) - connector STILL sent the
apex; the built-in Google LOGIN works on the custom domain, so it's specifically the connector
callback that's wrong. Reported to Base44 (FEEDBACK.md). **Decision (Roi): manual add is the
competition ingest path** (PRD amendment v1.2). `GMAIL_CONNECT_ENABLED=false` in src/lib/config.js;
onboarding leads with manual add; Gmail card shows "coming soon"; appBaseUrl reverted to the stable
built-in URL. Flip the flag when Base44 fixes the redirect. itrack.inboxfiles.com stays connected
(works, nicer URL) but is not relied on.

## RESOLUTION 2026-07-23 (later same day): per-user Gmail WORKS; it was an app-side fix, not a wait

The "hardcoded apex" diagnosis was wrong. Base44's connect-initiate endpoint MIRRORS THE REQUEST
HOST into the OAuth redirect_uri, and the SDK's `createClient` defaults `serverUrl` to the
`base44.app` apex (not derived from `appBaseUrl`), so `connectAppUser` POSTed initiate to the apex
and got an unregisterable callback. Fix (shipped in `src/api/auth.jsx`): call the initiate endpoint
on `window.location.origin`, whose slug callback is registered in the Google client.
`GMAIL_CONNECT_ENABLED` flipped to `true`. Verified end-to-end through the live Connect Gmail button
(readonly consent -> callback -> `syncMyMail`); 48 real orders imported from roishmuel14@gmail.com;
idempotent re-sync adds zero. Full root cause + Base44 asks in FEEDBACK.md. Manual add remains
available alongside.

Merge dedup (Stage 3) FIXED same day: the live sync exposed duplicate rows caused by entity reads
not being read-your-writes consistent (two emails about one order, processed 0-1s apart, each missed
the other's just-created Order). Fix: a per-run in-memory cache in `base44/shared/pipeline.ts` +
`inbox/syncMyMail` (created orders/shipments are unioned into the merge candidates) and an
order-number-only safety net in `mergeEngine.ts` `decideMerge`. Backfilled Roi's data (48 -> 36
orders: 11 duplicate groups merged, 25 duplicate EmailRecords + 18 duplicate TrackingEvents removed).
Cross-invocation reprocessing then CLOSED via page-token paging: `inbox/syncMyMail` processes one
Gmail page per call and returns `next_page_token`; the frontend (`useGmailSync`) echoes it back so
successive calls page through strictly older mail and never re-list what an earlier call handled.
Verified by a forced 90-day re-scan: 4 pages, drained clean (`has_more=false`), 46 already-seen
messages skipped, 0 duplicate groups. The underlying entity read-after-write consistency ask stays
in FEEDBACK.md.

## Current status

- [x] Stage 0: Foundation (scaffold, git, deploy skeleton) - done 2026-07-22. The "iTrack Gmail
      account" item is RETIRED by the per-user-OAuth pivot and no longer gates stage 2 (done);
      enroll + Builder+ confirm remain as Roi manual items for stage 8.
- [x] Stage 1: Data layer - COMPLETE 2026-07-23. Two-account leak test PASSED on the live app:
      reads isolated (B sees 0 of A's 6 orders, 0 foreign in every per-user entity) AND realtime
      isolated + functional (B got exactly its own 5 events, 0 of A's; positive control confirms
      subscribe() delivers, so it is not a false pass). PRD risk #2 resolved: subscribe() respects
      RLS, no polling fallback needed.
- [x] Stage 2: Per-user Gmail (app-user connector) COMPLETE 2026-07-23, merged in PR #3. Earlier
      apex-callback block root-caused and fixed app-side (initiate on the app origin, not the SDK's
      default base44.app apex; see FEEDBACK.md + the RESOLUTION block above). Roi connected
      roishmuel14@gmail.com (readonly); `syncMyMail` imports real order mail; idempotent (cursor +
      EmailRecord dedup + page-token paging); `base44 logs` confirm live runs. **Two-account
      isolation gate PASSED** through the real Gmail path: account B connected its OWN Gmail and
      scanned -> imported 0 (read B's own mailbox, so no token leak), saw 0 of A's 36 orders; A saw
      0 foreign rows and its data was unchanged. ALL DoD MET.
- [x] Stage 3: Ingestion pipeline - COMPLETE 2026-07-23. Verified via manualAdd (merge,
      out-of-order, split shipments, newsletter, monotonicity) AND now end-to-end on the LIVE Gmail
      path with real merchant mail incl. a forwarded 54-item Hebrew grocery order. Idempotent both
      ways (re-sync creates zero rows). Merge dedup + page-token paging hardened after a real
      84-message mailbox exposed read-after-write duplicate races; `tests/` covers the pure logic.
      `sweep`/SyncState/quarantine are RETIRED by the pivot, not outstanding (see stage 3 below).
- [x] Stage 4: Frontend shell + shared kit - deployed 2026-07-22 (tokens, auth+OTP+Google, api
      wrappers with reasons-toasts, formatters, empty dashboard; login verified signed-out at
      375px, error toast verified via DOM)
- [x] Stage 5: Dashboard + timeline + onboarding - COMPLETE 2026-07-26 (MILESTONE 1: daily usable).
      All UI deployed (stats, filters, cards with progress+today marker, realtime subscriptions,
      detail+timeline+snippets, onboarding with Connect Gmail + paste-an-email, manual add, activity
      feed). Roi verified the remaining live items in a browser session on the deployed app
      (2026-07-26): authenticated click-through, two-window realtime, narrow-viewport inner screens.
- [x] Stage 6: Refund radar + digest - ALL functions + screens deployed; scan verified live
      (AC1 exactly-one, AC2 no-dupes, AC3 dismiss holds, draft cites order number), digest send +
      skip-when-off verified live. **Scheduled crons CONFIRMED in `base44 logs` 2026-07-26: two
      real runs each, on consecutive days.** `refunds/scan` fired 07-25 03:03:37 and 07-26 03:04:56
      UTC (cron `0 3 * * *`), both `{ok:true, overdue_orders:10, created:0, skippedExisting:16}` -
      a real scheduled run proving F5 AC2 (re-scan creates no duplicates). `digest/send` fired
      07-25 07:02:16 (`sent:0, skipped:3, considered:3`) and 07-26 07:04:30 (`sent:1, skipped:2,
      considered:3`) UTC (cron `0 7 * * *`) - covers F10 AC2/AC3 (sends only when there is content,
      skips opted-out/empty users). COMPLETE 2026-07-26 (Roi's call). Recorded for honesty: the
      post-wipe leak-test RERUN was not executed (it deletes data). Wipe isolation rests on static
      verification instead - `account/wipe` deletes only via
      `deleteMany({ owner_email: user.email })`, with the email taken from the token server-side
      (never the request body) and gated behind `confirm: true`, so other users' rows are
      structurally unreachable; RLS isolation itself is proven live in stages 1 and 2.
- [x] Stage 7: Assistant agent + WhatsApp - DONE 2026-07-27. All three ACs verified on the live
      app: AC1 answered in the real chat UI (item question -> right order, status, ETA) plus a
      reproducible exec smoke; **AC2 isolation gate PASSED** (non-admin account B: unfiltered
      `read_Order` returned only its own row, user-scoped memory stayed empty), so entity tools
      were kept and the function-tools-only fallback was never needed; AC3 WhatsApp round trip
      confirmed on a real phone by Roi. WhatsApp needed no dashboard enable and hit no agent cap
      (the "Connect" button is an end-user deep link, not an admin toggle), but the in-app
      affordances are still flag-gated so they can never dead-end. 375px pass done on Roi's phone
- [ ] Stage 8: Ship (MILESTONE 2: submitted)

## OPEN BUGS (must fix before submission)

- [x] **Duplicate orders shown on the dashboard** (reported by Roi 2026-07-26, FIXED + cleaned
      2026-07-28). Root cause was candidate 2 (real data, survives reload), with live-data proof:
      Gmail lists newest-first, so the number-less delivery/carrier notice of a thread created a
      sparse Order first, and the richer confirmation seconds later failed every merge rung
      (Salomon: fuzzy window anchored on the sparse row's `created_date` = sync day, 59d outside
      the 45d window, arbitration never ran; Amazon + LaPelota: arbitration saw an all-"unknown"
      candidate summary and the prompt said "when in doubt, answer false"; the FedEx card:
      carrier email became merchant fedex.com, which can never domain-match the real merchant).
      FIX (all deployed 2026-07-28): sync pages process oldest-first; fuzzy anchor now
      `ordered_at ?? last_event_at ?? created_date`, candidates sorted best-first, differing
      explicit order numbers hard-excluded; carrier/missing domains widen the search on both
      sides (`isCarrierDomain`); arbitration got full-fidelity summaries (subject + snippet +
      tracking numbers, full-row RunCache) and a rewritten prompt (missing data is not evidence
      of difference; same-merchant leans merge, cross-merchant needs positive evidence);
      matched-branch now repairs `ordered_at`/`merchant_name`/carrier `merchant_domain`;
      `orders/manualAdd` tracking mode dedupes by tracking number. Existing rows merged by
      `scripts/dedupe-orders.ts` (10 -> 7 orders, 3 pairs, idempotent re-run = 0). VERIFIED live:
      dashboard shows 7 unique cards, Overdue 2 -> 0, LaPelota delivered with full product data;
      manualAdd probes: confirmation + sparse delivery paste merged into ONE order, tracking-mode
      re-add returned `already_exists`, merchant-less carrier paste attached by tracking. 91 unit
      tests green (`deno test tests/ scripts/tests/`). NOTE: the two-account agent leak test was
      NOT rerun (scripts/.env.leaktest with account B credentials is absent on this machine);
      isolation surfaces untouched (all candidate fetches stay owner-scoped), but rerun it before
      submission when the env file is restored.

## Architectural decisions (the chosen shape)

1. **Base44 developer platform via CLI only.** Entities as JSONC + `entities push`, Deno functions
   + `functions deploy`, Vite/React frontend + `base44 deploy`. Never the no-code builder MCP:
   different product.
2. **Ingest = per-user Gmail OAuth (app-user connector), read-only, foreground-only.** REPLACED the
   original shared-inbox + plus-alias + 15-min-sweep design on 2026-07-23 (PRD v1.1/v1.3); shipped
   and verified 2026-07-23. Each user connects their OWN mailbox; `inbox/syncMyMail` reads it with
   `getCurrentAppUserConnection`, which is REQUEST-SCOPED, so there is no background sweep and no
   cron path: sync runs on app load, on demand, and while the app is open. Paging uses Gmail's
   page tokens with a stable `after` bound so calls never re-list earlier pages. Manual add stays
   as an equal ingest path. Cost of the model: the Google consent shows the "unverified app" step
   until full restricted-scope verification (see stage 2).
3. **All entity writes go through backend functions with `asServiceRole`; frontend SDK is
   read + invoke + subscribe only.** Ownership is an explicit `owner_email` stamped server-side;
   RLS reads key on it (service-created rows don't carry the end user's `created_by`).
4. **Statuses are monotonic and computed by one writer** (the merge engine): no client ever sets
   a status directly; ranks ordered(0)..delivered(4), branch states annotate.
5. **AI = `InvokeLLM` with `response_json_schema`** for classify/extract/draft; `aiGateway` is the
   pre-decided fallback if schema compliance disappoints.
6. **Ownership comes from the token, never from the mail.** RETIRED the alias-routing/quarantine
   rule with the per-user pivot: there is nothing to route, because the caller's own OAuth token
   fetched the message, so `owner_email` is stamped from `auth.me()`. Idempotency key is
   (`owner_email`, `gmail_message_id`). Merging is by (merchant domain + order number), with an
   order-number-only fallback that refuses to cross two different known domains, then tracking
   number, then LLM arbitration; ambiguity creates a new order rather than guessing.
7. **English-only UI, clean consumer light design** (white cards, soft shadows, imagery forward,
   indigo accent). No RTL/i18n in MVP.

## Project structure

Verified against the repo 2026-07-24 (post per-user-Gmail pivot). SyncState, the connectors dir,
`inbox/onNewMail`, `inbox/sweep`, `inbox/confirmForwarding`, `aliasRouter` and a standalone
`classify` are all GONE: deleted by the pivot (classify folded into `extract`).

```
iTrack/
  base44/
    .app.jsonc            # gitignored; app id
    config.jsonc          # name, dirs, site.outputDirectory/serveCommand
    entities/             # 7: Order, Shipment, TrackingEvent, EmailRecord,
                          # RefundOpportunity, RefundPolicy, UserSettings (.jsonc)
                          # NOTE: the Gmail connector is an app-user connector configured in
                          # Workspace Settings (id in the GMAIL_CONNECTOR_ID secret), NOT a repo file
    agents/itrack_assistant.jsonc
    functions/            # 9
      inbox/syncMyMail/
      account/bootstrap/  account/wipe/  settings/update/
      orders/manualAdd/  orders/setStatus/
      refunds/scan/  refunds/updateStatus/  digest/send/
    shared/               # 9: gmail, pipeline, extract, mergeEngine, syncWindow,
                          # htmlToText, carriers, rehost, responses
  src/                    # Vite + React (template), pages/ components/ api/ lib/
  tests/                  # deno test tests/ - pure-logic units (mergeEngine, syncWindow)
  scripts/                # base44 exec seed/verify/leak-test scripts (not deployed)
  PRD.md  BUILD_PLAN.md  CLAUDE.md  FEEDBACK.md  README.md (stage 8)
```

---

## Stage 0: Foundation

Scaffold, link, version control, and a deployed skeleton on day one.

- [ ] Roi (manual, ~15 min): enroll at backendcompetition.base44.app/enroll; create the iTrack
      Gmail account (suggestion: `itrackapp44@gmail.com`, strong password, no 2FA blockers for
      connector auth); confirm workspace plan is Builder+. **STILL PENDING as of 2026-07-22.**
- [x] Prereqs: node v22.18.0, base44 CLI 0.1.5 (roishmuel14@gmail.com), deno 2.7.13.
- [x] `base44 create iTrack --path . --template backend-and-client`: accepted the non-empty dir,
      scaffolded in place. App id 6a6117b2e209abd12bdb7160.
- [x] `git init`, first commit; private GitHub repo `roishmuel14/itrack`; `.app.jsonc` verified
      gitignored before push (`.app.json*` pattern in template .gitignore).
- [x] App id + live URL recorded in CLAUDE.md.
- [x] `npm run build` && `base44 deploy -y` (visibility public came from config.jsonc; live URL
      https://i-track-2bdb7160.base44.app serves HTTP 200 signed-out).
- [x] `base44 dev` boots: backend on :4400 loads entities, vite on :5173.

**DoD:** live `*.base44.app` URL serves the skeleton to a signed-out visitor; repo on GitHub with
no `.app.jsonc`; `base44 dev` runs functions locally (deno present).

---

## Stage 1: Data layer

All schemas up front (schema churn after screens exist is the most expensive change), the write
pattern proven once, RLS verified with two accounts.

- [x] All 8 entity JSONCs written (Order + EmailRecord verbatim from PRD; rest from field tables).
- [x] `base44 entities push`: all 8 created, sample Task deleted; remote schemas diffed via
      list_entity_schemas, match 1:1 including RLS blocks.
- [x] `base44 types generate` -> base44/.types/types.d.ts.
- [x] RefundPolicy seeded: {created:6, total:6} via scripts/seed-policies.ts + base44 exec
      (idempotent upsert by policy_key, re-runnable).
- [x] Mutation pattern proven on `account/bootstrap` (deployed): anonymous curl -> 401
      `{error, reasons:[{code:"auth_required",...}]}`; authenticated exec invoke -> settings with
      alias `3e0axvd4`, owner_email stamped server-side; second invoke -> `created:false` (idempotent);
      bootstrap-race self-heal included. Anonymous REST reads on per-user entities return `[]`
      (RLS filters, doesn't 401); RefundPolicy public read serves 6 rows.
- [x] Two-account leak test PASSED (2026-07-23, live app). Test account B =
      keyboardconverter@gmail.com (non-admin). Reads: 0 foreign across all 6 per-user entities
      (A holds 6 orders, B sees 0). Realtime: B received its own 5 events (create/update/delete of
      a B-owned Order + TrackingEvent) and 0 A-owned events, while the admin trigger churned both
      A- and B-owned rows in the same rooms during the same window; the own-event delivery is the
      positive control that rules out a dead-subscription false pass. Harness note (also in
      FEEDBACK.md): in Node the SDK realtime socket authenticates only from the token passed to
      createClient (no localStorage fallback), so the token must be resolved BEFORE createClient or
      the socket connects anonymously and silently receives nothing.

**DoD:** schemas live and matching the repo; policies seeded; bootstrap stamps per-user owner_email
server-side for two accounts (the "unique alias" clause is retired by the 2026-07-23 per-user-OAuth
pivot); **leak test passes for reads AND realtime** (PASSED 2026-07-23); anonymous function call
gets a clean 401 (verified stage 1). ALL MET - stage complete.

---

## Stage 2: Per-user Gmail connect + sync (GATE) - COMPLETE 2026-07-23

The scariest assumption gets verified before anything is built on it. Rewritten for the per-user
OAuth model (PRD amendments v1.1/v1.3); the original shared-inbox + alias-routing checklist is
retired (no shared account, no `connectors/gmail.jsonc`, no `onNewMail`, no alias headers).

- [x] Google OAuth Web client "iTrack (Base44 app-user Gmail)" (project gmail-attachment-tool,
      consent External/**Testing**, scope `gmail.readonly` + email, test users roishmuel14@ and
      keyboardconverter@). Authorized redirect URIs include the live and `preview--` slug callbacks
      `https://i-track-2bdb7160.base44.app/api/external-auth/callback`. Readonly-only was ACCEPTED,
      so PRD risk #4 did not materialize.
- [x] Base44 app-user Gmail connector configured in Workspace Settings; id in the
      `GMAIL_CONNECTOR_ID` secret; `account/bootstrap` returns `{configured, connected,
      connector_id}` as the UI's single source of truth.
- [x] **GATE decision, recorded:** the connect flow is host-dependent, not hardcoded. Base44's
      connect-initiate MIRRORS THE REQUEST HOST into the OAuth `redirect_uri`, and the SDK client
      defaults `serverUrl` to the unregisterable `base44.app` apex (Public Suffix List). Fix:
      `connectGmail` (src/api/auth.jsx) calls initiate on `window.location.origin`, whose callback
      IS registered. No Base44 change needed; `GMAIL_CONNECT_ENABLED = true`. Full root cause and
      the two platform asks are in FEEDBACK.md.
- [x] `inbox/syncMyMail` live: `getCurrentAppUserConnection` (request-scoped, per caller) ->
      `listMessages`/`getMessage` -> the same `runCorePipeline` manual add feeds. One Gmail page per
      call with `next_page_token` + a stable `after` bound echoed by `useGmailSync`, so calls never
      re-list earlier pages. Idempotent per (`owner_email`, `gmail_message_id`).
- [x] Verified on the live app with real merchant mail (Amazon, AliExpress, Temu, Wolt, Revolve,
      Salomon, Israir, a forwarded 54-item Hebrew grocery order): orders/shipments/events created,
      statuses monotonic, re-sync adds zero, `base44 logs --function inbox/syncMyMail` shows the
      runs. Merge dedup fixed in the same pass (per-run cache + order-number fallback; live data
      backfilled) with unit tests in `tests/` (`deno test tests/`).
- [x] **Two-account isolation gate PASSED** (cross-cutting rule 3, exercised through the Gmail
      path, not just RLS): account B (keyboardconverter@) connected its OWN Gmail and scanned ->
      imported 0 (it read B's own mailbox; a token leak would have pulled A's mail in as B's) and
      saw 0 of A's 36 orders; A saw 0 foreign Orders/EmailRecords and its data was unchanged.

**DoD:** a signed-in user connects their OWN Gmail read-only from the live app and their order mail
becomes cards (logs prove the runs); sync is idempotent and pages without re-listing; a second
account connecting its own Gmail sees only its own data. ALL MET - stage complete (PR #3).

**Known limitation (not a blocker):** the Google consent screen shows the "unverified app" step and
the shared project's name, because `gmail.readonly` is a restricted scope and the app is in Testing.
Removing it needs full restricted-scope verification (verified domain + public homepage + privacy
policy + demo video + a CASA security assessment, several weeks). Decision: stay in Testing for the
competition and connect the demo account before recording.

---

## Stage 3: Ingestion pipeline - COMPLETE 2026-07-23

The backend centerpiece: email in, correct entities out, idempotent. The "quarantine when unsure"
clause is retired with alias routing (nothing to route); ambiguity now creates a new order instead.

- [x] Shared modules: `htmlToText`, `extract` (classify+extract in ONE InvokeLLM call with
      `response_json_schema`, so no separate `classify` module), `mergeEngine` (merge keys,
      monotonic status, shipment aggregation: pure, unit-tested), `carriers`, `rehost` (UploadFile),
      `responses`, plus `gmail` (read-only REST) and `syncWindow` (paging math) from the pivot.
      `aliasRouter` was never needed and is deleted.
- [x] `inbox/syncMyMail` REPLACES `inbox/onNewMail` (per-user pivot): idempotency check on
      (`owner_email`, `gmail_message_id`) BEFORE any LLM work, then `runCorePipeline` ->
      EmailRecord statuses (parsed/low_confidence/irrelevant/failed; `unroutable` retired).
      `orders/manualAdd` feeds the identical pipeline, so both paths share one parser.
- [x] `inbox/sweep` + SyncState DELETED by the pivot, and the "Inbox sweep" workflow with them:
      app-user tokens are request-scoped, so a cron cannot read a user's mailbox (logged in
      FEEDBACK.md as a platform gap). The incremental cursor now lives on
      `UserSettings.last_gmail_sync_at` and advances only when a paging session fully drains.
      Scheduling note kept for stage 6: this app generation REJECTS function.jsonc automations
      (409 workflows_enabled; FEEDBACK.md), so "Refund scan" (03:00 UTC) and "Daily digest"
      (07:00 UTC) exist as builder-prompt WORKFLOWS.
- [x] Tested against real merchant mail through the LIVE Gmail path (2026-07-23), not fixtures:
      Amazon, AliExpress, Temu, Wolt, Revolve, Salomon, Israir, JoyBox, Local Pet Food, and a
      forwarded 54-item Hebrew grocery confirmation parsed at 0.95-1.0 confidence. Out-of-order
      sequences, the Amazon-style split into two shipments, and status monotonicity were verified
      earlier via `manualAdd` on the same pipeline.
- [x] Idempotency proven both ways: a re-sync of already-processed mail reports every message as
      `duplicate` and creates ZERO rows (46 skipped in one run), and an immediate re-run scans 0.
      Non-order mail lands as `irrelevant` EmailRecords and nothing else (6 in one run).
- [x] Merge dedup hardening (found by running against a real 84-message mailbox): Base44 entity
      reads are not read-your-writes consistent, so back-to-back emails about one order each missed
      the other's just-created Order. Fixed with a per-run in-memory merge cache + an
      order-number-only fallback; cross-invocation reprocessing closed with page-token paging and a
      stable `after` bound. Live data backfilled (48 -> 36 orders; 25 duplicate EmailRecords and 18
      duplicate TrackingEvents removed). Unit tests in `tests/` (`deno test tests/`, 15 passing).

**DoD:** PRD F1 AC 1-5 and F2 AC 1-3 pass against the deployed app (verified on the live Gmail path
AND via manualAdd); the incremental cursor advances in logs; idempotency holds across re-sync and
re-paging. The "sweep advances its cursor" and "alias-less mail lands in quarantine" clauses are
RETIRED with the shared-inbox model, not unmet. ALL MET - stage complete.

---

## Stage 4: Frontend shell + shared kit

- [ ] Design tokens (light theme, indigo accent, status colors) in `src/index.css`; base layout
      (header, nav, toaster).
- [ ] Auth flow using built-in Base44 auth (login/register/Google), `account/bootstrap` on first
      authenticated load.
- [ ] `src/api/` wrapper: entities read helpers, `invokeFunction` (unwraps `.data`, maps
      `reasons[]` to toasts), subscription helper with cleanup.
- [ ] `src/lib/` formatters: dates (DD/MM/YYYY), money (Intl.NumberFormat by currency), countdown
      ("in 3 days" / "2 days overdue"), carrier link builder (reuses shared/carriers logic).
- [ ] Empty dashboard with correct empty state (personal address + manual-add CTA).

**DoD:** fresh account: register -> onboarding address visible -> empty dashboard, deployed;
invoke error path shows a toast with the server's reason message (force one).

---

## Stage 5: Dashboard + timeline + onboarding (MILESTONE 1: daily usable)

- [x] Dashboard: stats row, filter tabs, card grid (image, logo, status chip, progress bar with
      today marker, countdown, refund badge), delivered section collapsed, ETA sort.
- [x] Realtime: subscribe to Order + TrackingEvent; live card updates + toasts.
- [x] Order detail: header, shipment blocks (copy tracking number, carrier deep link), timeline
      with source snippets, archive / mark-delivered via `orders/setStatus`.
- [x] Onboarding screen: "Connect Gmail" (read-only, one click) + paste-an-email as the equal
      second path. The Gmail-filter walkthrough and `inbox/confirmForwarding` assist are RETIRED
      (no forwarding in the per-user model); the function is deleted.
- [x] `orders/manualAdd` (paste email text OR tracking number) + UI.
- [x] Activity feed (latest events, newest first).

**DoD:** PRD F3 AC 1-3, F4 AC 1-3, F6 AC 1-2 (two-window realtime + two-account RLS-over-realtime),
F8 AC 1-2, F9 AC 1-3; narrow-viewport pass on every screen; **connect Gmail -> real order cards
appear** (the demo moment, replacing "forward-an-email" with the pivot; the connect + first-sync
half is already verified live in stage 2, so what remains here is the authenticated click-through,
the two-window realtime test, and the 375px pass on inner screens).
**MET 2026-07-26** - the connect -> real-cards demo moment and RLS-over-realtime were verified in
stages 2 and 1 respectively; Roi verified the remaining three live items (authenticated
click-through, two-window realtime, 375px inner screens) in a browser session on the deployed app.

---

## Stage 6: Refund radar + digest

- [x] `refunds/scan`: overdue detection, policy matching, upsert (unique order+policy, skip
      dismissed), claim drafting; cron `0 3 * * *`; manual trigger path for testing.
- [x] `refunds/updateStatus` (dismiss/claimed/recovered) + Refunds screen (countdowns, copy claim,
      claim link) + card badges + stats-row sum.
- [x] `digest/send`: per-user opt-in digest, `Core.SendEmail`, cron `0 7 * * *`; `settings/update`
      function; Settings screen (digest toggle + hour, address, wipe with confirm).
- [x] `account/wipe` full implementation (all per-user entities).
- [x] Test fixture: `scripts/force-overdue.ts` backdates a demo order's promised_date.
- [~] Wipe leak-test rerun: NOT RUN (it deletes data); waived 2026-07-26 by Roi's call. Covered
      instead by static verification of `account/wipe` (deletes scoped to
      `deleteMany({ owner_email: user.email })`, email from the token, `confirm: true` required).
      To close it properly later: invoke `account/wipe` as account B, then assert account A's rows
      are untouched (A held 10 real imported orders as of 2026-07-26; the earlier "36" predates the
      product_kind relevance filtering that excluded SaaS/food-delivery/flight receipts).

**DoD:** PRD F5 AC 1-4 and F10 AC 1-3 pass on deployed app (cron verified by manual trigger + one
real scheduled run in logs); wipe leaves a second account's data untouched (leak-test rerun).
**Cron half MET 2026-07-26** (`base44 logs --env preview`, two consecutive real scheduled runs each:
`refunds/scan` 07-25 03:03:37 + 07-26 03:04:56 UTC, `created:0 skippedExisting:16`; `digest/send`
07-25 07:02:16 `sent:0` + 07-26 07:04:30 `sent:1 skipped:2` UTC). Wipe rerun still open.

---

## Stage 7: Assistant agent + WhatsApp

- [x] `base44/agents/itrack_assistant.jsonc` (PRD section 9); `base44 agents push` (2026-07-27:
      re-pushed, so remote provably equals the committed jsonc; confirmed in the dashboard by the
      Welcome Message length matching `whatsapp_greeting`. There is no `agents list`/`pull` to read
      remote state back, so a re-push is the only way to be sure: FEEDBACK).
- [x] In-app chat button + conversation UI (SDK agents module); WhatsApp connect button via
      `getWhatsAppConnectURL`, gated behind `WHATSAPP_ENABLED` in `src/lib/config.js` plus a
      Settings card (PRD section 10 screen 6). The flag exists because `getWhatsAppConnectURL` is a
      synchronous string builder that returns a URL whether or not the channel works, so the old
      try/catch around it was dead code and the icon was a live dead link.
- [x] Roi (manual): WhatsApp for `itrack_assistant`. Outcome 2026-07-27: **there was nothing to
      enable.** The dashboard's green "Connect" button is not an admin toggle, it opens the same
      end-user deep link the SDK builds, and no 3-agent cap surfaced anywhere in the UI (FEEDBACK).
      The channel is live: the deployed Settings button lands on `api.whatsapp.com/send/` with a
      real number and a prefilled activation code, and the route survives an `agents push`.
- [x] **Isolation gate (PRD F7 AC2 / risk #5):** `scripts/agent-leak-test.mjs` as non-admin B,
      exit 0 (2026-07-27). Entity tools did NOT leak, so no fallback to function-tools-only was
      needed: the agent ran an unfiltered `read_Order` and got exactly its own 1 row while A owned
      11, and B's memory probe came back empty right after A saved a memory. Seed and cleanup are
      `scripts/agent-leak-seed.ts` / `agent-leak-cleanup.ts`; `scripts/agent-smoke.ts` covers AC1.

**DoD:** "where's my [item]?" answered correctly in-app for the demo account; second account gets
only its own data; WhatsApp round-trip on a real phone.

---

## Stage 8: Ship (MILESTONE 2: submitted)

- [ ] Polish pass: every empty/loading/error state from PRD section 10; admin quarantine screen;
      favicon + og tags; final visual QA at 375px and 1440px.
- [ ] Demo account seeding: forward the real merchant emails so every state is represented
      (in transit, arriving soon, overdue + refund, delivered); run scan + digest once.
- [ ] README: architecture diagram, checklist-features table, run instructions, production-path
      section; finalize FEEDBACK.md (paste-ready answers for the 3 required questions + bugs).
- [ ] Demo video 2-3 min per PRD section 13 beats; upload (YouTube unlisted).
- [ ] Secrets audit (`git log -p` scan for tokens; confirm `.app.jsonc` untracked) -> repo public.
- [ ] Final `npm run build` && `base44 deploy -y`; click through the live URL signed-out and as
      the demo account.
- [ ] Submit at backendcompetition.base44.app/submit (form fields per
      BASE44_BUILDOFF_REFERENCE.md section 3; tick exactly the six features, all genuinely used;
      NPS = Roi's honest number) + paste feedback.

**DoD:** BASE44_BUILDOFF_REFERENCE.md section 12 checklist fully green; submission confirmation
screen seen.

---

## Cross-cutting rules (checked every stage)

1. `base44 functions deploy` after EVERY function change; `entities push` after every schema
   change. File sync alone registers nothing.
2. Verify on the LIVE app + `base44 logs`, not just locally: automations never run under
   `base44 dev`.
3. Any stage that touches data surfaces reruns the two-account leak test (reads, realtime, agent).
4. Every platform surprise goes into FEEDBACK.md the moment it happens, with repro.
5. Commit at every green DoD; small commits between checkboxes.
6. No em dashes in any file, UI string, or commit message. English-only UI.
7. Tick the stage checkbox in "Current status" when its DoD passes; note deviations inline.
8. **Reproduce through the real UI, not a CLI/curl proxy.** The Gmail connect bug hid for hours
   because `base44 exec` and curl minted a WORKING connect URL while the browser button minted a
   broken one (different SDK `serverUrl`). A green CLI probe is not evidence the feature works.
9. **Put pure logic in `base44/shared/` and unit-test it** (`deno test tests/`). Both the merge keys
   and the paging window are pure and testable; a first-sync paging bug shipped and was caught in
   review, and the test that now guards it takes four lines. Entity/LLM behavior still needs live
   verification, but never leave decision logic untested because "the platform needs a deploy".

## Open decisions (defaults chosen, override anytime)

- Accent color: indigo #4F46E5. App display name: "iTrack". Repo: `roishmuel/itrack` (private
  until stage 8).
- Demo Gmail: RETIRED as a concept (no app-owned mailbox). Judges either connect their OWN Gmail
  (only if added as a Google test user, since the consent screen is in Testing) or use manual add;
  the recorded demo uses roishmuel14@gmail.com, connected BEFORE filming so the "unverified app"
  consent step never appears on camera.
- Demo merchants: whatever is really in the demo mailbox. As of 2026-07-23 that is Amazon,
  AliExpress, Temu, Wolt, Revolve, Salomon, Israir, JoyBox, Local Pet Food, plus a Hebrew grocery
  order (a nice showcase for the parser, since it is forwarded, RTL, and 54 line items).
- Digest default: on, 07:00 UTC. Sweep cadence: RETIRED (no background sync; foreground paging).
- Domain: default `<slug>.base44.app` (no custom domain in MVP).

## Day mapping (6 days, slack burns bottom-up)

| Date | Stages |
|---|---|
| Jul 23 (Wed) | 0 + 1 + 2 (the gate day) |
| Jul 24 (Thu) | 3 |
| Jul 25 (Fri) | 4 + start 5 |
| Jul 26 (Sat) | finish 5 + 6 |
| Jul 27 (Sun) | 7 + start 8 (video draft, README) |
| Jul 28 (Mon) | finish 8, submit with hours to spare |

If behind after Jul 26: cut WhatsApp channel (keep in-app agent), then cut digest email (keep
feed), then cut the forwarding-confirmation assist (manual forwarding still works). Never cut:
ingestion quality, RLS tests, the demo account, the video.
