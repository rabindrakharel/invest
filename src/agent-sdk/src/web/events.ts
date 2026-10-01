import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { HitlQuestion } from "../../assets/tools/hitl/terminal.js";

/**
 * What the browser is told. Deliberately small and stable: the UI never sees a raw SDK message, so the
 * SDK can change shape without touching the page, and every event is plain JSON that replays on reconnect.
 */
export type UiEvent =
  | { type: "status"; state: "idle" | "running" | "closed"; agent: string }
  | { type: "user"; text: string }
  /**
   * `agent` is absent for the orchestrator's own words and names the subagent type otherwise; `lane` is the id of the
   * dispatch (the orchestrator's `Agent` tool call) the event belongs to, so parallel instances of one type stay apart.
   */
  | { type: "assistant"; agent?: string; lane?: string; text: string }
  | { type: "thinking"; agent?: string; lane?: string; text: string }
  /** `input` and `output` are the verbose forms, clipped, for the log view; `summary` is the one line the chat shows. */
  | { type: "tool"; id: string; agent?: string; lane?: string; name: string; summary: string; input?: string }
  | { type: "tool_result"; id: string; agent?: string; lane?: string; error: boolean; summary: string; output?: string }
  /** One per dispatch: `label` numbers instances of a type in dispatch order (ticker-analyst/1, /2, ...). */
  | { type: "subagent"; id: string; name: string; label?: string; description?: string; prompt?: string; state: "running" | "done" | "failed"; stats?: string; tools?: number; tokens?: number; durationMs?: number }
  /** A running subagent's heartbeat: counts so far, its last tool, and (when the SDK makes one) a one-line summary. */
  | { type: "progress"; id: string; tools: number; tokens: number; durationMs: number; lastTool?: string; summary?: string }
  /** The page itself is fetched from /api/sessions/:id/artifacts/:n, so events stay small and a reload can re-render it. */
  | { type: "artifact"; n: number; title: string; caption?: string }
  | { type: "hitl"; id: string; kind: "question" | "permission" | "spend"; source: string; agent?: string; questions: HitlQuestion[] }
  | { type: "hitl_done"; id: string; answered: boolean }
  | { type: "result"; ok: boolean; subtype: string; turns: number; durationMs: number; costUsd?: number; tokensIn?: number; tokensOut?: number; error?: string }
  /** A determinism check at an agent's stop: `agent` is the dispatch key (ticker-analyst/2) or the orchestrator. */
  | { type: "check"; agent: string; ok: boolean; gaveUp: boolean; findings: { script: string; problem: string; detail: string; paths: string[] }[] }
  /** Session-level facts for the log: the model, tools and MCP servers at start, and the run's workspace. */
  | { type: "system"; text: string; detail?: string }
  | { type: "error"; message: string }
  | { type: "notice"; text: string };

export type SequencedEvent = UiEvent & { seq: number; at: string };

interface Block { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean; content?: unknown }

const clip = (text: string, max: number): string => { const one = text.replace(/\s+/g, " ").trim(); return one.length > max ? `${one.slice(0, max - 1)}…` : one; };
/** Keeps line breaks (for the log view), bounded so a large tool payload cannot swamp the stream. */
export const MAX_DETAIL_CHARS = 6000;
const detail = (text: string, max = MAX_DETAIL_CHARS): string => (text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text);
const pretty = (value: unknown): string => { try { return JSON.stringify(value, null, 2) ?? ""; } catch { return String(value); } };

