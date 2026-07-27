# Base44 BaaS Feedback Log (Dev Build-Off)

Running log for the submission's feedback section (its own bonus prize: "most helpful feedback").
Add an entry the moment anything surprises, blocks, or delights; date it; include repro steps for
bugs. On submission day this file becomes the answers to the three required questions.

## What worked well

- 2026-07-27: **Agent entity tools inherit RLS correctly, and that is the single best thing we
  tested all build.** Our whole assistant feature rested on an unproven assumption: that an agent
  reading `Order`/`Shipment`/`TrackingEvent` on behalf of a signed-in user cannot see other users'
  rows. Verified from a second, NON-admin account (`scripts/agent-leak-test.mjs`): the agent issued
  `read_Order` with an UNFILTERED `{"query": {}}` and got back exactly ONE row, its own, while the
  other account owned 11. User-scoped agent memory held too: account B's "what do you remember about
  me?" came back empty minutes after account A saved a memory. Zero app code was needed to get this
  right, which is exactly how it should be, and it is worth documenting explicitly because right now
  a developer has no way to know it without testing it themselves.

- 2026-07-27: **WhatsApp needed zero backend work and the round trip worked first try.** From an
  agent that already existed, the entire cost of a second channel was one `whatsapp_greeting` line
  in the agent jsonc and a link built by `getWhatsAppConnectURL()`. On a real phone: send the
  prefilled activation message, get the greeting back, ask "where's my Mikasa ball?", and the same
  tool-backed answer arrives as in the web chat, correctly scoped to that account's own orders. No
  webhook, no number provisioning, no message-template approval, no session-window handling. Having
  built a WhatsApp integration the normal way before, this is the single largest effort gap between
  Base44 and doing it yourself that we hit in this build.

- 2026-07-27: **Nested function-tool names resolve.** `{ "function_name": "orders/manualAdd" }` in
  an agent's `tool_configs` works with the slash intact: the tool call comes back named exactly
  `orders/manualAdd` with `status: "success"`. Our 4xx error contract also survives the trip: a
  function returning `{ error, reasons: [{code: "tracking_invalid", message: "That tracking number
  looks too short"}] }` reached the user as "the tracking number 'AB1' is too short to be valid",
  not a generic apology. Undocumented, worth documenting.

- 2026-07-22: `base44 create --template backend-and-client` into a NON-empty directory just
  worked, kept our existing docs, and shipped an `.agents/skills/` folder with genuinely accurate
  CLI + SDK reference docs. Those bundled docs (entities.md, base44-agents.md, auth.md) were the
  single biggest time-saver of the day: every method name we used came from them and none was wrong.
- 2026-07-22: `base44 entities push` registered all 8 schemas 1:1 on the first try, including
  full `rls` blocks with `$or` + `user_condition`, and cleanly deleted the template's sample
  entity. Diffing `list_entity_schemas` against the repo showed zero drift.
- 2026-07-22: `base44 exec` is a superpower for headless verification: we proved the whole
  ingest pipeline (merge, out-of-order monotonicity, split shipments, newsletter rejection),
  refund scan idempotency, digest sends, and even realtime `subscribe()` delivery end to end
  without ever opening the dashboard.
- 2026-07-22: `InvokeLLM` with `response_json_schema` was impressively reliable on real-world
  order emails: correct order numbers, totals, date-range resolution ("Jul 25 - Jul 27" -> the
  last day), per-item prices, and honest confidence scores, with zero schema violations across
  every test email we threw at it.
- 2026-07-22: The error contract pattern (4xx + `{error, reasons[]}`) plus `functions.invoke`
  surfacing the body on `err.response.data` made server-to-toast error plumbing trivial.
- 2026-07-22: `base44 agents push` + entity tools: the assistant answered "Where are my LED strip
  lights?" correctly on the FIRST try, reading the user's own orders through RLS-scoped tools.
- 2026-07-23: **Realtime `subscribe()` enforces RLS per-subscriber (F6 AC2 verified live, two
  accounts).** All users share one room per entity (`entities:<appId>:<Entity>`), yet in a
  two-account test account B received ONLY its own 5 create/update/delete events and NONE of
  account A's, which were churned in the same rooms during the same window. The server filters the
  broadcast by row ownership before delivery - exactly what we needed and could not safely assume.
  PRD risk #2 (subscribe leaking across users) closed; no polling fallback required.

## Where we got stuck / confused

