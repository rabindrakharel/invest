import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import type { DispatchRegistry } from "../handoffs/dispatch.js";

/**
 * The dispatch key of the agent a hook fired for. `agent_id` is the SDK's own
 * per-dispatch identity, so two concurrent dispatches of one type route to their
 * own planes instead of interleaving in a shared type-keyed file.
 */
export function callerKey(input: HookInput, rootAgent: string, dispatches?: DispatchRegistry): string {
  const agentId = "agent_id" in input && typeof input.agent_id === "string" ? input.agent_id : undefined;
  const fromId = agentId ? dispatches?.keyForAgentId(agentId) : undefined;
  if (fromId) return fromId;
  const agentType = "agent_type" in input && typeof input.agent_type === "string" ? input.agent_type : undefined;
  if (!agentType) return rootAgent;
  return dispatches?.latestFor(agentType) ?? agentType;
}
