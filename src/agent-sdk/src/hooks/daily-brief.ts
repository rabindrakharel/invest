import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { scriptToolName } from "../../assets/tools/catalog.js";
import { fromRepoRoot } from "../config/paths.js";
import { localToday } from "../determinism/templates.js";
import type { DispatchRegistry } from "../handoffs/dispatch.js";
import { isTerminalStatus } from "../handoffs/reconcile.js";
import { callerKey } from "./caller.js";
import { blockStop, NO_OPINION } from "./decisions.js";

/**
 * The daily brief has one format: data/research/<DATE>/outlook/outlook.md as build_outlook.py renders it, with the
 * judgment (the read, top calls, risks, what changes the call) embedded. Two gates hold it:
 *
 * - Any agent, subagent or root, that built the outlook or wrote into an outlook folder may not stop until
 *   `build_outlook.py --verify` passes for that date (the files are a fresh render with the judgment in them).
 * - On a daily-brief request (a prompt that starts with "Daily brief"), the root may not finish until today's
 *   outlook (or the one this run built) verifies AND its final message is that outlook.md, verbatim.
 *
 * After `maxBlocks` refusals an agent is let go with the failure reported, so an unfixable input cannot trap a run.
 */

export const OUTLOOK_SCRIPT = "src/agent-sdk/assets/tools/repo/market-outlook/build_outlook.py";
export const MAX_DAILY_BRIEF_BLOCKS = 2;
const DAILY_BRIEF = /^\s*daily brief\b/imu;
const OUTLOOK_DIR = /research\/(\d{4}-\d{2}-\d{2})\/outlook\//u;
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

/** Does this request (or the run prompt that wraps it) ask for the daily brief? */
export const isDailyBriefRequest = (text: string) => DAILY_BRIEF.test(text);

export type OutlookVerifier = (date: string) => { ok: boolean; detail: string };

export function verifyOutlook(root = fromRepoRoot(), python = "python3"): OutlookVerifier {
  return (date) => {
    const run = spawnSync(python, [resolve(root, OUTLOOK_SCRIPT), "--date", date, "--verify"], { cwd: root, encoding: "utf8", timeout: 30_000, env: process.env });
    if (run.error) return { ok: false, detail: `the format check could not run: ${run.error.message}` };
    return { ok: run.status === 0, detail: (run.status === 0 ? run.stdout : run.stderr || run.stdout).trim() };
  };
}

export interface DailyBriefDeps {
  rootAgent: string;
  /** The run's first request asked for the daily brief. Later prompts re-arm or disarm it. */
  armed: boolean;
  dispatches?: DispatchRegistry;
  root?: string;
  dataDir?: string;
  verify?: OutlookVerifier;
  today?: () => string;
  maxBlocks?: number;
  onOutcome?: (outcome: { key: string; ok: boolean; detail: string; gaveUp: boolean }) => void | Promise<void>;
}

/** Whitespace at line ends and around the message does not count; everything else must match. */
const normalize = (text: string) => text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim();

export function createDailyBriefGate(deps: DailyBriefDeps): { track: HookCallback; gate: HookCallback } {
  const root = deps.root ?? fromRepoRoot();
  const dataDir = deps.dataDir ?? process.env.INVEST_DATA_DIR ?? resolve(root, "data");
  const verify = deps.verify ?? verifyOutlook(root);
  const today = deps.today ?? (() => localToday());
  const maxBlocks = deps.maxBlocks ?? MAX_DAILY_BRIEF_BLOCKS;
  const outlookTool = scriptToolName("outlook_build");
  const touched = new Map<string, Set<string>>();
  const blocks = new Map<string, number>();
  let armed = deps.armed;
  let latest: string | undefined;

  const touch = (key: string, date: string) => {
    if (!touched.has(key)) touched.set(key, new Set());
    touched.get(key)!.add(date);
    if (!latest || date > latest) latest = date;
  };

  const track: HookCallback = async (input) => {
    if (input.hook_event_name === "UserPromptSubmit") {
      armed = isDailyBriefRequest(input.prompt);
      return NO_OPINION;
    }
    if (input.hook_event_name !== "PostToolUse") return NO_OPINION;
    const key = callerKey(input, deps.rootAgent, deps.dispatches);
    const args = (input.tool_input ?? {}) as Record<string, unknown>;
    if (input.tool_name === outlookTool && !args.verify) touch(key, typeof args.date === "string" ? args.date : today());
    if (input.tool_name === "Bash" && typeof args.command === "string" && args.command.includes("build_outlook.py") && !/--verify\b/u.test(args.command)) {
      touch(key, /--date[=\s]+(\d{4}-\d{2}-\d{2})/u.exec(args.command)?.[1] ?? today());
    }
    if (WRITE_TOOLS.has(input.tool_name) && typeof args.file_path === "string") {
      const date = OUTLOOK_DIR.exec(args.file_path.split("\\").join("/"))?.[1];
      if (date) touch(key, date);
    }
    return NO_OPINION;
  };

  const refuse = async (event: "Stop" | "SubagentStop", key: string, problems: string[]) => {
    const count = (blocks.get(key) ?? 0) + 1;
    blocks.set(key, count);
    const gaveUp = count > maxBlocks;
    await deps.onOutcome?.({ key, ok: false, detail: problems.join("\n"), gaveUp });
    if (gaveUp) return NO_OPINION;
    return blockStop(event, `Daily brief format check failed for ${key}`, [
      "The outlook is not in the daily brief's fixed format yet, so you cannot stop. Fix each item, then stop again:",
      ...problems.map((problem) => `- ${problem}`),
      `Never edit outlook.md by hand: write data/research/<DATE>/outlook/judgment.json and rerun \`python3 ${OUTLOOK_SCRIPT} --date <DATE>\`. If it cannot pass, say why in your final message.`,
    ].join("\n"));
  };

  const gate: HookCallback = async (input) => {
    if (input.hook_event_name !== "Stop" && input.hook_event_name !== "SubagentStop") return NO_OPINION;
    // Delegated work still in flight: the root is pausing, not finishing.
    if (input.hook_event_name === "Stop" && input.background_tasks?.some((task) => !isTerminalStatus(task.status))) return NO_OPINION;
    const key = input.hook_event_name === "Stop" ? deps.rootAgent : callerKey(input, deps.rootAgent, deps.dispatches);
    const briefing = input.hook_event_name === "Stop" && armed;
    const dates = new Set(touched.get(key) ?? []);
    const briefDate = latest ?? today();
    if (briefing) dates.add(briefDate);
    if (!dates.size) return NO_OPINION;
    const problems: string[] = [];
    for (const date of [...dates].sort()) {
      const result = verify(date);
      if (!result.ok) problems.push(`outlook ${date}: ${result.detail}`);
    }
    if (briefing && !problems.length) {
      const path = resolve(dataDir, "research", briefDate, "outlook", "outlook.md");
      const brief = await readFile(path, "utf8");
      if (normalize(input.last_assistant_message ?? "") !== normalize(brief)) {
        problems.push(`A daily brief's final message is data/research/${briefDate}/outlook/outlook.md exactly: no preface, no summary, no edits, nothing after it. Reply with this text verbatim:\n\n${brief}`);
      }
    }
    if (problems.length) return refuse(input.hook_event_name, key, problems);
    blocks.delete(key);
    touched.delete(key);
    if (briefing) armed = false;
    await deps.onOutcome?.({ key, ok: true, detail: `outlook ${[...dates].join(", ")} verified`, gaveUp: false });
    return NO_OPINION;
  };

  return { track, gate };
}
