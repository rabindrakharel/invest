import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { buildSkillCatalog, type SkillCatalogEntry } from "../catalog/skills.js";
import type { AgentSpec } from "../domain/types.js";
import type { AgentGraph } from "./catalog.js";
import { buildAgentContext } from "../prompt/assemble.js";
import { toXml } from "../prompt/xml.js";
import type { RunContext } from "../prompt/model.js";
import { ALWAYS_ON_TOOL_NAMES, CONTEXT_SERVER, GUIDE_SERVER, HITL_SERVER, PRESENT_SERVER, SCRIPT_SERVER, type ToolCatalog } from "../../assets/tools/catalog.js";

/**
 * Resolve an agent's callable tool roster from its profile `tools:` grants. Each
 * grant names a tool FAMILY in the catalog; its concrete `toolNames` join the
 * always-on baseline (read surface + run-context, guide and HITL adapters). Fails closed on an
 * unknown family rather than granting an empty scope.
 */
export function resolveAgentTools(spec: AgentSpec, toolCatalog: ToolCatalog): string[] {
  const scoped = spec.tools.flatMap(({ name }) => {
    const entry = toolCatalog.groups.get(name);
    if (!entry) throw new Error(`Agent '${spec.name}' references unknown tool family '${name}'`);
    return entry.toolNames;
  });
  return [...ALWAYS_ON_TOOL_NAMES, ...scoped];
}

/**
 * Materialize a tool grant into the concrete names an agent's roster must name
 * explicitly. A subagent's `AgentDefinition.tools` is matched by exact name — it
 * does NOT expand `*` — so a wildcard grant like `mcp__acme__list_*`
 * would otherwise reach the roster as an unmatchable literal and every tool it
 * covers reports "No such tool available", even though the MCP server registered
 * them. We expand each `*`-suffixed pattern against the known tool universe;
 * patterns we can't enumerate (external MCP servers absent from our catalog) pass through unchanged so their runtime resolution
 * is unaffected.
 */
export function expandToolPatterns(patterns: string[], knownToolNames: readonly string[]): string[] {
  return patterns.flatMap((pattern) => {
    if (!pattern.endsWith("*")) return [pattern];
    const matches = knownToolNames.filter((name) => name.startsWith(pattern.slice(0, -1)));
    return matches.length ? matches : [pattern];
  });
}

/**
 * Model resolution is three-tier and the order is load-bearing: an explicit
 * `override` (the `CLAUDE_MODEL` env var) pins EVERY agent — that is what a
 * human asking for one model across the run means; otherwise each agent uses
 * the model its catalog spec declares; `fallback` (runtime.yaml `model`) only
 * covers a spec that declares none. Passing runtime.yaml's value as `override`
 * silently flattened every per-agent model to one, which made the catalog's
 * `sdk.model` field inert.
 */
export interface AgentModelResolution { override?: string | undefined; fallback?: string | undefined }

export async function buildAgents(graph: AgentGraph, toolCatalog: ToolCatalog, models: AgentModelResolution = {}, runContext?: RunContext): Promise<Record<string, AgentDefinition>> {
  const skillCatalog = await buildSkillCatalog();
  const definitions: Record<string, AgentDefinition> = {};
  for (const [name, spec] of graph.agents) {
    for (const skill of spec.skills) if (!skillCatalog.has(skill)) throw new Error(`Agent '${name}' references missing skill '${skill}'`);
    // Context isolation: only an orchestrator sees the run — the original request,
    // the artifact plane, prior outcomes. A subagent's whole task arrives in its
    // dispatch brief; embedding the run in its system prompt would hand every
    // dispatch the full request and every sibling's history.
    const prompt = await composeAgentDefinitionPrompt(spec, toolCatalog, skillCatalog, spec.orchestrator ? runContext : undefined);
    const model = models.override ?? spec.sdk.model ?? models.fallback;
    if (!model) throw new Error(`Agent '${name}' has no resolved model`);
    // Skill delivery is prompt inlining only: the SDK `skills` option is
    // deliberately absent so no second (path-resolving) channel exists.
    // Tool scoping is definition-owned: handoff-capable agents get the Agent
    // tool here, and every agent may raise a HITL question (the permission
    // bridge collects answers; headless runs deny it gracefully).
    const resolvedTools = expandToolPatterns(resolveAgentTools(spec, toolCatalog), toolCatalog.allToolNames);
    definitions[name] = {
      ...spec.sdk,
      model,
      mcpServers: [...new Set([...(spec.sdk.mcpServers ?? []), CONTEXT_SERVER, GUIDE_SERVER, HITL_SERVER, SCRIPT_SERVER, PRESENT_SERVER])],
      description: spec.description,
      prompt,
      tools: [...new Set([
        // Expand wildcard grants to concrete names: the SDK matches a subagent's
        // roster by exact name, so an unexpanded `*` would hide every tool it covers.
        ...resolvedTools,
        ...(spec.handoffs.length ? ["Agent"] : []),
        "AskUserQuestion",
      ])],
    };
  }
  return definitions;
}

/**
 * Compose one agent's dispatched system prompt: assemble the structured
 * {@link buildAgentContext} model, then serialize it to the native XML prompt.
 * The prompt is XML end-to-end — the retired markdown clause assembly is gone;
 * the same model materializes as `context.yaml` via `toYaml`. `skillCatalog` and
 * `runContext` are threaded so callers that already built them avoid re-work.
 */
export async function composeAgentDefinitionPrompt(spec: AgentSpec, toolCatalog?: ToolCatalog, skillCatalog?: Map<string, SkillCatalogEntry>, runContext?: RunContext): Promise<string> {
  return toXml(await buildAgentContext(spec, {
    ...(toolCatalog ? { toolCatalog } : {}),
    ...(skillCatalog ? { skillCatalog } : {}),
    ...(runContext ? { runContext } : {}),
  }));
}
