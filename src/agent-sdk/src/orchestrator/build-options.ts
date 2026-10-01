import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { writeFile } from "node:fs/promises";
import { buildAgents, resolveAgentTools } from "../agents/build.js";
import { loadAgentGraph } from "../agents/catalog.js";
import { discoverSkills } from "../catalog/skills.js";
import { loadSdkConfig } from "../config/load.js";
import { fromRepoRoot } from "../config/paths.js";
import type { AgentSpec, RunWorkspace, RuntimeConfig } from "../domain/types.js";
import { DeterminismLedger } from "../determinism/ledger.js";
import type { DeterminismOutcome } from "../hooks/determinism.js";
import { meteredSpend } from "../hooks/guards.js";
import { isDailyBriefRequest } from "../hooks/daily-brief.js";
import { composeHooks } from "../hooks/index.js";
import { buildToolCatalog, scriptToolName } from "../../assets/tools/catalog.js";
import { createPermissionBridge } from "../../assets/tools/hitl/tool.js";
import type { ArtifactSink } from "../../assets/tools/present/document.js";
import type { Prompter } from "../../assets/tools/hitl/terminal.js";
import { buildMcpServers } from "../../assets/tools/mcp/catalog.js";
import { ensureAgentWorkspace } from "../workspace/run-workspace.js";
import { HandoffBus } from "../handoffs/state.js";
import { DispatchRegistry } from "../handoffs/dispatch.js";
import type { SteeringBus } from "../steering/bus.js";
import { buildAgentContext } from "../prompt/assemble.js";
import { toYaml } from "../prompt/yaml.js";
import type { AgentContext } from "../prompt/model.js";

/** What the host (terminal run, web session, test) plugs into a run. Everything is optional: a bare call is headless. */
export interface RunHost {
  prompter?: Prompter;
  steering?: SteeringBus;
  artifactSink?: ArtifactSink;
  /** The run's first request; a daily-brief request arms the outlook format gate. */
  request?: string;
  /** Told every determinism check's outcome (the web session shows it in the chat and the log). */
  onDeterminism?: (outcome: DeterminismOutcome) => void | Promise<void>;
}

