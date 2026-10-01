import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { HitlQuestion } from "../../assets/tools/hitl/terminal.js";

/**
 * What the browser is told. Deliberately small and stable: the UI never sees a raw SDK message, so the
 * SDK can change shape without touching the page, and every event is plain JSON that replays on reconnect.
 */
export type UiEvent =
  | { type: "status"; state: "idle" | "running" | "closed"; agent: string }
  | { type: "user"; text: string }
  /** `agent` is absent for the orchestrator's own words and names the subagent otherwise. */
  | { type: "assistant"; agent?: string; text: string }
  | { type: "tool"; id: string; agent?: string; name: string; summary: string }
  | { type: "tool_result"; id: string; agent?: string; error: boolean; summary: string }
  | { type: "subagent"; id: string; name: string; description?: string; state: "running" | "done" | "failed"; stats?: string }
  /** The page itself is fetched from /api/sessions/:id/artifacts/:n, so events stay small and a reload can re-render it. */
  | { type: "artifact"; n: number; title: string; caption?: string }
  | { type: "hitl"; id: string; kind: "question" | "permission" | "spend"; source: string; agent?: string; questions: HitlQuestion[] }
  | { type: "hitl_done"; id: string; answered: boolean }
  | { type: "result"; ok: boolean; subtype: string; turns: number; durationMs: number; costUsd?: number; tokensIn?: number; tokensOut?: number; error?: string }
  | { type: "error"; message: string }
  | { type: "notice"; text: string };

export type SequencedEvent = UiEvent & { seq: number; at: string };

interface Block { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean; content?: unknown }

const clip = (text: string, max: number): string => { const one = text.replace(/\s+/g, " ").trim(); return one.length > max ? `${one.slice(0, max - 1)}…` : one; };

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
  private readonly agents = new Map<string, string>();

  translate(message: SDKMessage): UiEvent[] {
    const events: UiEvent[] = [];
    const m = message as SDKMessage & { parent_tool_use_id?: string | null; subagent_type?: string; subtype?: string };
    switch (message.type) {
      case "assistant": {
        const agent = m.parent_tool_use_id ? m.subagent_type ?? "subagent" : undefined;
        for (const block of (message.message.content ?? []) as Block[]) {
          if (block.type === "text" && block.text?.trim()) events.push({ type: "assistant", ...(agent ? { agent } : {}), text: block.text.trim() });
          else if (block.type === "tool_use" && block.name && block.id) {
            const { label, summary } = describeTool(block.name, block.input);
            events.push({ type: "tool", id: block.id, ...(agent ? { agent } : {}), name: label, summary });
            if (block.name === "Agent") {
              const input = (block.input ?? {}) as { subagent_type?: string; description?: string; name?: string };
              const name = input.subagent_type ?? input.name ?? "subagent";
              this.agents.set(block.id, name);
              events.push({ type: "subagent", id: block.id, name, ...(input.description ? { description: input.description } : {}), state: "running" });
            }
          }
        }
        return events;
      }
      case "user": {
        const agent = m.parent_tool_use_id ? m.subagent_type : undefined;
        const asyncLaunch = Boolean((message as { tool_use_result?: { isAsync?: boolean } }).tool_use_result?.isAsync);
        for (const block of (message.message.content ?? []) as Block[]) {
          if (typeof block !== "object" || block.type !== "tool_result" || !block.tool_use_id) continue;
          const error = Boolean(block.is_error);
          const spawned = this.agents.get(block.tool_use_id);
          if (spawned && !m.parent_tool_use_id && !asyncLaunch) {
            const native = (message as { tool_use_result?: { totalToolUseCount?: number; totalDurationMs?: number } }).tool_use_result;
            const stats = [native?.totalToolUseCount !== undefined ? `${native.totalToolUseCount} tool uses` : "", native?.totalDurationMs !== undefined ? `${Math.round(native.totalDurationMs / 1000)}s` : ""].filter(Boolean).join(" · ");
            events.push({ type: "subagent", id: block.tool_use_id, name: spawned, state: error ? "failed" : "done", ...(stats ? { stats } : {}) });
            this.agents.delete(block.tool_use_id);
          }
          events.push({ type: "tool_result", id: block.tool_use_id, ...(agent ? { agent } : {}), error, summary: clip(resultText(block.content), 200) });
        }
        return events;
      }
      case "system": {
        if (m.subtype === "task_notification") {
          const task = message as unknown as { tool_use_id?: string; status?: string; summary?: string };
          const name = task.tool_use_id ? this.agents.get(task.tool_use_id) : undefined;
          if (name && task.tool_use_id && task.status && task.status !== "running") {
            events.push({ type: "subagent", id: task.tool_use_id, name, state: task.status === "completed" ? "done" : "failed", ...(task.summary ? { stats: clip(task.summary, 120) } : {}) });
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
