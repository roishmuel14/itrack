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

**ROI MANUAL (the new, smaller list - no new Gmail account needed):**
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
by a Base44 bug):** Google OAuth Web client "iTrack (Base44 app-user Gmail)" created (project
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

## Current status

- [x] Stage 0: Foundation (scaffold, git, deploy skeleton) - done 2026-07-22; Roi manual items
      (enroll, iTrack Gmail account, Builder+ confirm) still pending, gate stage 2
- [x] Stage 1: Data layer - COMPLETE 2026-07-23. Two-account leak test PASSED on the live app:
      reads isolated (B sees 0 of A's 6 orders, 0 foreign in every per-user entity) AND realtime
      isolated + functional (B got exactly its own 5 events, 0 of A's; positive control confirms
      subscribe() delivers, so it is not a false pass). PRD risk #2 resolved: subscribe() respects
      RLS, no polling fallback needed.
- [~] Stage 2: Gmail connector spike - connector pushed, PENDING Roi: create the iTrack Gmail
      account + authorize (fresh URL below), then rerun `base44 functions deploy` + send the
      3 test emails
- [~] Stage 3: Ingestion pipeline - pipeline + sweep + quarantine DEPLOYED and verified via
      manualAdd on the live app (merge, out-of-order, split, newsletter, monotonicity all pass);
      remaining: live gmail-path tests once the connector is authorized, sweep workflow run in logs
- [x] Stage 4: Frontend shell + shared kit - deployed 2026-07-22 (tokens, auth+OTP+Google, api
      wrappers with reasons-toasts, formatters, empty dashboard; login verified signed-out at
      375px, error toast verified via DOM)
- [~] Stage 5: Dashboard + timeline + onboarding - ALL UI deployed (stats, filters, cards with
      progress+today marker, realtime subscriptions, detail+timeline+snippets, onboarding with
      confirmForwarding assist, manual add, activity feed); remaining: authenticated click-through
      + two-window realtime test (needs a browser session), narrow-viewport pass on inner screens
- [~] Stage 6: Refund radar + digest - ALL functions + screens deployed; scan verified live
      (AC1 exactly-one, AC2 no-dupes, AC3 dismiss holds, draft cites order number), digest send +
      skip-when-off verified live; remaining: workflows for 03:00/07:00 crons, wipe leak-test rerun
- [~] Stage 7: Assistant agent - itrack_assistant pushed with user-scoped memory; in-app chat
      widget deployed; agent answered "Where are my LED strip lights?" correctly from entity tools
      (headless test). Remaining: WhatsApp enable (Roi, dashboard), two-account isolation gate
- [ ] Stage 8: Ship (MILESTONE 2: submitted)

## Architectural decisions (the chosen shape)

1. **Base44 developer platform via CLI only.** Entities as JSONC + `entities push`, Deno functions
   + `functions deploy`, Vite/React frontend + `base44 deploy`. Never the no-code builder MCP:
   different product.
2. **Ingest = shared Gmail inbox + per-user plus-aliases + connector automation, with a 15-min
   sweep cron as the self-healing net.** No per-user OAuth in MVP (Google verification burden;
   full analysis in ITRACK_CONCEPT.md section 2).
3. **All entity writes go through backend functions with `asServiceRole`; frontend SDK is
   read + invoke + subscribe only.** Ownership is an explicit `owner_email` stamped server-side;
   RLS reads key on it (service-created rows don't carry the end user's `created_by`).
4. **Statuses are monotonic and computed by one writer** (the merge engine): no client ever sets
   a status directly; ranks ordered(0)..delivered(4), branch states annotate.
5. **AI = `InvokeLLM` with `response_json_schema`** for classify/extract/draft; `aiGateway` is the
   pre-decided fallback if schema compliance disappoints.
6. **Exact-match alias routing or quarantine.** Never assign unrouted mail heuristically; admin
   review screen instead.
7. **English-only UI, clean consumer light design** (white cards, soft shadows, imagery forward,
   indigo accent). No RTL/i18n in MVP.

## Project structure

```
iTrack/
  base44/
    .app.jsonc            # gitignored; app id
    config.jsonc          # name, dirs, site.outputDirectory/serveCommand
    entities/             # Order, Shipment, TrackingEvent, EmailRecord,
                          # RefundOpportunity, RefundPolicy, UserSettings, SyncState (.jsonc)
    connectors/gmail.jsonc
    agents/itrack_assistant.jsonc
    functions/
      inbox/onNewMail/  inbox/sweep/  inbox/confirmForwarding/
      account/bootstrap/  account/wipe/  settings/update/
      orders/manualAdd/  orders/setStatus/
      refunds/scan/  refunds/updateStatus/  digest/send/
    shared/               # aliasRouter, htmlToText, classify, extract, mergeEngine,
                          # rehost, carriers, responses
  src/                    # Vite + React (template), pages/ components/ api/ lib/
  PRD.md  BUILD_PLAN.md  CLAUDE.md  FEEDBACK.md  README.md (stage 8)
scripts/                  # base44 exec seed/verify scripts (not deployed)
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

## Stage 2: De-risk spike: Gmail connector + alias routing (GATE, day 1)

The scariest assumption gets verified before anything is built on it.

- [~] `base44/connectors/gmail.jsonc` with readonly scope written; `base44 connectors push` done
      2026-07-22 -> connector PENDING authorization (connectionId base44_6a611a5655287dedb0f0b9be).
      **ROI MANUAL: create the iTrack Gmail account, then open
      https://app.base44.com/api/external-auth/connect/ef769588bf3949a391a883d22bca2eee
      in a browser and authorize while logged into THAT account. If the link has expired, rerun
      `base44 connectors push` for a fresh one. If the final account name differs from
      itrackapp44@gmail.com, update INBOX_BASE in src/api/auth.jsx and set the secret:
      `base44 secrets set ITRACK_INBOX_ADDRESS=<the-address>`.** If readonly-only is rejected, accept the full
      scope set and log to FEEDBACK.md (PRD risk #4). NOTE (logged in FEEDBACK.md): functions with
      a connector automation cannot deploy until the connector is authorized, so after authorizing
      rerun `base44 functions deploy`.
- [ ] Minimal `inbox/onNewMail` that logs the FULL automation payload + fetches the new message's
      headers via `getConnection("gmail")` and logs `Delivered-To` / `X-Forwarded-To` / `To`.
      `function.jsonc` with the connector automation + `has_new_messages` condition (PRD section 6).
      `base44 functions deploy`.
- [ ] Send a plain email to `itrackapp...+testtoken@gmail.com` directly; then FORWARD a real order
      email manually from Roi's personal Gmail to the alias; then create a Gmail filter
      auto-forwarding and repeat. After each: `base44 logs --function inbox/onNewMail`.
- [ ] **GATE decision, recorded here:** which header reliably carries the alias per path. If none
      does on forwards, adopt the fallback (unique subject tag or From-matching) and update PRD
      section 3.1 + this line before proceeding.

**DoD:** automation fires on new mail (logs prove it); alias token recovered for direct AND
manually-forwarded mail (filter-forward result recorded either way); raw payload shape documented
in a comment in `inbox/onNewMail`.

---

## Stage 3: Ingestion pipeline

The backend centerpiece: email in, correct entities out, idempotent, quarantined when unsure.

- [ ] Shared modules: `htmlToText`, `aliasRouter` (from stage 2 findings), `classify` + `extract`
      (single InvokeLLM call, PRD section 8 schema), `mergeEngine` (merge keys, monotonic status,
      shipment aggregation: pure, unit-testable), `carriers`, `rehost` (UploadFile), `responses`.
- [ ] Full `inbox/onNewMail`: idempotency check (gmail_message_id), route, pipeline, EmailRecord
      statuses (parsed/low_confidence/irrelevant/unroutable/failed), quarantine path.
- [x] `inbox/sweep` + SyncState cursor deployed. Scheduling note: this app generation REJECTS
      function.jsonc automations (409 workflows_enabled; FEEDBACK.md); the "Inbox sweep" WORKFLOW
      (every 15 min) was created via a scoped builder prompt and VERIFIED FIRING in logs
      (20:30:04 run hit the expected connector-not-connected error path). "Refund scan" (03:00
      UTC) and "Daily digest" (07:00 UTC) workflows requested the same way; their functions'
      manual-trigger paths are verified; confirm first scheduled runs in tomorrow's logs.
- [ ] Test with 5 real merchant emails (Amazon, Temu, Revolve, AliExpress, local vendor): forward
      confirmation + shipping + delivery variants, including one out-of-order sequence and one
      Amazon-style split into two shipments. Verify via `scripts/verify-ingest.ts` (`base44 exec`).
- [ ] Re-forward two already-processed emails: assert zero new rows. Forward a newsletter: assert
      one `irrelevant` EmailRecord, nothing else.

**DoD:** PRD F1 AC 1-5 and F2 AC 1-3 all pass against the deployed app; sweep visibly advances its
cursor in logs; a deliberately alias-less email lands in quarantine.

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

- [ ] Dashboard: stats row, filter tabs, card grid (image, logo, status chip, progress bar with
      today marker, countdown, refund badge), delivered section collapsed, ETA sort.
- [ ] Realtime: subscribe to Order + TrackingEvent; live card updates + toasts.
- [ ] Order detail: header, shipment blocks (copy tracking number, carrier deep link), timeline
      with source snippets, archive / mark-delivered via `orders/setStatus`.
- [ ] Onboarding screen incl. Gmail-filter walkthrough + `inbox/confirmForwarding` assist.
- [ ] `orders/manualAdd` (paste email text OR tracking number) + UI.
- [ ] Activity feed (latest events, newest first).

**DoD:** PRD F3 AC 1-3, F4 AC 1-3, F6 AC 1-2 (two-window realtime + two-account RLS-over-realtime),
F8 AC 1-2, F9 AC 1-3; narrow-viewport pass on every screen; forward-an-email -> card appears with
no refresh (the demo moment works end to end).

---

## Stage 6: Refund radar + digest

- [ ] `refunds/scan`: overdue detection, policy matching, upsert (unique order+policy, skip
      dismissed), claim drafting; cron `0 3 * * *`; manual trigger path for testing.
- [ ] `refunds/updateStatus` (dismiss/claimed/recovered) + Refunds screen (countdowns, copy claim,
      claim link) + card badges + stats-row sum.
- [ ] `digest/send`: per-user opt-in digest, `Core.SendEmail`, cron `0 7 * * *`; `settings/update`
      function; Settings screen (digest toggle + hour, address, wipe with confirm).
- [ ] `account/wipe` full implementation (all per-user entities).
- [ ] Test fixture: `scripts/force-overdue.ts` backdates a demo order's promised_date.

**DoD:** PRD F5 AC 1-4 and F10 AC 1-3 pass on deployed app (cron verified by manual trigger + one
real scheduled run in logs); wipe leaves a second account's data untouched (leak-test rerun).

---

## Stage 7: Assistant agent + WhatsApp

- [ ] `base44/agents/itrack_assistant.jsonc` (PRD section 9); `base44 agents push`.
- [ ] In-app chat button + conversation UI (SDK agents module); WhatsApp connect button via
      `getWhatsAppConnectURL`.
- [ ] Roi (manual): check the 3-agent WhatsApp limit across his apps; enable WhatsApp for
      `itrack_assistant` in the dashboard.
- [ ] **Isolation gate (PRD F7 AC2 / risk #5):** two-account test through the agent. If entity
      tools leak, switch to function-tools-only and log to FEEDBACK.md.

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

## Open decisions (defaults chosen, override anytime)

- Accent color: indigo #4F46E5. App display name: "iTrack". Repo: `roishmuel/itrack` (private
  until stage 8).
- Demo Gmail: `itrackapp44@gmail.com` (Roi may pick another; record the final one here).
- Demo merchants: Amazon, Temu, Revolve, AliExpress, local pet-food vendor.
- Digest default: on, 07:00 UTC. Sweep cadence: 15 min.
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
