import { loadAgentProfile, validateAgentProfileSkills, type AgentProfile } from "../catalog/agent-profiles.js";
import { buildSkillCatalog, type SkillCatalogEntry } from "../catalog/skills.js";
import { readFrontmatter } from "../catalog/markdown.js";
import { CONTEXT_SERVER, readGuide, type ToolCatalog } from "../../assets/tools/catalog.js";
import type { AgentSpec } from "../domain/types.js";
import type { AgentContext, CapabilityEntry, RunContext } from "./model.js";

export interface AssembleOptions {
  toolCatalog?: ToolCatalog;
  skillCatalog?: Map<string, SkillCatalogEntry>;
  runContext?: RunContext;
}

/**
 * Assemble one agent's full {@link AgentContext} from its profile, granted
 * skills/tools, and (optionally) the bound run context. This is the single
 * producer feeding BOTH serializers — {@link toXml} for the dispatched prompt
 * and {@link toYaml} for the on-disk `context.yaml` — so the file and the prompt
 * are the same object in two encodings. It replaces the retired markdown
 * clause renderers (`renderAgentProfile`/`renderRoutingClause`/
 * `renderOutputClause`/`renderSkillsClause`/`renderToolsClause`).
 */
export async function buildAgentContext(spec: AgentSpec, options: AssembleOptions = {}): Promise<AgentContext> {
  const profile = await loadAgentProfile(spec);
  validateAgentProfileSkills(spec.name, spec.skills, profile);
  const skillCatalog = options.skillCatalog ?? await buildSkillCatalog();
  const skills = await collectSkills(spec, profile, skillCatalog);

  const toolCatalog = options.toolCatalog;
  const tools = toolCatalog ? await collectTools(spec, toolCatalog) : { alwaysOn: [], onDemand: [] };

  return {
    agent: spec.name,
    role: profile.persona,
    task: profile.goal,
    instructions: profile.success_criteria,
    inputs: profile.input,
    deliverables: {
      runtimeContract: runtimeContract(spec),
      ledgerEntry: profile.context_ledger,
      files: profile.output.map((row) => ({ filename: row.filename, key_sections: row.key_sections, required: row.required })),
    },
    handoffs: spec.handoffs,
    escalation: profile.hitl,
    skills,
    tools,
    ...(spec.sdk.permissionMode === "plan" ? { planMode: PLAN_MODE } : {}),
    repositoryLookup: spec.orchestrator ? ORCHESTRATOR_LOOKUP : SUBAGENT_LOOKUP,
    artifactConsumption: ARTIFACT_CONSUMPTION,
    readDiscipline: READ_DISCIPLINE,
    ...(options.runContext ? { context: options.runContext } : {}),
  };
}

/**
 * Split an agent's granted skills into always-on bodies vs on-demand summaries,
 * driven by the profile's per-skill `disclosure` mode. Mandatory skills inline
 * the full `SKILL.md` body; progressive skills disclose only the one-line
 * description and load the workflow on demand via `load_skill`.
 */
async function collectSkills(spec: AgentSpec, profile: AgentProfile, skillCatalog: Map<string, SkillCatalogEntry>): Promise<AgentContext["skills"]> {
  const disclosure = new Map(profile.skills.map((row) => [row.name, row.disclosure]));
  const alwaysOn: CapabilityEntry[] = [];
  const onDemand: CapabilityEntry[] = [];
  for (const name of spec.skills) {
    const entry = skillCatalog.get(name);
    if (!entry) throw new Error(`Agent '${spec.name}' references missing skill '${name}'`);
    if (disclosure.get(name) === "mandatory") {
      const { body } = await readFrontmatter(entry.path);
      alwaysOn.push({ name, body: body.trim() });
    } else {
      onDemand.push({ name, summary: entry.description });
    }
  }
  return { alwaysOn, onDemand };
}

/**
 * Split an agent's granted tool families into always-on guide bodies vs
 * on-demand stubs, driven by the profile's per-grant `disclosure` mode — the
 * tools-side twin of {@link collectSkills}. Both modes reveal the same first
 * step: the family name plus its guide frontmatter `description` (the compacted
 * usecase). `mandatory` additionally inlines the guide body and has its load
 * gate pre-satisfied elsewhere, so it never re-fetches; `progressive` leaves the
 * body behind `load_guide` for when the agent inquires.
 */
