import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { fromRepoRoot } from "../config/paths.js";
import { deny, NO_OPINION } from "./decisions.js";

/**
 * Largest text file a `Read` may load without `limit` (~3k tokens). The prompt
 * rule measured LINES ("~500"), and a 208-line runbook of long lines is 25 KB:
 * one run full-read it right after listing its headings. Bytes are
 * what the context pays for, so the gate measures bytes.
 */
export const MAX_UNBOUNDED_READ_BYTES = 12_000;
const NON_TEXT_READ = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|ipynb)$/iu;

/** PreToolUse on `Read`: a large text file is read by neighborhood, never whole. */
export function boundUnlimitedRead(maxBytes = MAX_UNBOUNDED_READ_BYTES): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Read") return NO_OPINION;
    const { file_path: path, limit } = (input.tool_input ?? {}) as { file_path?: unknown; limit?: unknown };
    if (typeof path !== "string" || limit !== undefined || NON_TEXT_READ.test(path)) return NO_OPINION;
    const cwd = typeof input.cwd === "string" ? input.cwd : fromRepoRoot();
    const size = await stat(isAbsolute(path) ? path : resolve(cwd, path)).then((info) => (info.isFile() ? info.size : 0), () => 0);
    if (size <= maxBytes) return NO_OPINION;
    return deny(`\`${path}\` is ${Math.round(size / 1024)} KB; a Read without \`limit\` is capped at ${Math.round(maxBytes / 1000)} KB because every byte stays in your context for the rest of the run. Locate first — its headings (\`rg -n '^#' <file>\`) or the line you need (\`rg -n '<identifier>' <file>\`), \`jq\` for JSON — then Read that neighborhood with \`offset\` and \`limit\`.`);
  };
}

const PATH_LIKE_KEY = /path|file|dir|args/i;

/**
 * Does a caller-supplied path land inside the repository?
 *
 * The invariant this guard defends is CONTAINMENT — "no tool reaches outside the
 * repo" — and containment is a property of where a path RESOLVES, not of the
 * characters it is spelled with. The previous test (`/(^|\/)\.\.(\/|$)/` against
 * the raw string) confused the two and got both directions wrong: it denied
 * paths that never leave the tree, while treating resolution as something it
 * could approximate by pattern.
 *
 * So resolve, then compare. Both spellings are accepted because both are
 * legitimate: a relative path resolves against the caller's cwd (the shell's own
 * semantics), an absolute path is taken as given, and either is allowed exactly
 * when it stays under the root. A `..` inside a path is fine as long as it does
 * not walk out — which is what "traversal" was always meant to mean.
 */
function escapesRepository(value: string, cwd: string, root: string): boolean {
  const resolved = isAbsolute(value) ? resolve(value) : resolve(cwd, value);
  const rel = relative(root, resolved);
  return rel.startsWith("..") || isAbsolute(rel);
}

/**
 * A path-shaped KEY does not guarantee a path-shaped VALUE. Tool inputs carry
 * plenty of strings under path-ish keys that name no location — a grep pattern,
 * a git ref in `args`, a URL — and resolving those yields a meaningless verdict.
 * Check only values that could denote a real filesystem location.
 */
function looksLikePath(value: string): boolean {
  return value.trim().length > 0 && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/[*?[\]]/.test(value);
}

export function confineToRepository(root = fromRepoRoot()): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return NO_OPINION;
    const cwd = typeof input.cwd === "string" ? input.cwd : root;
    let reason = "";
    const unsafe = (value: unknown, key = ""): boolean => {
      if (typeof value === "string") {
        // NUL is rejected in ANY field, path-shaped or not: it truncates strings
        // inside syscalls, so it is never legitimate content.
        if (value.includes("\u0000")) {
          reason = "NUL bytes are forbidden in tool arguments";
          return true;
        }
        if (!PATH_LIKE_KEY.test(key) || !looksLikePath(value)) return false;
        if (!escapesRepository(value, cwd, root)) return false;
        reason = `Path escapes the repository: ${value} \u2014 pass a path inside ${root}; relative (data/research/...) and absolute forms are both accepted`;
        return true;
      }
      if (Array.isArray(value)) return value.some((entry) => unsafe(entry, key));
      if (value && typeof value === "object") return Object.entries(value).some(([childKey, child]) => unsafe(child, childKey));
      return false;
    };
    if (unsafe(input.tool_input ?? {})) {
      return deny(reason);
    }
    return NO_OPINION;
  };
}

export function requireLoadedGuide(toolAreas: Map<string, string>, loaded: Set<string>): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return NO_OPINION;
    const area = toolAreas.get(input.tool_name);
    if (!area || loaded.has(area)) return NO_OPINION;
    return deny(`Load the '${area}' tool guide with mcp__run_guide__load_guide before calling ${input.tool_name}`);
  };
}

