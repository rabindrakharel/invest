import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { fromRepoRoot } from "../config/paths.js";
import { deny, NO_OPINION } from "./decisions.js";

/**
 * Ticker research has one template. The mechanical context (ticker_context.py), the agent's judgment
 * (<T>.judgment.json, checked against ticker-judgment/1) and the rendered brief (render_brief.py) each
 * have one writer, so a brief's title, header and sections never vary between runs. The rules live once,
 * in brief_guard.py, which Claude Code also runs from .claude/settings.json; this hook pipes the same
 * event to it. Only calls that name a report or a ticker file pay for the subprocess.
 */
export const TICKER_GUARD = "src/agent-sdk/assets/tools/repo/ticker-brief/brief_guard.py";
const TICKER_GUARD_TOOLS = new Set(["Write", "Edit", "MultiEdit", "Bash"]);
const TICKER_RESEARCH = /reports\/|\/tickers\//u;

export function enforceTickerTemplate(root = fromRepoRoot(), python = "python3"): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse" || !TICKER_GUARD_TOOLS.has(input.tool_name)) return NO_OPINION;
    if (!TICKER_RESEARCH.test(JSON.stringify(input.tool_input ?? {}))) return NO_OPINION;
    const event = { hook_event_name: "PreToolUse", tool_name: input.tool_name, tool_input: input.tool_input, cwd: typeof input.cwd === "string" ? input.cwd : root };
    const run = spawnSync(python, [resolve(root, TICKER_GUARD)], { input: JSON.stringify(event), cwd: root, encoding: "utf8", timeout: 15_000, env: process.env });
      // Fail closed: a write into ticker research that cannot be checked does not land.
    if (run.error || run.status !== 0) return deny(`The ticker-research guard could not run (${run.error?.message ?? run.stderr?.trim() ?? `exit ${run.status}`}); this write was not checked, so it was refused.`);
    const out = run.stdout.trim();
    if (!out) return NO_OPINION;
    try { return JSON.parse(out) as ReturnType<typeof deny>; } catch { return deny(`The ticker-research guard returned something that is not JSON: ${out.slice(0, 200)}`); }
  };
}
