import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, test } from "vitest";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { enforceTickerTemplate } from "../src/hooks/policy.js";

// The harness hook pipes the event to brief_guard.py (the rules live there and have their own unittest);
// these tests prove the wiring: what reaches the guard, what comes back, and that a broken guard fails closed.
let data: string;
const previous = process.env.INVEST_DATA_DIR;
beforeAll(async () => {
  data = await mkdtemp(resolve(tmpdir(), "invest-ticker-hook-"));
  await mkdir(resolve(data, "research/2026-09-30/tickers"), { recursive: true });
  await writeFile(resolve(data, "research/2026-09-30/tickers/META.json"), JSON.stringify({ ticker: "META", as_of: "2026-09-30", themes: [] }));
  process.env.INVEST_DATA_DIR = data;
});
afterAll(async () => {
  if (previous === undefined) delete process.env.INVEST_DATA_DIR; else process.env.INVEST_DATA_DIR = previous;
  await rm(data, { recursive: true, force: true });
});

const call = (hook: ReturnType<typeof enforceTickerTemplate>, tool_name: string, tool_input: Record<string, unknown>) =>
  hook({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd: data, session_id: "s", transcript_path: "t" } as unknown as HookInput, "tu", { signal: new AbortController().signal }) as Promise<{ hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }>;

test("a hand-written ticker brief is denied with the template's instructions", async () => {
  const out = await call(enforceTickerTemplate(), "Write", { file_path: resolve(data, "reports/2026-09-30-meta.md"), content: "# META take" });
  assert.equal(out.hookSpecificOutput?.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput?.permissionDecisionReason ?? "", /render_brief\.py/);
});

test("an invalid judgment is denied with every rule it breaks", async () => {
  const out = await call(enforceTickerTemplate(), "Write", { file_path: resolve(data, "research/2026-09-30/tickers/META.judgment.json"), content: JSON.stringify({ schema: "ticker-judgment/1", ticker: "META", as_of: "2026-09-30", verdict: "Buy" }) });
  assert.match(out.hookSpecificOutput?.permissionDecisionReason ?? "", /verdict must be one of/);
});

test("unrelated calls never start the guard, and allowed ones pass through", async () => {
  assert.deepEqual(await call(enforceTickerTemplate(undefined, "/nonexistent/python"), "Write", { file_path: "notes/todo.md", content: "x" }), {});
  assert.deepEqual(await call(enforceTickerTemplate(undefined, "/nonexistent/python"), "Read", { file_path: "data/reports/2026-09-30-meta.md" }), {});
  assert.deepEqual(await call(enforceTickerTemplate(), "Write", { file_path: resolve(data, "reports/2026-09-30-macro-deep-dive.md"), content: "# Macro, 2026-09-30" }), {});
});

test("a guard that cannot run fails closed for ticker research", async () => {
  const out = await call(enforceTickerTemplate(undefined, "/nonexistent/python"), "Write", { file_path: resolve(data, "reports/2026-09-30-meta.md"), content: "x" });
  assert.equal(out.hookSpecificOutput?.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput?.permissionDecisionReason ?? "", /could not run/);
});
