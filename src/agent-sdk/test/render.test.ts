import assert from "node:assert/strict";
import { test } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createRenderer } from "../src/orchestrator/render.js";

/** Runs the renderer over `messages` and returns everything it wrote to stdout. */
const capture = (messages: unknown[]): string => {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const render = createRenderer(() => {}, "ddb-modeler");
    for (const message of messages) render(message as SDKMessage);
  } finally {
    process.stdout.write = original;
  }
  // Strip ANSI so assertions read the words, not the colors.
// eslint-disable-next-line no-control-regex -- stripping ANSI escape sequences is the point
  return written.join("").replace(/\u001b\[[0-9;]*m/g, "");
};

const result = (overrides: Record<string, unknown>) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 1,
  duration_ms: 1000,
  total_cost_usd: 0,
  result: "",
  usage: { input_tokens: 0, output_tokens: 0 },
  ...overrides,
});

test("an API error result renders as failed, never as done/success", () => {
  // An unsupported model arrives as subtype "success" with is_error set.
  const out = capture([result({ is_error: true, result: "API Error: 400 unsupported model" })]);
  assert.match(out, /✗ ddb-modeler\s+failed/);
  assert.match(out, /✗ error/);
  assert.doesNotMatch(out, /✓ success/);
  assert.doesNotMatch(out, /✓ ddb-modeler/);
});

test("a clean result renders as done and success", () => {
  const out = capture([result({})]);
  assert.match(out, /✓ ddb-modeler\s+done/);
  assert.match(out, /✓ success/);
});

test("a non-success subtype keeps its own label", () => {
  const out = capture([result({ subtype: "error_max_turns", is_error: true })]);
  assert.match(out, /✗ error_max_turns/);
  assert.match(out, /✗ ddb-modeler\s+failed/);
});
