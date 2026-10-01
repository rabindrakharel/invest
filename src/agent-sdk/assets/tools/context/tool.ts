import { mkdir, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { fromRepoRoot } from "../../../src/config/paths.js";
import type { AgentSpec, RunWorkspace } from "../../../src/domain/types.js";
import { HandoffBus } from "../../../src/handoffs/state.js";
import { DispatchRegistry, lastProgressAt } from "../../../src/handoffs/dispatch.js";
import { reconcileOutcome } from "../../../src/handoffs/reconcile.js";
import { ensureAgentWorkspace } from "../../../src/workspace/run-workspace.js";
import { CONTEXT_SERVER } from "../catalog.js";

const inside = (root: string, path: string) => {
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(root + "/")) throw new Error(`Path escapes workspace: ${path}`);
  return resolved;
};

// Waiting here is the EXCEPTION path, not the primary one. The SDK's own answer
// to "I need this agent's result before continuing" is `run_in_background: false`
// on the Agent call, which returns the subagent's final message as the tool
// result — no ledger polling, no liveness inference, no verdict to reconstruct.
//
// This waiter exists only for deliberately-detached work, and it is deliberately
// SHORT: a coordinator blocked inside this call cannot process the completion
// notification for the very agent it is waiting on, so a long wait delays the
// answer it is waiting for (a 1800s wait produced a 30-minute livelock — the
// awaited child's SubagentStop could not be delivered while the parent was
// parked here, and every sibling that the parent did NOT block on completed
// normally). Short wait, then yield the turn.
const DEFAULT_WAIT_SECONDS = 120;
const MAX_WAIT_SECONDS = 600;
const POLL_INTERVAL_MS = 500;