/** A one-line, human description of what a tool call is doing. */
export function describeTool(name: string, input: unknown): { label: string; summary: string } {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const first = (...keys: string[]) => keys.map((key) => args[key]).find((value) => typeof value === "string") as string | undefined;
  const label = name.startsWith("mcp__") ? name.split("__").slice(1).join(" › ").replace(/_/g, " ") : name;
  switch (name) {
    case "Bash": return { label, summary: clip(first("command") ?? "", 140) };
    case "Read": case "Write": case "Edit": return { label, summary: clip(first("file_path") ?? "", 140) };
    case "Grep": case "Glob": return { label, summary: clip(first("pattern") ?? "", 140) };
    case "WebSearch": return { label, summary: clip(first("query") ?? "", 140) };
    case "WebFetch": return { label, summary: clip(first("url") ?? "", 140) };
    case "Agent": return { label: "dispatch", summary: clip(`${first("subagent_type") ?? "subagent"}: ${first("description", "name") ?? ""}`, 140) };
    case "mcp__present__show_html": return { label: "present", summary: clip(first("title") ?? "", 140) };
  }
  const entries = Object.entries(args).filter(([, value]) => value !== undefined && value !== null);
  return { label, summary: clip(entries.map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`).join(" "), 140) };
}

const resultText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "")).join(" ");
  return "";
};

/**
 * Turns the SDK's message stream into UI events. Stateful only to pair a tool result with its call and to
 * close a subagent's lane when its `Agent` call returns; one instance per session.
 */
export class EventTranslator {
  /** Open dispatches: the `Agent` tool_use id → its subagent type. */
  private readonly agents = new Map<string, string>();
  private readonly counts = new Map<string, number>();

  translate(message: SDKMessage): UiEvent[] {
    const events: UiEvent[] = [];
    const m = message as SDKMessage & { parent_tool_use_id?: string | null; subagent_type?: string; subtype?: string };
    const lane = m.parent_tool_use_id ?? undefined;
    const who = lane ? { agent: m.subagent_type ?? this.agents.get(lane) ?? "subagent", lane } : {};
    switch (message.type) {
      case "assistant": {
        for (const block of (message.message.content ?? []) as Block[]) {
          if (block.type === "text" && block.text?.trim()) events.push({ type: "assistant", ...who, text: block.text.trim() });
          else if (block.type === "thinking" && (block as { thinking?: string }).thinking?.trim()) events.push({ type: "thinking", ...who, text: detail((block as { thinking: string }).thinking.trim()) });
          else if (block.type === "tool_use" && block.name && block.id) {
            const { label, summary } = describeTool(block.name, block.input);
            events.push({ type: "tool", id: block.id, ...who, name: label, summary, input: detail(pretty(block.input ?? {})) });
            if (block.name === "Agent") {
              const input = (block.input ?? {}) as { subagent_type?: string; description?: string; name?: string; prompt?: string };
              const name = input.subagent_type ?? input.name ?? "subagent";
              const n = (this.counts.get(name) ?? 0) + 1;
              this.counts.set(name, n);
              this.agents.set(block.id, name);
              events.push({ type: "subagent", id: block.id, name, label: `${name}/${n}`, ...(input.description ? { description: input.description } : {}), ...(input.prompt ? { prompt: detail(input.prompt, 4000) } : {}), state: "running" });
            }
          }
        }
        return events;
      }
      case "user": {
        const asyncLaunch = Boolean((message as { tool_use_result?: { isAsync?: boolean } }).tool_use_result?.isAsync);
        for (const block of (message.message.content ?? []) as Block[]) {
          if (typeof block !== "object" || block.type !== "tool_result" || !block.tool_use_id) continue;
          const error = Boolean(block.is_error);
          const spawned = this.agents.get(block.tool_use_id);
          if (spawned && !lane && !asyncLaunch) {
            const native = (message as { tool_use_result?: { totalToolUseCount?: number; totalDurationMs?: number; totalTokens?: number } }).tool_use_result;
            const stats = [native?.totalToolUseCount !== undefined ? `${native.totalToolUseCount} tool uses` : "", native?.totalDurationMs !== undefined ? `${Math.round(native.totalDurationMs / 1000)}s` : ""].filter(Boolean).join(" · ");
            events.push({ type: "subagent", id: block.tool_use_id, name: spawned, state: error ? "failed" : "done", ...(stats ? { stats } : {}),
              ...(native?.totalToolUseCount !== undefined ? { tools: native.totalToolUseCount } : {}), ...(native?.totalDurationMs !== undefined ? { durationMs: native.totalDurationMs } : {}), ...(native?.totalTokens !== undefined ? { tokens: native.totalTokens } : {}) });
            this.agents.delete(block.tool_use_id);
          }
          const text = resultText(block.content);
          events.push({ type: "tool_result", id: block.tool_use_id, ...who, error, summary: clip(text, 200), output: detail(text) });
        }
        return events;
      }
      case "system": {
        if (m.subtype === "init") {
          const init = message as unknown as { model?: string; cwd?: string; tools?: string[]; mcp_servers?: { name: string; status: string }[]; permissionMode?: string; claude_code_version?: string };
          const servers = (init.mcp_servers ?? []).map((server) => `${server.name}: ${server.status}`).join(", ");
          events.push({ type: "system", text: `Session started: model ${init.model ?? "?"}, ${init.tools?.length ?? 0} tools, permission mode ${init.permissionMode ?? "?"}`, detail: [`cwd: ${init.cwd ?? ""}`, `claude code: ${init.claude_code_version ?? ""}`, `mcp servers: ${servers || "none"}`, `tools: ${(init.tools ?? []).join(", ")}`].join("\n") });
        } else if (m.subtype === "task_progress") {
          const task = message as unknown as { tool_use_id?: string; usage?: { total_tokens: number; tool_uses: number; duration_ms: number }; last_tool_name?: string; summary?: string };
          if (task.tool_use_id && task.usage && this.agents.has(task.tool_use_id)) {
            events.push({ type: "progress", id: task.tool_use_id, tools: task.usage.tool_uses, tokens: task.usage.total_tokens, durationMs: task.usage.duration_ms,
              ...(task.last_tool_name ? { lastTool: describeTool(task.last_tool_name, {}).label } : {}), ...(task.summary ? { summary: clip(task.summary, 160) } : {}) });
          }
        } else if (m.subtype === "task_notification") {
          const task = message as unknown as { tool_use_id?: string; status?: string; summary?: string; usage?: { total_tokens: number; tool_uses: number; duration_ms: number } };
          const name = task.tool_use_id ? this.agents.get(task.tool_use_id) : undefined;
          if (name && task.tool_use_id && task.status && task.status !== "running") {
            events.push({ type: "subagent", id: task.tool_use_id, name, state: task.status === "completed" ? "done" : "failed", ...(task.summary ? { stats: clip(task.summary, 120) } : {}),
              ...(task.usage ? { tools: task.usage.tool_uses, tokens: task.usage.total_tokens, durationMs: task.usage.duration_ms } : {}) });
            this.agents.delete(task.tool_use_id);
          }
        }
        return events;
      }
      case "result": {
        const ok = message.subtype === "success" && !message.is_error;
        const usage = (message as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage;
        // Any lane still open when the turn ends is settled, so the UI never shows a subagent spinning forever.
        for (const [id, name] of this.agents) events.push({ type: "subagent", id, name, state: ok ? "done" : "failed" });
        this.agents.clear();
        events.push({
          type: "result", ok, subtype: message.subtype, turns: message.num_turns, durationMs: message.duration_ms,
          ...(typeof message.total_cost_usd === "number" ? { costUsd: message.total_cost_usd } : {}),
          ...(usage ? { tokensIn: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), tokensOut: usage.output_tokens ?? 0 } : {}),
          ...(!ok && "result" in message && message.result ? { error: clip(String(message.result), 400) } : {}),
        });
        return events;
      }
      default: {
        if (m.subtype === "api_retry") events.push({ type: "notice", text: "Retrying the API request…" });
        else if (m.subtype === "permission_denied") events.push({ type: "notice", text: `Permission denied: ${String((message as { tool_name?: string }).tool_name ?? "")}` });
        return events;
      }
    }
  }
}
