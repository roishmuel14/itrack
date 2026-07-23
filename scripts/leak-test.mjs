// Two-account RLS leak test (BUILD_PLAN stage 1 DoD; PRD risk #2).
// Runs as test user B and asserts zero visibility into user A's rows, for
// plain reads AND realtime subscriptions.
//
// Setup (one-time, manual): sign in as a second, NON-admin account on the
// live app (Google or email/password), then create gitignored
// scripts/.env.leaktest with EITHER:
//   ITRACK_TEST_B_TOKEN=...     (localStorage "base44_access_token" from B's logged-in tab)
// or:
//   ITRACK_TEST_B_EMAIL=...
//   ITRACK_TEST_B_PASSWORD=...
// Run:
//   node --env-file=scripts/.env.leaktest scripts/leak-test.mjs
// While the realtime window is open, in another terminal trigger A-owned churn:
//   cat scripts/leak-test-trigger.ts | base44 exec
// Exit code 0 = no leaks. Non-zero = leak or setup failure, details on stdout.

import { createClient } from "@base44/sdk";

const APP_ID = "6a6117b2e209abd12bdb7160";
const A_EMAIL = "roishmuel14@gmail.com";
const B_EMAIL = process.env.ITRACK_TEST_B_EMAIL;
const B_PASSWORD = process.env.ITRACK_TEST_B_PASSWORD;
const B_TOKEN = process.env.ITRACK_TEST_B_TOKEN;
const PER_USER_ENTITIES = ["Order", "Shipment", "TrackingEvent", "EmailRecord", "RefundOpportunity", "UserSettings"];
const REALTIME_WINDOW_MS = 35000;

if (!B_TOKEN && (!B_EMAIL || !B_PASSWORD)) {
  console.error("Provide ITRACK_TEST_B_TOKEN, or ITRACK_TEST_B_EMAIL + ITRACK_TEST_B_PASSWORD (use --env-file=scripts/.env.leaktest)");
  process.exit(2);
}

const APP_BASE_URL = "https://i-track-2bdb7160.base44.app";
const failures = [];

// Resolve B's access token BEFORE building the client. The realtime socket
// authenticates with the token passed to createClient (socketConfig.token) and,
// as a fallback, getAccessToken() -> localStorage. Node has no localStorage, so
// a token set only via loginViaEmailPassword after construction leaves the
// SOCKET anonymous (HTTP stays authed via the in-memory token) and it receives
// ZERO realtime events. So: get the token first, then hand it to createClient.
let token = B_TOKEN;
if (!token) {
  const loginClient = createClient({ appId: APP_ID, appBaseUrl: APP_BASE_URL, requiresAuth: false });
  const res = await loginClient.auth.loginViaEmailPassword(B_EMAIL, B_PASSWORD);
  token = res?.access_token ?? res?.data?.access_token;
  if (!token) {
    console.error("loginViaEmailPassword returned no access_token");
    process.exit(2);
  }
}

const base44 = createClient({ appId: APP_ID, appBaseUrl: APP_BASE_URL, token, requiresAuth: false });
base44.auth.setToken(token);
const me = await base44.auth.me();
console.log(`Authenticated as B: ${me.email} (role: ${me.role})`);
if (me.role === "admin") {
  console.error("Test account B must NOT be admin; the test is meaningless otherwise.");
  process.exit(2);
}

// 1. Bootstrap B and assert server-side ownership stamping.
const bootRes = await base44.functions.invoke("account/bootstrap", {});
const boot = bootRes?.data ?? bootRes;
console.log(`B settings: id=${boot.settings.id} gmail_connected=${boot.settings.gmail_connected}`);
if (boot.settings.owner_email !== me.email) {
  failures.push(`bootstrap returned settings owned by ${boot.settings.owner_email}, expected ${me.email}`);
}

// 2. Read every per-user entity as B: zero rows owned by anyone else.
for (const entity of PER_USER_ENTITIES) {
  const rows = await base44.entities[entity].list(null, 1000);
  const foreign = rows.filter((r) => r.owner_email && r.owner_email !== me.email);
  console.log(`${entity}: ${rows.length} rows visible, ${foreign.length} foreign`);
  if (foreign.length > 0) {
    failures.push(`${entity}: B sees ${foreign.length} rows owned by others (e.g. ${foreign[0].owner_email})`);
  }
}

// 3. Realtime: subscribe to Order + TrackingEvent; any event for a row not
// owned by B during the window is a leak. The trigger churns A-owned rows
// (must NOT arrive) plus one B-owned row as a positive delivery control
// (MUST arrive; otherwise subscribe delivers nothing and the test is void).
console.log(`Realtime window open for ${REALTIME_WINDOW_MS / 1000}s; run the trigger script now:`);
console.log("  cat scripts/leak-test-trigger.ts | base44 exec");
const events = [];
const unsubs = [];
for (const entity of ["Order", "TrackingEvent"]) {
  const unsub = base44.entities[entity].subscribe((event) => {
    events.push({ entity, event });
    console.log(`  [realtime] ${entity} ${event.type} id=${event.id} owner=${event.data?.owner_email}`);
  });
  unsubs.push(unsub);
}
await new Promise((resolve) => setTimeout(resolve, REALTIME_WINDOW_MS));
for (const u of unsubs) { try { u(); } catch (_) { /* closing */ } }

const foreignEvents = events.filter(({ event }) => event.data?.owner_email && event.data.owner_email !== me.email);
const ownEvents = events.filter(({ event }) => event.data?.owner_email === me.email);
console.log(`Realtime: ${events.length} events received, ${ownEvents.length} own, ${foreignEvents.length} foreign`);
if (foreignEvents.length > 0) {
  failures.push(`realtime: B received ${foreignEvents.length} events for other users' rows (A=${A_EMAIL})`);
}
if (ownEvents.length === 0) {
  failures.push("realtime positive control: B received zero events for its OWN churn (subscribe may not deliver at all; PRD risk #2)");
}

if (failures.length) {
  console.error("\nLEAK TEST FAILED:");
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("\nLEAK TEST PASSED: reads and realtime are user-scoped.");
process.exit(0);