- 2026-07-27: **The WhatsApp "Connect" button is not what its name implies, and there is no visible
  channel state anywhere.** We expected an enable/disable channel toggle (and had planned around a
  rumoured "3 agents with WhatsApp per workspace" cap). What the green **Connect** button on
  Agents -> agent -> WhatsApp actually does is open `api.whatsapp.com/send/` with a per-click
  activation code, i.e. it is the exact same thing as the SDK's `getWhatsAppConnectURL()`: an
  end-user deep link, not an admin action. Two consequences we had to discover by clicking: (a) the
  channel appears to be live for every agent already, so there was nothing to "enable" and no cap
  surfaced anywhere in the UI; (b) every click mints a NEW activation code against a DIFFERENT
  pooled number (we saw three distinct US numbers in five minutes), which is alarming the first time
  you see it because it reads like the previous link was invalidated. Asks: rename the button to
  something like "Get connect link", show the channel's actual state and assigned number on the
  agent card, and document the cap (or confirm there is none).

- 2026-07-27: **`getTelegramConnectURL` exists in the SDK and a Telegram tab exists in the agent
  config, but neither appears in the docs we could find.** It sits right next to
  `getWhatsAppConnectURL` in `AgentsModule` with a full doc comment, so it is clearly intentional;
  it just never shows up when you go looking for "what channels can my agent use". A one-line
  channels overview in the agents docs would have saved us guessing.

- 2026-07-26 (live, one occurrence, hypothesis): **a `functions deploy` may not serve the new
  bundle immediately.** We changed the Gmail search string inside `inbox/syncMyMail` (removed a
  `from:` sender), deploy reported success, and a sync triggered ~18 minutes later STILL listed 16
  emails only the OLD query matches (all from the removed sender). A second sync ~15 minutes after
  that used the new query (those 16 no longer listed, same 60-day window). Same function, no code
  change in between, so either warm instances keep serving the previous bundle for a while or
  registration completes async after the CLI returns. Repro odds unknown; worth knowing that
  "deployed" does not always mean "what runs on the next invocation".
- 2026-07-26 (live, systematic across ~40 real emails): **`InvokeLLM` follows enum fields far
  better than prose exclusion rules.** A prompt with an explicit "always irrelevant" list (SaaS,
  food delivery, flights) was ignored at 0.9+ confidence whenever the email LOOKED like an order
  receipt: Wolt food receipts, Atlassian/Namecheap SaaS orders, and a flight booking all came back
  `is_order_related: true`. Adding a required `product_kind` enum to `response_json_schema`
  (physical_goods / food_or_grocery_delivery / digital_or_saas / service_or_booking / other) fixed
  it completely: every one of the same emails was tagged with the right kind at confidence 1, and
  the relevance decision moved into backend code keyed on that enum. Rule of thumb for InvokeLLM:
  make the model NAME facts via schema enums; never ask it to fold an exclusion policy into a
  boolean.

- 2026-07-22 (CLI 0.1.5, live, repro'd 3x): **A `function.jsonc` in the function folder breaks
  `base44/shared/` imports at deploy.** With `base44/functions/inbox/sweep/{entry.ts,function.jsonc}`,
  deploy fails server-side with `Cannot import "../../../shared/gmail.ts": it must reference a file
  bundled with this function` - for direct AND transitive shared imports. Delete ONLY the
  function.jsonc (same code) and it deploys fine. Functions without a function.jsonc (e.g. our
  account/bootstrap, orders/manualAdd) import shared/ without issues. Looks like the
  config-bearing deploy path validates imports against just the function folder, ignoring the
  documented `base44/shared/` allowance. Repro: any function folder with a minimal
  `{"name","entry"}` function.jsonc + an entry importing `../../../shared/x.ts`.

- 2026-07-22 (live): **New apps are on Workflows, and `function.jsonc` automations 409.** Deploying
  a cron automation returns `status=409 This app uses Workflows - legacy automations are disabled
  for it (reason: workflows_enabled)`. But the developer docs + changelog (Feb 10, 2026) still
  present function.jsonc automations as THE mechanism, the CLI still validates and ships them, and
  there is no `base44 workflows` command and no documented API/CLI write path for workflows: the
  only path is a natural-language prompt to the builder chat. For a CLI-first developer-platform
  build this is a hard wall: scheduling now requires the no-code surface. Suggestions: (a) accept
  function.jsonc automations on Workflows apps by auto-converting them to workflows at deploy,
  (b) ship `base44 workflows push` with a declarative file format, (c) at minimum document the 409
  + the builder-prompt path in the developer docs.

- 2026-07-22 (CLI 0.1.5, live): **Deploy ordering constraint between connectors and connector
  automations.** `base44 functions deploy` of a function whose `function.jsonc` declares a
  `type: "connector"` automation fails with `Automation processing failed: Integration 'gmail' is
  not connected. Please connect it first.` when the connector exists only in a pending
  (unauthorized) state. So the required order is: `connectors push` -> authorize in browser ->
  `functions deploy`. The error message is clear (good!), but the docs never mention the ordering,
  and a CI/scripted deploy that ships both together will fail non-obviously. Suggestion: deploy the
  function code and register the automation as inactive-pending instead of failing the whole
  function, or document the required order.

- 2026-07-22 (docs research): The split between the two Base44 products is easy to trip over.
  The connectors docs for app users say the OAuth flow "runs under your registered OAuth
  application" but the shared-connector page never states the mirror fact (that Base44's own OAuth
  app is used and no client registration is needed). Making that difference explicit on both pages
  would have saved a full architecture detour.

