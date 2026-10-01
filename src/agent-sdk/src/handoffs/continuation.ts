import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fromRepoRoot } from "../config/paths.js";
import type { RunWorkspace } from "../domain/types.js";
import { ensureAgentWorkspace } from "../workspace/run-workspace.js";

/**
 * Hard ceiling on attempts at one plan row: the original dispatch plus two
 * operator-approved continuations. This is OTP restart intensity — an operator
 * who keeps approving still hits a floor, so a thrashing agent cannot bill an
 * unbounded number of full-budget attempts.
 */
export const MAX_DISPATCH_ATTEMPTS = 3;

/** Tools whose `tool_input` names a file this dispatch MUTATED. */
export const MUTATING_TOOLS = new Set([
  "Edit",
  "Write",
  "NotebookEdit",
]);

/** Every `tool_input` key that carries a path, across native edit tools. */
const PATH_KEYS = new Set(["path", "file_path", "paths", "file_paths", "files"]);

/** Pull the mutated path(s) out of one tool call's input. Shape-tolerant by design. */
export function mutatedPaths(toolName: string, toolInput: unknown): string[] {
  if (!MUTATING_TOOLS.has(toolName) || !toolInput || typeof toolInput !== "object") return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(toolInput as Record<string, unknown>)) {
    if (!PATH_KEYS.has(key)) continue;
    if (typeof value === "string") found.push(value);
    else if (Array.isArray(value)) found.push(...value.filter((entry): entry is string => typeof entry === "string"));
  }
  return found;
}


export interface ContinuationPacket {
  /** Repo-relative path to the written packet — quote this into the retry prompt. */
  path: string;
  attempt: number;
  /** True once the NEXT attempt would exceed {@link MAX_DISPATCH_ATTEMPTS}. */
  exhausted: boolean;
  toolCalls: number;
  files: string[];
  /** A tool that failed repeatedly at the end of the run — the thrashing signal. */
  thrashing: string | null;
}

interface ToolRecord {
  event?: string;
  tool?: string;
  status?: string;
  paths?: string[];
}

/**
 * Derive, from GROUND TRUTH, what a terminated dispatch actually did — so its
 * successor resumes from a real position instead of re-deriving one.
 *
 * The dead dispatch cannot describe itself: a `maxTurns` guillotine leaves no
 * turn in which to write a handoff. So the packet is reconstructed mechanically
 * from that dispatch's own `tools.jsonl`, the same principle the outcome
 * reconciler uses — observe what happened, never ask the worker to report it.
 *
 * The files list is the load-bearing part. A terminated implementation agent
 * leaves real, uncommitted mutations on disk with nothing recording them; a
 * successor that does not know about them will either redo the work or apply a
 * second layer on top of a half-finished first.
 */
export async function writeContinuationPacket(
  run: RunWorkspace,
  key: string,
  missing: string[],
  // The attempt at this dispatch's WORK ITEM (DispatchRegistry.attemptOf). Never
  // the key's ordinal: parallel siblings of one type are all first attempts.
  attempt: number,
): Promise<ContinuationPacket> {
  const workspace = await ensureAgentWorkspace(run, key);
  const records = await readToolRecords(resolve(workspace.agentRoot, "tools.jsonl"));
  const outcomes = records.filter((record) => record.event === "PostToolUse" || record.event === "PostToolUseFailure");
  const files = [...new Set(outcomes.flatMap((record) => record.paths ?? []))].sort();
  const packet: ContinuationPacket = {
    path: relative(fromRepoRoot(), resolve(workspace.agentRoot, "continuation.md")),
    attempt,
    exhausted: attempt + 1 > MAX_DISPATCH_ATTEMPTS,
    toolCalls: outcomes.length,
    files,
    thrashing: detectThrashing(outcomes),
  };
  await writeFile(resolve(workspace.agentRoot, "continuation.md"), render(key, packet, missing, outcomes), "utf8");
  return packet;
}

async function readToolRecords(path: string): Promise<ToolRecord[]> {
  const raw = await readFile(path, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ToolRecord];
      } catch {
        return [];
      }
    });
}

/**
 * Was the dispatch making progress, or stuck? An operator deciding whether to
 * approve another full-budget attempt is really deciding "underscoped, or
 * thrashing?", and nothing else in the packet separates those two. A tail of
 * repeated calls to one tool with failures in it is the strongest mechanical
 * signal available.
 */
function detectThrashing(outcomes: ToolRecord[]): string | null {
  const tail = outcomes.slice(-8);
  if (tail.length < 6) return null;
  const counts = new Map<string, { total: number; failed: number }>();
  for (const record of tail) {
    const name = record.tool ?? "unknown";
    const entry = counts.get(name) ?? { total: 0, failed: 0 };
    counts.set(name, { total: entry.total + 1, failed: entry.failed + (record.status === "failed" ? 1 : 0) });
  }
  for (const [tool, { total, failed }] of counts) {
    if (total >= 4 && failed >= 2) return `${tool} — ${total} of the last ${tail.length} calls, ${failed} failed`;
  }
  return null;
}

function render(key: string, packet: ContinuationPacket, missing: string[], outcomes: ToolRecord[]): string {
  const tail = outcomes.slice(-8).map((record) => `- \`${record.tool ?? "unknown"}\`${record.status === "failed" ? " — FAILED" : ""}`);
  return [
    `# Continuation packet — \`${key}\``,
    "",
    "This dispatch terminated without publishing its required outputs (turn budget,",
    "crash, or cancel — the runtime cannot tell which). It could not describe itself,",
    "so everything below is derived mechanically from its own `tools.jsonl`.",
    "",
    "## Not published",
    "",
    ...missing.map((name) => `- \`${name}\``),
    "",
    "## Files this dispatch already mutated",
    "",
    packet.files.length
      ? "Real, uncommitted changes are on disk. READ each one before editing it: the work is partially done, and a blind redo will double-apply it."
      : "None — no file mutation was recorded, so nothing is half-applied.",
    "",
    ...packet.files.map((file) => `- \`${file}\``),
    "",
    "## Activity",
    "",
    `- Attempt: ${packet.attempt} of ${MAX_DISPATCH_ATTEMPTS}`,
    `- Tool calls completed: ${packet.toolCalls}`,
    `- Repeated-failure signal: ${packet.thrashing ?? "none detected"}`,
    "",
    "Last calls before termination:",
    "",
    ...(tail.length ? tail : ["- none recorded"]),
    "",
  ].join("\n");
}
