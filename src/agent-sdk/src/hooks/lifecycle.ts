import { readdir } from "node:fs/promises";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSpec, RunWorkspace } from "../domain/types.js";
import { MAX_DISPATCH_ATTEMPTS, writeContinuationPacket, type ContinuationPacket } from "../handoffs/continuation.js";
import type { DispatchRegistry } from "../handoffs/dispatch.js";
import { isTerminalStatus, reconcileOutcome } from "../handoffs/reconcile.js";
import { ensureAgentWorkspace } from "../workspace/run-workspace.js";
import { addContext, blockStop, NO_OPINION } from "./decisions.js";

/**
 * The coordinator's `Agent` call returning is the ONE seam that exists for a
 * synchronous dispatch no matter how the child died. `SubagentStop` is a signal
 * the child emits, so a `maxTurns` guillotine silences it; `background_tasks`
 * lists detached work only, so a `run_in_background: false` dispatch is never in
 * it. Between those two the synchronous path had no closing trigger at all, and
 * a terminated child returned its last, mid-sentence assistant text to a
 * coordinator with no way to tell narration from a result.
 *
 * So: reconcile here, where the parent is alive by definition — it is the thing
 * being returned to — and when the verdict is `abandoned`, say so IN the tool
 * result. A coordinator must never have to infer termination from prose.
 */
export function closeDispatchOnReturn(workspace: RunWorkspace, specs: Map<string, AgentSpec>, dispatches?: DispatchRegistry): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PostToolUse" || input.tool_name !== "Agent") return NO_OPINION;
    const requested = (input.tool_input as { subagent_type?: unknown } | null)?.subagent_type;
    if (typeof requested !== "string") return NO_OPINION;
    const childSpec = specs.get(requested);
    if (!childSpec) return NO_OPINION;
    const returned = readAgentReturn(input.tool_response);
    // Bind the dispatch to its work item on EVERY return — the async launch
    // acknowledgement included — so attempts count per item, not per type.
    const requestInput = (input.tool_input ?? {}) as { name?: unknown; description?: unknown };
    const workItem = typeof requestInput.name === "string" && requestInput.name.trim() ? requestInput.name : typeof requestInput.description === "string" ? requestInput.description : "";
    const launched = returned.agentId ? dispatches?.keyForAgentId(returned.agentId) : undefined;
    if (launched && workItem) dispatches?.bindWorkItem(launched, workItem);
    // A returned `Agent` call is not, by itself, proof the child finished:
    // `run_in_background: false` is a request the agent DEFINITION can override
    // (`sdk.background: true`), and those dispatches answer with a launch
    // acknowledgement within milliseconds of `SubagentStart`. Close only what the
    // SDK reports terminal, and identify it by the id it hands back rather than
    // by "the latest dispatch of this type" — two dispatches of one type in
    // flight would otherwise close the wrong one.
    if (!returned.terminal) return NO_OPINION;
    // Without the SDK's id, only an UNAMBIGUOUS type may stand in for it: with
    // siblings of one type in flight, "the latest" is a guess that closes the
    // wrong one. A key equal to the bare type means `SubagentStart` never claimed
    // an ordinal — nothing ran, nothing to close.
    const key = launched ?? dispatches?.soleFor(requested);
    if (!key || key === requested) return NO_OPINION;
    if (workItem) dispatches?.bindWorkItem(key, workItem);
    dispatches?.markTerminal(key);
    const result = await reconcileOutcome(workspace, childSpec, { dispatch: key });
    if (result.verdict !== "abandoned") return NO_OPINION;
    const packet = await writeContinuationPacket(workspace, key, result.missing, dispatches?.attemptOf(key) ?? 1);
    return addContext("PostToolUse", continuationDirective(key, requested, result.missing, packet));
  };
}

/**
 * Read the SDK's answer to an `Agent` call. Both forms — the terminal result and
 * the `async_launched` acknowledgement — are objects carrying the dispatch's own
 * `agentId` and a `status` drawn from the SAME vocabulary as `background_tasks`,
 * so liveness is decided here with the same {@link isTerminalStatus} predicate
 * used there, and identity comes from the SDK's id instead of a positional guess.
 *
 * `status` answers "has it stopped running?" and NEVER "did it work?": the
 * dispatch that exposed this seam came back `status: "completed"` moments after
 * the turn guillotine killed it mid-sentence with nothing published. Whether the
 * work actually landed is decided in exactly one place — the output plane, via
 * `reconcileOutcome`.
 */