- 2026-07-23 (SDK 0.8.3, live): **`auth.verifyOtp` silently drops a mis-named param and produces a
  user-facing dead end.** The method signature is `verifyOtp({ email, otpCode })` (it posts
  `otp_code`); we passed the intuitive `{ email, otp }`, so axios stripped the undefined field and
  every verification failed with a generic server error. Nothing catches this client-side: no
  runtime validation, and in a plain JS app no type error either. A real unverified user was stuck
  in a loop of "stale" codes until we read the SDK source. Suggestion: validate required params in
  the SDK and throw a descriptive error (`verifyOtp requires otpCode`), or accept `otp` as an
  alias. Repro: `base44.auth.verifyOtp({ email, otp: "123456" })` -> request body `{email}` only.

- 2026-07-23 (live, observed while testing recovery flows): **Account-existence disclosure is
  inconsistent across auth endpoints.** `POST /auth/reset-password-request` is deliberately silent
  for unknown emails (200 either way - good), but `POST /auth/resend-otp` answers `User not found`
  for a nonexistent address, so it can be used to enumerate which emails have accounts. Suggestion:
  make resend-otp respond 200 unconditionally, like the reset request does.

- 2026-07-23 (SDK 0.8.3, Node headless): **The realtime `subscribe()` socket connects ANONYMOUSLY
  and silently in Node - zero events, no error - when the token is not passed to `createClient`.**
  `client.js` sets `socketConfig.token` from `createClient(config).token`, and the only fallback is
  `getAccessToken()` -> `window.localStorage`, absent in Node. A client that authenticates AFTER
  construction (`auth.loginViaEmailPassword` / `setToken`) therefore has authed HTTP (in-memory
  token on axios) but an UNAUTHED socket: it connects, joins no authed rooms, and the callback
  never fires - with no `error`/`connect_error`. This cost a full debug cycle on a two-account RLS
  test (0 events read as broken realtime, not as a missing token). Fix on our side: resolve the
  token first and pass it to `createClient({ token })`. Suggestions: (a) have `setToken()` refresh
  the socket auth (`updateConfig`) so post-construction login also authenticates the socket,
  (b) emit a console warning when the realtime socket connects with no token, (c) document that
  headless/Node realtime needs the token in `createClient`.

## What is missing / feature requests

- 2026-07-22: **App-user connectors have no service-role, by-user token API and no per-user
  connector automations.** `getCurrentAppUserConnection()` is request-scoped only, so a cron
  cannot iterate users and read their mailboxes, and `type: "connector"` automations fire only for
  shared connectors. Per-user webhook triggers (or a `getAppUserConnection(userId)`) would unlock
  a whole class of per-user sync products without polling.

- 2026-07-27: **No `agents list` / `agents pull`, so a pushed agent config is unverifiable from the
  CLI.** `agents push` is a full replace and prints only "Updated: <name>"; there is no way to read
  back what the platform currently holds. We could only confirm our config had landed by opening the
  dashboard and eyeballing the Welcome Message character count (123/500 matched our
  `whatsapp_greeting` exactly). Ask: `base44 agents list` plus a `pull`/`diff` that writes the remote
  config back as jsonc, the way `entities` and `functions` can be inspected.

