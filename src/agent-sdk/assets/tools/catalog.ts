import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { readFrontmatter } from "../../src/catalog/markdown.js";
import { fromSdkRoot } from "../../src/config/paths.js";
import { loadScriptSpecs, type ScriptSpec } from "./script/registry.js";

export interface ToolGroupCatalogEntry { name: string; summary: string; guidePath: string; gated: boolean; toolNames: string[] }
export interface ToolCatalog { groups: Map<string, ToolGroupCatalogEntry>; groupForTool: Map<string, string>; allToolNames: string[]; scripts: ScriptSpec[] }

export const CONTEXT_SERVER = "run_context";
export const GUIDE_SERVER = "run_guide";
export const HITL_SERVER = "hitl";
/** The in-process MCP server that exposes every registered script as `mcp__invest__<name>`. */
export const SCRIPT_SERVER = "invest";
/** The in-process MCP server through which an agent shows the operator a designed HTML page. */
export const PRESENT_SERVER = "present";
export const PRESENT_TOOL_NAMES = [`mcp__${PRESENT_SERVER}__show_html`] as const;
export const scriptToolName = (name: string) => `mcp__${SCRIPT_SERVER}__${name}`;
export const CONTEXT_TOOL_NAMES = [`mcp__${CONTEXT_SERVER}__read_context`, `mcp__${CONTEXT_SERVER}__wait_for_outcome`, `mcp__${CONTEXT_SERVER}__record_outcome`, `mcp__${CONTEXT_SERVER}__publish_output`] as const;
export const GUIDE_TOOL_NAMES = [`mcp__${GUIDE_SERVER}__load_guide`, `mcp__${GUIDE_SERVER}__load_skill`] as const;
export const HITL_TOOL_NAMES = [`mcp__${HITL_SERVER}__ask_user`] as const;
export const READ_TOOL_NAMES = ["Read", "Glob", "Grep"] as const;
// Every agent receives these without listing them in its profile `tools:`: the read
// surface plus the run-context, guide and human-in-the-loop adapters.
export const ALWAYS_ON_TOOL_NAMES = [...READ_TOOL_NAMES, ...CONTEXT_TOOL_NAMES, ...GUIDE_TOOL_NAMES, ...HITL_TOOL_NAMES] as const;

const unquote = (value: string | undefined): string => (value ?? "").replace(/^"(.*)"$/s, "$1").trim();

// A tool family discloses in two steps. Step one is its guide frontmatter
// `description`, the compacted usecase and the ONLY field every prompt shows beside
// the family name. Step two is the guide body (guardrails, contract, examples),
// reached by `load_guide` when an agent inquires, or inlined for a `mandatory` grant.
export async function guideSummary(guidePath: string): Promise<string> {
  const { attributes } = await readFrontmatter(guidePath);
  const summary = unquote(attributes.description);
  if (!summary) throw new Error(`Guide is missing frontmatter description: ${guidePath}`);
  return summary;
}

/** The full disclosure payload: the compacted usecase followed by the guide body. */
export async function readGuide(guidePath: string): Promise<string> {
  const { attributes, body } = await readFrontmatter(guidePath);
  const summary = unquote(attributes.description);
  if (!summary) throw new Error(`Guide is missing frontmatter description: ${guidePath}`);
  return body.trim() ? `${summary}\n\n${body.trim()}` : summary;
}

interface DeclaredFamily { name: string; guide: string; gated: boolean; tools?: string[]; scripts?: boolean }

/**
 * Tool families are declared once in assets/config/tools.yaml: a name, a guide, the
 * concrete tool names it grants, and whether its tools stay denied until the agent
 * has loaded the guide. The always-on baseline is code (above), not configuration.
 */
export async function buildToolCatalog(): Promise<ToolCatalog> {
  const declared = (parse(await readFile(fromSdkRoot("assets/config/tools.yaml"), "utf8")) as { families?: DeclaredFamily[] }).families ?? [];
  const scripts = await loadScriptSpecs();
  const scriptFamilies = new Set(declared.filter((family) => family.scripts).map((family) => family.name));
  for (const spec of scripts) if (!scriptFamilies.has(spec.family)) throw new Error(`Script '${spec.name}' names family '${spec.family}', which tools.yaml does not declare with scripts: true`);
  const groups = new Map<string, ToolGroupCatalogEntry>();
  const groupForTool = new Map<string, string>();
  const allToolNames: string[] = [];
  const register = (name: string, guidePath: string, gated: boolean, toolNames: readonly string[]) => groups.set(name, { name, summary: "", guidePath, gated, toolNames: [...toolNames] });
  register("context", fromSdkRoot("assets/tools/context/guide.md"), false, CONTEXT_TOOL_NAMES);
  register("guide", fromSdkRoot("assets/tools/guide/guide.md"), false, GUIDE_TOOL_NAMES);
  register("hitl", fromSdkRoot("assets/tools/hitl/guide.md"), false, HITL_TOOL_NAMES);
  for (const family of declared) {
    if (groups.has(family.name)) throw new Error(`Tool family '${family.name}' is declared twice (or collides with a built-in family)`);
    // A `scripts: true` family grants the registered script tools that name it; any other grants its listed native tools.
    const toolNames = family.scripts ? scripts.filter((spec) => spec.family === family.name).map((spec) => scriptToolName(spec.name)) : family.tools ?? [];
    if (!toolNames.length) throw new Error(`Tool family '${family.name}' grants no tools`);
    register(family.name, fromSdkRoot(family.guide), family.gated === true, toolNames);
  }
  for (const entry of groups.values()) {
    entry.summary = await guideSummary(entry.guidePath);
    for (const toolName of entry.toolNames) {
      // A wildcard grant (`mcp__playwright__*`) cannot be enumerated here; it is
      // resolved by family, never by pattern expansion.
      if (toolName.endsWith("*")) continue;
      if (groupForTool.has(toolName)) throw new Error(`Duplicate tool registration '${toolName}'`);
      groupForTool.set(toolName, entry.name);
      allToolNames.push(toolName);
    }
  }
  return { groups, groupForTool, allToolNames: allToolNames.sort(), scripts };
}
