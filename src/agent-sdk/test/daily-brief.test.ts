import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, test } from "vitest";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { createDailyBriefGate, isDailyBriefRequest, verifyOutlook, type OutlookVerifier } from "../src/hooks/daily-brief.js";
import { fromRepoRoot } from "../src/config/paths.js";

const BRIEF = "# Market outlook, 2026-09-30\n\n**Lean risk-off**\n\n## Theme stances\n";
let data: string;
beforeAll(async () => {
  data = await mkdtemp(resolve(tmpdir(), "invest-daily-brief-"));
  await mkdir(resolve(data, "research/2026-09-30/outlook"), { recursive: true });
  await writeFile(resolve(data, "research/2026-09-30/outlook/outlook.md"), BRIEF);
});
afterAll(async () => { await rm(data, { recursive: true, force: true }); });

type Out = { decision?: string; hookSpecificOutput?: { additionalContext?: string } };
const fire = (hook: ReturnType<typeof createDailyBriefGate>["gate"], input: Record<string, unknown>) =>
  hook({ session_id: "s", transcript_path: "t", cwd: data, ...input } as unknown as HookInput, undefined, { signal: new AbortController().signal }) as Promise<Out>;
const passing: OutlookVerifier = () => ({ ok: true, detail: "verified" });
const failing: OutlookVerifier = () => ({ ok: false, detail: "judgment.json is missing" });
const gateWith = (verify: OutlookVerifier, armed = false) => createDailyBriefGate({ rootAgent: "chief", armed, dataDir: data, verify, today: () => "2026-09-30" });

test("the request marker is a prompt that starts a line with 'Daily brief'", () => {
  assert.ok(isDailyBriefRequest("Daily brief for today's date (intent outlook)."));
  assert.ok(isDailyBriefRequest("[run-context]\nRUN_ROOT=x\n\nUser request:\nDaily brief for today."));
  assert.ok(!isDailyBriefRequest("Give me the market outlook"));
  assert.ok(!isDailyBriefRequest("what is in the daily brief?"));
});

test("a subagent that built the outlook cannot stop until it verifies", async () => {
  const { track, gate } = gateWith(failing);
  await fire(track, { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "python3 src/agent-sdk/assets/tools/repo/market-outlook/build_outlook.py --date 2026-09-30" }, agent_id: "a1", agent_type: "macro-analyst" });
  const out = await fire(gate, { hook_event_name: "SubagentStop", agent_id: "a1", agent_type: "macro-analyst", stop_hook_active: false });
  assert.equal(out.decision, "block");
  assert.match(out.hookSpecificOutput?.additionalContext ?? "", /judgment\.json is missing/);
});

test("an agent that never touched the outlook is not checked", async () => {
  const { gate } = gateWith(failing);
  assert.deepEqual(await fire(gate, { hook_event_name: "SubagentStop", agent_id: "a2", agent_type: "theme-analyst", stop_hook_active: false }), {});
  assert.deepEqual(await fire(gate, { hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Risk on." }), {});
});

test("a daily brief ends only on the outlook, verbatim", async () => {
  const { gate } = gateWith(passing, true);
  const paraphrased = await fire(gate, { hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Summary: lean risk-off." });
  assert.equal(paraphrased.decision, "block");
  assert.match(paraphrased.hookSpecificOutput?.additionalContext ?? "", /verbatim/);
  assert.deepEqual(await fire(gate, { hook_event_name: "Stop", stop_hook_active: true, last_assistant_message: `${BRIEF.replace(/\n/g, "  \n")}\n` }), {});
});

test("background work in flight defers the root's check", async () => {
  const { gate } = gateWith(failing, true);
  assert.deepEqual(await fire(gate, { hook_event_name: "Stop", stop_hook_active: false, background_tasks: [{ id: "x", status: "running", agent_type: "news-scout" }] }), {});
});

test("a later prompt that is not a daily brief disarms the gate", async () => {
  const { track, gate } = gateWith(failing, true);
  await fire(track, { hook_event_name: "UserPromptSubmit", prompt: "Now what about NVDA?" });
  assert.deepEqual(await fire(gate, { hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "NVDA" }), {});
});

test("after the block limit the agent is let go and the failure reported", async () => {
  const outcomes: boolean[] = [];
  const { gate } = createDailyBriefGate({ rootAgent: "chief", armed: true, dataDir: data, verify: failing, today: () => "2026-09-30", maxBlocks: 1, onOutcome: (o) => { outcomes.push(o.gaveUp); } });
  assert.equal((await fire(gate, { hook_event_name: "Stop", stop_hook_active: false })).decision, "block");
  assert.deepEqual(await fire(gate, { hook_event_name: "Stop", stop_hook_active: true }), {});
  assert.deepEqual(outcomes, [false, true]);
});

test("the real verifier passes the 2026-09-24 reference outlook", () => {
  const result = verifyOutlook(fromRepoRoot())("2026-09-24");
  assert.ok(result.ok, result.detail);
});
