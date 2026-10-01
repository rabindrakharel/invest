import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "vitest";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { loadAgentGraph } from "../src/agents/catalog.js";
import { HandoffBus } from "../src/handoffs/state.js";
import { isTerminalStatus, reconcileOutcome } from "../src/handoffs/reconcile.js";
import { finalizeAgentOutput } from "../src/hooks/policy.js";
import { createRunWorkspace, ensureAgentWorkspace } from "../src/workspace/run-workspace.js";

const signal = () => ({ signal: new AbortController().signal });

test("isTerminalStatus recognizes only settled SDK statuses", () => {
  for (const s of ["completed", "failed", "cancelled", "COMPLETED", " Failed "]) assert.equal(isTerminalStatus(s), true);
  for (const s of ["running", "pending", "queued", ""]) assert.equal(isTerminalStatus(s), false);
});

test("reconcileOutcome derives `completed` from a fully published output plane", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "coding-agent-reconcile-ok-"));
  try {
    const workspace = await createRunWorkspace(root, "chief", "Run it");
    const spec = (await loadAgentGraph()).agents.get("macro-analyst")!;
    const child = await ensureAgentWorkspace(workspace, spec.name);
    for (const name of spec.requiredOutputs) await writeFile(resolve(child.output, name), "done");

    const result = await reconcileOutcome(workspace, spec);
    assert.equal(result.state, "reconciled-complete");
    assert.equal(result.verdict, "completed");
    const ledger = await new HandoffBus(workspace.contextFile).readAgent(spec.name);
    assert.match(ledger ?? "", /Verdict: completed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reconcileOutcome derives `abandoned` and names the missing outputs", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "coding-agent-reconcile-missing-"));
  try {
    const workspace = await createRunWorkspace(root, "chief", "Run it");
    const spec = (await loadAgentGraph()).agents.get("macro-analyst")!;

    const result = await reconcileOutcome(workspace, spec);
    assert.equal(result.state, "reconciled-abandoned");
    assert.equal(result.verdict, "abandoned");
    assert.deepEqual(result.missing, spec.requiredOutputs);
    const ledger = await new HandoffBus(workspace.contextFile).readAgent(spec.name);
    assert.match(ledger ?? "", /Verdict: abandoned/);
    assert.match(ledger ?? "", new RegExp(spec.requiredOutputs[0]!.replace(".", "\\.")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reconcileOutcome with onlyIfComplete leaves an incomplete plane untouched (pending)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "coding-agent-reconcile-pending-"));
  try {
    const workspace = await createRunWorkspace(root, "chief", "Run it");
    const spec = (await loadAgentGraph()).agents.get("macro-analyst")!;

    const result = await reconcileOutcome(workspace, spec, { onlyIfComplete: true });
    assert.equal(result.state, "pending");
    assert.equal(await new HandoffBus(workspace.contextFile).readAgent(spec.name), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reconcileOutcome never clobbers an outcome the agent recorded itself", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "coding-agent-reconcile-owned-"));
  try {
    const workspace = await createRunWorkspace(root, "chief", "Run it");
    const spec = (await loadAgentGraph()).agents.get("macro-analyst")!;
    // Agent recorded `blocked` but published nothing: its own verdict must win.
    await new HandoffBus(workspace.contextFile).record(spec.name, "blocked", "schema change needs a human", "x/output");

    const result = await reconcileOutcome(workspace, spec);
    assert.equal(result.state, "already-recorded");
    assert.equal(result.verdict, "blocked");
    const ledger = await new HandoffBus(workspace.contextFile).readAgent(spec.name);
    assert.match(ledger ?? "", /Verdict: blocked/);
    assert.doesNotMatch(ledger ?? "", /abandoned|Reconciled/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("parent Stop reconciles a terminal background child that never announced (fail-closed)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "coding-agent-backstop-"));
  try {
    const workspace = await createRunWorkspace(root, "chief", "Run it");
    const graph = await loadAgentGraph();
    const chief = graph.agents.get("chief")!;
    const child = graph.agents.get("macro-analyst")!;
    await ensureAgentWorkspace(workspace, chief.name);
    for (const name of chief.requiredOutputs) await writeFile(resolve((await ensureAgentWorkspace(workspace, chief.name)).output, name), "done");

    // Child task is `completed` at the SDK level but published nothing and never
    // recorded an outcome — exactly the incident shape.
    const hook = finalizeAgentOutput(workspace, chief, graph.agents);
    const input = {
      hook_event_name: "Stop",
      stop_hook_active: false,
      background_tasks: [{ id: "a1", type: "subagent", status: "completed", description: "Phase 2", agent_type: child.name }],
      session_id: "test", transcript_path: "test", cwd: root, permission_mode: "default",
    } as HookInput;
    await hook(input, undefined, signal());

    const ledger = await new HandoffBus(workspace.contextFile).readAgent(child.name);
    assert.match(ledger ?? "", /Verdict: abandoned/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
