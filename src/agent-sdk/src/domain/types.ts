import type { AgentDefinition, PermissionMode } from "@anthropic-ai/claude-agent-sdk";

// NOTE: `memory` is deliberately EXCLUDED. Native SDK memory is hard-disabled:
// it injected a native-memory prompt plus the CLI project auto-memory per agent.
// What an agent learns goes in its published outputs and the run ledger.
export type AgentNativeConfig = Pick<AgentDefinition,
  | "model"
  | "disallowedTools"
  | "mcpServers"
  | "criticalSystemReminder_EXPERIMENTAL"
  | "initialPrompt"
  | "maxTurns"
  | "background"
  | "effort"
  | "permissionMode"
  | "observer"
  | "observerMessage"
>;

// Names of the four composition domains. A skill may never carry one of these
// names into an agent's `skills` grant (a workflow named `tools` would smuggle
// executable capability past the profile's `tools:` grant), and a profile shim
// named after one launches a profile that grants tool families instead.
export const COMPOSITION_DOMAIN_NAMES: ReadonlySet<string> = new Set(["agents", "agent_profile", "skills", "tools"]);

export type ToolDisclosure = "progressive" | "mandatory";
export interface ToolGrant { name: string; disclosure: ToolDisclosure }

export interface AgentSpec {
  name: string;
  description: string;
  agentProfile: string;
  // Derived from the agent profile (single source of truth), never declared in
  // agent_catalog.yaml: `skills` are workflow names, `tools` are tool-family
  // grants with per-agent disclosure.
  skills: string[];
  tools: ToolGrant[];
  // Only an orchestrator declares handoffs: a Claude Agent SDK subagent has no
  // `Agent` tool, so a handoff edge on one could never be dispatched.
  handoffs: string[];
  requiredOutputs: string[];
  // An orchestrator runs as the session's MAIN thread (the SDK `agent` option)
  // and is the only agent that dispatches. It is never a handoff target: running
  // one as a subagent would strip the `Agent` tool its whole workflow depends on.
  orchestrator: boolean;
  // Orchestrator -> orchestrator SESSION handoff: when this orchestrator's run
  // ends having published its handoff brief, the launcher may start the named
  // orchestrator as a NEW main-thread session seeded with that brief alone. Never
  // a subagent dispatch — the target keeps its `Agent` tool and a clean context.
  handoffTo?: string;
  sdk: AgentNativeConfig;
}

// agent_catalog.yaml rows carry infra only — profile-owned fields are stripped.
export type AgentSpecDeclaration = Omit<AgentSpec, "description" | "skills" | "tools">;

export interface RuntimeConfig {
  defaultAgent: string;
  model: string;
  maxTurns: number;
  permissionMode: PermissionMode;
  settingSources: Array<"user" | "project" | "local">;
  runsDirectory: string;
}

// One external (out-of-process) MCP server, resolved from the repo-root
// `.mcp.json` so its wiring has exactly one home: a stdio subprocess or a
// streamable-HTTP endpoint. Both shapes are assignable to
// the SDK's `McpServerConfig` union and pass through `buildMcpServers` verbatim.
export type ExternalMcpServer =
  | { type: "stdio"; command: string; args: string[]; env: Record<string, string> }
  | { type: "http"; url: string; headers: Record<string, string>; alwaysLoad?: boolean };

// SDK-level tuning (assets/config/agent-sdk-config.yaml): process env forwarded to
// every spawned agent CLI. Not per-agent (that is catalog.yaml `sdk:`).
export interface AgentSdkConfig {
  env: Record<string, string>;
  // External MCP servers to attach, keyed by server name. `settingSources: []`
  // means the CLI never discovers `.mcp.json` on its own, so a profile that
  // grants an external family (e.g. a `browser` family -> `mcp__playwright__*`) gets an
  // allowlist entry for tools that do not exist unless we attach them here.
  externalMcpServers: Record<string, ExternalMcpServer>;
}

export interface RunWorkspace {
  runId: string;
  root: string;
  agentRoot: string;
  toolsFile: string;
  output: string;
  contextFile: string;
  auditFile: string;
  agentContextFile: string;
}
