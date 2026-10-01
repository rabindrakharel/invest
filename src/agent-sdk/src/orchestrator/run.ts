import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { TerminalPrompter } from "../../assets/tools/hitl/terminal.js";
import { loadAgentGraph } from "../agents/catalog.js";
import { loadRuntimeConfig } from "../config/load.js";
import { fromRepoRoot } from "../config/paths.js";
import { createRunWorkspace } from "../workspace/run-workspace.js";
import type { RunWorkspace } from "../domain/types.js";
import { buildOptions } from "./build-options.js";
import { createRenderer } from "./render.js";
import { handoffMode, pendingHandoff, type PendingHandoff } from "./handoff.js";
import { SteeringBus } from "../steering/bus.js";

/**
 * The run's input channel: the request, then every root-addressed steering note
 * for as long as the run lives.
 *
 * Passing a plain string here instead disables the SDK's whole control surface —
 * `interrupt()` and `setPermissionMode()` are documented as streaming-input only,
 * and there is no way to say anything to a running agent. One generator buys all
 * three.
 */
async function* runInput(request: string, steering: SteeringBus): AsyncGenerator<SDKUserMessage> {
  yield userMessage(request);
  for await (const note of steering.rootNotes()) yield userMessage(note);
}

/**
 * The root agent's first user message: runtime DATA only (paths are repo-root-relative because every agent runs
 * with cwd at the repo root), then the request. The agent's contract arrives as its definition system prompt.
 */
export function buildInitialPrompt(workspace: RunWorkspace, request: string): string {
  const rel = (path: string) => relative(fromRepoRoot(), path);
  return `[run-context]\nAGENT_TOOLS_LOG=${rel(workspace.toolsFile)}\nAGENT_OUTPUT_DIR=${rel(workspace.output)}\nCONTEXT.md=${rel(workspace.contextFile)}\nRUN_ROOT=${rel(workspace.root)}\nAGENT_OUTPUT_DIR_PATTERN={RUN_ROOT}/{agent}/output (yours; a DELEGATED agent publishes under {RUN_ROOT}/{agent}/{dispatch}/output; take its exact path from that agent's ledger Output dir pointer, never guess the ordinal)\n\nUser request:\n${request}`;
}

/** One user message in the SDK's streaming-input shape. */
export function userMessage(content: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
}

export async function runAgent(agentName: string | undefined, request: string): Promise<void> {
  const [config, graph] = await Promise.all([loadRuntimeConfig(), loadAgentGraph()]);
  const name = agentName ?? config.defaultAgent;
  const agent = graph.agents.get(name);
  if (!agent) throw new Error(`Unknown agent '${name}'. Available: ${[...graph.agents.keys()].join(", ")}`);
  // The default launch must be able to dispatch; `--agent <subagent>` still runs
  // that one agent alone as the main thread (no roster, no fan-out).
  if (!agentName && !agent.orchestrator) throw new Error(`runtime.yaml defaultAgent '${name}' is not an orchestrator. Orchestrators: ${[...graph.orchestrators.keys()].join(", ")}`);
  const workspace = await createRunWorkspace(process.env.AGENT_RUNS_DIR ?? config.runsDirectory, name, request);
  // The root agent's contract arrives as its definition system prompt (SDK
  // `agent` option in buildOptions); this user prompt carries runtime DATA
  // only, repo-root-relative (cwd is the repo root) — instructional prose
  // lives in the agent profile. Process env keeps absolute paths for scripts.
  const rel = (path: string) => relative(fromRepoRoot(), path);
  const prompt = buildInitialPrompt(workspace, request);
  // The exact first prompt, so a run proves what the root agent started from
  // instead of reconstructing it.
  await writeFile(resolve(workspace.root, "initial-prompt.md"), prompt, "utf8");
  const steering = new SteeringBus(resolve(workspace.root, "steering.jsonl"), new Set(graph.agents.keys()), name);
  // stdin has exactly one reader. Steering lines are offered to the bus by the
  // prompter itself, so a note typed mid-run and an answer typed into a HITL
  // dialog can never race for the same keystrokes.
  const prompter = new TerminalPrompter(process.stdout, process.stdin, (line) => {
    const submitted = steering.offer(line);
    if (submitted.rejection) process.stdout.write(`\n  ✳ ${submitted.rejection}\n`);
    else if (submitted.accepted) process.stdout.write(`\n  ✳ steering queued for ${submitted.addressee ?? name}\n`);
    return submitted.accepted;
  });
  const options = await buildOptions(config, agent, workspace, prompter, steering);
  const rawLog = createWriteStream(resolve(workspace.root, "messages.jsonl"), { flags: "a" });
  const render = createRenderer((line) => rawLog.write(line + "\n"), name, rel(workspace.root));
  const session = query({ prompt: runInput(prompt, steering), options });
  // First Ctrl-C stops the current turn and hands control back so the operator
  // can redirect; a second within two seconds gives up and exits.
  let interruptedAt = 0;
  const onInterrupt = () => {
    const now = Date.now();
    if (now - interruptedAt < 2000) { steering.close(); prompter.dispose(); process.exit(130); }
    interruptedAt = now;
    process.stdout.write("\n  ✳ interrupting current turn — type `> instruction` to redirect, Ctrl-C again to exit\n");
    void session.interrupt().catch(() => undefined);
  };
  if (prompter.interactive) {
    prompter.listen();
    process.on("SIGINT", onInterrupt);
    process.stdout.write(`\n  ✳ steering: \`> note\` → ${name} · \`>@<agent> note\` → that dispatch · Ctrl-C interrupts the turn\n`);
  }
  try {
    for await (const message of session) {
      render(message);
      // The session ends when the run produces a result AND the operator has
      // nothing queued; a note submitted before that keeps the input channel
      // open so it starts the next turn instead of being discarded.
      if (message.type === "result" && !steering.hasPendingForRoot()) steering.close();
    }
  } finally {
    process.off("SIGINT", onInterrupt);
    steering.close();
    await steering.flush();
    prompter.dispose();
    rawLog.end();
    for (const note of steering.undelivered())
      process.stdout.write(`\n  ✳ steering never delivered to ${note.addressee}: ${note.text}\n`);
  }
  // Orchestrator -> orchestrator handoff happens HERE, between sessions, never as
  // a dispatch: the next orchestrator starts as a fresh main thread whose only
  // input is the brief this one published.
  const next = await pendingHandoff(agent, workspace);
  if (next) await continueWith(next);
}

async function continueWith(next: PendingHandoff): Promise<void> {
  const mode = handoffMode();
  let start = mode === "auto";
  if (mode === "ask") {
    const prompter = new TerminalPrompter();
    try {
      if (prompter.interactive) {
        const [answer] = await prompter.ask({ source: `${next.from} handoff` }, [{
          header: "Handoff",
          question: `${next.from} finished and handed off to ${next.to} (brief: ${next.briefPath}). Start the ${next.to} session now?`,
          options: [
            { label: `Start ${next.to}`, description: "new orchestrator session seeded with the brief only" },
            { label: "Stop here", description: "review the plan first; run the printed command later" },
          ],
        }]);
        start = answer?.answer === `Start ${next.to}`;
      }
    } finally {
      prompter.dispose();
    }
  }
  if (!start) {
    process.stdout.write(`\n  ✳ handoff ready: ${next.from} -> ${next.to}. Start it with:\n    ${next.command}\n`);
    return;
  }
  process.stdout.write(`\n  ✳ handing off: ${next.from} -> ${next.to} (new session, brief ${next.briefPath})\n`);
  await runAgent(next.to, next.request);
}
