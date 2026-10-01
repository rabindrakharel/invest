import { createSdkMcpServer, tool, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { HITL_SERVER } from "../catalog.js";
import type { HitlQuestion, Prompter } from "./terminal.js";

interface AskUserQuestionEntry {
  question: string;
  header?: string | undefined;
  options: Array<{ label: string; description?: string | undefined }>;
  multiSelect?: boolean | undefined;
}

/**
 * In-process MCP server exposing `mcp__hitl__ask_user` so the supervisor and
 * every subagent can request human input mid-run through the shared terminal.
 */
export function createHitlServer(prompter: Prompter) {
  return createSdkMcpServer({ name: HITL_SERVER, version: "0.1.0", tools: [
    tool(
      "ask_user",
      "Ask the human operator a blocking question in the terminal. Provide 2-4 mutually exclusive options when choices are known; the operator can always type a free-form answer instead. Use this when a decision is genuinely the human's to make (scope, approach, destructive actions) — not for facts you can derive yourself.",
      {
        question: z.string().min(1).describe("Complete question ending with a question mark"),
        // A display label is cosmetic: clip it to the chip width instead of
        // rejecting the call. Hard-failing here blocked an agent that was already
        // stuck from even ASKING to get unstuck — the one call that must not fail.
        header: z.string().transform((label) => label.trim().slice(0, 24)).optional()
          .describe("Short label for the question, e.g. 'Approach' (clipped to 24 chars for display)"),
        options: z.array(z.object({
          label: z.string().min(1).describe("Concise choice text (1-5 words)"),
          description: z.string().optional().describe("What picking this option implies"),
        })).max(6).optional(),
        multiSelect: z.boolean().optional().describe("Allow picking several options (default false)"),
      },
      async ({ question, header, options, multiSelect }) => {
        if (!prompter.interactive) {
          return { content: [{ type: "text" as const, text: "No interactive terminal is attached to this run. Proceed with your best judgment and record the assumption in your output." }], isError: true };
        }
        const [answer] = await prompter.ask({ source: "ask_user" }, [{ question, header, options: options ?? [], multiSelect: multiSelect ?? false }]);
        return { content: [{ type: "text" as const, text: answer!.answer }] };
      },
    ),
  ] });
}

/**
 * canUseTool bridge — the same mechanism Claude Code uses for its interactive
 * surfaces:
 *  - `AskUserQuestion` tool calls are answered in the terminal and returned via
 *    `updatedInput.answers` (the documented "permission component" contract).
 *  - Explicitly trusted read-only tools are allowed without opening a terminal
 *    dialog, including when a delegated agent's permission mode asks again.
 *  - Ordinary permission prompts (tools outside `allowedTools`) render as
 *    allow / always-allow / deny choices; a typed answer becomes deny-with-guidance.
 * Returning `null` defers to the SDK's default behavior.
 */
export function createPermissionBridge(
  prompter: Prompter,
  autoAllowedTools: Iterable<string> = [],
  // A call this returns a description for is NEVER auto-allowed: the operator sees it and decides.
  requiresApproval?: (toolName: string, input: Record<string, unknown>) => string | undefined,
): CanUseTool {
  // Entries ending in `*` auto-allow a whole MCP surface by prefix. An external
  // server (Playwright) exposes dozens of tools whose names we cannot enumerate
  // at build time, and exact-name matching made every single one its own dialog:
  // "allow for this session" answers for `browser_find` and the next call to
  // `browser_snapshot` asks again. Auto-allow does NOT widen who may call a tool
  // — authorization stays definition-owned, so only agents granted the family
  // reach this seam at all.
  const autoAllowed = new Set<string>();
  const autoAllowedPrefixes: string[] = [];
  for (const pattern of autoAllowedTools) {
    if (pattern.endsWith("*")) autoAllowedPrefixes.push(pattern.slice(0, -1));
    else autoAllowed.add(pattern);
  }
  const isAutoAllowed = (toolName: string) =>
    autoAllowed.has(toolName) || autoAllowedPrefixes.some((prefix) => toolName.startsWith(prefix));
  return async (toolName, input, options) => {
    const spend = requiresApproval?.(toolName, input);
    if (spend !== undefined) {
      if (!prompter.interactive) return { behavior: "deny", message: "This call needs the operator's approval and no terminal is attached.", toolUseID: options.toolUseID };
      const [decision] = await prompter.ask({ source: "metered", agent: options.agentID }, [{
        question: `Approve this metered command?\n  ${spend}`,
        header: "Spends money",
        options: [{ label: "Approve once", description: "Run it now; it is billed to the X API or the model" }, { label: "Deny", description: "Do not run it" }],
      }], options.signal);
      if (decision!.answer === "Approve once") return { behavior: "allow", updatedInput: input, toolUseID: options.toolUseID };
      return { behavior: "deny", message: decision!.freeText ? decision!.answer : "Denied by the human operator.", toolUseID: options.toolUseID };
    }
    if (toolName !== "AskUserQuestion" && isAutoAllowed(toolName)) {
      return { behavior: "allow", updatedInput: input, toolUseID: options.toolUseID };
    }
    if (!prompter.interactive) return null;
    if (toolName === "AskUserQuestion") {
      const questions = ((input.questions ?? []) as AskUserQuestionEntry[]).map((entry): HitlQuestion => ({
        question: entry.question,
        header: entry.header,
        options: entry.options ?? [],
        multiSelect: entry.multiSelect,
      }));
      if (!questions.length) return { behavior: "deny", message: "AskUserQuestion carried no questions." };
      const answers = await prompter.ask({ source: "question", agent: options.agentID }, questions, options.signal);
      return {
        behavior: "allow",
        updatedInput: { ...input, answers: Object.fromEntries(answers.map((entry) => [entry.question, entry.answer])) },
        toolUseID: options.toolUseID,
      };
    }
    const permissionOptions = [
      { label: "Allow once", description: "Run this tool call now" },
      ...(options.suggestions?.length ? [{ label: "Allow for this session", description: "Stop asking for this tool during the run" }] : []),
      { label: "Deny", description: "Block this tool call" },
    ];
    const [decision] = await prompter.ask({ source: "permission", agent: options.agentID }, [{
      question: options.title ?? `Allow ${toolName} with input ${JSON.stringify(input).slice(0, 200)}?`,
      header: options.displayName ?? toolName,
      options: permissionOptions,
    }], options.signal);
    if (decision!.freeText) return { behavior: "deny", message: decision!.answer, toolUseID: options.toolUseID };
    if (decision!.answer === "Allow once") return { behavior: "allow", updatedInput: input, toolUseID: options.toolUseID };
    if (decision!.answer === "Allow for this session") {
      return { behavior: "allow", updatedInput: input, updatedPermissions: options.suggestions ?? [], toolUseID: options.toolUseID };
    }
    return { behavior: "deny", message: "Denied by the human operator.", toolUseID: options.toolUseID };
  };
}
