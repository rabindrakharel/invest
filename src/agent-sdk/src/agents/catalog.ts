import { loadDeclaredAgents } from "../config/load.js";
import { COMPOSITION_DOMAIN_NAMES, type AgentSpec } from "../domain/types.js";
import { loadAgentProfile } from "../catalog/agent-profiles.js";

/**
 * The validated agent graph. `orchestrators` are the agents a session may be
 * launched as that DISPATCH — each one runs as the SDK main thread with its own
 * subagent roster. Every other agent is a subagent: dispatched by an
 * orchestrator, never dispatching itself.
 */
/** The published output that seeds an orchestrator-to-orchestrator session handoff. */
export const HANDOFF_BRIEF = "handoff-brief.md";

export interface AgentGraph { orchestrators: Map<string, AgentSpec>; agents: Map<string, AgentSpec> }

export function validateAgentGraph(specs: AgentSpec[]): AgentGraph {
  const agents = new Map<string, AgentSpec>();
  for (const spec of specs) {
    if (agents.has(spec.name)) throw new Error(`Duplicate agent '${spec.name}'`);
    if (!spec.description.trim()) throw new Error(`Agent '${spec.name}' has no description`);
    if (typeof spec.agentProfile !== "string" || !spec.agentProfile.trim()) throw new Error(`Agent '${spec.name}' has no agent profile`);
    if (!spec.requiredOutputs.length) throw new Error(`Agent '${spec.name}' has no required outputs`);
    if (typeof spec.orchestrator !== "boolean") throw new Error(`Agent '${spec.name}' must declare 'orchestrator: true|false'`);
    for (const skill of spec.skills) {
      if (COMPOSITION_DOMAIN_NAMES.has(skill)) throw new Error(`Agent '${spec.name}' loads '${skill}' as a skill, but '${skill}' names a composition domain; skills stay workflows — grant executable capability through the profile's tools`);
    }
    validateNativeConfig(spec);
    agents.set(spec.name, spec);
  }
  const orchestrators = specs.filter((spec) => spec.orchestrator);
  if (!orchestrators.length) throw new Error("Agent graph requires at least one orchestrator (orchestrator: true)");
  for (const spec of specs) {
    for (const target of spec.handoffs) {
      if (!agents.has(target)) throw new Error(`Agent '${spec.name}' hands off to unknown agent '${target}'`);
      // One level of dispatch, by construction: an SDK subagent has no `Agent`
      // tool, so an orchestrator dispatched as a subagent could never fan out.
      if (agents.get(target)!.orchestrator) throw new Error(`Agent '${spec.name}' hands off to orchestrator '${target}'; orchestrators run as the session main thread and are never dispatched`);
    }
    if (!spec.orchestrator && spec.handoffs.length) throw new Error(`Subagent '${spec.name}' declares handoffs (${spec.handoffs.join(", ")}); only an orchestrator dispatches — a subagent returns to the orchestrator that dispatched it`);
    if (spec.handoffTo !== undefined) {
      const next = agents.get(spec.handoffTo);
      if (!spec.orchestrator) throw new Error(`Subagent '${spec.name}' declares handoffTo; only an orchestrator hands its session off`);
      if (!next || !next.orchestrator) throw new Error(`Orchestrator '${spec.name}' hands its session off to '${spec.handoffTo}', which is not an orchestrator`);
      if (next.name === spec.name) throw new Error(`Orchestrator '${spec.name}' cannot hand its session off to itself`);
      if (!spec.requiredOutputs.includes(HANDOFF_BRIEF)) throw new Error(`Orchestrator '${spec.name}' hands off to '${spec.handoffTo}' but does not require ${HANDOFF_BRIEF}, the brief that seeds the next session`);
    }
    if (spec.sdk.observer && !agents.has(spec.sdk.observer)) throw new Error(`Agent '${spec.name}' observes with unknown agent '${spec.sdk.observer}'`);
    if (spec.sdk.observer === spec.name) throw new Error(`Agent '${spec.name}' cannot observe itself`);
    if (spec.sdk.observer && agents.get(spec.sdk.observer)!.orchestrator) throw new Error(`Agent '${spec.name}' observes with orchestrator '${spec.sdk.observer}'; an observer is spawned as a subagent`);
  }
  const reachable = new Set<string>();
  for (const orchestrator of orchestrators) for (const target of orchestrator.handoffs) reachable.add(target);
  const unreachable = specs.filter((spec) => !spec.orchestrator && !reachable.has(spec.name)).map((spec) => spec.name);
  if (unreachable.length) throw new Error(`Subagents no orchestrator dispatches: ${unreachable.join(", ")}`);
  return { orchestrators: new Map(orchestrators.map((spec) => [spec.name, spec])), agents };
}

const PERMISSION_MODES = new Set(["default", "acceptEdits", "plan", "bypassPermissions", "dontAsk", "auto"]);
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

function validateNativeConfig(spec: AgentSpec): void {
  const native = spec.sdk;
  if (!native || typeof native !== "object") throw new Error(`Agent '${spec.name}' has no sdk configuration`);
  if (!native.model || typeof native.model !== "string") throw new Error(`Agent '${spec.name}' has no native model`);
  if (native.maxTurns !== undefined && (!Number.isInteger(native.maxTurns) || native.maxTurns < 1)) throw new Error(`Agent '${spec.name}' has invalid maxTurns`);
  if (native.effort !== undefined && !(typeof native.effort === "number" ? Number.isInteger(native.effort) && native.effort > 0 : EFFORT_LEVELS.has(native.effort))) throw new Error(`Agent '${spec.name}' has invalid effort`);
  if (native.permissionMode !== undefined && !PERMISSION_MODES.has(native.permissionMode)) throw new Error(`Agent '${spec.name}' has invalid permissionMode`);
  if (native.background !== undefined && typeof native.background !== "boolean") throw new Error(`Agent '${spec.name}' has invalid background flag`);
  if (native.disallowedTools !== undefined && !native.disallowedTools.every((tool) => typeof tool === "string" && tool.length > 0)) throw new Error(`Agent '${spec.name}' has invalid disallowedTools`);
  if (native.mcpServers !== undefined && !native.mcpServers.every((server) => typeof server === "string" || (typeof server === "object" && server !== null && !Array.isArray(server)))) throw new Error(`Agent '${spec.name}' has invalid mcpServers`);
  for (const [field, value] of [["initialPrompt", native.initialPrompt], ["criticalSystemReminder_EXPERIMENTAL", native.criticalSystemReminder_EXPERIMENTAL], ["observer", native.observer], ["observerMessage", native.observerMessage]] as const) {
    if (value !== undefined && (typeof value !== "string" || !value.trim())) throw new Error(`Agent '${spec.name}' has invalid ${field}`);
  }
}

export async function loadAgentGraph(): Promise<AgentGraph> {
  const declarations = (await loadDeclaredAgents()).agents;
  const specs = await Promise.all(declarations.map(async (declaration): Promise<AgentSpec> => {
    if ("description" in declaration) throw new Error(`Agent '${declaration.name}' declares a description in agent_catalog.yaml; selection descriptions live only in the agent profile's description field`);
    for (const owned of ["skills", "toolGroups", "tools"] as const) {
      if (owned in declaration) throw new Error(`Agent '${declaration.name}' declares '${owned}' in agent_catalog.yaml; skills and tools live only in the agent profile (agent_catalog.yaml is infra-only)`);
    }
    const profile = await loadAgentProfile(declaration);
    return { ...declaration, description: profile.description.trim(), skills: profile.skills.map((row) => row.name), tools: profile.tools };
  }));
  return validateAgentGraph(specs);
}
