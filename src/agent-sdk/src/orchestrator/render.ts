import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { box, colorsEnabled, style, visibleWidth } from "../terminal/ansi.js";

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

const enabled = colorsEnabled();
const s = (codes: string, text: string) => style(codes, text, enabled);
const dim = (text: string) => s("2", text);
const gray = (text: string) => s("90", text);
const AGENT_COLORS = ["95", "94", "93", "92", "96", "91"];

const compact = (value: unknown, max = 140): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

const firstLines = (value: unknown, lines = 3, width = 180): string[] => {
  const text = typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map((block) => (block as ContentBlock).text ?? "").join("\n")
      : JSON.stringify(value ?? "");
  const all = text.trim().split("\n");
  const slice = all.slice(0, lines).map((line) => (line.length > width ? `${line.slice(0, width)}…` : line));
  if (all.length > lines) slice.push(`… +${all.length - lines} lines`);
  return slice;
};

/** `mcp__repo__repo__tests_test_api` → `{ name: "repo:repo__tests_test_api", mcp: true }` */
const displayTool = (name: string): { name: string; mcp: boolean } => {
  if (!name.startsWith("mcp__")) return { name, mcp: false };
  const [, server, ...rest] = name.split("__");
  return { name: `${server}:${rest.join("__")}`, mcp: true };
};

const width = () => Math.max(40, Math.min(process.stdout.columns || 80, 90));

interface AgentProgress {
  name: string;
  status: "running" | "done" | "failed";
  turns: number;
  /** Last turn's full context load: input + cache-read + cache-creation tokens. */
  context: number;
  /** Cumulative output tokens: per message, max(reported snapshot, content estimate). */
  output: number;
  /** Set when the SDK's native AgentOutput metrics replaced the estimates at completion. */
  exact?: boolean;
  toolUses?: number;
  durationMs?: number;
  /**
   * Per API-message-id accounting. The SDK's usage snapshots are captured at
   * message start and never revised, so `reported` alone badly under-counts;
   * `estimated` sums a chars/4 approximation of every content block seen for
   * that message (forwarded subagent messages arrive one block per event, so
   * estimates accumulate). Each message contributes max(reported, estimated).
   */
  outputByMessage: Map<string, { reported: number; estimated: number }>;
}

const formatTokens = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

/**
 * Streams the SDK message feed as Claude Code-style terminal narration:
 * `⏺` bullets for text and tool calls, `⎿` indented results, italic `✻`
 * thinking, per-subagent colors, rounded boxes for the run banner and final
 * summary, and a live agent-progress table (status, turns, context load,
 * output tokens) re-rendered on every agent start and completion. Every
 * message is also handed to `raw` untouched for JSONL persistence;
 * `AGENT_OUTPUT=json` bypasses styling entirely.
 */
