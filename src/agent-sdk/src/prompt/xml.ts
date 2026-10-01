import type { AgentContext, CapabilityEntry, PriorOutcome, RunContext } from "./model.js";

/**
 * Serialize an {@link AgentContext} to the native XML prompt shipped to the
 * model. Anthropic's prompt-engineering guidance is explicit that XML tags are
 * the way to demarcate distinct regions of a prompt that mixes instructions,
 * context, and variable inputs — so the static contract and the dynamic
 * `<context>` block are each wrapped in their own descriptive tags.
 *
 * Text content and attribute values are XML-escaped; nothing is CDATA-wrapped so
 * the document is always well-formed even when a skill/tool body contains `<`,
 * `>`, or `&`. Freeform bodies keep their own newlines (whitespace inside an
 * element's text content is insignificant to the reader), so embedded markdown
 * and code fences survive intact.
 */
export function toXml(context: AgentContext): string {
  const lines: string[] = [`<agent_context agent="${attr(context.agent)}">`];

  lines.push(block("role", context.role));
  lines.push(block("task", context.task));

  // Ordered on purpose: profiles whose instructions are a procedure (the
  // supervisor's numbered STEP list) depend on sequence, so the index is part
  // of the contract the model reads, not decoration.
  lines.push(list("instructions", context.instructions.map((item, i) => leaf("success_criterion", item, { index: String(i + 1) }))));
  lines.push(list("inputs", context.inputs.map((item) => leaf("input", item))));

  const deliverables = [
    block("runtime_contract", context.deliverables.runtimeContract),
    block("ledger_entry", context.deliverables.ledgerEntry),
    ...context.deliverables.files.map((file) =>
      `  <file name="${attr(file.filename)}" required="${file.required}">${esc(file.key_sections)}</file>`),
  ];
  lines.push(`<deliverables>\n${deliverables.join("\n")}\n</deliverables>`);

  lines.push(context.handoffs.length
    ? list("handoffs", context.handoffs.map((target) => leaf("target", target)))
    : `<handoffs>none</handoffs>`);

  lines.push(block("escalation", context.escalation));

  lines.push(capabilities("skills", "skill", context.skills.alwaysOn, context.skills.onDemand));
  lines.push(capabilities("tools", "tool", context.tools.alwaysOn, context.tools.onDemand));

  if (context.planMode) lines.push(block("plan_mode", context.planMode));

  lines.push(block("repository_lookup", context.repositoryLookup));
  lines.push(block("artifact_consumption", context.artifactConsumption));
  lines.push(block("read_discipline", context.readDiscipline));

  if (context.context) lines.push(runContext(context.context));

  lines.push(`</agent_context>`);
  return lines.join("\n\n");
}

function capabilities(wrapper: string, item: string, alwaysOn: CapabilityEntry[], onDemand: CapabilityEntry[]): string {
  if (!alwaysOn.length && !onDemand.length) return `<${wrapper}/>`;
  const rows: string[] = [];
  for (const entry of alwaysOn) rows.push(`  <${item} name="${attr(entry.name)}" mode="always_on">\n${esc(entry.body ?? "")}\n  </${item}>`);
  for (const entry of onDemand) rows.push(`  <${item} name="${attr(entry.name)}" mode="on_demand">${esc(entry.summary ?? "")}</${item}>`);
  return `<${wrapper}>\n${rows.join("\n")}\n</${wrapper}>`;
}

function runContext(run: RunContext): string {
  const rows = [block("original_request", run.originalRequest)];
  if (run.artifactPlane) rows.push(block("artifact_plane", run.artifactPlane));
  rows.push(run.priorOutcomes.length
    ? list("prior_outcomes", run.priorOutcomes.map(outcome))
    : `  <prior_outcomes/>`);
  return `<context>\n${indent(rows.join("\n\n"))}\n</context>`;
}

function outcome(prior: PriorOutcome): string {
  const inner: string[] = [];
  if (prior.summary) inner.push(leaf("summary", prior.summary));
  if (prior.output) inner.push(leaf("output", prior.output));
  const attrs = `agent="${attr(prior.agent)}"${prior.verdict ? ` verdict="${attr(prior.verdict)}"` : ""}`;
  return inner.length ? `<outcome ${attrs}>\n${indent(inner.join("\n"))}\n</outcome>` : `<outcome ${attrs}/>`;
}

/** A `<tag>` wrapping a multi-line freeform body on its own lines. */
function block(tag: string, body: string): string {
  return `<${tag}>\n${esc(body)}\n</${tag}>`;
}

/** A `<tag>value</tag>` leaf on a single line, two-space indented. */
function leaf(tag: string, value: string, attrs: Record<string, string> = {}): string {
  const rendered = Object.entries(attrs).map(([key, val]) => ` ${key}="${attr(val)}"`).join("");
  return `  <${tag}${rendered}>${esc(value)}</${tag}>`;
}

/** A `<wrapper>` around already-indented child leaves. */
function list(wrapper: string, children: string[]): string {
  return `<${wrapper}>\n${children.join("\n")}\n</${wrapper}>`;
}

function indent(text: string): string {
  return text.split("\n").map((line) => (line ? `  ${line}` : line)).join("\n");
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attr(value: string): string {
  return esc(value).replace(/"/g, "&quot;");
}
