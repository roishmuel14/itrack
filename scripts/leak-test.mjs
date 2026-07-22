// Two-account RLS leak test (BUILD_PLAN stage 1 DoD; PRD risk #2).
// Runs as test user B and asserts zero visibility into user A's rows, for
// plain reads AND realtime subscriptions.
//
// Setup (one-time, manual): register a second account on the live app
// (email/password), then create gitignored scripts/.env.leaktest with:
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
const PER_USER_ENTITIES = ["Order", "Shipment", "TrackingEvent", "EmailRecord", "RefundOpportunity", "UserSettings"];
const REALTIME_WINDOW_MS = 25000;

if (!B_EMAIL || !B_PASSWORD) {
  console.error("Missing ITRACK_TEST_B_EMAIL / ITRACK_TEST_B_PASSWORD (use --env-file=scripts/.env.leaktest)");
  process.exit(2);
}

const failures = [];
const base44 = createClient({
  appId: APP_ID,
  appBaseUrl: "https://i-track-2bdb7160.base44.app",
  requiresAuth: false,
});

await base44.auth.loginViaEmailPassword(B_EMAIL, B_PASSWORD);
const me = await base44.auth.me();
console.log(`Authenticated as B: ${me.email} (role: ${me.role})`);
if (me.role === "admin") {
  console.error("Test account B must NOT be admin; the test is meaningless otherwise.");
  process.exit(2);
}

// 1. Bootstrap B and assert a distinct alias.
const bootRes = await base44.functions.invoke("account/bootstrap", {});
const boot = bootRes?.data ?? bootRes;
console.log(`B settings: alias=${boot.settings.alias_token}`);
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

// 3. SyncState must be invisible to B entirely.
try {
  const sync = await base44.entities.SyncState.list();
  if (sync.length > 0) failures.push(`SyncState: B sees ${sync.length} rows (admin-only entity)`);
  else console.log("SyncState: 0 rows visible");
} catch (_) {
  console.log("SyncState: read rejected (fine)");
}

// 4. Realtime: subscribe to Order + TrackingEvent; any event for a row not
// owned by B during the window is a leak (the trigger script only touches
// A-owned rows).
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
console.log(`Realtime: ${events.length} events received, ${foreignEvents.length} foreign`);
if (foreignEvents.length > 0) {
  failures.push(`realtime: B received ${foreignEvents.length} events for other users' rows (A=${A_EMAIL})`);
}

if (failures.length) {
  console.error("\nLEAK TEST FAILED:");
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("\nLEAK TEST PASSED: reads and realtime are user-scoped.");
process.exit(0);
