import assert from "node:assert/strict";
import { test } from "vitest";
import { createCircuitBreaker, MAX_IDENTICAL_ATTEMPTS } from "../src/hooks/circuit-breaker.js";

const ctx = { signal: new AbortController().signal };
const pre = (tool: string, input: unknown, agent_id?: string) =>
  ({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, ...(agent_id ? { agent_id } : {}) }) as never;
const post = (tool: string, input: unknown, agent_id?: string) =>
  ({ hook_event_name: "PostToolUse", tool_name: tool, tool_input: input, tool_response: "ok", ...(agent_id ? { agent_id } : {}) }) as never;
const denied = (r: unknown) =>
  (r as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision === "deny";

test("circuit breaker trips on repeated identical calls and resets on success", async () => {
  const b = createCircuitBreaker();
  const call = pre("Edit", { file_path: "a.ts", old_string: "x", new_string: "y" });
  // First MAX-1 identical attempts are allowed; the MAX-th is denied.
  for (let i = 1; i < MAX_IDENTICAL_ATTEMPTS; i += 1) {
    assert.deepEqual(await b.preToolUse(call, undefined, ctx), {}, `attempt ${i} should pass`);
  }
  const tripped = await b.preToolUse(call, undefined, ctx);
  assert(denied(tripped), "the threshold-th identical call is denied");
  assert.match(
    (tripped as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason,
    /Circuit breaker|record_outcome|BLOCKED/,
  );
  // A successful PostToolUse for that signature clears the streak.
  await b.postToolUse(post("Edit", { file_path: "a.ts", old_string: "x", new_string: "y" }), undefined, ctx);
  assert.deepEqual(await b.preToolUse(call, undefined, ctx), {}, "counter resets after a success");
});

test("circuit breaker isolates by signature and by agent", async () => {
  const b = createCircuitBreaker();
  // Different inputs => different signatures => counted independently (exploration ok).
  for (let i = 0; i < MAX_IDENTICAL_ATTEMPTS + 2; i += 1) {
    assert.deepEqual(await b.preToolUse(pre("Edit", { file_path: `f${i}.ts`, old_string: "x", new_string: "y" }), undefined, ctx), {});
  }
  // Two agents hammering the SAME call are tracked separately.
  const same = { file_path: "shared.ts", old_string: "x", new_string: "y" };
  for (let i = 1; i < MAX_IDENTICAL_ATTEMPTS; i += 1) {
    assert.deepEqual(await b.preToolUse(pre("Edit", same, "agentA"), undefined, ctx), {});
    assert.deepEqual(await b.preToolUse(pre("Edit", same, "agentB"), undefined, ctx), {});
  }
  assert(denied(await b.preToolUse(pre("Edit", same, "agentA"), undefined, ctx)), "agentA trips");
  assert(denied(await b.preToolUse(pre("Edit", same, "agentB"), undefined, ctx)), "agentB trips independently");
});
