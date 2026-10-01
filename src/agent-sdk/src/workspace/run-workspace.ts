import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fromRepoRoot } from "../config/paths.js";
import type { RunWorkspace } from "../domain/types.js";
import { HandoffBus } from "../handoffs/state.js";
import { emitAudit, seedAgentContext } from "../observability.js";

export async function createRunWorkspace(runsDirectory: string, agent: string, request: string): Promise<RunWorkspace> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const root = resolve(fromRepoRoot(), runsDirectory, runId);
  const agentRoot = resolve(root, agent);
  const workspace = {
    runId, root, agentRoot,
    toolsFile: resolve(agentRoot, "tools.jsonl"),
    output: resolve(agentRoot, "output"),
    contextFile: resolve(root, "CONTEXT.md"),
    auditFile: resolve(root, "audit.jsonl"),
    agentContextFile: resolve(agentRoot, "context.yaml"),
  };
  // Variablized artifact scheme — one repo-relative formula, never an enumerated
  // or absolute path list: every agent runs with cwd at the repo root.
  const artifactPlane = [
    `RUN_ROOT: \`${relative(fromRepoRoot(), root)}\` (repo-root-relative; cwd is the repo root)`,
    "Artifact path formula: the ROOT agent publishes to `{RUN_ROOT}/{agent}/output/`; every DELEGATED agent publishes to `{RUN_ROOT}/{agent}/{dispatch}/output/`, where `{dispatch}` is its 1-based dispatch ordinal — a re-dispatch of the same agent gets its own directory and never overwrites the earlier attempt.",
    "Never guess a dispatch ordinal: each per-agent section below names its own `Output dir:` — that pointer is the artifact plane of that specific attempt. It is a DIRECTORY: list it, never file-read it.",
    "Published artifacts of prior agents are canonical inputs: read the artifacts that feed your task from those pointers instead of re-deriving their content.",
  ].join("\n");
  await Promise.all([mkdir(workspace.agentRoot, { recursive: true }), mkdir(workspace.output, { recursive: true })]);
  await new HandoffBus(workspace.contextFile).init(request, artifactPlane);
  await writeFile(workspace.auditFile, "", { flag: "wx" });
  await Promise.all([
    seedAgentContext(workspace.agentContextFile, `agent: ${agent}\n`),
    writeFile(workspace.toolsFile, "", { flag: "wx" }),
    emitAudit(workspace.auditFile, { event: "run_created", runId, agent }),
  ]);
  return workspace;
}

export async function ensureAgentWorkspace(run: RunWorkspace, agent: string): Promise<RunWorkspace> {
  const agentRoot = resolve(run.root, agent);
  if (agentRoot !== run.root && !agentRoot.startsWith(run.root + "/")) throw new Error(`Agent workspace escapes run root: ${agent}`);
  const workspace = {
    ...run,
    agentRoot,
    toolsFile: resolve(agentRoot, "tools.jsonl"),
    output: resolve(agentRoot, "output"),
    agentContextFile: resolve(agentRoot, "context.yaml"),
  };
  await Promise.all([mkdir(workspace.agentRoot, { recursive: true }), mkdir(workspace.output, { recursive: true })]);
  try { await seedAgentContext(workspace.agentContextFile, `agent: ${agent}\n`); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  try { await writeFile(workspace.toolsFile, "", { flag: "wx" }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return workspace;
}
