import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "vitest";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { buildAgents } from "../src/agents/build.js";
import { loadAgentGraph, validateAgentGraph } from "../src/agents/catalog.js";
import { check } from "../src/cli.js";
import { loadRuntimeConfig } from "../src/config/load.js";
import { confineToRepository, gateMeteredSpend, meteredSpend, protectAppendOnly, requireLoadedGuide } from "../src/hooks/policy.js";
import { renderShims, staleShims } from "../src/catalog/shims.js";
import { createPermissionBridge } from "../assets/tools/hitl/tool.js";
import { buildOptions } from "../src/orchestrator/build-options.js";
import { buildToolCatalog } from "../assets/tools/catalog.js";
import { createRunWorkspace } from "../src/workspace/run-workspace.js";

const signal = { signal: new AbortController().signal };
const pre = (tool_name: string, tool_input: Record<string, unknown>) =>
  ({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd: process.cwd() }) as never;
const verdict = async (hook: HookCallback, input: never) =>
  ((await hook(input, undefined, signal)) as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision;

test("the declared harness validates: graph, profiles, skills, tool families, composed prompts", async () => {
  await check();
});

test("an orchestrator's prompt carries the run; a subagent's never does", async () => {
  const graph = await loadAgentGraph();
  const toolCatalog = await buildToolCatalog();
  const runContext = { originalRequest: "SECRET-REQUEST", priorOutcomes: [] };
  const agents = await buildAgents(graph, toolCatalog, { fallback: "m" }, runContext);
  assert.match(agents.chief!.prompt, /SECRET-REQUEST/);
  assert.doesNotMatch(agents["macro-analyst"]!.prompt, /SECRET-REQUEST/);
  // Dispatch is one level deep: only the orchestrator holds the Agent tool.
  assert(agents.chief!.tools!.includes("Agent"));
  assert(!agents["macro-analyst"]!.tools!.includes("Agent"));
});

test("a progressive skill is summarized, not inlined, and loads through load_skill", async () => {
  const graph = await loadAgentGraph();
  const agents = await buildAgents(graph, await buildToolCatalog(), { fallback: "m" });
  assert.match(agents["tone-grader"]!.prompt, /name="x-sentiment" mode="on_demand"/);
  assert.doesNotMatch(agents["tone-grader"]!.prompt, /mode="always_on">\s*# X sentiment/);
  // A mandatory grant inlines the body.
  assert.match(agents["macro-analyst"]!.prompt, /name="macro-regime" mode="always_on"/);
});

test("the graph rejects a subagent that dispatches and a roster naming an orchestrator", async () => {
  const graph = await loadAgentGraph();
  const specs = [...graph.agents.values()];
  const base = specs.map((spec) => ({ ...spec }));
  assert.throws(() => validateAgentGraph(base.map((s) => s.name === "macro-analyst" ? { ...s, handoffs: ["macro-analyst"] } : s)), /only an orchestrator dispatches/);
  assert.throws(() => validateAgentGraph(base.map((s) => s.name === "chief" ? { ...s, handoffs: ["macro-analyst", "chief"] } : s)), /never dispatched/);
  assert.throws(() => validateAgentGraph(base.map((s) => s.name === "chief" ? { ...s, handoffs: [] } : s)), /no orchestrator dispatches/);
});

test("buildOptions composes hooks, agents and the in-process servers without starting a session", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "invest-agent-options-"));
  try {
    const config = await loadRuntimeConfig();
    const graph = await loadAgentGraph();
    const workspace = await createRunWorkspace(root, "chief", "probe");
    const options = await buildOptions(config, graph.agents.get("chief")!, workspace);
    assert.equal(options.agent, "chief");
    assert.deepEqual(Object.keys(options.agents ?? {}).sort(), [...graph.agents.keys()].sort());
    assert.deepEqual(Object.keys(options.mcpServers ?? {}).sort(), ["invest", "present", "run_context", "run_guide"]);
    assert(options.allowedTools?.includes("Bash"));
    for (const event of ["PreToolUse", "PostToolUse", "SubagentStart", "SubagentStop", "Stop"] as const) assert(options.hooks?.[event]?.length, event);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Bash stays denied until its guide is loaded", async () => {
  const toolCatalog = await buildToolCatalog();
  const areas = new Map([...toolCatalog.groups.values()].filter((g) => g.gated).flatMap((g) => g.toolNames.map((t) => [t, g.name] as const)));
  const loaded = new Set<string>();
  const hook = requireLoadedGuide(areas, loaded);
  assert.equal(await verdict(hook, pre("Bash", { command: "ls" })), "deny");
  assert.equal(await verdict(hook, pre("Read", { file_path: "a" })), undefined);
  loaded.add("shell");
  assert.equal(await verdict(hook, pre("Bash", { command: "ls" })), undefined);
});

