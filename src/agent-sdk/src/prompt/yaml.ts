import { stringify } from "yaml";
import type { AgentContext } from "./model.js";

/**
 * Serialize an {@link AgentContext} to the `context.yaml` written into each
 * agent's run workspace. YAML is the human-authorable/observable form of the
 * exact same object the {@link toXml} serializer ships to the model, so the two
 * never drift: `context.yaml` IS the prompt, expressed as data.
 *
 * Fields are emitted in template order (role → task → … → context) and
 * undefined-valued optional regions are dropped so the file reads cleanly.
 * Freeform bodies serialize as block scalars, preserving embedded markdown.
 */
export function toYaml(context: AgentContext): string {
  const ordered = {
    agent: context.agent,
    role: context.role,
    task: context.task,
    instructions: context.instructions,
    inputs: context.inputs,
    deliverables: {
      runtime_contract: context.deliverables.runtimeContract,
      ledger_entry: context.deliverables.ledgerEntry,
      files: context.deliverables.files.map((file) => ({
        filename: file.filename,
        key_sections: file.key_sections,
        required: file.required,
      })),
    },
    handoffs: context.handoffs,
    escalation: context.escalation,
    skills: {
      always_on: context.skills.alwaysOn.map((entry) => ({ name: entry.name, body: entry.body })),
      on_demand: context.skills.onDemand.map((entry) => ({ name: entry.name, summary: entry.summary })),
    },
    tools: {
      always_on: context.tools.alwaysOn.map((entry) => ({ name: entry.name, body: entry.body })),
      on_demand: context.tools.onDemand.map((entry) => ({ name: entry.name, summary: entry.summary })),
    },
    ...(context.planMode ? { plan_mode: context.planMode } : {}),
    repository_lookup: context.repositoryLookup,
    artifact_consumption: context.artifactConsumption,
    read_discipline: context.readDiscipline,
    ...(context.context ? {
      context: {
        original_request: context.context.originalRequest,
        ...(context.context.artifactPlane ? { artifact_plane: context.context.artifactPlane } : {}),
        prior_outcomes: context.context.priorOutcomes.map((outcome) => ({
          agent: outcome.agent,
          ...(outcome.verdict ? { verdict: outcome.verdict } : {}),
          ...(outcome.summary ? { summary: outcome.summary } : {}),
          ...(outcome.output ? { output: outcome.output } : {}),
        })),
      },
    } : {}),
  };
  return stringify(ordered, { lineWidth: 0 });
}
