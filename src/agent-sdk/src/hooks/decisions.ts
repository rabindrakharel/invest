/**
 * The few answers a hook gives, built in one place so every hook speaks the SDK's hook-output shape the same way.
 * A hook with nothing to say returns {@link NO_OPINION}; later hooks in the chain still run.
 */

export const NO_OPINION = {};

/** PreToolUse: refuse the call, with the reason the agent reads. */
export const deny = (reason: string) => ({
  hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "deny" as const, permissionDecisionReason: reason },
});

/** PreToolUse: allow the call with a rewritten input. */
export const allowWith = (updatedInput: Record<string, unknown>) => ({
  hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "allow" as const, updatedInput },
});

/** Add context the agent reads before it acts (PreToolUse) or with the tool's result (PostToolUse). */
export const addContext = (hookEventName: "PreToolUse" | "PostToolUse", additionalContext: string) => ({
  hookSpecificOutput: { hookEventName, additionalContext },
});

/** Stop or SubagentStop: keep the agent running; `stopReason` is for the log, `additionalContext` is what it reads. */
export const blockStop = (hookEventName: "Stop" | "SubagentStop", stopReason: string, additionalContext: string) => ({
  decision: "block" as const,
  continue: true,
  stopReason,
  hookSpecificOutput: { hookEventName, additionalContext },
});
