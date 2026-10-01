import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { ScriptSpec } from "../../assets/tools/script/registry.js";
import { scriptToolName } from "../../assets/tools/catalog.js";
import { fromRepoRoot } from "../config/paths.js";
import { obligationsFor, type DeterminismLedger } from "../determinism/ledger.js";
import { scriptCallsIn } from "../determinism/shell.js";
import { explain, verifyDuties, type Finding } from "../determinism/verify.js";
import type { DispatchRegistry } from "../handoffs/dispatch.js";
import { callerKey } from "./caller.js";
import { blockStop, NO_OPINION } from "./decisions.js";

/**
 * Deterministic outputs, enforced at the end of every agent. While a dispatch works, {@link recordDeterministicWork}
 * notes each deterministic script it runs (through its MCP tool or typed into Bash) and each file it writes that
 * obliges a check. When it tries to stop, {@link enforceDeterministicOutputs} proves those duties (see
 * determinism/verify.ts) and, if any fail, blocks the stop with the reasons. After `maxBlocks` refusals it lets the
 * agent stop and reports the failure instead, so an unfixable check cannot trap a run.
 */

export const MAX_DETERMINISM_BLOCKS = 2;

export interface DeterminismOutcome { key: string; ok: boolean; findings: Finding[]; gaveUp: boolean }

export interface DeterminismDeps {
  ledger: DeterminismLedger;
  specs: readonly ScriptSpec[];
  rootAgent: string;
  dispatches?: DispatchRegistry;
  root?: string;
  maxBlocks?: number;
  verify?: typeof verifyDuties;
  /** Told the outcome of every check, pass or fail (the audit trail and the web log subscribe). */
  onOutcome?: (outcome: DeterminismOutcome) => void | Promise<void>;
}

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const isError = (response: unknown) => Boolean(response && typeof response === "object" && (response as { isError?: unknown }).isError);

export function recordDeterministicWork(deps: DeterminismDeps): HookCallback {
  const deterministic = deps.specs.filter((spec) => spec.determinism);
  const byTool = new Map(deterministic.map((spec) => [scriptToolName(spec.name), spec]));
  const root = deps.root ?? fromRepoRoot();
  return async (input) => {
    if (input.hook_event_name !== "PostToolUse") return NO_OPINION;
    const key = callerKey(input, deps.rootAgent, deps.dispatches);
    const args = (input.tool_input ?? {}) as Record<string, unknown>;
    const viaTool = byTool.get(input.tool_name);
    if (viaTool && !isError(input.tool_response)) await deps.ledger.recordRun(key, viaTool, args);
    if (input.tool_name === "Bash" && typeof args.command === "string") {
      for (const call of scriptCallsIn(args.command, deterministic)) await deps.ledger.recordRun(key, call.spec, call.input);
    }
    if (WRITE_TOOLS.has(input.tool_name) && typeof args.file_path === "string") {
      const path = deps.ledger.templatePath(args.file_path, typeof input.cwd === "string" ? input.cwd : root);
      if (path) for (const obligation of obligationsFor(path, deterministic)) deps.ledger.oblige(key, obligation);
    }
    return NO_OPINION;
  };
}

export function enforceDeterministicOutputs(deps: DeterminismDeps): HookCallback {
  const root = deps.root ?? fromRepoRoot();
  const verify = deps.verify ?? verifyDuties;
  const maxBlocks = deps.maxBlocks ?? MAX_DETERMINISM_BLOCKS;
  return async (input) => {
    if (input.hook_event_name !== "SubagentStop" && input.hook_event_name !== "Stop") return NO_OPINION;
    const key = input.hook_event_name === "Stop" ? deps.rootAgent : callerKey(input, deps.rootAgent, deps.dispatches);
    const duties = deps.ledger.dutiesOf(key);
    if (!duties.length) return NO_OPINION;
    const findings = await verify(deps.ledger.paths, root, duties);
    // A rerun refreshed the products: re-record them, so the next stop compares against what is on disk now.
    for (const duty of duties) if (duty.kind === "run" && duty.spec.determinism?.check === "rerun") await deps.ledger.recordRun(key, duty.spec, duty.input);
    if (!findings.length) {
      await deps.onOutcome?.({ key, ok: true, findings, gaveUp: false });
      return NO_OPINION;
    }
    const gaveUp = deps.ledger.blocked(key) > maxBlocks;
    await deps.onOutcome?.({ key, ok: false, findings, gaveUp });
    if (gaveUp) return NO_OPINION;
    return blockStop(input.hook_event_name, `Determinism check failed for ${key}: ${findings.map((f) => f.script).join(", ")}`, explain(findings));
  };
}
