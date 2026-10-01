import { access, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fromSdkRoot } from "../config/paths.js";
import { readFrontmatter } from "./markdown.js";

/**
 * Skills live once, in `assets/skills/<skill>/SKILL.md`, with their scripts, briefs and
 * templates beside them. `.claude/skills/<skill>/SKILL.md` is a generated pointer so the
 * operator's slash-commands keep working; the harness never reads it. An agent reaches a
 * skill only through its profile's `skills:` grant.
 */
export const SKILLS_ROOT = "assets/skills";

const AGENT_PROFILE_MARKERS = ["## Agent Persona", "## Condition for HITL"] as const;

export async function discoverSkills(): Promise<Map<string, string>> {
  const skills = new Map<string, string>();
  for (const entry of await readdir(fromSdkRoot(SKILLS_ROOT), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(fromSdkRoot(SKILLS_ROOT), entry.name, "SKILL.md");
    if (await access(path).then(() => true, () => false)) skills.set(entry.name, path);
  }
  return skills;
}

export async function validateSkillCatalog(skills: Map<string, string>): Promise<void> {
  for (const [name, path] of skills) {
    const { attributes, body } = await readFrontmatter(path);
    if ((attributes.name ?? "").trim() !== name) throw new Error(`Skill '${name}' frontmatter name '${attributes.name ?? ""}' does not match its folder (${path})`);
    if (!attributes.description?.trim()) throw new Error(`Skill '${name}' has no description frontmatter (${path})`);
    if (!body.trim()) throw new Error(`Skill '${name}' has an empty workflow body (${path})`);
    for (const marker of AGENT_PROFILE_MARKERS) {
      if (body.includes(marker)) throw new Error(`Skill '${name}' masquerades as an agent profile: contains '${marker}' (${path})`);
    }
  }
}

export interface SkillCatalogEntry { name: string; path: string; description: string }

/**
 * The disclosed skill catalog, built from each skill's own frontmatter. `description`
 * is the one-line summary a progressive skill shows; the body is fetched on demand
 * through `load_skill`. Load policy (mandatory vs progressive) belongs to the
 * consuming agent's profile, never to the skill.
 */
export async function buildSkillCatalog(discovered?: Map<string, string>): Promise<Map<string, SkillCatalogEntry>> {
  const skills = discovered ?? await discoverSkills();
  const catalog = new Map<string, SkillCatalogEntry>();
  for (const [name, path] of skills) {
    const { attributes } = await readFrontmatter(path);
    const description = (attributes.description ?? "").trim();
    if (!description) throw new Error(`Skill '${name}' has no description frontmatter (${path})`);
    catalog.set(name, { name, path, description });
  }
  return catalog;
}

/** Every granted skill must exist; a skill nobody grants is reported, not fatal (the operator's own slash-commands need no agent). */
export function ungrantedSkills(skills: Map<string, string>, grants: Iterable<{ skills: readonly string[] }>): string[] {
  const granted = new Set<string>();
  for (const grant of grants) for (const skill of grant.skills) granted.add(skill);
  return [...skills.keys()].filter((name) => !granted.has(name));
}

const EXECUTABLE_EXTENSIONS = new Set([".sh", ".bash", ".zsh", ".js", ".mjs", ".cjs", ".ts", ".py"]);

/**
 * Skills and agent profiles are declarative: every script, test and helper module lives under
 * `assets/tools/repo/<area>/`, never beside a workflow or a profile. A skill may keep templates and
 * example data (`template.html`, `example/*.json`), which are content, not code.
 */
export async function assertDeclarativeAssets(): Promise<void> {
  for (const root of [SKILLS_ROOT, "assets/agents"]) {
    for (const entry of await readdir(fromSdkRoot(root), { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && EXECUTABLE_EXTENSIONS.has(extname(entry.name))) {
        throw new Error(`Declarative assets only: executable '${entry.name}' found under ${root}; code and scripts belong in assets/tools/repo/<area>/`);
      }
    }
  }
}
