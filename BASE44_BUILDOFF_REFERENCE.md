# Base44 Dev Build-Off: Build Reference

Everything needed to build and submit an entry. Written 2026-07-22.
Source of truth for competition facts: `https://backendcompetition.base44.app` (scraped, including the
judging rubric and submission form pulled from the app's own JS bundle).
Source of truth for platform facts: `docs.base44.com` developer docs (via the Base44 docs MCP).

---

## 0. The clock

| | |
|---|---|
| **Build window** | **July 21-28, 2026** (1 week) |
| **Today** | July 22, 2026 |
| **Time left** | ~6 days |

**Action needed from you before anything else:** enroll at
`https://backendcompetition.base44.app/enroll` (full name + email, 5 seconds). I did not submit this
for you: it is a form with your personal details, so it is yours to click. Enrollment and submission
are separate; you can submit any time inside the window.

---

## 1. What the competition is

> "Build in your favorite tools, deploy on Base44."
> Build anything in Claude Code, Cursor, or any other tool, ship it on Base44's all-inclusive backend
> (database, hosting, auth, functions, realtime), and win $10,000.

- **Prize:** $10,000, winner takes all, plus a feature from founder Maor to his audience.
- **Bonus prize:** "most helpful feedback" wins a surprise from the team, winning app or not.
  (This is a real second lane. See section 4: the feedback form is mandatory anyway.)
- **Cost:** free. No entry fee. You keep full ownership of what you build.
- **Eligibility:** open to all developers, online, build from anywhere.
- **The `/terms` page is currently blank.** No published rules text beyond the site copy as of
  2026-07-22. Worth re-checking before submitting.

### Official FAQ (verbatim answers from the site)

- **What is the Base44 backend platform?** "It's a managed backend you build on from the command
  line: database, auth, AI, real-time, storage, and hosting, all handled for you. It's separate from
  the Base44 no-code builder."
- **Do I need experience with it?** "No. Most entrants are new to it." Docs, starter templates, and
  office hours are offered.
- **What can I build?** "Anything, as long as it runs on a Base44 backend with your own frontend. A
  web app, a Chrome extension, a Telegram bot, a mobile app, even a game. **The more creative and the
  deeper on the backend, the better.**"
- **Can I use AI coding tools?** "Yes, and we encourage it. Tools like Cursor and Claude Code work
  great with a Base44 backend."
- **How are winners chosen?** "Judges score every entry on backend depth, frontend creativity,
  usefulness, polish, and documentation."

### The one hard constraint

The app must run on a **Base44 backend** (the CLI/BaaS product, `npx base44 create`) with **your own
frontend**. This is explicitly *not* the no-code app builder. Anything you already know about
`app.base44.com`, the AI builder, and the GitHub 2-way sync is a different product and mostly does
not apply here.

---

## 2. The judging rubric (exact weights)

Pulled from the competition app's own judging UI. Two rounds.

**Round 1 - Triage:** each entry gets a verdict of Yes (strong candidate) / Maybe (worth a second
look) / No, plus an optional "flag for second look".

**Round 2 - Scoring, out of 100:**

| Axis | Max | Share |
|---|---|---|
| **Backend depth & technical execution** | **40** | 40% |
| Frontend creativity & surface | 25 | 25% |
| Real-world usefulness | 20 | 20% |
| Polish & completeness | 10 | 10% |
| Write-up & documentation | 5 | 5% |

**How to read this:**

- **Backend depth is the whole game.** It is worth more than usefulness and polish combined. An app
  with a modest UI and a genuinely deep backend beats a beautiful CRUD app. Every hour spent on the
  backend is worth ~1.6x an hour spent on the frontend and ~4x an hour on polish.
- **Surface counts for 25%.** The judges call out Chrome extensions, Telegram bots, mobile, and games
  as valid. A plain web dashboard competes against every other plain web dashboard on polish alone.
  A bot or extension differentiates cheaply.
- **Documentation is only 5 points but it is nearly free.** A good README plus the optional write-up
  field is maybe 45 minutes of work for the full 5.
- **Polish at 10 points** means: it works when a judge clicks it, empty states exist, nothing 500s.
  Do not gold-plate.

---

## 3. The submission form (build toward this)

Three sections. Every field below is exactly what you will be asked. Read it now so nothing is a
surprise on day 6.

### Section 1: Submission

| Field | Required | Notes |
|---|---|---|
| Full name | Yes | |
| Email | Yes | validated |
| Project title | Yes | |
| One-line pitch | Yes | "The hook in a sentence" |
| Surface type | Yes | one of: Web app, Chrome extension, Bot, Mobile, Desktop, Game, Other |
| Project URL | if web | must be a valid `https://` URL |
| **Repo URL** | **Yes** | **"Required - repo must be public"** |
| Access instructions | if non-web | "Bot handle, install steps, test credentials..." |
| Demo video URL | recommended | "2-3 min" |
| Project write-up | optional | **"scored under documentation"**: how you built it, decisions, learnings |
| Consent to feature in marketing | checkbox | defaults to on |
| Agentic IDE used | optional | "Cursor, Codex, Claude Code..." |
| App ID | optional | from your dashboard |

### Section 2: Backend features used

Checkboxes. **At least one is required.** Label on the form:
*"Tick everything you incorporated. This helps judges gauge backend depth - **verified against your
repo**."*

- [ ] Authentication & user management
- [ ] Database / entities
- [ ] Backend functions (Deno)
- [ ] AI / LLM / agents
- [ ] Real-time subscriptions
- [ ] File & media storage

**This checklist is the backend-depth scorecard.** It is verified against the public repo, so do not
tick what you did not build. Target: all six, each used for a real reason rather than a token call.
Section 6 maps each one to the exact API.

### Section 3: BaaS feedback (this is the bonus-prize lane)

| Question | Required |
|---|---|
| What BaaS capabilities worked well or felt great to use? | Yes |
| Where did you get stuck, confused, or blocked? ("Don't hold back - this is gold for our team.") | Yes |
| What was missing, or what would you add? | Yes |
| Bugs (links, error messages, repro steps welcome) | No |
| Detailed feedback (overall experience, suggestions, comparisons to other tools) | No |
| NPS 0-10 | slider, defaults to 7 |
| Consent to follow-up contact | checkbox |

**Keep a `FEEDBACK.md` in the repo from day 1.** Every time something surprises you, blocks you, or
is missing, write one line with the timestamp and the error. On submission day you paste it in. This
costs nothing during the build and is the entire qualification for the second prize. Bug reports with
repro steps are what they are asking for.

---

## 4. What we are building

**iTrack: a personal delivery command center.** Connect your Gmail once; every in-flight order
(Amazon, Temu, Revolve, the local dog-food vendor) becomes a live card with product image, status,
a progress bar toward the promised date, the full email timeline, and a refund radar that flags
money you're owed when packages run late. WhatsApp agent as a companion Q&A surface.

**Authoritative specs (2026-07-22): [PRD.md](PRD.md) for requirements, [BUILD_PLAN.md](BUILD_PLAN.md)
for execution stages and progress.** [ITRACK_CONCEPT.md](ITRACK_CONCEPT.md) remains as rationale and
history. The PRD/BUILD_PLAN supersede both this section and the generic plan in section 11 below.

Decisions made:

- **Language:** English only. No RTL work, no i18n layer.
- **Surface:** web app (the dashboard is the product) + WhatsApp agent companion. Submit as "Web app".
- **Gmail ingest:** Base44 app-user connector over our own Google OAuth client in Testing mode
  ($0, no CASA, 100 test users, 7-day refresh expiry - harmless inside a 6-day window).
- **Chrome extension:** rejected. Same restricted-scope burden plus store review, and the core
  logic belongs server-side anyway.

---

## 5. Setup: the exact commands

Verified on this machine 2026-07-22:

- Node `v22.18.0` (requirement is >= 20.19.0). OK.
- `base44` CLI `0.1.5` installed globally. OK.
- Logged in as `roishmuel14@gmail.com`. OK.
- **Deno is required for running backend functions locally** with `base44 dev`. Check before day 1.

```bash
node -v && base44 --version && base44 whoami && deno --version
```

### Create the project

```bash
base44 create iTrack --path /Users/roishmuel/Dev/iTrack --template backend-and-client
```

Templates: `backend-only` or `backend-and-client` (Vite + React + Tailwind + shadcn, with a
pre-wired SDK client at `src/api/base44Client.js`). Add `--deploy` to build and deploy the site
immediately after creation. Providing both `name` and `--path` runs it non-interactively.

Base44 agent skills are installed into the project automatically (`.claude/skills/`), so Claude Code
picks up `base44-cli`, `base44-sdk`, and `base44-troubleshooter` inside the repo. To refresh:

```bash
npx skills add base44/skills
```

### Everyday loop

```bash
base44 dev                      # local backend (port 4400) + frontend if site.serveCommand is set
base44 entities push            # push entity schemas
base44 functions deploy         # deploy all functions (or: functions deploy <name>)
base44 deploy -y                # everything: entities, functions, connectors, auth, site
base44 logs --function <name>   # production function logs
base44 site open                # open the live site
base44 exec                     # run a script pre-authenticated as you (great for seeding)
base44 types generate           # TS types for entities/functions/agents
base44 secrets set KEY=VALUE    # function env vars (never in the repo)
base44 visibility public        # public | private | workspace
```

---

## 6. The six checklist features, mapped to code

This section exists so that ticking all six boxes is a build task, not an afterthought.

### 6.1 Database / entities

Entities are JSON Schema files in `base44/entities/<Name>.jsonc`. The **filename determines the
entity name**, and the name must match SDK access exactly including capitalization
(`Task.jsonc` -> `base44.entities.Task`).

Database is **MongoDB compatible**: all Mongo operators work in `filter()`. Schemas are not enforced,
so you can change the model without migrations.

Every record automatically gets: `id`, `created_date`, `updated_date`, `created_by` (email),
`created_by_id`. Do not define these yourself.

```jsonc
{
  "name": "Task",
  "type": "object",
  "title": "Task",
  "description": "A task item with priority, due date, and completion status",
  "properties": {
    "title":    { "type": "string", "minLength": 1, "maxLength": 200 },
    "priority": { "type": "string", "enum": ["low", "medium", "high"], "default": "medium" },
    "completed":{ "type": "boolean", "default": false },
    "due_date": { "type": "string", "format": "date" },
    "tags":     { "type": "array", "items": { "type": "string" } },
    "internal_notes": {
      "type": "string",
      "rls": {                                        // field-level security
        "read":  { "user_condition": { "role": "admin" } },
        "write": { "user_condition": { "role": "admin" } }
      }
    }
  },
  "required": ["title"],
  "rls": {                                            // row-level security
    "create": true,
    "read":   { "created_by": "{{user.email}}" },
    "update": { "created_by": "{{user.email}}" },
    "delete": { "user_condition": { "role": "admin" } }
  }
}
```

Field types: `string` (with `minLength`/`maxLength`/`pattern`/`format`/`enum`/`default`), `integer`,
`number` (`minimum`/`maximum`), `boolean`, `array` (`items`), `object` (`properties`/`required`).
String `format` values: `date`, `date-time`, `time`, `email`, `uri`, `hostname`, `ipv4`, `ipv6`,
`uuid`.

**RLS is a backend-depth signal that costs almost nothing.** Permission values are `true`, `false`,
or a condition. Three condition shapes:

```jsonc
{ "created_by": "{{user.email}}" }                     // entity field vs user value
{ "data.department": "{{user.data.department}}" }      // any schema field via data.*
{ "user_condition": { "role": "admin" } }              // check the user directly
{ "$or": [ { "created_by": "{{user.email}}" },         // combine: $or $and $nor $in $nin $all
           { "user_condition": { "role": "admin" } } ] }
```

Template variables: `{{user.email}}`, `{{user.id}}`, `{{user.role}}`, `{{user.data.*}}`.

Deploy with `base44 entities push`. **Warning: `base44 deploy` fully syncs entities. An entity that
exists remotely but not locally is removed** (data survives, but it becomes inaccessible via SDK).

### 6.2 Authentication & user management

Built in: email/password, social (Google, Microsoft, Facebook, Apple), and SSO. Config lives in
`base44/auth/config.jsonc`; pull the current state with `base44 auth pull`, push with `auth push`.

```javascript
base44.auth.loginViaEmailPassword(email, password)   // -> { access_token, user }
base44.auth.loginWithProvider('google', fromUrl?)
base44.auth.register({ email, password })
base44.auth.verifyOtp({ email, otpCode })
base44.auth.me()                                     // -> User
base44.auth.updateMe(data)
base44.auth.isAuthenticated()
base44.auth.logout(redirectUrl?)                     // note: always navigates
base44.users.inviteUser(email, 'user' | 'admin')
```

The `User` entity is special: schema-extendable (add your own fields, readable as `{{user.data.*}}`
in RLS), but users are not created or deleted through the SDK. The built-in `role` is
`admin` | `user`.

### 6.3 Backend functions (Deno)

One folder per function under `base44/functions/`, each with `entry.ts`. The folder path relative to
the functions root is the function name (`functions/email/send/entry.ts` -> `email/send`).

```typescript
import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();

    // caller's permissions (RLS applies):
    const mine = await base44.entities.Task.filter({ completed: false });
    // elevated, bypasses RLS - backend only:
    const all  = await base44.asServiceRole.entities.Task.list();

    return Response.json({ ok: true, count: all.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
```

Limits: **max 50 functions per project**, **max 5 minutes execution time**.

**Multiple files per function:** every `.js`/`.ts`/`.json`/`.jsonc` in the function folder is
deployed with it; import via relative paths. **Shared code across functions:** put it in
`base44/shared/` and import with `../../shared/x.ts`. The whole `shared` dir is bundled into every
function, so each function carries its own copy: change a shared file and only the functions you
redeploy get the new version. Run `base44 functions deploy` with no arguments to redeploy everything.
Relative imports cannot escape `base44/`.

**Two ways to call a function:**

```javascript
// From the frontend, auth passed through automatically:
const response = await base44.functions.invoke("sendWelcomeEmail", { name: "Alice" });
const payload  = response.data;      // <-- YOUR JSON IS ON .data, NOT THE TOP LEVEL

// Over HTTP (webhooks, cURL, external systems), no authenticated user:
// POST https://<your-app-domain>/functions/<function-name>
```

The HTTP endpoint is what makes bots, webhooks, and Stripe/GitHub callbacks work, and it is the
highest-leverage backend-depth demo in the whole platform. With no authenticated user on that path,
use `asServiceRole` for everything.

**Automations** (in `function.jsonc` next to `entry.ts`, deployed atomically with the function):

```jsonc
{
  "name": "sendDailyReport",
  "entry": "entry.ts",
  "automations": [
    {
      "type": "scheduled",
      "name": "daily_report",
      "description": "Runs every day at 04:30 UTC",
      "function_args": { "mode": "full_sync" },
      "is_active": true,
      "schedule_mode": "recurring",     // or "one-time"
      "schedule_type": "cron",          // or "simple"
      "cron_expression": "30 4 * * *"
    }
  ]
}
```

Four automation types: `scheduled` with cron, `scheduled` with a simple interval
(`repeat_unit` minutes/hours/days/weeks/months + `repeat_interval`/`start_time`/`repeat_on_days`),
`entity` (fires on record create/update/delete), and `connector` (fires on an integration webhook,
for example a new Gmail message). All times are **UTC**. Automations do **not** run locally under
`base44 dev`.

### 6.4 AI / LLM / agents

Three tiers, pick per use case:

```javascript
// 1. One-shot LLM call, no tools:
base44.integrations.Core.InvokeLLM({
  prompt, add_context_from_internet?, response_json_schema?, file_urls?
});
base44.integrations.Core.GenerateImage({ prompt });                 // -> { url }
base44.integrations.Core.ExtractDataFromUploadedFile({ file_url, json_schema });

// 2. A chat product for your users -> configured agents (base44/agents/<name>.jsonc + agents push)
base44.agents.subscribeToConversation(conversationId, onUpdate);    // realtime agent chat

// 3. A code agent with a tool loop -> the AI gateway (backend only), OpenAI-compatible:
const { baseURL, token } = base44.asServiceRole.aiGateway.connection();
// feed baseURL/token to the Vercel AI SDK, Mastra, or the OpenAI SDK
```

Agent config (`base44/agents/support.jsonc`, push with `base44 agents push`):

```jsonc
{
  "name": "customer_support",
  "description": "Handles support inquiries and ticket management",
  "instructions": "You are a friendly support agent...",
  "model": "anthropic/claude-sonnet-4-20250514",
  "tool_configs": [
    { "entity_name": "tickets", "allowed_operations": ["read", "create", "update"] },
    { "function_name": "escalate_to_human", "description": "Escalates to a human agent" }
  ]
}
```

Models available to agents: `anthropic/claude-sonnet-4-20250514`,
`anthropic/claude-3-5-sonnet-20241022`, `openai/gpt-4o`, `openai/gpt-4o-mini`.

**Note the difference:** entity tools plus function tools means an agent that actually *does* things
in your app. That reads far deeper than a chatbot that only answers.

### 6.5 Real-time subscriptions

WebSocket-backed, one line:

```javascript
const unsubscribe = base44.entities.Task.subscribe((event) => {
  // event = { type: "create" | "update" | "delete", data: {...}, id, timestamp }
});
unsubscribe();
```

Realtime works under `base44 dev` against the local in-memory DB, so it is testable offline. This is
the cheapest "wow" in a demo video: two windows side by side, change in one, instant update in the
other. Budget 30 minutes for it and make sure the demo video shows it.

### 6.6 File & media storage

```javascript
base44.integrations.Core.UploadFile({ file });                     // -> { file_url }  public
base44.integrations.Core.UploadPrivateFile({ file });              // -> { file_uri }  private
base44.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in? });  // -> { signed_url }
```

Uploads run locally under `base44 dev` (saved to a temp dir, cleared on stop). Max file size 50 MB.
Private file plus signed URL is a better depth signal than a public upload.

### Bonus: connectors and custom integrations (not on the checklist, but they read as depth)

- **Connectors** are OAuth connections to third-party services, configured as
  `base44/connectors/<type>.jsonc` and pushed with `base44 connectors push`. Discover them with
  `base44 connectors list-available --app-id <id>` (must be run from a linked project or with an
  explicit app id). There are roughly 66, including gmail, slack, notion, googlesheets,
  googlecalendar, github, hubspot, stripe-adjacent billing tools, and the Microsoft 365 apps.
  In a function: `base44.asServiceRole.connectors.getConnection('slack')` -> `{ accessToken, connectionConfig }`.
  **Check this catalog before hand-rolling any integration with an API key.**
- **Custom integrations** proxy an external API from an imported OpenAPI spec, so credentials never
  reach the frontend: `base44.integrations.custom.call(slug, "get:/contacts", { queryParams })`.

---

## 7. SDK cheat sheet

```javascript
// Client (external apps / your own frontend):
import { createClient } from "@base44/sdk";
const base44 = createClient({ appId: "your-app-id" });   // the key MUST be `appId`

// Entities:
base44.entities.Task.create(data)
base44.entities.Task.bulkCreate([...])
base44.entities.Task.list(sort?, limit?, skip?, fields?)      // "-created_date" = descending
base44.entities.Task.filter(query, sort?, limit?, skip?)      // Mongo-style query
base44.entities.Task.get(id)
base44.entities.Task.update(id, data)
base44.entities.Task.updateMany(query, { $set: { field: val } })
base44.entities.Task.bulkUpdate([{ id, ...}])
base44.entities.Task.delete(id) / deleteMany(query)
base44.entities.Task.subscribe(cb)                            // -> unsubscribe fn

// Functions:
base44.functions.invoke(name, data?)      // -> axios response; body on .data; throws on non-2xx
base44.functions.fetch(path, init?)       // low-level, for streaming or custom methods

// Service role (backend functions only), prefix any module:
base44.asServiceRole.entities.Task.list()
base44.asServiceRole.functions.invoke(name, data)
base44.asServiceRole.connectors.getConnection('slack')

// Analytics / logs:
base44.analytics.track({ eventName, properties })
base44.appLogs.logUserInApp(pageName)
```

**Max 5,000 records per `list`/`filter` request.** Paginate with `skip`.

---

## 8. Local development

`base44 dev` (default port 4400) runs a real local backend:

| Runs locally | Forwarded to the deployed app |
|---|---|
| Backend functions (one Deno process each, hot reload, logs to terminal) | OAuth and social login |
| Entities (in-memory DB, wiped on stop, schema changes hot-reload and clear that entity) | Core integrations: `SendEmail`, AI generation |
| Realtime subscriptions | Custom integrations (OpenAPI) |
| File uploads (temp dir, 50 MB) | |
| Email/password auth (OTP code is printed to your terminal instead of emailed) | |

Your CLI account can log in locally with **any** password. **Local tokens are signed with a different
secret than production**: sign out and clear local storage before switching to the deployed app, or
it will reject the token.

Automations do not run locally. Function output prints to the terminal, so `base44 logs` is only for
production.

If `site.serveCommand` is set in `base44/config.jsonc`, `base44 dev` also boots your frontend and
injects `VITE_BASE44_APP_ID` and `VITE_BASE44_APP_BASE_URL` pointed at the local backend.

---

## 9. Project structure

```
iTrack/
  base44/
    .app.jsonc          # links the folder to the app id. GITIGNORED, do not commit
    config.jsonc        # name, dir paths, site.outputDirectory / buildCommand / serveCommand
    .types/types.d.ts   # generated by `base44 types generate`
    entities/           # <Name>.jsonc  (filename = entity name)
    functions/
      <fn-name>/
        entry.ts        # required
        function.jsonc  # optional: custom name, automations
    shared/             # code shared across functions, bundled into each
    agents/             # <agent>.jsonc
    connectors/         # <type>.jsonc
    auth/config.jsonc   # enabled login methods
  src/                  # your frontend (backend-and-client template)
    api/base44Client.js
  .claude/skills/       # Base44 agent skills, safe to commit
```

`config.jsonc` essentials:

```jsonc
{
  "name": "iTrack",
  "description": "...",
  "entitiesDir": "./entities",
  "functionsDir": "./functions",
  "site": {
    "outputDirectory": "./dist",     // required for site deploy
    "serveCommand": "npm run dev"    // used by `base44 dev`
  }
}
```

---

## 10. Gotchas

Docs-verified unless marked. Items marked **[field]** come from prior Base44 work and were observed
live rather than read in the docs, so verify them once and correct this file if the platform has
moved on.

1. **`functions.invoke()` returns the full axios-style response. Your JSON is on `.data`.** Reading
   the top level silently returns `undefined`. This one has bitten before.
2. **Cron: use `*`, not `?`.** The official docs example shows `"0 0 * * ?"`, but the CLI rejects `?`
   with `'?' is not valid in standard Unix cron. Use '*' for wildcards.` **[field]** Use
   `"30 4 * * *"`.
3. **All automation times are UTC.** Convert local time yourself and write the conversion into the
   `description` field. DST will shift the local offset through the year.
4. **`base44 deploy` prunes entities and connectors but not functions.** A remote entity with no local
   file is removed. Use `functions deploy --force` to prune functions deliberately.
5. **Function HTTP endpoints are reachable anonymously.** App visibility gates the app UI, not the
   function routes. **[field]** The auth check inside your function is the only thing protecting it.
   Write cron and webhook paths to be safe under anonymous replay: idempotent, and ignoring every body
   field except the declared `function_args` keys.
6. **`auth.me()` may throw rather than return null on a missing or invalid token. [field]** A bare
   `if (!user) return 401` then never fires and anonymous callers get a 500. Wrap it:
   `let user = null; try { user = await base44.auth.me(); } catch (_) {} if (!user) return 401;`
7. **Function responses carry `Content-Security-Policy: script-src 'none'`. [field]** Inline JS in
   HTML served *from a function* never runs, and it fails silently. Public pages served by a function
   must be server-rendered HTML with plain form POSTs. This does not restrict what the function itself
   runs: importing `npm:` libraries in Deno is fine.
8. **Server-side filters on `created_date` / `updated_date` can silently return zero rows. [field]**
   Fetch and compare in code.
9. **Registered string fields cap around 20,000 bytes. [field]** Do not plan on storing a large blob
   in a string field: upload it and store the URL.
10. **Never commit `base44/.app.jsonc`.** The CLI gitignores it for you. Since the repo must be public
    for the submission, check this before pushing, along with any `.env`.
11. **Entity name capitalization must match exactly** between the schema `name` and
    `base44.entities.X`.
12. **Deno must be installed separately** for local function execution.
13. Hard limits worth designing around: 50 functions, 5 min per execution, 5,000 records per
    list/filter, 50 MB per upload.

---

## 11. Suggested plan for the remaining days

Assumes a start on July 22 and a submission on July 27, leaving July 28 as buffer.

| Day | Goal | Definition of done |
|---|---|---|
| **Jul 22** | Enroll. Lock the iTrack concept and surface. `base44 create`. Write **all** entity schemas with RLS up front. `entities push`. Start `FEEDBACK.md`. | Project deploys; entities visible in the dashboard |
| **Jul 23** | Backend core: the 3-5 functions that carry the real logic, with `asServiceRole` where needed. One HTTP/webhook entry point. | Functions deploy and answer over cURL |
| **Jul 24** | AI layer plus automations. One agent with entity + function tools, or an AI gateway tool loop. One cron automation that does something real. | Automation fires; AI path produces useful output |
| **Jul 25** | Frontend: the core loop end to end. Realtime subscription wired in. File upload path. | A judge could use it without instructions |
| **Jul 26** | Polish, empty states, error paths, a second-account permissions check against RLS. Deploy. | No 500s on the happy path or the obvious failure paths |
| **Jul 27** | README + write-up, 2-3 min demo video, final `base44 deploy -y`, verify the live URL, make the repo public, submit. | Submitted |
| **Jul 28** | Buffer. | |

Schema churn after the frontend exists is the single most expensive change. Spend day 1 on the data
model.

---

## 12. Pre-submission checklist

- [ ] Repo is **public**, and `base44/.app.jsonc`, `.env`, and any secrets are not in it
- [ ] Live URL loads for a signed-out visitor, or access instructions are written and tested
- [ ] Test credentials provided if the app needs a login
- [ ] All six backend features either genuinely used or honestly unticked, and each one is findable
      in the repo (judges verify the checklist against the code)
- [ ] README covers: what it is, the backend architecture, which Base44 features are used and where,
      and how to run it
- [ ] Demo video, 2-3 minutes, showing the realtime moment and the AI moment
- [ ] Write-up field filled in (it is scored under documentation)
- [ ] `FEEDBACK.md` pasted into the three required feedback questions, with bugs and repro steps
- [ ] Final `base44 deploy -y` run and the live URL re-checked afterwards

---

## 13. Links

- Competition: https://backendcompetition.base44.app
- Enroll: https://backendcompetition.base44.app/enroll
- Submit: https://backendcompetition.base44.app/submit
- Backend platform: https://base44.com/backend
- Developer docs: https://docs.base44.com/developers/home
- CLI command reference: https://docs.base44.com/developers/references/cli/commands/introduction
- Example apps: https://github.com/base44/apps-examples
- Base44 agent skills: https://github.com/base44/skills