export async function buildOptions(config: RuntimeConfig, selected: AgentSpec, workspace: RunWorkspace, host: RunHost = {}): Promise<Options> {
  const { prompter, steering, artifactSink } = host;
  const [graph, skills, sdkConfig, toolCatalog] = await Promise.all([loadAgentGraph(), discoverSkills(), loadSdkConfig(), buildToolCatalog()]);
  // Tool policy is PROFILE-DERIVED and has exactly one source: the `tools:` grant in
  // each agent profile. Whatever a profile grants, that agent may call without a
  // permission dialog. This is a session-level PERMISSION list, not a roster: it
  // widens nobody's reach, because each subagent is still bounded by its own
  // AgentDefinition.tools (built from its own profile).
  const grantedByAnyProfile = [...new Set(
    [...graph.agents.values()].flatMap((spec) => resolveAgentTools(spec, toolCatalog)),
  )];
  const automaticallyAllowed = [...new Set([
    ...grantedByAnyProfile,
    ...(selected.handoffs.length ? ["Agent"] : []),
  ])];
  // One registry per run: SubagentStart claims a dispatch key here, and the waiter,
  // ledger, hooks, and artifact planes all resolve through it, so a re-dispatch of
  // one agent type never collides with its predecessor.
  const dispatches = new DispatchRegistry(selected.name);
  const mcp = buildMcpServers(toolCatalog, workspace, selected.name, graph.agents, skills, prompter, dispatches, sdkConfig.externalMcpServers, artifactSink);
  // Pre-satisfy the session-global load-guide gate for every family any agent
  // declares `mandatory`: its guide is already inlined in that agent's prompt.
  for (const spec of graph.agents.values())
    for (const grant of spec.tools) if (grant.disclosure === "mandatory") mcp.loadedGuides.add(grant.name);
  // Registered script tools that cost money: approved per call in a terminal, denied headless.
  const meteredTools = new Set(toolCatalog.scripts.filter((spec) => spec.metered).map((spec) => scriptToolName(spec.name)));
  // `CLAUDE_MODEL` pins every agent; runtime.yaml's `model` is only the default for
  // a spec that declares none, so the catalog's per-agent models stand.
  const modelOverride = process.env.CLAUDE_MODEL;
  const model = modelOverride ?? graph.agents.get(selected.name)?.sdk.model ?? config.model;
  // Parse the shared markdown ledger once into the structured run context, then bind
  // it into every orchestrator's context so the dispatched XML prompt AND the
  // on-disk context.yaml carry the same <context> region.
  const runContext = await new HandoffBus(workspace.contextFile).readRunContext();
  const agents = await buildAgents(graph, toolCatalog, { override: modelOverride, fallback: config.model }, runContext);
  const contexts = new Map<string, AgentContext>();
  for (const [name, spec] of graph.agents) contexts.set(name, await buildAgentContext(spec, { toolCatalog, ...(spec.orchestrator ? { runContext } : {}) }));
  const rootWorkspace = await ensureAgentWorkspace(workspace, selected.name);
  await writeFile(rootWorkspace.agentContextFile, toYaml(contexts.get(selected.name)!));
  return {
    cwd: fromRepoRoot(), model,
    maxTurns: Number(process.env.CLAUDE_MAX_TURNS ?? config.maxTurns),
    ...(process.env.CLAUDE_MAX_BUDGET_USD ? { maxBudgetUsd: Number(process.env.CLAUDE_MAX_BUDGET_USD) } : {}),
    permissionMode: config.permissionMode, settingSources: config.settingSources,
    // Forward subagent text/thinking into the parent stream so the terminal renderer
    // can narrate delegated work, not just heartbeat tool calls.
    forwardSubagentText: true,
    // A short model-written "what it is doing now" line on each running subagent's progress events, for the
    // web chat's orchestration map and the terminal. The fork reuses the subagent's prompt cache, so it is cheap.
    agentProgressSummaries: true,
    // Exactly ONE seam carries the auto-approve list. With a prompter the bridge
    // approves it; also passing it as bare `allowedTools` would approve those tools
    // before the bridge is consulted, so the bridge could never see them.
    ...(prompter ? { canUseTool: createPermissionBridge(prompter, automaticallyAllowed, (toolName, input) => meteredSpend(toolName, input, meteredTools)) } : { allowedTools: automaticallyAllowed }),
    // Tool scoping is DEFINITION-owned, never session-owned: the root runs as its own
    // agent definition (SDK `agent` option), so its tools/disallowed restrictions bind
    // only itself. No session-level `tools`/`disallowedTools`: those would clamp every
    // subagent to the root's surface.
    agent: selected.name,
    agents,
    mcpServers: mcp.servers,
    hooks: composeHooks({
      workspace, selected, agents: graph.agents, contexts, dispatches, steering,
      interactive: Boolean(prompter?.interactive), meteredTools,
      toolAreas: mcp.toolAreas, loadedGuides: mcp.loadedGuides,
      scripts: toolCatalog.scripts, ledger: new DeterminismLedger(fromRepoRoot()),
      dailyBrief: isDailyBriefRequest(host.request ?? ""),
      ...(host.onDeterminism ? { onDeterminism: host.onDeterminism } : {}),
    }),
    env: {
      ...process.env,
      // SDK-level tuning (auto-memory/CLAUDE.md suppression, traffic, ...) is
      // declarative in assets/config/agent-sdk-config.yaml, not hardcoded here.
      ...sdkConfig.env,
      AGENT_TOOLS_LOG: workspace.toolsFile,
      AGENT_OUTPUT_DIR: workspace.output,
      AGENT_RUN_CONTEXT: workspace.contextFile,
    },
  };
}
