import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fromRepoRoot } from "../config/paths.js";
import { describeTool, MAX_DETAIL_CHARS, type SequencedEvent, type UiEvent } from "./events.js";
import { EVENTS_FILE } from "./session.js";

/**
 * The Logs tab's read side for runs that are no longer live: a run's own web event file when it has one, and
 * otherwise its audit trail (audit.jsonl, written by the hooks for every run, headless or web) rebuilt into the
 * same event shape, so one viewer reads both.
 */

const RUN_ID = /^[\w.-]{1,120}$/;
const MAX_LOG_EVENTS = 20_000;

export interface RunSummary { id: string; agent: string; title: string; at: string; source: "web" | "audit"; events: number }

export const runsRoot = (runsDirectory: string): string => resolve(fromRepoRoot(), process.env.AGENT_RUNS_DIR ?? runsDirectory);

const lines = async (path: string): Promise<Record<string, unknown>[]> => {
  const text = await readFile(path, "utf8").catch(() => "");
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as Record<string, unknown>); } catch { /* a torn last line from a crash */ }
    if (out.length >= MAX_LOG_EVENTS) break;
  }
  return out;
};

const clip = (text: string, max = MAX_DETAIL_CHARS) => (text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text);
const one = (text: string, max: number) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };
const textOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : JSON.stringify(part))).join("\n");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.stdout === "string") return [record.stdout, record.stderr].filter(Boolean).join("\n");
    return JSON.stringify(value, null, 2);
  }
  return value === undefined ? "" : String(value);
};

/** audit.jsonl → the UI's event shape. Subagent instances are told apart by the SDK's agent_id. */
export function auditToEvents(rows: Record<string, unknown>[]): SequencedEvent[] {
  const events: SequencedEvent[] = [];
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  let seq = 0;
  const push = (event: UiEvent, at: unknown) => events.push({ ...event, seq: ++seq, at: typeof at === "string" ? at : "" } as SequencedEvent);
  for (const row of rows) {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const lane = typeof data.agent_id === "string" ? data.agent_id : undefined;
    const type = typeof data.agent_type === "string" ? data.agent_type : String(row.agent ?? "");
    const who = lane ? { agent: type, lane } : {};
    switch (row.event) {
      case "run_created": push({ type: "system", text: `Run ${String(row.runId ?? "")} created for ${String(row.agent ?? "")}` }, row.at); break;
      case "SubagentStart": {
        if (!lane) break;
        const n = (counts.get(type) ?? 0) + 1;
        counts.set(type, n);
        labels.set(lane, `${type}/${n}`);
        push({ type: "subagent", id: lane, name: type, label: `${type}/${n}`, state: "running" }, row.at);
        break;
      }
      case "SubagentStop": {
        if (!lane) break;
        const last = typeof data.last_assistant_message === "string" ? data.last_assistant_message : "";
        if (last) push({ type: "assistant", ...who, text: last }, row.at);
        push({ type: "subagent", id: lane, name: type, state: "done", ...(last ? { stats: one(last, 120) } : {}) }, row.at);
        break;
      }
      case "Stop": {
        const last = typeof data.last_assistant_message === "string" ? data.last_assistant_message : "";
        if (last) push({ type: "assistant", text: last }, row.at);
        break;
      }
      case "Determinism": {
        const findings = Array.isArray(row.data) ? (row.data as { script: string; problem: string; detail: string; paths: string[] }[]) : [];
        push({ type: "check", agent: String(row.agent ?? ""), ok: row.status === "ok", gaveUp: row.status === "gave_up", findings }, row.at);
        break;
      }
      case "PreToolUse": {
        const name = typeof data.tool_name === "string" ? data.tool_name : "tool";
        const { label, summary } = describeTool(name, data.tool_input);
        push({ type: "tool", id: String(data.tool_use_id ?? row.toolUseId ?? ""), ...who, name: label, summary, input: clip(JSON.stringify(data.tool_input ?? {}, null, 2)) }, row.at);
        break;
      }
      case "PostToolUse": case "PostToolUseFailure": {
        const failed = row.event === "PostToolUseFailure";
        const output = failed ? textOf(data.error) : textOf(data.tool_response);
        push({ type: "tool_result", id: String(data.tool_use_id ?? row.toolUseId ?? ""), ...who, error: failed, summary: one(output, 200), output: clip(output) }, row.at);
        break;
      }
    }
  }
  return events;
}

export async function listRuns(root: string): Promise<RunSummary[]> {
  const out: RunSummary[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !RUN_ID.test(entry.name)) continue;
    const dir = resolve(root, entry.name);
    const web = resolve(dir, EVENTS_FILE);
    const hasWeb = await stat(web).then(() => true, () => false);
    const audit = resolve(dir, "audit.jsonl");
    const hasAudit = !hasWeb && await stat(audit).then(() => true, () => false);
    if (!hasWeb && !hasAudit) continue;
    const prompt = await readFile(resolve(dir, "initial-prompt.md"), "utf8").catch(() => "");
    // The operator's request closes the initial prompt ("User request:" and the text); the run id carries the start time.
    const request = /\nUser request:\s*\n([\s\S]+)$/.exec(prompt)?.[1] ?? "";
    const rows = await lines(hasWeb ? web : audit);
    const firstUser = rows.find((row) => row.type === "user") as { text?: string } | undefined;
    const created = rows.find((row) => row.event === "run_created") as { agent?: string } | undefined;
    const status = rows.find((row) => row.type === "status") as { agent?: string } | undefined;
    out.push({
      id: entry.name, agent: status?.agent ?? created?.agent ?? "", source: hasWeb ? "web" : "audit", events: rows.length,
      title: one(firstUser?.text ?? request ?? "", 120) || entry.name,
      at: entry.name.slice(0, 19).replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3"),
    });
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

export async function readRunLog(root: string, id: string): Promise<{ id: string; agent: string; source: "web" | "audit"; events: SequencedEvent[] }> {
  if (!RUN_ID.test(id)) throw Object.assign(new Error("Not a run id"), { status: 400 });
  const dir = resolve(root, id);
  const web = await lines(resolve(dir, EVENTS_FILE));
  if (web.length) return { id, agent: String((web.find((row) => row.type === "status") as { agent?: string } | undefined)?.agent ?? ""), source: "web", events: web as unknown as SequencedEvent[] };
  const audit = await lines(resolve(dir, "audit.jsonl"));
  if (!audit.length) throw Object.assign(new Error("No log for that run"), { status: 404 });
  return { id, agent: String((audit.find((row) => row.event === "run_created") as { agent?: string } | undefined)?.agent ?? ""), source: "audit", events: auditToEvents(audit) };
}