test("append-only corpus layers, the ledger and the secrets file are protected", async () => {
  const hook = protectAppendOnly();
  const deny = (tool: string, input: Record<string, unknown>) => verdict(hook, pre(tool, input));
  assert.equal(await deny("Write", { file_path: "data/corpus/raw/ingest_dt=2026-09-24/x.jsonl.gz", content: "" }), "deny");
  assert.equal(await deny("Edit", { file_path: "data/ledger/verdicts.jsonl" }), "deny");
  assert.equal(await deny("Write", { file_path: ".env", content: "" }), "deny");
  assert.equal(await deny("Read", { file_path: ".env" }), "deny");
  assert.equal(await deny("Bash", { command: "rm -rf data/corpus/raw" }), "deny");
  assert.equal(await deny("Bash", { command: "echo x > data/ledger/verdicts.jsonl" }), "deny");
  assert.equal(await deny("Bash", { command: "cat .env" }), "deny");
  // Allowed: judgment files, reads, appends, and unrelated data.
  assert.equal(await deny("Write", { file_path: "data/research/2026-09-30/macro/narrative.json", content: "{}" }), undefined);
  assert.equal(await deny("Read", { file_path: "data/ledger/verdicts.jsonl" }), undefined);
  assert.equal(await deny("Bash", { command: "echo '{}' >> data/ledger/verdicts.jsonl" }), undefined);
  assert.equal(await deny("Bash", { command: "pnpm q list" }), undefined);
  assert.equal(await deny("Bash", { command: "rm -rf data/cache/2026-09-30-x" }), undefined);
});

test("paths resolving outside the repository are denied, including through `..`", async () => {
  const hook = confineToRepository();
  assert.equal(await verdict(hook, pre("Read", { file_path: "/etc/passwd" })), "deny");
  assert.equal(await verdict(hook, pre("Read", { file_path: "../../outside" })), "deny");
  assert.equal(await verdict(hook, pre("Read", { file_path: "data/../data/reports/INDEX.md" })), undefined);
});

test("every orchestrator's roster is real and every skill is owned by an agent", async () => {
  const graph = await loadAgentGraph();
  assert.deepEqual([...graph.orchestrators.keys()].sort(), ["chief", "corpus-lead", "runway-lead"]);
  // Skills that fan out their own workers belong to an orchestrator, never to a leaf.
  for (const skill of ["fetch", "corpus-probe", "runway-probe"]) {
    const owners = [...graph.agents.values()].filter((a) => a.skills.includes(skill) && !a.orchestrator);
    for (const owner of owners) assert(!["macro-analyst", "chief"].includes(owner.name), `${owner.name} must not own ${skill}`);
  }
  assert.deepEqual(graph.agents.get("tone-grader")!.handoffs, []);
});

test("metered commands are recognised and denied headless", async () => {
  assert(meteredSpend("Bash", { command: "pnpm task:capture" }));
  assert(meteredSpend("Bash", { command: "pnpm task:backfill --start 2026-07-07T00:00:00Z" }));
  assert(meteredSpend("Bash", { command: "pnpm -s task:delta" }));
  assert.equal(meteredSpend("Bash", { command: "pnpm task:session-ingest --check" }), undefined);
  assert.equal(meteredSpend("Bash", { command: "pnpm q corpus-coverage" }), undefined);
  assert.equal(meteredSpend("Read", { command: "pnpm task:capture" }), undefined);
  assert.equal(await verdict(gateMeteredSpend(false), pre("Bash", { command: "pnpm task:capture" })), "deny");
  assert.equal(await verdict(gateMeteredSpend(false), pre("Bash", { command: "pnpm q corpus-coverage" })), undefined);
  assert.equal(await verdict(gateMeteredSpend(true), pre("Bash", { command: "pnpm task:capture" })), undefined);
});

test("in a terminal run a metered command is never auto-allowed: the operator decides", async () => {
  const asked: string[] = [];
  const prompter = { interactive: true, ask: async (_c: unknown, qs: Array<{ question: string }>) => { asked.push(...qs.map((q) => q.question)); return qs.map((q) => ({ question: q.question, answer: "Deny", freeText: false })); } } as never;
  const bridge = createPermissionBridge(prompter, ["Bash"], meteredSpend);
  const opts = { signal: new AbortController().signal, toolUseID: "t", requestId: "r" };
  assert.equal((await bridge("Bash", { command: "pnpm q corpus-coverage" }, opts))?.behavior, "allow");
  assert.equal(asked.length, 0);
  assert.equal((await bridge("Bash", { command: "pnpm task:capture" }, opts))?.behavior, "deny");
  assert.match(asked[0] ?? "", /task:capture/);
});

test("generated pointers match their sources, one per skill, orchestrator and subagent", async () => {
  const graph = await loadAgentGraph();
  const shims = await renderShims(graph, await buildToolCatalog());
  assert.deepEqual(await staleShims(shims), []);
  const subagents = [...graph.agents.values()].filter((a) => !a.orchestrator).map((a) => `.claude/agents/${a.name}.md`);
  for (const path of subagents) assert(shims.has(path), path);
  assert(shims.has(".claude/skills/macro-regime/SKILL.md") && shims.has(".claude/skills/chief/SKILL.md"));
  assert(!shims.has(".claude/agents/chief.md"), "an orchestrator is never a subagent shim");
  // A subagent shim carries only native tools, and never the Agent tool.
  assert.doesNotMatch(shims.get(".claude/agents/macro-analyst.md")!, /^tools:.*(Agent|mcp__)/m);
});
