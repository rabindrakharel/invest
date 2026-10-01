import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { HANDOFF_BRIEF } from "../agents/catalog.js";
import { fromRepoRoot } from "../config/paths.js";
import type { AgentSpec, RunWorkspace } from "../domain/types.js";

/**
 * Orchestrator -> orchestrator SESSION handoff (e.g. a planner -> an executor).
 *
 * The next orchestrator is never dispatched as a subagent: a subagent has no
 * `Agent` tool, so an executor run that way could not fan anything out. Instead
 * the launcher ends the first session and starts the second as a new main
 * thread. The ONLY thing that crosses is the handoff brief the first one
 * published — not its transcript, probes, or ledger — so the executor starts
 * with the plan pointer and scope it needs and nothing it would have to wade
 * through.
 */
export type HandoffMode = "ask" | "auto" | "off";

export function handoffMode(value = process.env.AGENT_HANDOFF): HandoffMode {
  const mode = (value ?? "ask").trim().toLowerCase();
  if (mode === "ask" || mode === "auto" || mode === "off") return mode;
  throw new Error(`AGENT_HANDOFF must be ask, auto, or off (got '${value}')`);
}

export interface PendingHandoff {
  from: string;
  to: string;
  /** Repo-relative path of the published brief. */
  briefPath: string;
  /** The next session's request: the brief itself, with its provenance. */
  request: string;
  /** The same launch, as a command an operator can run later. */
  command: string;
}

/**
 * The handoff this finished session owes, or null when its orchestrator hands off to
 * nobody or never published a brief (a run that stopped early must not start the
 * next stage on work that does not exist).
 */
export async function pendingHandoff(
  spec: AgentSpec,
  workspace: RunWorkspace,
): Promise<PendingHandoff | null> {
  if (!spec.handoffTo) return null;
  const path = resolve(workspace.root, spec.name, "output", HANDOFF_BRIEF);
  const brief = (await readFile(path, "utf8").catch(() => "")).trim();
  if (!brief) return null;
  const briefPath = relative(fromRepoRoot(), path);
  return {
    from: spec.name,
    to: spec.handoffTo,
    briefPath,
    request: `${brief}\n\n(Handoff brief from the ${spec.name} session: ${briefPath})`,
    command: `pnpm agents --agent ${spec.handoffTo} "$(cat ${path})"`,
  };
}