- 2026-07-27: **Agent tool results come back as PYTHON REPR strings, not JSON.** A tool call's
  `results` field looks like `[{'merchant_name': 'Salomon', 'price': None, 'created_date':
  datetime.datetime(2026, 7, 27, ...), 'is_sample': False}]`: single quotes, `None`, `False`, and
  bare `datetime.datetime(...)` constructor calls. `JSON.parse` fails on every one, so anything
  programmatic (tests, audit tooling, a UI that renders tool output) has to string-match. This leaks
  the backend's Python implementation through a documented TypeScript-typed field
  (`AgentMessageToolCall.results: string`). Ask: serialize tool results as JSON.

## Bugs (with repro)

- 2026-07-23 (BLOCKER for BYO app-user Gmail OAuth on a default `<slug>.base44.app` app):
  **The app-user connector OAuth flow redirects to the APEX `https://base44.app/api/external-auth/callback`,
  which Google refuses to register because `base44.app` is on the Public Suffix List** (like
  `vercel.app`/`netlify.app`) - Google errors "Invalid Redirect: must use a domain that is a valid
  Top private domain." This CONTRADICTS Base44's own "View redirect URIs for your apps" modal, which
  for this app listed only registerable URIs: `https://app.base44.com/api/external-auth/callback`
  and the slug subdomains `https://i-track-2bdb7160.base44.app/...` (+ `app--`, `preview--`,
  `share--` variants). I registered ALL of those in the Google client; the live "Connect Gmail" on
  `https://i-track-2bdb7160.base44.app` still failed with `redirect_uri_mismatch`, redirect_uri =
  `https://base44.app/...` (decoded from the accounts.google.com error). Repro: create a BYO Google
  OAuth client, register exactly the URIs the modal shows, set up the Gmail app-user connector,
  open the hosted slug app, click Connect - Google rejects because the runtime sent the apex, which
  is not registerable and was never in the modal's list. Expected: the runtime should redirect to
  the slug subdomain it told me to register (that one IS registerable and would match). Net effect:
  BYO per-user Gmail OAuth appears impossible on a default `<slug>.base44.app` app; it likely needs
  a CUSTOM DOMAIN (Base44's custom-Google-OAuth docs do start with "connect a custom domain"), but
  the connectors "redirect URIs" modal never says so and offers slug URIs that the flow doesn't use.
  Asks: (a) make the app-user connector flow redirect to the slug subdomain (or app.base44.com) that
  the modal advertises, OR (b) if a custom domain is truly required, say so in the modal and the
  Gmail-connector docs and stop listing slug URIs that won't be used.

  UPDATE 2026-07-23 (definitive, after trying the custom-domain fix): **a custom domain does NOT
  fix it.** Connected a verified-serving custom domain (itrack.inboxfiles.com, CNAME ->
  base44.onrender.com, HTTP 200 + valid cert), set the SDK `appBaseUrl` to it, redeployed, logged in
  ON the custom domain, and clicked Connect Gmail: the connector STILL sent
  redirect_uri=`https://base44.app/api/external-auth/callback` (the bare apex), identical to the
  base44.app-served attempt. So the connector redirect_uri is HARDCODED to the apex regardless of
  the app's built-in URL, custom domain, or appBaseUrl. Crucially, on the SAME custom domain the
  built-in Google **login** (loginWithProvider) worked flawlessly - it used
  `https://app.base44.com/api/apps/auth/callback` with the app domain carried in `state`
  (`state.domain=https://itrack.inboxfiles.com`). So Base44 already has the correct pattern for the
  login callback; the app-user **connector** callback just doesn't use it. Net: BYO per-user Gmail
  (or any app-user OAuth connector) is currently IMPOSSIBLE on Base44 with a custom Google client,
  because the one redirect_uri it emits can never be registered in Google. Fix is one-line on
  Base44's side: build the connector redirect_uri from the app's domain (as the login callback
  already does) instead of the hardcoded base44.app apex.

  RESOLUTION 2026-07-23 (root cause found; app-side fix; per-user Gmail now WORKS end-to-end). The
  redirect_uri is NOT hardcoded - the connect-initiate endpoint MIRRORS THE REQUEST HOST into the
  OAuth redirect_uri. The trap: the SDK's `createClient` defaults `serverUrl` to the `base44.app`
  apex and does NOT derive it from `appBaseUrl`, so `base44.connectors.connectAppUser(id)` POSTs
  `/api/apps/{app}/app-user-auth/connectors/{id}/initiate` to the APEX host, and the server then
  builds redirect_uri=`https://base44.app/.../callback` (unregisterable). This explains both earlier
  red herrings: (1) the custom domain didn't help because `appBaseUrl != serverUrl`; (2) our CLI/curl
  probe looked fine because the CLI's SDK resolved `serverUrl` to the slug and so minted a
  registerable URL - a FALSE POSITIVE that masked the browser's apex behavior (lesson: reproduce
  through the actual in-app button, not a CLI proxy). Fix (app-side, shipped in
  `src/api/auth.jsx`): call the initiate endpoint on the app's OWN origin
  (`${window.location.origin}/api/apps/{app}/app-user-auth/connectors/{id}/initiate`) with the
  bearer token, then follow the returned `redirect_url`; the server mirrors the slug/preview/custom
  host, whose callback IS registered. Verified through the live "Connect Gmail" button: Google
  consent (readonly) -> callback -> `getCurrentAppUserConnection` -> `syncMyMail` imported 48 orders
  from Roi's own mailbox. Base44 asks (still valid, so this works out-of-the-box): (a) default the
  SDK `serverUrl` from `appBaseUrl`, or surface `serverUrl` as a first-class client option; and/or
  (b) normalize the connect redirect_uri to a registerable host (app.base44.com or the slug) instead
  of mirroring the bare apex - exactly as the built-in login callback already does.