async function collectTools(spec: AgentSpec, toolCatalog: ToolCatalog): Promise<AgentContext["tools"]> {
  const alwaysOn: CapabilityEntry[] = [];
  const onDemand: CapabilityEntry[] = [];
  for (const { name, disclosure } of spec.tools) {
    const entry = toolCatalog.groups.get(name);
    if (!entry) throw new Error(`Agent '${spec.name}' references unknown tool family '${name}'`);
    if (disclosure === "mandatory") {
      alwaysOn.push({ name, body: await readGuide(entry.guidePath) });
    } else {
      onDemand.push({ name, summary: entry.summary });
    }
  }
  return { alwaysOn, onDemand };
}

function runtimeContract(spec: AgentSpec): string {
  return `Your runtime agent name is \`${spec.name}\`. Required outputs: ${spec.requiredOutputs.join(", ")}. Publish each artifact directly with \`mcp__${CONTEXT_SERVER}__publish_output\`, passing \`agent: "${spec.name}"\`, the filename as \`path\`, and the complete artifact text as \`content\`; then call \`mcp__${CONTEXT_SERVER}__record_outcome\` with that agent name before stopping. Files a skill owns (\`data/research/<DATE>/...\`) are written by that skill's scripts or, for judgment files, by you under the skill's contract; \`tools.jsonl\` is an append-only tool-call log and must never contain draft artifacts.`;
}

const PLAN_MODE = `You run in \`plan\` permission mode, so the harness injects generic plan-mode instructions about editing a \`.claude/plans/*.md\` plan file with the \`Write\` tool. That framing does not apply to you: your deliverable write surface is \`mcp__${CONTEXT_SERVER}__publish_output\` (your required outputs) and \`mcp__${CONTEXT_SERVER}__record_outcome\`. Producing and publishing your required output IS your job, and plan mode never blocks it.`;

const ORCHESTRATOR_LOOKUP = `Know what is current before you dispatch: run \`python3 src/agent-sdk/assets/tools/repo/state/state.py --intent <intent>\` and run only the commands it lists; never rerun a fresh product. \`/fetch\` is the only metered step: ask the operator before it. Read the corpus only through \`pnpm q <saved query>\` (over \`sql/views.sql\`), never through the Parquet files. Route each piece of work to the subagent whose skill owns it, give it ONE task in a bounded brief, and read what it published instead of redoing it. A skill owns its files; you read another skill's output and never recompute its numbers.`;

const SUBAGENT_LOOKUP = `Your dispatch brief is your context, and your granted skill is your procedure: follow its steps and its report contract. Read other skills' products where they live (\`data/research/<DATE>/<part>/\`, \`data/market/<DATE>/\`) and never recompute their numbers; if an input looks wrong, report it as \`blocked\` naming the owning skill. Read the corpus only through \`pnpm q <saved query>\`. Every value you state carries its source and as-of date; write "not found" instead of guessing a number. The model never produces a price fact.`;

const ARTIFACT_CONSUMPTION = `Your own artifacts live under the output dir injected in your run context (AGENT_OUTPUT_DIR). Reach ANOTHER agent's through the \`Output dir:\` pointer in its ledger section (AGENT_RUN_CONTEXT): a delegated agent publishes under \`{RUN_ROOT}/{agent}/{dispatch}/output/\` and the dispatch ordinal is not guessable. Publish your own artifacts in one shape: a one-paragraph summary, then \`##\` sections. Runtime paths are injected per run; never hardcode them.`;

/**
 * Bounded-read discipline: bytes are what the context pays for. A whole-file read is
 * the last resort; structured data (\`.json\`, \`.jsonl\`, \`.csv\`) is sized and sampled, not loaded.
 */
const READ_DISCIPLINE = `Reading a whole file is the LAST resort, not the first move. Locate first with \`Grep\` (\`output_mode: "count"\` to size a match, \`"files_with_matches"\` to pick a file, \`"content"\` with \`-n\` and \`head_limit\` to land a line number), then \`Read\` that neighborhood with \`offset\` and \`limit\`. The runtime denies an unbounded \`Read\` of a text file over 12 KB. For structured data (\`.json\`, \`.jsonl\`, \`.csv\`, market series), grep the KEY to get shape and counts rather than loading records, and when you hold the \`shell\` family use \`jq\`, \`head\` or a saved \`pnpm q\` query for a fraction of a full read.`;