/**
 * The repository's irreplaceable data, from CLAUDE.md's invariants: the paid X
 * corpus and the price and pick layers are append-only, and the verdict ledger is
 * only ever appended through `/runway-probe`'s register step. No agent edits,
 * overwrites or deletes them by hand, and none reads the secrets file.
 *
 * This guards the agent's own direct tool calls (`Write`, `Edit`, and the shell
 * commands it composes); the pipeline scripts that legitimately append to these
 * areas run as processes and are not inspected here.
 */
const APPEND_ONLY = /(?:^|\/)data\/(?:corpus\/(?:raw|picks|pick_tags|prices)|ledger)(?:\/|$)/u;
const SECRETS = /(?:^|\/)\.env(?:\.[\w-]+)?$/u;
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
// A shell verb that can rewrite or remove what it names; `>>` (append) is deliberately absent.
const DESTRUCTIVE_SHELL = /(?:\brm\b|\bmv\b|\btruncate\b|\bsed\s+-[a-z]*i|\btee\b(?!\s+-a)|\bdd\b|\bshred\b|\bgit\s+(?:checkout|restore|clean|reset)\b|(?<!>)>(?!>))/u;

export function protectAppendOnly(root = fromRepoRoot()): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return NO_OPINION;
    const cwd = typeof input.cwd === "string" ? input.cwd : root;
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
    const asRelative = (path: string) => relative(root, isAbsolute(path) ? resolve(path) : resolve(cwd, path));
    if (WRITE_TOOLS.has(input.tool_name)) {
      const path = typeof toolInput.file_path === "string" ? toolInput.file_path : typeof toolInput.notebook_path === "string" ? toolInput.notebook_path : "";
      if (path && APPEND_ONLY.test(asRelative(path))) return deny(`\`${asRelative(path)}\` is append-only (CLAUDE.md invariants): paid corpus layers are never rewritten, and the verdict ledger is appended only through /runway-probe's register step.`);
      if (path && SECRETS.test(path)) return deny("The secrets file is never written by an agent.");
    }
    if (input.tool_name === "Read" || input.tool_name === "Grep") {
      const path = typeof toolInput.file_path === "string" ? toolInput.file_path : typeof toolInput.path === "string" ? toolInput.path : "";
      if (path && SECRETS.test(path)) return deny("The secrets file is not readable by an agent; ask the operator for a value it needs.");
    }
    if (input.tool_name === "Bash" && typeof toolInput.command === "string") {
      const command = toolInput.command;
      if (/(?:^|[\s/"'=])\.env(?:\.[\w-]+)?(?=$|[\s"';|&)])/u.test(command)) return deny("A shell command may not touch the secrets file (.env).");
      const names = /data\/(?:corpus\/(?:raw|picks|pick_tags|prices)|ledger)(?:\/|\s|$|["'])/u.test(command);
      if (names && DESTRUCTIVE_SHELL.test(command)) return deny("This command would rewrite or remove an append-only area (data/corpus/raw|picks|pick_tags|prices, data/ledger). Append through the owning pipeline step instead.");
    }
    return NO_OPINION;
  };
}

/**
 * The metered steps: the X API behind capture and backfill (about $0.005 per post read)
 * and the API-lane extraction. CLAUDE.md says to ask first, and an instruction an agent
 * must remember is not a control, so the runtime enforces it: in an interactive run the
 * permission bridge puts the exact command in front of the operator, and in a headless
 * run nothing can approve it, so it is denied.
 */
const METERED = /\btask:(?:capture|backfill|delta|resolve-accounts|extract)\b|\bsrc\/(?:capture\/(?:index|backfill)|x\/resolve-accounts|extract\/index)\.ts\b/u;

/**
 * The operator-facing description of a metered call, or undefined when it spends nothing. A registered
 * script tool is metered when its registry entry says so (`meteredTools`: full tool names); the shell
 * backstop recognises the same commands when typed into `Bash`.
 */
export function meteredSpend(toolName: string, toolInput: unknown, meteredTools: ReadonlySet<string> = new Set()): string | undefined {
  if (meteredTools.has(toolName)) return `${toolName.split("__").pop()} ${JSON.stringify(toolInput ?? {})}`;
  if (toolName !== "Bash") return undefined;
  const command = (toolInput as { command?: unknown } | null)?.command;
  return typeof command === "string" && METERED.test(command) ? command : undefined;
}

export function gateMeteredSpend(interactive: boolean, meteredTools: ReadonlySet<string> = new Set()): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse" || interactive) return NO_OPINION;
    const command = meteredSpend(input.tool_name, input.tool_input, meteredTools);
    if (!command) return NO_OPINION;
    return deny(`\`${command}\` spends money (X API reads about $0.005 per post, or model calls) and needs the operator's approval, which a headless run cannot collect. Report it as \`blocked\`, with the post count and cost you expected, and let the operator run it.`);
  };
}
