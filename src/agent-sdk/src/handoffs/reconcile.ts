import { readdir } from "node:fs/promises";
import { relative } from "node:path";
import { fromRepoRoot } from "../config/paths.js";
import type { AgentSpec, RunWorkspace } from "../domain/types.js";
import { HandoffBus } from "./state.js";
import { ensureAgentWorkspace } from "../workspace/run-workspace.js";

// A background task's SDK status is terminal once it can no longer transition.
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.trim().toLowerCase());
}

export type ReconcileState = "already-recorded" | "reconciled-complete" | "reconciled-abandoned" | "pending";

export interface ReconcileResult {
  state: ReconcileState;
  // Terminal verdict now in the ledger for this agent ("" only when `pending`).
  verdict: string;
  // The agent's full `## <agent>` ledger section ("" only when `pending`).
  outcome: string;
  missing: string[];
}

/**
 * Idempotently converge an agent's run-ledger outcome to a terminal verdict,
 * DERIVED from ground truth (its published output files) — never left to a
 * signal the worker must remember to send.
 *
 * Precedence:
 *  1. If the agent already recorded an outcome (its `## <agent>` ledger section
 *     exists), that is authoritative and returned untouched — the worker's own
 *     verdict (`completed` | `needs_retry` | `blocked`) always wins.
 *  2. Otherwise inspect the agent's `output/` plane:
 *       - every required output present -> `completed` (the agent did the work
 *         but never announced it; the runtime announces on its behalf);
 *       - one or more missing -> `abandoned`, naming exactly what is missing.
 *
 * With `onlyIfComplete`, an incomplete plane writes NOTHING and returns
 * `pending` — used by the waiter's poll loop so it never declares `abandoned`
 * while the agent may still be working; the unconditional call (wait deadline,
 * parent Stop backstop) is what finally converges an incomplete plane.
 *
 * This reconciler is THE guarantee that every dispatched agent's ledger entry
 * reaches a terminal verdict, whatever path terminated it — clean stop, maxTurns
 * guillotine, crash, or cancel. `record_outcome` becomes a fast-path refinement,
 * never the sole writer, so a silent worker can no longer hang its coordinator.
 */
export async function reconcileOutcome(
  run: RunWorkspace,
  spec: AgentSpec,
  options: { onlyIfComplete?: boolean; dispatch?: string } = {},
): Promise<ReconcileResult> {
  // Ledger + artifact plane are keyed per DISPATCH, so a retry of the same agent
  // type is independently observable and never overwrites the earlier attempt.
  const key = options.dispatch ?? spec.name;
  const bus = new HandoffBus(run.contextFile);
  const existing = await bus.readAgent(key);
  if (existing) return { state: "already-recorded", verdict: verdictOf(existing), outcome: existing, missing: [] };

  const agentWorkspace = await ensureAgentWorkspace(run, key);
  const present = new Set(await readdir(agentWorkspace.output).catch(() => [] as string[]));
  const missing = spec.requiredOutputs.filter((name) => !present.has(name));
  const pointer = relative(fromRepoRoot(), agentWorkspace.output);

  if (missing.length === 0) {
    const summary = spec.requiredOutputs.length
      ? `Reconciled from published outputs (${spec.requiredOutputs.join(", ")}); the agent terminated without recording its own outcome.`
      : "Reconciled: agent terminated with no required outputs to publish.";
    await bus.record(key, "completed", summary, pointer);
    return { state: "reconciled-complete", verdict: "completed", outcome: (await bus.readAgent(key)) ?? "", missing: [] };
  }

  if (options.onlyIfComplete) return { state: "pending", verdict: "", outcome: "", missing };

  // Name both halves: a re-dispatch needs to know what already landed as much as
  // what is missing, and the pointer is a directory to LIST, never to file-read.
  const found = spec.requiredOutputs.filter((name) => present.has(name));
  const summary = [
    `Terminated without publishing required output(s): ${missing.join(", ")}.`,
    found.length ? `Already published: ${found.join(", ")}.` : "Nothing was published.",
    "List the output dir (do not read it as a file) and re-dispatch to complete.",
  ].join(" ");
  await bus.record(key, "abandoned", summary, pointer);
  return { state: "reconciled-abandoned", verdict: "abandoned", outcome: (await bus.readAgent(key)) ?? "", missing };
}

/** The `- Verdict:` line of a rendered ledger section; `recorded` when absent. */
export function verdictOf(section: string): string {
  return section.match(/^- Verdict:\s*(.+)$/m)?.[1]?.trim() ?? "recorded";
}
