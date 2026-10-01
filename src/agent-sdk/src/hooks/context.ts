import { writeFile } from "node:fs/promises";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { RunWorkspace } from "../domain/types.js";
import type { DispatchRegistry } from "../handoffs/dispatch.js";
import type { AgentContext } from "../prompt/model.js";
import { toYaml } from "../prompt/yaml.js";
import type { SteeringBus } from "../steering/bus.js";
import { ensureAgentWorkspace } from "../workspace/run-workspace.js";
import { callerKey } from "./caller.js";
import { addContext, allowWith, deny, NO_OPINION } from "./decisions.js";

export function prepareAgentContext(workspace: RunWorkspace, contexts: Map<string, AgentContext>, dispatches?: DispatchRegistry): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "SubagentStart") return NO_OPINION;
    // First hook of a dispatch's life: claim its ordinal here so every later hook,
    // ledger write, and artifact path for this instance resolves to the same key.
    const key = dispatches?.register(input.agent_id, input.agent_type) ?? input.agent_type;
    const context = contexts.get(input.agent_type);
    if (!context) return NO_OPINION;
    const agentWorkspace = await ensureAgentWorkspace(workspace, key);
    // The subagent's dispatched prompt IS this context as XML; context.yaml is
    // the same object as data, materialized for observability.
    await writeFile(agentWorkspace.agentContextFile, toYaml(context));
    return NO_OPINION;
  };
}

const CALLER_ATTRIBUTED_CONTEXT_TOOLS = new Set([
  "mcp__run_context__record_outcome",
  "mcp__run_context__publish_output",
  ]);

/**
 * PreToolUse hook: deterministically attribute every caller-owned context write
 * (`record_outcome`, `publish_output`) to the DISPATCH that actually made it. One
 * `run_context` server is shared across all agents, so the tool would otherwise
 * fall back to the root's name whenever the model omits `agent`. The SDK stamps
 * the calling agent onto the hook input (`agent_id` per dispatch, `agent_type` for
 * the type); we rewrite the tool input so a subagent's published artifacts —
 * including its required outputs — always land in its own
 * dispatch `output/`, never the supervisor's and never a sibling attempt's.
 *
 * A write ADDRESSED to a different agent is denied outright rather than quietly
 * redirected: an orchestrator that tried to publish a subagent's required output had it
 * silently rewritten into its own plane and believed the subagent's required
 * output was satisfied. Close-out is non-transferable; say so loudly.
 */
export function attributeContextWriteToCaller(allowedAgents: Set<string>, dispatches?: DispatchRegistry): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return NO_OPINION;
    if (!CALLER_ATTRIBUTED_CONTEXT_TOOLS.has(input.tool_name)) return NO_OPINION;
    const callerType = typeof input.agent_type === "string" ? input.agent_type : undefined;
    if (!callerType || !allowedAgents.has(callerType)) return NO_OPINION;
    const current = (input.tool_input ?? {}) as Record<string, unknown>;
    const requested = typeof current.agent === "string" ? current.agent : undefined;
    if (requested && requested !== callerType && dispatches?.typeOf(requested) !== callerType) {
      return deny(`${input.tool_name} writes only your OWN plane: you are \`${callerType}\`, not \`${requested}\`. An agent's required outputs and outcome are its own to publish — re-dispatch \`${requested}\` to finish its close-out instead of writing it yourself.`);
    }
    const key = callerKey(input, callerType, dispatches);
    if (current.agent === key) return NO_OPINION;
    return allowWith({ ...current, agent: key });
  };
}

/**
 * Deliver operator steering to a DELEGATED dispatch.
 *
 * The SDK's streaming-input channel addresses the root session only; a subagent
 * runs in its own isolated session that no user message can reach. Its notes
 * therefore ride the next hook that fires for it — `PreToolUse`, so the note
 * lands BEFORE the agent acts. Steering that arrives after the fact is a
 * comment, not steering.
 *
 * Root-addressed notes are skipped here on purpose: they go out through the
 * input channel, and delivering them twice would double every instruction.
 */
export function deliverSteering(steering: SteeringBus | undefined, rootAgent: string, dispatches?: DispatchRegistry): HookCallback {
  return async (input) => {
    if (!steering || input.hook_event_name !== "PreToolUse") return NO_OPINION;
    const key = callerKey(input, rootAgent, dispatches);
    if (key === rootAgent) return NO_OPINION;
    const notes = steering.drainFor(key, dispatches?.typeOf(key));
    if (!notes.length) return NO_OPINION;
    return addContext("PreToolUse", [
          `The human operator is steering you (\`${key}\`) mid-task. Apply this before continuing, and say in your outputs how it changed what you did:`,
          ...notes.map((note) => `- ${note}`),
        ].join("\n"));
  };
}
