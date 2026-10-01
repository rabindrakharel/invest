import assert from "node:assert/strict";
import { test } from "vitest";
import { ALWAYS_ON_TOOL_NAMES, buildToolCatalog, CONTEXT_TOOL_NAMES } from "../assets/tools/catalog.js";
import { loadAgentGraph } from "../src/agents/catalog.js";
import { resolveAgentTools } from "../src/agents/build.js";
import { createHitlServer, createPermissionBridge } from "../assets/tools/hitl/tool.js";
import type { HitlAnswer, HitlContext, HitlQuestion, TerminalPrompter } from "../assets/tools/hitl/terminal.js";

interface RecordedAsk { context: HitlContext; questions: HitlQuestion[] }

function stubPrompter(reply: (question: HitlQuestion) => HitlAnswer, interactive = true) {
  const asks: RecordedAsk[] = [];
  const prompter = {
    interactive,
    ask: async (context: HitlContext, questions: HitlQuestion[]) => {
      asks.push({ context, questions });
      return questions.map(reply);
    },
  } as unknown as TerminalPrompter;
  return { prompter, asks };
}

const bridgeOptions = { signal: new AbortController().signal, toolUseID: "tu_1", requestId: "req_1" };

test("permission bridge answers AskUserQuestion via updatedInput.answers", async () => {
  const { prompter, asks } = stubPrompter((question) => ({ question: question.question, answer: "Feature flag", freeText: false }));
  const bridge = createPermissionBridge(prompter);
  const input = {
    questions: [{
      question: "Which rollout strategy?",
      header: "Rollout",
      options: [{ label: "Feature flag", description: "Gate it" }, { label: "Hard cutover", description: "Replace now" }],
      multiSelect: false,
    }],
  };
  const result = await bridge("AskUserQuestion", input, bridgeOptions);
  assert(result && result.behavior === "allow");
  assert.deepEqual((result.updatedInput as { answers: Record<string, string> }).answers, { "Which rollout strategy?": "Feature flag" });
  assert.equal(asks[0]?.questions[0]?.options.length, 2);
});

test("permission bridge maps numbered permission choices to allow/deny", async () => {
  const allow = createPermissionBridge(stubPrompter((question) => ({ question: question.question, answer: "Allow once", freeText: false })).prompter);
  const allowed = await allow("Bash", { command: "ls" }, bridgeOptions);
  assert(allowed && allowed.behavior === "allow");

  const deny = createPermissionBridge(stubPrompter((question) => ({ question: question.question, answer: "use the saved query instead", freeText: true })).prompter);
  const denied = await deny("Bash", { command: "rm -rf" }, bridgeOptions);
  assert(denied && denied.behavior === "deny");
  assert.equal(denied.message, "use the saved query instead");
});

test("permission bridge auto-allows the always-on run tools without prompting", async () => {
  const { prompter, asks } = stubPrompter((question) => ({ question: question.question, answer: "Deny", freeText: false }));
  const bridge = createPermissionBridge(prompter, ALWAYS_ON_TOOL_NAMES);

  for (const toolName of CONTEXT_TOOL_NAMES) {
    const result = await bridge(toolName, { path: "report.md", content: "x" }, bridgeOptions);
    assert(result && result.behavior === "allow", toolName);
  }
  assert.equal(asks.length, 0);
});

test("ask_user clips a long header instead of rejecting the escalation", async () => {
  // A display label must never block the one call a stuck agent makes to get
  // unstuck: a 35-char header used to fail schema validation outright.
  const { prompter, asks } = stubPrompter((question) => ({ question: question.question, answer: "proceed", freeText: true }));
  const server = createHitlServer(prompter);
  const registered = (server.instance as unknown as {
    _registeredTools: Record<string, {
      inputSchema: { parse: (value: unknown) => unknown };
      handler: (args: unknown, extra?: unknown) => Promise<{ content: Array<{ text: string }> }>;
    }>;
  })._registeredTools;
  const parsed = registered.ask_user!.inputSchema.parse({
    question: "Should I proceed without the missing output?",
    header: "Tool defect blocking required output",
  });
  const result = await registered.ask_user!.handler(parsed, {});
  assert.equal(result.content[0]!.text, "proceed");
  const header = asks[0]?.questions[0]?.header ?? "";
  assert.equal(header, "Tool defect blocking req");
  assert.equal(header.length <= 24, true);
});

test("permission bridge auto-allows exactly what the profiles grant", async () => {
  const catalog = await buildToolCatalog();
  const graph = await loadAgentGraph();
  const granted = [...new Set([...graph.agents.values()].flatMap((spec) => resolveAgentTools(spec, catalog)))];
  const { prompter, asks } = stubPrompter((question) => ({ question: question.question, answer: "Deny", freeText: false }));
  const bridge = createPermissionBridge(prompter, granted);

  // Whatever any profile grants runs without a dialog — including the tools that
  // used to wall a run on first use because they were subagent-granted only.
  for (const toolName of [
    "Bash",
    "Write",
    "WebSearch",
    "mcp__run_context__publish_output",
  ]) {
    assert(granted.includes(toolName), `${toolName} should be granted by some profile`);
    const result = await bridge(toolName, { args: [] }, bridgeOptions);
    assert(result && result.behavior === "allow", toolName);
  }
  assert.equal(asks.length, 0);

  // A tool no profile grants is still gated — the list is derived, not blanket.
  assert(!granted.includes("NotebookEdit"));
  const ungranted = await bridge("NotebookEdit", { notebook_path: "x.ipynb" }, bridgeOptions);
  assert(ungranted && ungranted.behavior === "deny");
  assert.equal(asks.length, 1);
});

test("permission bridge auto-allows a wildcarded MCP surface by prefix", async () => {
  const { prompter, asks } = stubPrompter((question) => ({ question: question.question, answer: "Deny", freeText: false }));
  const bridge = createPermissionBridge(prompter, ["mcp__acme__*"]);

  // An external MCP server's tool names cannot be enumerated at build time, so
  // exact-name matching made every external-server verb its own dialog: answering for
  // list_items did nothing for the next get_item call.
  for (const toolName of [
    "mcp__acme__list_items",
    "mcp__acme__get_item",
    "mcp__acme__some_future_tool",
  ]) {
    const result = await bridge(toolName, { text: "Action" }, bridgeOptions);
    assert(result && result.behavior === "allow", toolName);
  }
  assert.equal(asks.length, 0);

  // The prefix is anchored: a look-alike server name must not inherit the grant.
  const lookalike = await bridge("mcp__acme_evil__list_items", {}, bridgeOptions);
  assert(lookalike && lookalike.behavior === "deny");
  assert.equal(asks.length, 1);
});

test("permission bridge defers to SDK defaults without a TTY", async () => {
  const bridge = createPermissionBridge(stubPrompter((question) => ({ question: question.question, answer: "unused", freeText: true }), false).prompter);
  assert.equal(await bridge("AskUserQuestion", { questions: [] }, bridgeOptions), null);
});

test("permission bridge auto-allows granted tools without a TTY", async () => {
  const { prompter, asks } = stubPrompter((question) => ({ question: question.question, answer: "unused", freeText: true }), false);
  const bridge = createPermissionBridge(prompter, CONTEXT_TOOL_NAMES);
  const result = await bridge("mcp__run_context__read_context", {}, bridgeOptions);
  assert(result && result.behavior === "allow");
  assert.equal(asks.length, 0);
});
