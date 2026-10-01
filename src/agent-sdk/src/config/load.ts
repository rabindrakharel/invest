import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { fromRepoRoot, fromSdkRoot } from "./paths.js";
import type { AgentSdkConfig, AgentSpecDeclaration, ExternalMcpServer, RuntimeConfig } from "../domain/types.js";

async function yaml<T>(name: string): Promise<T> {
  return parse(await readFile(fromSdkRoot("assets/config", name), "utf8")) as T;
}

export const loadRuntimeConfig = () => yaml<RuntimeConfig>("runtime.yaml");
export const loadDeclaredAgents = async (): Promise<{ agents: AgentSpecDeclaration[] }> => yaml("agent_catalog.yaml");

interface ExternalMcpDeclaration {
  source?: string;
  attach?: string[];
}

// Expand `${VAR}` and `${VAR:-default}` against process.env. `settingSources: []`
// means the spawned CLI never reads `.mcp.json` itself, so WE do the expansion the
// CLI would otherwise perform.
function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/gi, (_, name: string, fallback?: string) => {
    const resolved = process.env[name];
    return resolved !== undefined && resolved !== "" ? resolved : fallback ?? "";
  });
}

interface McpJsonEntry {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  alwaysLoad?: boolean;
}

/**
 * Resolve the external MCP servers named in `external_mcp_servers.attach` from the
 * repo-root `.mcp.json` (its one home). A named-but-missing server throws at
 * startup: a tool family granting `mcp__<name>__*` would otherwise name tools that
 * do not exist.
 */
async function loadExternalMcpServers(declaration: ExternalMcpDeclaration | undefined): Promise<Record<string, ExternalMcpServer>> {
  const attach = declaration?.attach ?? [];
  if (!attach.length) return {};
  const source = declaration?.source ?? ".mcp.json";
  const parsed = JSON.parse(await readFile(fromRepoRoot(source), "utf8").catch(() => {
    throw new Error(`agent-sdk-config.yaml external_mcp_servers.source '${source}' is unreadable; it must exist to attach ${attach.join(", ")}`);
  })) as { mcpServers?: Record<string, McpJsonEntry> };
  const servers: Record<string, ExternalMcpServer> = {};
  for (const name of attach) {
    const entry = parsed.mcpServers?.[name];
    if (!entry) throw new Error(`agent-sdk-config.yaml attaches MCP server '${name}', but ${source} has no mcpServers.${name}`);
    if (entry.type === "http" || entry.url) {
      if (!entry.url) throw new Error(`HTTP MCP server '${name}' in ${source} has no url`);
      const headers = Object.fromEntries(Object.entries(entry.headers ?? {}).map(([k, v]) => [k, expandEnv(v)]));
      servers[name] = { type: "http", url: expandEnv(entry.url), headers, ...(entry.alwaysLoad !== undefined ? { alwaysLoad: entry.alwaysLoad } : {}) };
      continue;
    }
    if (!entry.command) throw new Error(`MCP server '${name}' in ${source} has no command`);
    servers[name] = {
      type: "stdio",
      command: expandEnv(entry.command),
      args: (entry.args ?? []).map(expandEnv),
      env: Object.fromEntries(Object.entries(entry.env ?? {}).map(([k, v]) => [k, expandEnv(v)])),
    };
  }
  return servers;
}

export const loadSdkConfig = async (): Promise<AgentSdkConfig> => {
  const raw = (await yaml<Partial<AgentSdkConfig> & { external_mcp_servers?: ExternalMcpDeclaration }>("agent-sdk-config.yaml")) ?? {};
  const env = raw.env ?? {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") throw new Error(`agent-sdk-config.yaml env.${key} must be a string (process env values are strings)`);
  }
  return { env, externalMcpServers: await loadExternalMcpServers(raw.external_mcp_servers) };
};