function readAgentReturn(toolResponse: unknown): { terminal: boolean; agentId?: string } {
  if (!toolResponse || typeof toolResponse !== "object") return { terminal: false };
  const response = toolResponse as { status?: unknown; agentId?: unknown };
  return {
    // Fail SAFE on an unrecognized shape: assume still running. Closing a live
    // dispatch invents an `abandoned` verdict and a retry prompt for work that is
    // succeeding; closing a dead one late costs only lateness, because the `Stop`
    // sweep is the backstop that cannot be skipped.
    terminal: typeof response.status === "string" && isTerminalStatus(response.status),
    ...(typeof response.agentId === "string" ? { agentId: response.agentId } : {}),
  };
}

function continuationDirective(key: string, agentType: string, missing: string[], packet: ContinuationPacket): string {
  const evidence = [
    `attempt ${packet.attempt} of ${MAX_DISPATCH_ATTEMPTS}`,
    `${packet.toolCalls} tool calls`,
    `${packet.files.length} file(s) already mutated on disk`,
    packet.thrashing ? `repeated-failure signal: ${packet.thrashing}` : "no repeated-failure signal",
  ].join("; ");
  const lines = [
    `\`${key}\` DID NOT COMPLETE. It terminated without publishing: ${missing.join(", ")}.`,
    "The text this tool call returned is that agent's last narration, NOT a result. Do not treat it as one, do not summarize it as an outcome, and do not mark the plan row done.",
    `Continuation packet (what it actually did, derived from its tool log): \`${packet.path}\`. Read it before deciding.`,
    `Evidence for the operator: ${evidence}.`,
  ];
  if (packet.exhausted) {
    lines.push(
      `This type has now used all ${MAX_DISPATCH_ATTEMPTS} permitted attempts. Do NOT re-dispatch it. Record the row as a named defect in \`runtime-plan.md\`, naming the missing outputs and the mutated files left on disk, and report it to the user.`,
    );
    return lines.join(" ");
  }
  lines.push(
    "Ask the operator through the HITL tool BEFORE re-dispatching — a continuation costs another full turn budget, and whether one more attempt finishes the work or repeats the failure is not decidable from anything the runtime can observe. Put the evidence above in the question so the operator can judge underscoped vs stuck, and offer: continue, re-scope into smaller rows, or stop and report.",
    `On approval, re-dispatch \`${agentType}\` (the registry mints the next attempt automatically) with a prompt that quotes the continuation packet path, names the already-mutated files as MUST-READ-BEFORE-EDIT, and narrows the task to what is left. Never re-dispatch it with the original prompt unchanged.`,
  );
  return lines.join(" ");
}

