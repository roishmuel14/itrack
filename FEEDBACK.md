# Base44 BaaS Feedback Log (Dev Build-Off)

Running log for the submission's feedback section (its own bonus prize: "most helpful feedback").
Add an entry the moment anything surprises, blocks, or delights; date it; include repro steps for
bugs. On submission day this file becomes the answers to the three required questions.

## What worked well

- (add as discovered during the build)

## Where we got stuck / confused

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

## What is missing / feature requests

- 2026-07-22: **App-user connectors have no service-role, by-user token API and no per-user
  connector automations.** `getCurrentAppUserConnection()` is request-scoped only, so a cron
  cannot iterate users and read their mailboxes, and `type: "connector"` automations fire only for
  shared connectors. Per-user webhook triggers (or a `getAppUserConnection(userId)`) would unlock
  a whole class of per-user sync products without polling.

## Bugs (with repro)

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