export function createContextServer(
  workspace: RunWorkspace,
  rootAgent: string,
  specs: Map<string, AgentSpec>,
  dispatches: DispatchRegistry = new DispatchRegistry(rootAgent),
) {
  const bus = new HandoffBus(workspace.contextFile);
  const allowedAgents = new Set(specs.keys());
  const agentRoster = [...allowedAgents];
  // The run ledger is keyed by AGENT TYPE (the catalog/`subagent_type` name), not
  // by the harness's opaque per-launch agentId. A coordinator that pastes the
  // launch acknowledgement's id gets a hard, self-correcting rejection — surface
  // the roster and name the confusion instead of a bare "unknown agent".
  const unknownAgent = (name: string) =>
    new Error(
      `Unknown or unauthorized run agent: ${name}. Valid agents in this run: ${agentRoster.join(", ")}. `
      + "Pass the agent TYPE name you dispatched (the `subagent_type`, e.g. `macro-analyst`) — "
      + "NOT the opaque agentId from an Agent launch acknowledgement, which this run's ledger never keys on.",
    );
  // Enumerate the roster in the tool schema itself so the model sees the legal
  // values up front rather than discovering them through a failed call.
  //
  // The union's second arm is NOT model-facing: `attributeContextWriteToCaller`
  // rewrites `agent` to the caller's dispatch key (`macro-analyst/1`) before the tool
  // runs, so the schema must accept what the runtime writes as well as what the
  // model types. Without it, every delegated publish failed validation — the
  // agent was blocked from its own required output by its own attribution hook.
  const AgentTypeSchema = agentRoster.length
    ? z.enum(agentRoster as [string, ...string[]])
    : z.string().min(1);
  const DispatchKeySchema = z.string().regex(/^[^/]+\/[1-9][0-9]*$/, {
    message: "dispatch keys are `<agent-type>/<ordinal>`; pass the agent TYPE name instead",
  });
  const AgentNameSchema = z.union([AgentTypeSchema, DispatchKeySchema]);
  // Callers name a TYPE; the ledger and workspace are keyed per DISPATCH. The
  // registry resolves the type to the dispatch actually running, so a re-dispatch
  // gets its own section instead of colliding with its predecessor's.
  const resolveAgent = async (agent?: string) => {
    const name = agent ?? rootAgent;
    if (!allowedAgents.has(name) && !dispatches.typeOf(name)) throw unknownAgent(name);
    const key = dispatches.resolve(name) ?? name;
    return { key, workspace: await ensureAgentWorkspace(workspace, key) };
  };
  return createSdkMcpServer({ name: CONTEXT_SERVER, version: "0.2.0", tools: [
    tool("read_context", "Read the shared run handoff ledger", {}, async () => ({
      content: [{ type: "text" as const, text: await bus.read() }],
    })),
    tool("wait_for_outcome", "EXCEPTION PATH — only for an agent you deliberately detached. When you need a delegated agent's result before continuing, dispatch it with `run_in_background: false` instead; the Agent call then returns its final message directly and no wait is needed at all. Wait briefly for a detached agent's terminal outcome — its own recorded verdict, or, if it terminated without recording one, a runtime-reconciled verdict derived from its published outputs (completed when present, abandoned when missing). Identify the dispatch by its dispatch key (`macro-analyst/3`, from the ledger), or by its TYPE name (`macro-analyst`) when exactly one dispatch of that type is in flight — a type with several siblings in flight is ambiguous and is refused with the keys to choose from. Never pass the opaque agentId from an Agent launch acknowledgement. If it returns `still running`, END YOUR TURN so the runtime can deliver the completion notification — blocking here again only delays it. Never re-dispatch on `still running`.", {
      agent: AgentNameSchema
        .describe("A dispatch key (`macro-analyst/3`, from the ledger), or a TYPE name when only one dispatch of it is in flight — never a launch-acknowledgement agentId"),
      // Optional, not `.default()`: the SDK tool wrapper rejects a call that omits a defaulted field.
      timeout_seconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).optional(),
    }, async ({ agent, timeout_seconds: requestedTimeout }) => {
      const timeout_seconds = requestedTimeout ?? DEFAULT_WAIT_SECONDS;
      // Accept a dispatch key as well as a type — resolve back to the owning spec.
      const spec = specs.get(agent) ?? specs.get(dispatches.typeOf(agent) ?? "");
      if (!spec) throw unknownAgent(agent);
      const siblings = specs.has(agent) ? dispatches.openFor(agent) : [];
      if (siblings.length > 1) {
        return {
          content: [{ type: "text" as const, text: `\`${agent}\` is ambiguous: ${siblings.length} dispatches of it are in flight (${siblings.join(", ")}). Wait on one by its dispatch key.` }],
          isError: true,
        };
      }
      const deadline = Date.now() + timeout_seconds * 1000;
      const startedAt = Date.now();
      let key = dispatches.resolve(agent);
      let baseline = key ? await lastProgressAt(workspace, key) : 0;
      while (Date.now() < deadline) {
        // The dispatch may not have registered yet when the wait starts (the
        // launch acknowledgement returns before SubagentStart fires). Re-resolve
        // until it appears rather than waiting on a stale predecessor's key.
        const current = dispatches.resolve(agent);
        if (current && current !== key) {
          key = current;
          baseline = await lastProgressAt(workspace, key);
        }
        if (key) {
          const recorded = await bus.readAgent(key);
          if (recorded) return { content: [{ type: "text" as const, text: recorded }] };
          // Ground-truth fast path: the agent published every required output but
          // never recorded an outcome — converge the ledger to `completed` and
          // return now instead of blocking on a signal it earned yet forgot to
          // send. `onlyIfComplete` keeps us from calling it `abandoned` while it
          // may still be working; only the deadline below settles that.
          const eager = await reconcileOutcome(workspace, spec, { onlyIfComplete: true, dispatch: key });
          if (eager.state !== "pending") return { content: [{ type: "text" as const, text: eager.outcome }] };
        }
        await new Promise((settle) => setTimeout(settle, POLL_INTERVAL_MS));
      }

      // Deadline. Converging to `abandoned` here USED TO be unconditional, which
      // declared still-working agents dead and caused duplicate dispatches. Only
      // an agent that is observably finished — or that made no progress at all
      // for the whole wait — gets a terminal verdict; a live one gets a
      // non-terminal answer so the coordinator waits again instead of re-running.
      if (!key) {
        return {
          content: [{ type: "text" as const, text: `No dispatch of \`${agent}\` has started yet after ${timeout_seconds}s. Verify it was launched; do not record an outcome on its behalf.` }],
          isError: true,
        };
      }
      // Only an OBSERVED terminal dispatch earns a terminal verdict. A slow agent
      // is not a dead one, and the cost of guessing wrong is asymmetric: a false
      // `abandoned` triggers a duplicate dispatch that competes for the same
      // output plane, while waiting again costs one more tool call. Anything that
      // truly died converges through the parent's Stop backstop, which reads real
      // terminal `background_tasks` status instead of inferring it from a clock.
      if (!dispatches.isTerminal(key)) {
        const progressed = await lastProgressAt(workspace, key) > Math.max(baseline, startedAt - POLL_INTERVAL_MS);
        const evidence = progressed
          ? `it published or logged activity during the ${timeout_seconds}s wait`
          : `it has not written anything for ${timeout_seconds}s, but has not terminated either`;
        return {
          content: [{ type: "text" as const, text: `${key} is still running: ${evidence} and has not recorded an outcome. This is NOT a failure and NOT a verdict.\n\nEND YOUR TURN now — you cannot receive this agent's completion notification while you are blocked in this call, so waiting again delays the very answer you want. Do NOT re-dispatch; a second instance would duplicate work already in flight. Next time, dispatch a task you must gate on with \`run_in_background: false\` so the Agent call returns its result directly.` }],
        };
      }
      const settled = await reconcileOutcome(workspace, spec, { dispatch: key });
      return {
        content: [{ type: "text" as const, text: `${settled.outcome}\n\n_Reconciled at the wait deadline (${settled.state}); the agent terminated without recording its own outcome._` }],
        isError: settled.verdict !== "completed",
      };
    }),
    tool("record_outcome", "Append the calling agent's verdict and summary to the run ledger", {
      agent: AgentNameSchema.optional()
        .describe("Your OWN agent TYPE name (defaults to the caller); you may not record another agent's outcome"),
      verdict: z.enum(["completed", "needs_retry", "blocked"]), summary: z.string().min(1),
    }, async ({ agent, verdict, summary }) => {
      const target = await resolveAgent(agent);
      // Ledger pointers stay repo-root-relative — LLM-facing text never carries absolute paths.
      await bus.record(target.key, verdict, summary, relative(fromRepoRoot(), target.workspace.output));
      return { content: [{ type: "text" as const, text: `Outcome recorded for ${target.key}` }] };
    }),
    tool("publish_output", "Publish text content directly into the CALLING agent's output directory", {
      agent: AgentNameSchema.optional()
        .describe("Your OWN agent TYPE name (defaults to the caller); publishing into another agent's output plane is rejected"),
      path: z.string().min(1), content: z.string(),
    }, async ({ agent, path, content }) => {
      const target = await resolveAgent(agent);
      await mkdir(target.workspace.output, { recursive: true });
      const file = inside(target.workspace.output, basename(path));
      await writeFile(file, content);
      return { content: [{ type: "text" as const, text: relative(fromRepoRoot(), file) }] };
    }),
  ] });
}
