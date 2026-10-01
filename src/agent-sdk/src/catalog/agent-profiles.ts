import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { fromSdkRoot } from "../config/paths.js";
import { loadAgentGraph } from "../agents/catalog.js";
import type { AgentSpec } from "../domain/types.js";

const field = z.string().min(1).refine(
  (value) => !/(^|\n)#{1,6} /.test(value),
  { message: "markdown headings are not allowed inside profile fields; structure is renderer-owned" },
);

export const AgentProfileSchema = z.strictObject({
  description: field,
  persona: field,
  goal: field,
  success_criteria: z.array(field).min(1),
  input: z.array(field).min(1),
  output: z.array(z.strictObject({ filename: field, key_sections: field, required: z.boolean() })).min(1),
  context_ledger: field,
  hitl: field,
  // Per-agent skill load policy: one explicit `disclosure` mode per granted skill.
  // `disclosure: mandatory` inlines the whole skill body (always-on); `progressive`
  // discloses only its one-line description and lets the agent pull the body via
  // `load_skill`. Name+description live in the skill's SKILL.md — never re-declared here.
  skills: z.array(z.strictObject({ name: field, disclosure: z.enum(["progressive", "mandatory"]) })),
  // Per-agent tool grant + load policy, the tools-side twin of `skills`. Each entry
  // names one tool FAMILY (declared in assets/config/tools.yaml: `shell`, `web`,
  // `files`, …). Both modes reveal the family name + its guide frontmatter
  // `description` (the compacted usecase); `disclosure: mandatory` also inlines the
  // guide body and pre-satisfies the runtime load-guide gate, while `progressive`
  // leaves the body to `load_guide` for when the agent inquires. The read surface +
  // common adapters are always-on and never listed here.
  tools: z.array(z.strictObject({ name: field, disclosure: z.enum(["progressive", "mandatory"]) })),
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export async function loadAgentProfile(ref: Pick<AgentSpec, "name" | "agentProfile">): Promise<AgentProfile> {
  try {
    return AgentProfileSchema.parse(parse(await readFile(fromSdkRoot(ref.agentProfile), "utf8")));
  } catch (error) {
    throw new Error(`Agent profile '${ref.agentProfile}' is invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export function validateAgentProfileSkills(name: string, skills: string[], profile: AgentProfile): void {
  const listed = profile.skills.map((row) => row.name);
  for (const skill of skills) {
    if (!listed.includes(skill)) throw new Error(`Profile '${name}' does not list loaded skill '${skill}' in its skills`);
  }
  for (const row of listed) {
    if (!skills.includes(row)) throw new Error(`Profile '${name}' lists skill '${row}' that its AgentSpec does not load`);
  }
}

export async function buildAgentCatalog(): Promise<Map<string, AgentSpec>> {
  return (await loadAgentGraph()).agents;
}