export function createRenderer(raw: (line: string) => void, rootName = "root", runRoot?: string): (message: SDKMessage) => void {
  const toolNames = new Map<string, string>();
  const taskToolUses = new Map<string, string>();
  let lastToolUseId: string | undefined;
  const agentColors = new Map<string, string>();
  const progress = new Map<string, AgentProgress>();
  const newProgress = (name: string): AgentProgress =>
    ({ name, status: "running", turns: 0, context: 0, output: 0, outputByMessage: new Map() });
  progress.set("root", newProgress(rootName));

  const progressFor = (parentToolUseId: string | null | undefined, subagentType?: string): AgentProgress => {
    const key = parentToolUseId ?? "root";
    let entry = progress.get(key);
    if (!entry) {
      entry = newProgress(subagentType ?? "subagent");
      progress.set(key, entry);
    }
    return entry;
  };

  /** Full-width colored rule marking a subagent's lane in the transcript. */
  const agentRule = (codes: string, text: string): string => {
    const label = ` ${text} `;
    const pad = Math.max(4, width() - visibleWidth(label) - 2);
    return s(codes, `━━${label}${"━".repeat(pad)}`);
  };

  const renderProgressTable = (exact?: { turns: number; input: number; output: number }): void => {
    const nameWidth = Math.max(
      ...[...progress.values()].map((entry) => entry.name.length),
      "Agent".length,
      exact ? "run total".length : 0,
    );
    const header = `  ${s("1", "Agent".padEnd(nameWidth))}  ${s("1", "Status".padEnd(7))}  ${s("1", "Turns".padStart(5))}  ${s("1", "Ctx".padStart(7))}  ${s("1", "Out≈".padStart(7))}`;
    const divider = gray(`  ${"─".repeat(nameWidth)}  ${"─".repeat(7)}  ${"─".repeat(5)}  ${"─".repeat(7)}  ${"─".repeat(7)}`);
    const rows = [...progress.values()].map((entry) => {
      const glyph = entry.status === "running" ? s("33", "●") : entry.status === "failed" ? s("31", "✗") : s("32", "✓");
      const status = entry.status === "running" ? s("33", "running") : entry.status === "failed" ? s("31", "failed".padEnd(7)) : s("32", "done".padEnd(7));
      return `${glyph} ${entry.name.padEnd(nameWidth)}  ${status}  ${String(entry.turns).padStart(5)}  ${formatTokens(entry.context).padStart(7)}  ${formatTokens(entry.output).padStart(7)}`;
    });
    const totals = exact
      ? [divider, `  ${s("1", "run total".padEnd(nameWidth))}  ${s("1", "exact".padEnd(7))}  ${s("1", String(exact.turns).padStart(5))}  ${s("1", formatTokens(exact.input).padStart(7))}  ${s("1", formatTokens(exact.output).padStart(7))}`]
      : [];
    process.stdout.write(box([header, divider, ...rows, ...totals], { title: s("1", "Agents — progress"), width: width(), borderCodes: "90", enabled }));
  };
  const colorFor = (agent: string): string => {
    if (!agentColors.has(agent)) agentColors.set(agent, AGENT_COLORS[agentColors.size % AGENT_COLORS.length]!);
    return agentColors.get(agent)!;
  };
  const bullet = (message: { parent_tool_use_id?: string | null; subagent_type?: string }): { mark: string; label: string } => {
    if (!message.parent_tool_use_id) return { mark: s("36", "⏺"), label: "" };
    const agent = message.subagent_type ?? "subagent";
    const code = colorFor(agent);
    return { mark: s(code, "⏺"), label: s(code, agent) + " " };
  };

  return (message: SDKMessage): void => {
    raw(JSON.stringify(message));
    if (process.env.AGENT_OUTPUT === "json") {
      process.stdout.write(JSON.stringify(message) + "\n");
      return;
    }
    switch (message.type) {
      case "system": {
        if (message.subtype === "init") {
          process.stdout.write("\n" + box([
            s("1;36", "✻ invest agents"),
            "",
            `${gray("model")}  ${message.model}`,
            `${gray("mode")}   ${message.permissionMode}`,
            ...(runRoot ? [`${gray("run")}    ${runRoot}`] : []),
            `${gray("agents")} ${(message.agents ?? []).join(", ")}`,
          ], { width: width(), borderCodes: "36", enabled }));
        } else if (message.subtype === "task_started") {
          const task = message as { task_id: string; tool_use_id?: string };
          if (task.tool_use_id) taskToolUses.set(task.task_id, task.tool_use_id);
        } else if (message.subtype === "task_notification") {
          const task = message as { task_id: string; tool_use_id?: string; status: string; summary?: string };
          const toolUseId = task.tool_use_id ?? taskToolUses.get(task.task_id);
          const spawned = toolUseId ? progress.get(toolUseId) : undefined;
          if (spawned && task.status !== "running") {
            const completed = task.status === "completed";
            spawned.status = completed ? "done" : "failed";
            const rule = agentRule(completed ? colorFor(spawned.name) : "31", `${completed ? "✓" : "✗"} ${spawned.name} — ${task.status}${task.summary ? `: ${compact(task.summary, 90)}` : ""}`);
            process.stdout.write("\n" + rule + "\n");
            if (runRoot) process.stdout.write(`  ${gray("artifacts →")} ${runRoot}/${spawned.name}/output\n`);
            renderProgressTable();
          } else {
            process.stdout.write(gray(`◦ task ${message.status}: ${message.task_id}`) + "\n");
          }
        } else if (message.subtype === "status") {
          const status = (message as { status?: string | null }).status;
          if (status) process.stdout.write(gray(`◦ ${status}`) + "\n");
        }
        return;
      }
      case "assistant": {
        const { mark, label } = bullet(message);
        const apiMessage = message.message as { id?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
        const usage = apiMessage.usage;
        let isNewTurn = false;
        if (usage) {
          const entry = progressFor(message.parent_tool_use_id, message.subagent_type);
          const messageId = apiMessage.id ?? `anon-${entry.turns}`;
          isNewTurn = !entry.outputByMessage.has(messageId);
          const record = entry.outputByMessage.get(messageId) ?? { reported: 0, estimated: 0 };
          record.reported = Math.max(record.reported, usage.output_tokens ?? 0);
          // chars/4 estimate over this event's blocks; block-per-event forwarding accumulates.
          let chars = 0;
          for (const block of message.message.content as ContentBlock[]) {
            if (block.type === "text") chars += block.text?.length ?? 0;
            else if (block.type === "thinking") chars += block.thinking?.length ?? 0;
            else if (block.type === "tool_use") chars += (block.name?.length ?? 0) + JSON.stringify(block.input ?? {}).length;
          }
          record.estimated += Math.round(chars / 4);
          entry.outputByMessage.set(messageId, record);
          entry.turns = entry.outputByMessage.size;
          entry.context = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
          entry.output = [...entry.outputByMessage.values()].reduce((sum, value) => sum + Math.max(value.reported, value.estimated), 0);
          if (message.subagent_type) entry.name = message.subagent_type;
        }
        for (const block of message.message.content as ContentBlock[]) {
          if (block.type === "thinking" && block.thinking?.trim()) {
            process.stdout.write(`  ${label}${s("3;90", `✻ ${firstLines(block.thinking, 2)[0]}`)}` + "\n");
          } else if (block.type === "text" && block.text?.trim()) {
            const [head, ...rest] = block.text.trim().split("\n");
            process.stdout.write(`\n${mark} ${label}${head}\n`);
            for (const line of rest) process.stdout.write(`  ${line}\n`);
          } else if (block.type === "tool_use") {
            const tool = displayTool(block.name ?? "tool");
            if (block.id) {
              toolNames.set(block.id, tool.name);
              lastToolUseId = block.id;
            }
            process.stdout.write(`\n${mark} ${label}${s("1", tool.name)}${dim(`(${compact(block.input)})`)}${tool.mcp ? " " + gray("MCP") : ""}\n`);
            // Subagent spawn: register it running, open its lane, show the table.
            if (block.name === "Agent" && block.id) {
              const input = block.input as { subagent_type?: string; description?: string } | undefined;
              const spawnName = input?.subagent_type ?? input?.description ?? "subagent";
              progress.set(block.id, newProgress(spawnName));
              const rule = agentRule(colorFor(spawnName), `▶ ${spawnName} — running${input?.description ? `: ${input.description}` : ""}`);
              process.stdout.write("\n" + rule + "\n");
              if (runRoot) process.stdout.write(`  ${gray("workspace →")} ${runRoot}/${spawnName}\n`);
              renderProgressTable();
            }
            // Live routing-table panel: every publish (initial or update) of the
            // orchestrator's plan.md is rendered in full so progress is visible.
            if (block.name === "mcp__run_context__publish_output") {
              const input = block.input as { path?: string; content?: string } | undefined;
              if (input?.path?.endsWith("plan.md") && typeof input.content === "string") {
                const planLines = input.content.split("\n");
                const shown = planLines.slice(0, 48);
                if (planLines.length > 48) shown.push(`… +${planLines.length - 48} more lines in ${input.path}`);
                process.stdout.write(box(shown, {
                  title: s("1;36", "Plan"),
                  width: width(),
                  borderCodes: "36",
                  enabled,
                }));
              }
            }
          }
        }
        // Refresh the progress table once per subagent loop iteration (new API
        // message), not once per forwarded content block.
        if (usage && message.parent_tool_use_id && isNewTurn) renderProgressTable();
        return;
      }
      case "user": {
        for (const block of ((message.message.content ?? []) as ContentBlock[])) {
          if (typeof block !== "object" || block.type !== "tool_result") continue;
          // A result closing an Agent spawn marks that subagent done: close its lane.
          const spawned = block.tool_use_id ? progress.get(block.tool_use_id) : undefined;
          const asyncLaunch = Boolean((message as { tool_use_result?: { isAsync?: boolean } }).tool_use_result?.isAsync);
          if (spawned && !message.parent_tool_use_id && spawned.status === "running" && !asyncLaunch) {
            spawned.status = block.is_error ? "failed" : "done";
            // The SDK's native per-subagent metrics (AgentOutput) ride the closing
            // message's tool_use_result — replace the estimates with exact values.
            const native = (message as { tool_use_result?: { totalToolUseCount?: number; totalDurationMs?: number; usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } } }).tool_use_result;
            if (native?.usage) {
              spawned.output = native.usage.output_tokens ?? spawned.output;
              spawned.context = (native.usage.input_tokens ?? 0) + (native.usage.cache_read_input_tokens ?? 0) + (native.usage.cache_creation_input_tokens ?? 0);
              if (native.totalToolUseCount !== undefined) spawned.toolUses = native.totalToolUseCount;
              if (native.totalDurationMs !== undefined) spawned.durationMs = native.totalDurationMs;
              spawned.exact = true;
            }
            const stats = [
              `${spawned.turns} turns`,
              ...(spawned.toolUses !== undefined ? [`${spawned.toolUses} tool uses`] : []),
              `ctx ${formatTokens(spawned.context)}`,
              `out ${formatTokens(spawned.output)}${spawned.exact ? " (exact)" : ""}`,
              ...(spawned.durationMs !== undefined ? [`${Math.round(spawned.durationMs / 1000)}s`] : []),
            ].join(" · ");
            const rule = spawned.status === "failed"
              ? agentRule("31", `✗ ${spawned.name} — failed · ${stats}`)
              : agentRule(colorFor(spawned.name), `✓ ${spawned.name} — done · ${stats}`);
            process.stdout.write("\n" + rule + "\n");
            if (runRoot) process.stdout.write(`  ${gray("artifacts →")} ${runRoot}/${spawned.name}/output\n`);
            renderProgressTable();
          }
          const lines = firstLines(block.content, block.is_error ? 5 : 2);
          const paintLine = block.is_error ? (line: string) => s("31", line) : (line: string) => dim(line);
          // Name the originating tool unless this result directly follows its own call.
          const tag = block.tool_use_id && block.tool_use_id !== lastToolUseId
            ? gray(`${toolNames.get(block.tool_use_id) ?? "tool"} › `)
            : "";
          process.stdout.write(`  ${gray("⎿")}  ${tag}${paintLine(lines[0] ?? "")}\n`);
          for (const line of lines.slice(1)) process.stdout.write(`     ${paintLine(line)}\n`);
        }
        return;
      }
      case "result": {
        // `subtype: "success"` only means the loop ended normally; an API error
        // (e.g. an unsupported model) also arrives as success with is_error set.
        const ok = message.subtype === "success" && !message.is_error;
        const root = progress.get("root");
        if (root) root.status = ok ? "done" : "failed";
        for (const entry of progress.values()) if (entry.status === "running") entry.status = ok ? "done" : "failed";
        const runUsage = (message as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage;
        renderProgressTable(runUsage ? {
          turns: message.num_turns,
          input: (runUsage.input_tokens ?? 0) + (runUsage.cache_read_input_tokens ?? 0) + (runUsage.cache_creation_input_tokens ?? 0),
          output: runUsage.output_tokens ?? 0,
        } : undefined);
        const glyph = ok ? s("1;32", "✓ success") : s("1;31", `✗ ${message.subtype === "success" ? "error" : message.subtype}`);
        const cost = typeof message.total_cost_usd === "number" ? ` · ${s("1", `$${message.total_cost_usd.toFixed(4)}`)}` : "";
        const exactTokens = runUsage
          ? `${gray(" · ")}in ${formatTokens((runUsage.input_tokens ?? 0) + (runUsage.cache_read_input_tokens ?? 0) + (runUsage.cache_creation_input_tokens ?? 0))}${gray(" · ")}out ${formatTokens(runUsage.output_tokens ?? 0)} ${gray("(exact, whole run)")}`
          : "";
        process.stdout.write("\n" + box([
          `${glyph}${gray(" · ")}${message.num_turns} turns${gray(" · ")}${Math.round(message.duration_ms / 1000)}s${cost}${exactTokens}`,
        ], { width: width(), borderCodes: ok ? "32" : "31", enabled }));
        if ("result" in message && message.result) process.stdout.write(`${message.result.trim()}\n`);
        if (runRoot) {
          process.stdout.write(`\n${gray("run folder →")} ${runRoot}\n`);
          for (const agentName of new Set([...progress.values()].map((entry) => entry.name))) {
            process.stdout.write(`${gray("  artifacts →")} ${runRoot}/${agentName}/output\n`);
          }
        }
        return;
      }
      default: {
        const subtype = (message as { subtype?: string }).subtype;
        if (subtype === "permission_denied") {
          process.stdout.write(s("33", `⚠ permission denied: ${compact((message as { tool_name?: string }).tool_name ?? "")}`) + "\n");
        } else if (subtype === "api_retry") {
          process.stdout.write(gray("◦ retrying API request…") + "\n");
        }
      }
    }
  };
}