export function finalizeAgentOutput(workspace: RunWorkspace, spec: AgentSpec, specs?: Map<string, AgentSpec>, dispatches?: DispatchRegistry): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "Stop" && input.hook_event_name !== "SubagentStop") return NO_OPINION;
    // Observed terminal: this is the signal that lets the waiter's deadline tell a
    // finished agent from a slow one instead of declaring every slow one abandoned.
    if (input.hook_event_name === "SubagentStop") dispatches?.markTerminal(input.agent_id);
    if (input.background_tasks?.length) {
      // Fail-closed backstop for the detached-background delegation path: a
      // background subagent can terminate (finish, hit maxTurns, crash, be
      // cancelled) WITHOUT firing a SubagentStop of its own, so the child's own
      // completion gate never runs. Here the PARENT observes the terminal
      // `background_tasks` status directly and reconciles the child's ledger
      // outcome from its published-output ground truth — the run ledger converges
      // even when the child never announced anything.
      for (const task of input.background_tasks) {
        if (task.agent_type && isTerminalStatus(task.status)) {
          const childSpec = specs?.get(task.agent_type);
          // `BackgroundTaskSummary` carries no agent_id; `id` matches it for
          // subagent tasks, so try that first and fall back to the type's latest
          // dispatch. Marking terminal here is what unblocks a waiter whose child
          // died without ever firing its own SubagentStop.
          const key = dispatches?.keyForAgentId(task.id) ?? dispatches?.soleFor(task.agent_type);
          if (key) dispatches?.markTerminal(key);
          if (childSpec) {
            await reconcileOutcome(workspace, childSpec, key ? { dispatch: key } : {});
          }
        }
      }
      // The root session stays open while any background work is still in flight.
      if (input.hook_event_name === "Stop") {
        const pending = input.background_tasks.filter((task) => !isTerminalStatus(task.status));
        if (pending.length) {
          return blockStop("Stop", `Background work is still active: ${pending.map((task) => task.agent_type ?? task.description).join(", ")}`, `Background delegation is still active. Call mcp__run_context__wait_for_outcome exactly once for ${pending[0]?.agent_type ?? "the delegated agent"}; do not poll read_context or repeatedly attempt to stop.`);
        }
      }
    }
    const activeSpec = input.hook_event_name === "SubagentStop" ? specs?.get(input.agent_type) : spec;
    if (!activeSpec) {
      // Fail CLOSED. Returning `{}` here waved a subagent through with no
      // close-out gate at all whenever its spec could not be resolved — the one
      // path where "no rule matched" silently meant "no rule applies".
      if (input.hook_event_name !== "SubagentStop") return NO_OPINION;
      return blockStop("SubagentStop", `Unknown agent type '${input.agent_type}': close-out cannot be verified`, `Your agent type '${input.agent_type}' is not in the validated agent graph, so the runtime cannot check your required outputs. Publish your required outputs with mcp__run_context__publish_output, then record your outcome.`);
    }
    const activeKey = input.hook_event_name === "SubagentStop"
      ? dispatches?.keyForAgentId(input.agent_id) ?? activeSpec.name
      : activeSpec.name;
    const activeWorkspace = await ensureAgentWorkspace(workspace, activeKey);
    const present = new Set(await readdir(activeWorkspace.output));
    const missing = activeSpec.requiredOutputs.filter((name) => !present.has(name));
    if (!missing.length && input.hook_event_name === "SubagentStop") {
      // Every subagent's ledger entry converges at its OWN stop, from the same
      // output ground truth — not only at the coordinator's seams. Idempotent, so
      // a self-recorded verdict is never clobbered.
      await reconcileOutcome(workspace, activeSpec, { dispatch: activeKey });
    }
    if (!missing.length) {
      // Completeness backstop, run at the LAST possible moment: the root has
      // published everything it owes and this `Stop` is the one that actually
      // ends the run. `background_tasks` covers detached work only, and the
      // `Agent`-return seam covers a synchronous dispatch that returned a
      // terminal result — a child killed in a way that produced neither is
      // still open, and the registry is the only structure that knows it
      // started. So the run refuses to end with a dispatch unaccounted for.
      //
      // Deliberately the narrowest possible trigger. Converging a LIVE agent to
      // `abandoned` is what produces spurious retries and duplicate dispatches,
      // so this fires only when nothing is pending in `background_tasks` AND the
      // root is otherwise free to stop — never on an intermediate, blocked Stop
      // while delegated work may still be in flight.
      if (input.hook_event_name === "Stop" && dispatches && !input.background_tasks?.some((task) => !isTerminalStatus(task.status))) {
        for (const key of dispatches.openKeys()) {
          const orphanSpec = specs?.get(dispatches.typeOf(key) ?? "");
          if (!orphanSpec) continue;
          dispatches.markTerminal(key);
          const result = await reconcileOutcome(workspace, orphanSpec, { dispatch: key });
          if (result.verdict === "abandoned") await writeContinuationPacket(workspace, key, result.missing, dispatches.attemptOf(key));
        }
      }
      return NO_OPINION;
    }
    const eventName = input.hook_event_name;
    return blockStop(eventName, `Required outputs missing: ${missing.join(", ")}`, `Completion gate failed. Publish required outputs before stopping: ${missing.join(", ")}`);
  };
}
