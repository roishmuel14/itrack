# Base44 BaaS Feedback Log (Dev Build-Off)

Running log for the submission's feedback section (its own bonus prize: "most helpful feedback").
Add an entry the moment anything surprises, blocks, or delights; date it; include repro steps for
bugs. On submission day this file becomes the answers to the three required questions.

## What worked well

- (add as discovered during the build)

## Where we got stuck / confused

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
