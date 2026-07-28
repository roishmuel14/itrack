# iTrack

Personal delivery command center: forwarded order emails become live tracking cards. Base44 Dev
Build-Off entry; **submission deadline July 28, 2026**. English-only UI, single-user-per-data-row.

- **Source of truth for requirements:** [PRD.md](PRD.md)
- **Execution plan and progress tracking:** [BUILD_PLAN.md](BUILD_PLAN.md). Work stage by stage.
  When a stage's DoD passes on the DEPLOYED app, check it off in BUILD_PLAN.md before moving on.
- Background: [ITRACK_CONCEPT.md](ITRACK_CONCEPT.md) (rationale),
  [BASE44_BUILDOFF_REFERENCE.md](BASE44_BUILDOFF_REFERENCE.md) (platform manual + submission
  checklist), [FEEDBACK.md](FEEDBACK.md) (running platform-feedback log: bonus prize lane).

## Hard rules (apply to every change)

1. **Base44 developer platform via CLI only.** Never use the no-code builder MCP tools
   (`create_base44_app`, `edit_base44_app`, `create_entities`, `update_entity_schema`) on this
   app for code, schemas, or data: different product. Schemas are `base44/entities/*.jsonc` +
   `base44 entities push`; functions deploy with `base44 functions deploy`; data scripts run via
   `base44 exec`. **Sole exception (forced 2026-07-22): Workflows.** This app generation has
   legacy `function.jsonc` automations DISABLED (409 workflows_enabled), and workflows' only
   write path is a builder prompt; so scheduling/connector triggers are created via a tightly
   scoped `edit_base44_app` prompt that names the function, trigger, schedule, and args, and
   NOTHING else. Never keep `automations` arrays in function.jsonc, and prefer no function.jsonc
   at all (its presence also breaks `base44/shared/` imports at deploy; see FEEDBACK.md).
2. **Deploy after every change.** Function changed -> `base44 functions deploy` (file presence
   registers nothing). Schema changed -> `entities push`. Frontend -> `npm run build` +
   `base44 deploy -y`. Automations never run under `base44 dev`; verify them on the live app via
   `base44 logs`.
3. **All entity writes go through backend functions with `asServiceRole`.** Frontend SDK is
   read + `functions.invoke` + `subscribe` only. Every per-user row gets `owner_email` stamped
   server-side from `auth.me()` (never from the request body); RLS reads key on
   `data.owner_email`.
4. **Ingest invariants (per-user OAuth model, PRD amendment v1.1):** each user syncs their OWN
   Gmail via the app-user connector (`GMAIL_CONNECTOR_ID` secret; token via
   `getCurrentAppUserConnection`, request-scoped, so sync only runs for the signed-in caller);
   idempotent per (`owner_email`, `gmail_message_id`) checked against EmailRecord first; statuses
   are monotonic (ordered -> shipped -> in_transit -> out_for_delivery -> delivered) and only the
   merge engine sets them. No shared inbox, no alias routing, no background sweep.
5. **Function code contract:** wrap `auth.me()` in try/catch (it throws on anonymous); business
   failures return `{ error, reasons: [{code, message}] }` with 4xx; every route is anonymously
   reachable, so cron/webhook paths accept only declared automation args and stay idempotent.
6. **`invoke` responses unwrap at `.data`** (axios-style); reading the top level is a bug.
7. **Never commit `base44/.app.jsonc` or any secret.** The repo goes PUBLIC at submission; run
   the secrets audit before flipping. Secrets go through `base44 secrets set`.
8. **No em dashes anywhere** (code, UI, docs, commits). English-only UI. Log every platform
   surprise to FEEDBACK.md immediately, with repro steps.

## Stack (pinned)

Base44 backend (entities + Deno functions + shared Gmail connector + agents + realtime + storage);
Vite + React template frontend (`src/`), clean-consumer-light theme, indigo #4F46E5 accent;
AI via `integrations.Core.InvokeLLM` with `response_json_schema` (fallback: `aiGateway`). Do not
add databases, auth providers, or hosting outside Base44.

## Layout

`base44/entities/` 7 schemas; `base44/functions/` 12 functions (inbox/syncMyMail, account/,
settings/, orders/, refunds/, digest/); `base44/shared/` parse+merge modules; `base44/agents/
itrack_assistant.jsonc`; `scripts/` exec-run seed/verify tools. Gmail access is a per-user
app-user connector configured in Workspace Settings (connector id in the `GMAIL_CONNECTOR_ID`
secret), not a repo connector file.
App id lives in gitignored `base44/.app.jsonc`; record id + live URL here after stage 0:
**app id: 6a6117b2e209abd12bdb7160, URL: https://i-track-2bdb7160.base44.app**.

## Verification habits

- End of any stage touching data surfaces: rerun the two-account leak test (reads, `subscribe()`,
  and agent tools).
- Cron/webhook behavior: trigger manually via the function route, then confirm one real scheduled
  run in `base44 logs`.
- Every screen: narrow-viewport (375px) pass and explicit empty/loading/error states.
- DoD means verified on the live `*.base44.app` URL, not "looks right in code".
