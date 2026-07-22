# iTrack: Build Plan

Internal working document, derived from [PRD.md](PRD.md) v1.0 per the `prd-to-build-plan` skill
(Base44 CLI branch). Every stage ends with a running, testable system, not partial code. A checkbox
gets ticked only after the stage's DoD passes on the DEPLOYED app (not just locally).

Competition deadline: **submit by July 28, 2026**. Day mapping at the bottom.

## Current status

- [x] Stage 0: Foundation (scaffold, git, deploy skeleton) - done 2026-07-22; Roi manual items
      (enroll, iTrack Gmail account, Builder+ confirm) still pending, gate stage 2
- [ ] Stage 1: Data layer (all schemas + RLS + seed + mutation pattern proven)
- [ ] Stage 2: De-risk spike: Gmail connector + alias routing (GATE)
- [ ] Stage 3: Ingestion pipeline (parse, merge, sweep, quarantine)
- [ ] Stage 4: Frontend shell + shared kit
- [ ] Stage 5: Dashboard + timeline + onboarding (MILESTONE 1: daily usable)
- [ ] Stage 6: Refund radar + digest
- [ ] Stage 7: Assistant agent + WhatsApp
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

- [ ] Write all 8 entity JSONCs from PRD section 5 (Order and EmailRecord verbatim; rest from the
      field tables, RLS = the Order pattern).
- [ ] `base44 entities push`; diff the dashboard Data section against the files.
- [ ] `base44 types generate`.
- [ ] Seed RefundPolicy (6 policies from PRD F5) via `scripts/seed-policies.ts` + `base44 exec`.
- [ ] Prove the mutation pattern on the simplest function: `account/bootstrap` (auth -> owner
      check -> asServiceRole write with `owner_email` -> error contract). `base44 functions deploy`,
      verify via curl (anonymous gets 401 JSON, authenticated via `base44 exec` invoke gets settings
      with a unique alias).
- [ ] Create a second test account (invite or register). Write `scripts/leak-test.ts`: as user B,
      list every per-user entity and assert zero of user A's rows; also `subscribe()` as B while A
      changes -> assert no events (PRD risk #2).

**DoD:** schemas live and matching the repo; policies seeded; bootstrap returns unique aliases for
two accounts; **leak test passes for reads AND realtime**; anonymous function call gets a clean 401.

---

## Stage 2: De-risk spike: Gmail connector + alias routing (GATE, day 1)

The scariest assumption gets verified before anything is built on it.

- [ ] `base44/connectors/gmail.jsonc` with readonly scope; `base44 connectors push`; Roi authorizes
      with the iTrack Gmail account in the browser. If readonly-only is rejected, accept the full
      scope set and log to FEEDBACK.md (PRD risk #4).
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
- [ ] `inbox/sweep` + SyncState cursor; cron `*/15 * * * *`; deploy both.
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
