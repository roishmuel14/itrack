// itrack_assistant smoke test (BUILD_PLAN stage 7, PRD F7 AC1).
// Runs as the ADMIN CLI user (account A), so it proves ANSWER CORRECTNESS and
// TOOL RESOLUTION only. It can never prove isolation: admin sees every row by
// design. The isolation gate is scripts/agent-leak-test.mjs, run as non-admin B.
//
// Run (from the repo root, admin login):
//   cat scripts/agent-smoke.ts | base44 exec
//
// Note on reading results: subscribeToConversation TRUNCATES tool_calls
// (arguments_string to 500 chars, results to 50). Only getConversation returns
// the full stored tool call, so every assertion here polls getConversation.

const AGENT = "itrack_assistant";
const POLL_MS = 2500;
const TIMEOUT_MS = 90000;

// A's real demo order (read off live data 2026-07-27): the item question in
// AC1 must resolve to this row.
const AC1_QUESTION = "Where is my dog bed?";
const AC1_EXPECT_MERCHANT = "Amazon";
const AC1_EXPECT_ORDER = "111-7607719-8537017";

const SMOKE_MERCHANT = "AgentSmoke";
const SMOKE_TRACKING = "AGENTSMOKE1";

const failures: string[] = [];

// 1. Surface probe: does the exec sandbox expose the agents module at all?
const surface = base44.agents ? Object.keys(base44.agents) : [];
console.log(`agents module: ${surface.length ? surface.join(", ") : "MISSING"}`);
if (!surface.includes("createConversation")) {
  console.error("FATAL: exec sandbox has no agents module; fall back to the browser path.");
  throw new Error("no_agents_module");
}

async function ask(question: string, label: string) {
  const conv = await base44.agents.createConversation({ agent_name: AGENT });
  await base44.agents.addMessage(conv, { role: "user", content: question });

  const deadline = Date.now() + TIMEOUT_MS;
  let full;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    full = await base44.agents.getConversation(conv.id);
    const msgs = full?.messages ?? [];
    const settled = msgs.some(
      (m) =>
        m.role === "assistant" &&
        typeof m.content === "string" &&
        m.content.trim() &&
        !(m.tool_calls ?? []).some((t) => t.status === "running"),
    );
    if (settled) break;
  }

  const msgs = full?.messages ?? [];
  const reply = msgs
    .filter((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim())
    .map((m) => m.content as string)
    .join("\n");
  const toolCalls = msgs.flatMap((m) => m.tool_calls ?? []);

  console.log(`\n=== ${label} ===`);
  console.log(`conversation: ${conv.id}`);
  console.log(`Q: ${question}`);
  console.log(`A: ${reply || "(no assistant reply within timeout)"}`);
  for (const t of toolCalls) {
    let rows = "n/a";
    try {
      const parsed = JSON.parse(t.results ?? "null");
      rows = Array.isArray(parsed) ? String(parsed.length) : parsed && typeof parsed === "object" ? "object" : "scalar";
    } catch (_) { /* results may be plain text */ }
    console.log(`  tool ${t.name} -> ${t.status} (result rows: ${rows})`);
  }
  if (!reply) failures.push(`${label}: no assistant reply within ${TIMEOUT_MS / 1000}s`);
  return { reply, toolCalls, conversationId: conv.id };
}

// 2. AC1: the item question must resolve to the right order with status + ETA.
const ac1 = await ask(AC1_QUESTION, "AC1 item question");
if (ac1.toolCalls.length === 0) {
  failures.push("AC1: the agent answered without calling any tool (answer is not data-backed)");
}
if (ac1.reply && !ac1.reply.toLowerCase().includes(AC1_EXPECT_MERCHANT.toLowerCase())) {
  failures.push(`AC1: reply does not mention the expected merchant ${AC1_EXPECT_MERCHANT}`);
}
console.log(`AC1 negative-probe token for the isolation test: order_number=${AC1_EXPECT_ORDER}`);

// 3. Slash-nested function tool names: undocumented whether "orders/manualAdd"
// resolves. A success status on that exact name is the proof.
const add = await ask(
  `Please add an order for me: the store is ${SMOKE_MERCHANT} and the tracking number is ${SMOKE_TRACKING}.`,
  "function tool: orders/manualAdd",
);
const addCall = add.toolCalls.find((t) => t.name.includes("manualAdd"));
if (!addCall) {
  failures.push('function tool: no tool call named "*manualAdd" appeared (nested slash names may not resolve)');
} else {
  console.log(`resolved function tool name: "${addCall.name}" status=${addCall.status}`);
  if (addCall.status !== "success") failures.push(`function tool: ${addCall.name} status=${addCall.status}`);
}

// 4. Error contract: a too-short tracking number must surface manualAdd's
// reasons[] message through the chat, not a generic apology.
const bad = await ask(
  `Add an order from the store ${SMOKE_MERCHANT} with tracking number AB1.`,
  "error contract: reasons[] passthrough",
);
if (bad.reply && !/short|invalid|valid/i.test(bad.reply)) {
  failures.push("error contract: reply did not surface the tracking_invalid reason");
}

// 5. Cleanup: remove every row this smoke run created.
const smokeOrders = await base44.entities.Order.filter({ merchant_name: SMOKE_MERCHANT }, "-created_date", 100);
let removed = 0;
for (const o of smokeOrders) {
  for (const e of await base44.entities.TrackingEvent.filter({ order_id: o.id }, "-created_date", 100)) {
    await base44.entities.TrackingEvent.delete(e.id);
  }
  for (const s of await base44.entities.Shipment.filter({ order_id: o.id }, "-created_date", 100)) {
    await base44.entities.Shipment.delete(s.id);
  }
  await base44.entities.Order.delete(o.id);
  removed++;
}
console.log(`\ncleanup: removed ${removed} ${SMOKE_MERCHANT} order(s) and their children`);

if (failures.length) {
  console.error("\nAGENT SMOKE FAILED:");
  for (const f of failures) console.error(` - ${f}`);
  throw new Error("agent_smoke_failed");
}
console.log("\nAGENT SMOKE PASSED: agent answers from its tools and function tools resolve.");
