import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSpec, ExternalMcpServer, RunWorkspace } from "../../../src/domain/types.js";
import { DispatchRegistry } from "../../../src/handoffs/dispatch.js";
import { createContextServer } from "../context/tool.js";
import { createGuideServer } from "../guide/tool.js";
import { createHitlServer } from "../hitl/tool.js";
import type { Prompter } from "../hitl/terminal.js";
import { CONTEXT_SERVER, GUIDE_SERVER, HITL_SERVER, PRESENT_SERVER, SCRIPT_SERVER, type ToolCatalog } from "../catalog.js";
import { createFileArtifactSink, type ArtifactSink } from "../present/document.js";
import { createPresentServer } from "../present/tool.js";
import { fromRepoRoot } from "../../../src/config/paths.js";
import { createScriptServer } from "../script/tool.js";

export interface McpAssembly {
  // In-process SDK servers plus any external server named in
  // agent-sdk-config.yaml `external_mcp_servers.attach`.
  servers: Record<string, McpServerConfig>;
  loadedGuides: Set<string>;
  loadedSkills: Set<string>;
  // tool name -> gated family: the tool stays denied until that guide is loaded.
  toolAreas: Map<string, string>;
}

export function buildMcpServers(toolCatalog: ToolCatalog, workspace: RunWorkspace, agent: string, specs: Map<string, AgentSpec>, skills: Map<string, string>, prompter?: Prompter, dispatches?: DispatchRegistry, externalServers: Record<string, ExternalMcpServer> = {}, artifactSink?: ArtifactSink): McpAssembly {
  const loadedGuides = new Set<string>();
  const loadedSkills = new Set<string>();
  const guides = new Map([...toolCatalog.groups].map(([name, entry]) => [name, entry.guidePath] as const));
  const toolAreas = new Map<string, string>();
  for (const entry of toolCatalog.groups.values()) {
    if (!entry.gated) continue;
    for (const toolName of entry.toolNames) if (!toolName.endsWith("*")) toolAreas.set(toolName, entry.name);
  }
  return {
    loadedGuides,
    loadedSkills,
    toolAreas,
    servers: {
      // External servers first: an in-process server name always wins a collision.
      ...externalServers,
      [GUIDE_SERVER]: createGuideServer(guides, loadedGuides, skills, loadedSkills),
      // The web chat passes a sink that also pushes the page to the browser; every other run just saves it.
      [PRESENT_SERVER]: createPresentServer(artifactSink ?? createFileArtifactSink(workspace.root, fromRepoRoot()), agent),
      [SCRIPT_SERVER]: createScriptServer(toolCatalog.scripts),
      [CONTEXT_SERVER]: createContextServer(workspace, agent, specs, dispatches ?? new DispatchRegistry(agent)),
      ...(prompter ? { [HITL_SERVER]: createHitlServer(prompter) } : {}),
    },
  };
}