- 2026-07-23: **Entity reads are not read-your-writes consistent within a sequential function run,
  which silently produces duplicate rows.** `inbox/syncMyMail` processes messages one-by-one (await
  each), and each re-`filter`s Orders/Shipments to find its merge target. A row `create`d ~0.3-1s
  earlier was frequently NOT returned by the next `filter`, so two emails about the same order - and
  even the same message reprocessed across the frontend's rapid loop of syncMyMail calls - each
  created a fresh Order + EmailRecord + TrackingEvent. Observed on one real 84-message sync: 10
  duplicate Order groups (identical merchant+order#, created 0-1s apart), 25 duplicate EmailRecords
  sharing a gmail_message_id, 18 duplicate TrackingEvents. Repro: `create()` a row then immediately
  `filter()` for it in the same function - it may be absent. Worked around app-side with a per-run
  in-memory cache (created rows are unioned into the merge candidates) plus an order-number-only
  merge key; cross-invocation reprocessing (idempotency read-lag across the frontend's separate sync
  calls) was then closed by switching `inbox/syncMyMail` to Gmail page-token pagination (one page per
  call; the frontend echoes `next_page_token`), so no call re-lists a prior call's messages and the
  read-lag never gets a second chance to duplicate. Ask still stands: document the read-after-write
  consistency model for entities, or offer a strong-read / read-your-writes option for filter().

- 2026-07-23: **The workflow builder mis-applied a multi-workflow prompt: daily schedules came out
  as 15-minute schedules.** Prompted the dashboard AI (via MCP edit) to create three workflows with
  explicit cadences ("Refund scan ... DAILY at 03:00 UTC", "Daily digest ... DAILY at 07:00 UTC",
  "Inbox sweep ... every 15 minutes"). Result observed in function logs: ALL THREE functions fired
  every ~15 minutes all night (digest/send POSTs at :00/:15/:30/:45 from ~21:00 to 05:00+), which
  spammed the app owner with ~a dozen identical digest emails until an application-level
  once-per-day guard was added. A corrective prompt was needed. Two asks: (a) make the workflow
  builder echo back the parsed trigger spec (name + cadence + timezone) for confirmation before
  creating, and (b) give workflows a declarative file/CLI write path so cadence is exact by
  construction (same ask as the workflows_enabled entry above).

- 2026-07-22: Docs page `developers/backend/products/realtime` renders literal placeholder text
  ("Placeholder content for Realtime."). Repro: open the page; expected: realtime docs or a
  redirect to the SDK subscribe reference.
- 2026-07-22 (carried from a prior project, worth re-verifying on current CLI): the automations
  docs example uses Quartz-style `"cron_expression": "0 0 * * ?"`, but `functions deploy` rejects
  `?` ("not valid in standard Unix cron"). Either the validator should accept the doc example or
  the example should use `*`.

## Detailed notes / comparisons

- (overall experience, workflow notes, comparisons to Supabase/Firebase, added along the way)

## NPS (fill at submission)

- Score: TBD (Roi's honest number)
- Follow-up contact consent: yes
