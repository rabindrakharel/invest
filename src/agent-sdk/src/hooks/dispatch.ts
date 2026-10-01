import { isAbsolute, relative, resolve } from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { fromRepoRoot } from "../config/paths.js";
import { mutatedPaths } from "../handoffs/continuation.js";
import type { DispatchRegistry } from "../handoffs/dispatch.js";
import { callerKey } from "./caller.js";
import { deny, NO_OPINION } from "./decisions.js";

/**
 * Parallel dispatches share ONE working tree, so file ownership is the only thing
 * that keeps a fan-out from colliding: two `api-developer` siblings editing the
 * same file each land exact-match hunks against bytes the other is rewriting.
 *
 * The first LIVE delegated dispatch to mutate a path owns it until that dispatch
 * is observed terminal; any other live dispatch — or the orchestrator itself —
 * that tries to mutate it is denied with the owner named. Ownership is derived
 * from the edit calls themselves, never from a declaration the orchestrator must
 * remember to write, and it lapses by observation (the owner terminated), so a
 * later wave re-claims freely. The orchestrator never claims: its integration
 * edits happen between waves, when no sibling is live.
 */
export function claimWritePaths(rootAgent: string, dispatches?: DispatchRegistry, root = fromRepoRoot()): HookCallback {
  const owners = new Map<string, string>();
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse" || !dispatches) return NO_OPINION;
    const paths = "tool_input" in input ? mutatedPaths(input.tool_name, input.tool_input) : [];
    if (!paths.length) return NO_OPINION;
    const key = callerKey(input, rootAgent, dispatches);
    const cwd = typeof input.cwd === "string" ? input.cwd : root;
    const targets = paths.map((path) => relative(root, isAbsolute(path) ? resolve(path) : resolve(cwd, path)));
    const conflicts = targets.flatMap((path) => {
      const owner = owners.get(path);
      return owner && owner !== key && !dispatches.isTerminal(owner) ? [`\`${path}\` (owned by \`${owner}\`)`] : [];
    });
    if (conflicts.length) {
      const remedy = key === rootAgent
        ? "Wait for that dispatch to return before editing the file yourself."
        : "Parallel dispatches own disjoint files. Do not edit it: finish the files you own, and name the overlap in your evidence so the orchestrator sequences that change after the owner returns.";
      return deny(`A sibling dispatch that is still running is editing ${conflicts.join(", ")}. ${remedy}`);
    }
    if (key !== rootAgent) for (const path of targets) owners.set(path, key);
    return NO_OPINION;
  };
}

/**
 * Upper bound on one dispatch brief (~4k tokens). A subagent starts cold, and
 * everything in its prompt is context it pays for on every turn; a brief this
 * large is carrying the plan, a sibling's task, or run history instead of ONE
 * task. The cap turns that into a named denial at the dispatch seam.
 */
export const MAX_DISPATCH_BRIEF_CHARS = 16_000;

/**
 * PreToolUse on `Agent`: an orchestrator hands each subagent a bounded, isolated
 * brief — its own task and the minimum needed to do it — never its own context.
 */
export function boundDispatchBrief(maxChars = MAX_DISPATCH_BRIEF_CHARS): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Agent") return NO_OPINION;
    const prompt = (input.tool_input as { prompt?: unknown } | null)?.prompt;
    if (typeof prompt !== "string" || prompt.length <= maxChars) return NO_OPINION;
    return deny(`This dispatch brief is ${prompt.length} characters; the limit is ${maxChars}. A subagent gets ONE task and only what that task needs: its card, the paths it owns, the exact doc sections to read (by path and heading, not pasted whole), its gate, and its output. Remove the plan, other tasks, run history, and your own reasoning, then dispatch again.`);
  };
}
