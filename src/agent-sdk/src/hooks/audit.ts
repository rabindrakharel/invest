import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import type { RunWorkspace } from "../domain/types.js";
import { mutatedPaths } from "../handoffs/continuation.js";
import type { DispatchRegistry } from "../handoffs/dispatch.js";
import { emitAudit } from "../observability.js";
import { ensureAgentWorkspace } from "../workspace/run-workspace.js";
import { callerKey } from "./caller.js";
import { NO_OPINION } from "./decisions.js";

/** Every hook event, run-wide (audit.jsonl), and every tool event again in the calling dispatch's own tools.jsonl. */
export function auditHook(workspace: RunWorkspace, rootAgent: string, dispatches?: DispatchRegistry): HookCallback {
  return async (input: HookInput, toolUseId) => {
    await emitAudit(workspace.auditFile, { event: input.hook_event_name, ...(toolUseId ? { toolUseId } : {}), data: input });
    if ("tool_name" in input) {
      const agent = callerKey(input, rootAgent, dispatches);
      const agentWorkspace = await ensureAgentWorkspace(workspace, agent);
      // Stamp the mutated path onto the record. A dispatch that dies mid-flight
      // leaves uncommitted edits and no account of them; this makes its own
      // tools log self-sufficient for reconstructing what it touched, without
      // re-parsing the run-wide audit stream.
      const paths = "tool_input" in input ? mutatedPaths(input.tool_name, input.tool_input) : [];
      await emitAudit(agentWorkspace.toolsFile, {
        event: input.hook_event_name,
        agent,
        ...(toolUseId ? { toolUseId } : {}),
        tool: input.tool_name,
        ...(paths.length ? { paths } : {}),
        ...(input.hook_event_name === "PostToolUseFailure" ? { status: "failed" } : {}),
      });
    }
    return NO_OPINION;
  };
}
