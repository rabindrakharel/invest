import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ScriptSpec } from "../../assets/tools/script/registry.js";
import type { DeterminismLedger } from "../determinism/ledger.js";
import type { AgentSpec, RunWorkspace } from "../domain/types.js";
import type { DispatchRegistry } from "../handoffs/dispatch.js";
import { emitAudit } from "../observability.js";
import type { AgentContext } from "../prompt/model.js";
import type { SteeringBus } from "../steering/bus.js";
import { auditHook } from "./audit.js";
import { createCircuitBreaker } from "./circuit-breaker.js";
import { createDailyBriefGate } from "./daily-brief.js";
import { attributeContextWriteToCaller, deliverSteering, prepareAgentContext } from "./context.js";
import { enforceDeterministicOutputs, recordDeterministicWork, type DeterminismOutcome } from "./determinism.js";
import { boundDispatchBrief, claimWritePaths } from "./dispatch.js";
import { boundUnlimitedRead, confineToRepository, gateMeteredSpend, protectAppendOnly, requireLoadedGuide } from "./guards.js";
import { closeDispatchOnReturn, finalizeAgentOutput } from "./lifecycle.js";
import { enforceTickerTemplate } from "./ticker-template.js";

/**
 * The run's hook chain, composed in one place. Each module owns one concern (guards, dispatch, context, lifecycle,
 * determinism, audit) and exports plain HookCallbacks; this file only decides their order. Order matters where a
 * hook can refuse: guards run before anything records the call, and the audit hook runs last, so it logs what
 * actually happened.
 */
export interface HookDeps {
  workspace: RunWorkspace;
  selected: AgentSpec;
  agents: Map<string, AgentSpec>;
  contexts: Map<string, AgentContext>;
  dispatches: DispatchRegistry;
  steering?: SteeringBus;
  /** An operator can answer prompts (terminal or web); headless runs deny metered calls. */
  interactive: boolean;
  meteredTools: ReadonlySet<string>;
  toolAreas: Map<string, string>;
  loadedGuides: Set<string>;
  scripts: readonly ScriptSpec[];
  ledger: DeterminismLedger;
  /** The run's first request asks for the daily brief: the root must end on the verified outlook.md, verbatim. */
  dailyBrief?: boolean;
  onDeterminism?: (outcome: DeterminismOutcome) => void | Promise<void>;
}

export function composeHooks(deps: HookDeps): NonNullable<Options["hooks"]> {
  const root = deps.selected.name;
  const audit = auditHook(deps.workspace, root, deps.dispatches);
  const breaker = createCircuitBreaker();
  const closeOut = finalizeAgentOutput(deps.workspace, deps.selected, deps.agents, deps.dispatches);
  const determinism = {
    ledger: deps.ledger, specs: deps.scripts, rootAgent: root, dispatches: deps.dispatches,
    onOutcome: async (outcome: DeterminismOutcome) => {
      await emitAudit(deps.workspace.auditFile, { event: "Determinism", agent: outcome.key, status: outcome.ok ? "ok" : outcome.gaveUp ? "gave_up" : "blocked", data: outcome.findings });
      await deps.onDeterminism?.(outcome);
    },
  };
  const proveDeterminism = enforceDeterministicOutputs(determinism);
  const dailyBrief = createDailyBriefGate({
    rootAgent: root, armed: deps.dailyBrief === true, dispatches: deps.dispatches,
    onOutcome: async (outcome) => {
      await emitAudit(deps.workspace.auditFile, { event: "DailyBrief", agent: outcome.key, status: outcome.ok ? "ok" : outcome.gaveUp ? "gave_up" : "blocked", data: outcome.detail });
      // Shown where determinism checks are shown (the web chat and its log).
      await deps.onDeterminism?.({ key: outcome.key, ok: outcome.ok, gaveUp: outcome.gaveUp,
        findings: outcome.ok ? [] : [{ script: "outlook_build", call: "daily brief format", problem: "failed", detail: outcome.detail, paths: [] }] });
    },
  });

  return {
    PreToolUse: [{ hooks: [
      deliverSteering(deps.steering, root, deps.dispatches),
      breaker.preToolUse,
      // Guards: what no agent may do, whoever asks.
      confineToRepository(),
      protectAppendOnly(),
      enforceTickerTemplate(),
      gateMeteredSpend(deps.interactive, deps.meteredTools),
      boundUnlimitedRead(),
      requireLoadedGuide(deps.toolAreas, deps.loadedGuides),
      // Dispatch: parallel agents own disjoint files, briefs stay bounded, context writes land in the caller's plane.
      claimWritePaths(root, deps.dispatches),
      boundDispatchBrief(),
      attributeContextWriteToCaller(new Set(deps.agents.keys()), deps.dispatches),
      audit,
    ] }],
    PostToolUse: [{ hooks: [breaker.postToolUse, recordDeterministicWork(determinism), dailyBrief.track, closeDispatchOnReturn(deps.workspace, deps.agents, deps.dispatches), audit] }],
    PostToolUseFailure: [{ hooks: [audit] }],
    PostToolBatch: [{ hooks: [audit] }],
    SubagentStart: [{ hooks: [prepareAgentContext(deps.workspace, deps.contexts, deps.dispatches), audit] }],
    // A daily-brief request arms the format gate; any other prompt disarms it.
    UserPromptSubmit: [{ hooks: [dailyBrief.track] }],
    // A subagent stops only when its outputs are deterministic, an outlook it built is in the daily brief's format,
    // and its required outputs are published.
    SubagentStop: [{ hooks: [proveDeterminism, dailyBrief.gate, closeOut, audit] }],
    // `agents` is passed on Stop too: the root's own Stop is where the parent observes terminal background
    // children and reconciles their ledger outcomes.
    Stop: [{ hooks: [proveDeterminism, dailyBrief.gate, closeOut, audit] }],
  };
}
