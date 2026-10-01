import { spawnSync } from "node:child_process";
import { readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import type { RunWorkspace } from "../domain/types.js";
import type { AgentSpec } from "../domain/types.js";
import { emitAudit } from "../observability.js";
import { ensureAgentWorkspace } from "../workspace/run-workspace.js";
import { fromRepoRoot } from "../config/paths.js";
import { isTerminalStatus, reconcileOutcome } from "../handoffs/reconcile.js";
import { MAX_DISPATCH_ATTEMPTS, mutatedPaths, writeContinuationPacket, type ContinuationPacket } from "../handoffs/continuation.js";
import type { DispatchRegistry } from "../handoffs/dispatch.js";
import type { SteeringBus } from "../steering/bus.js";
import type { AgentContext } from "../prompt/model.js";
import { toYaml } from "../prompt/yaml.js";

/**
 * The dispatch key of the agent a hook fired for. `agent_id` is the SDK's own
 * per-dispatch identity, so two concurrent dispatches of one type route to their
 * own planes instead of interleaving in a shared type-keyed file.
 */
function callerKey(input: HookInput, rootAgent: string, dispatches?: DispatchRegistry): string {
  const agentId = "agent_id" in input && typeof input.agent_id === "string" ? input.agent_id : undefined;
  const fromId = agentId ? dispatches?.keyForAgentId(agentId) : undefined;
  if (fromId) return fromId;
  const agentType = "agent_type" in input && typeof input.agent_type === "string" ? input.agent_type : undefined;
  if (!agentType) return rootAgent;
  return dispatches?.latestFor(agentType) ?? agentType;
}

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
    return {};
  };
}

export function prepareAgentContext(workspace: RunWorkspace, contexts: Map<string, AgentContext>, dispatches?: DispatchRegistry): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "SubagentStart") return {};
    // First hook of a dispatch's life: claim its ordinal here so every later hook,
    // ledger write, and artifact path for this instance resolves to the same key.
    const key = dispatches?.register(input.agent_id, input.agent_type) ?? input.agent_type;
    const context = contexts.get(input.agent_type);
    if (!context) return {};
    const agentWorkspace = await ensureAgentWorkspace(workspace, key);
    // The subagent's dispatched prompt IS this context as XML; context.yaml is
    // the same object as data, materialized for observability.
    await writeFile(agentWorkspace.agentContextFile, toYaml(context));
    return {};
  };
}

const CALLER_ATTRIBUTED_CONTEXT_TOOLS = new Set([
  "mcp__run_context__record_outcome",
  "mcp__run_context__publish_output",
  ]);

/**
 * PreToolUse hook: deterministically attribute every caller-owned context write
 * (`record_outcome`, `publish_output`) to the DISPATCH that actually made it. One
 * `run_context` server is shared across all agents, so the tool would otherwise
 * fall back to the root's name whenever the model omits `agent`. The SDK stamps
 * the calling agent onto the hook input (`agent_id` per dispatch, `agent_type` for
 * the type); we rewrite the tool input so a subagent's published artifacts —
 * including its required outputs — always land in its own
 * dispatch `output/`, never the supervisor's and never a sibling attempt's.
 *
 * A write ADDRESSED to a different agent is denied outright rather than quietly
 * redirected: an orchestrator that tried to publish a subagent's required output had it
 * silently rewritten into its own plane and believed the subagent's required
 * output was satisfied. Close-out is non-transferable; say so loudly.
 */
export function attributeContextWriteToCaller(allowedAgents: Set<string>, dispatches?: DispatchRegistry): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    if (!CALLER_ATTRIBUTED_CONTEXT_TOOLS.has(input.tool_name)) return {};
    const callerType = typeof input.agent_type === "string" ? input.agent_type : undefined;
    if (!callerType || !allowedAgents.has(callerType)) return {};
    const current = (input.tool_input ?? {}) as Record<string, unknown>;
    const requested = typeof current.agent === "string" ? current.agent : undefined;
    if (requested && requested !== callerType && dispatches?.typeOf(requested) !== callerType) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `${input.tool_name} writes only your OWN plane: you are \`${callerType}\`, not \`${requested}\`. An agent's required outputs and outcome are its own to publish — re-dispatch \`${requested}\` to finish its close-out instead of writing it yourself.`,
        },
      };
    }
    const key = callerKey(input, callerType, dispatches);
    if (current.agent === key) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { ...current, agent: key },
      },
    };
  };
}

/**
 * Deliver operator steering to a DELEGATED dispatch.
 *
 * The SDK's streaming-input channel addresses the root session only; a subagent
 * runs in its own isolated session that no user message can reach. Its notes
 * therefore ride the next hook that fires for it — `PreToolUse`, so the note
 * lands BEFORE the agent acts. Steering that arrives after the fact is a
 * comment, not steering.
 *
 * Root-addressed notes are skipped here on purpose: they go out through the
 * input channel, and delivering them twice would double every instruction.
 */
export function deliverSteering(steering: SteeringBus | undefined, rootAgent: string, dispatches?: DispatchRegistry): HookCallback {
  return async (input) => {
    if (!steering || input.hook_event_name !== "PreToolUse") return {};
    const key = callerKey(input, rootAgent, dispatches);
    if (key === rootAgent) return {};
    const notes = steering.drainFor(key, dispatches?.typeOf(key));
    if (!notes.length) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: [
          `The human operator is steering you (\`${key}\`) mid-task. Apply this before continuing, and say in your outputs how it changed what you did:`,
          ...notes.map((note) => `- ${note}`),
        ].join("\n"),
      },
    };
  };
}

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
    if (input.hook_event_name !== "PreToolUse" || !dispatches) return {};
    const paths = "tool_input" in input ? mutatedPaths(input.tool_name, input.tool_input) : [];
    if (!paths.length) return {};
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
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `A sibling dispatch that is still running is editing ${conflicts.join(", ")}. ${remedy}`,
        },
      };
    }
    if (key !== rootAgent) for (const path of targets) owners.set(path, key);
    return {};
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
    if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Agent") return {};
    const prompt = (input.tool_input as { prompt?: unknown } | null)?.prompt;
    if (typeof prompt !== "string" || prompt.length <= maxChars) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `This dispatch brief is ${prompt.length} characters; the limit is ${maxChars}. A subagent gets ONE task and only what that task needs: its card, the paths it owns, the exact doc sections to read (by path and heading, not pasted whole), its gate, and its output. Remove the plan, other tasks, run history, and your own reasoning, then dispatch again.`,
      },
    };
  };
}

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
    if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Read") return {};
    const { file_path: path, limit } = (input.tool_input ?? {}) as { file_path?: unknown; limit?: unknown };
    if (typeof path !== "string" || limit !== undefined || NON_TEXT_READ.test(path)) return {};
    const cwd = typeof input.cwd === "string" ? input.cwd : fromRepoRoot();
    const size = await stat(isAbsolute(path) ? path : resolve(cwd, path)).then((info) => (info.isFile() ? info.size : 0), () => 0);
    if (size <= maxBytes) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `\`${path}\` is ${Math.round(size / 1024)} KB; a Read without \`limit\` is capped at ${Math.round(maxBytes / 1000)} KB because every byte stays in your context for the rest of the run. Locate first — its headings (\`rg -n '^#' <file>\`) or the line you need (\`rg -n '<identifier>' <file>\`), \`jq\` for JSON — then Read that neighborhood with \`offset\` and \`limit\`.`,
      },
    };
  };
}

/**
 * The coordinator's `Agent` call returning is the ONE seam that exists for a
 * synchronous dispatch no matter how the child died. `SubagentStop` is a signal
 * the child emits, so a `maxTurns` guillotine silences it; `background_tasks`
 * lists detached work only, so a `run_in_background: false` dispatch is never in
 * it. Between those two the synchronous path had no closing trigger at all, and
 * a terminated child returned its last, mid-sentence assistant text to a
 * coordinator with no way to tell narration from a result.
 *
 * So: reconcile here, where the parent is alive by definition — it is the thing
 * being returned to — and when the verdict is `abandoned`, say so IN the tool
 * result. A coordinator must never have to infer termination from prose.
 */
export function closeDispatchOnReturn(workspace: RunWorkspace, specs: Map<string, AgentSpec>, dispatches?: DispatchRegistry): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PostToolUse" || input.tool_name !== "Agent") return {};
    const requested = (input.tool_input as { subagent_type?: unknown } | null)?.subagent_type;
    if (typeof requested !== "string") return {};
    const childSpec = specs.get(requested);
    if (!childSpec) return {};
    const returned = readAgentReturn(input.tool_response);
    // Bind the dispatch to its work item on EVERY return — the async launch
    // acknowledgement included — so attempts count per item, not per type.
    const requestInput = (input.tool_input ?? {}) as { name?: unknown; description?: unknown };
    const workItem = typeof requestInput.name === "string" && requestInput.name.trim() ? requestInput.name : typeof requestInput.description === "string" ? requestInput.description : "";
    const launched = returned.agentId ? dispatches?.keyForAgentId(returned.agentId) : undefined;
    if (launched && workItem) dispatches?.bindWorkItem(launched, workItem);
    // A returned `Agent` call is not, by itself, proof the child finished:
    // `run_in_background: false` is a request the agent DEFINITION can override
    // (`sdk.background: true`), and those dispatches answer with a launch
    // acknowledgement within milliseconds of `SubagentStart`. Close only what the
    // SDK reports terminal, and identify it by the id it hands back rather than
    // by "the latest dispatch of this type" — two dispatches of one type in
    // flight would otherwise close the wrong one.
    if (!returned.terminal) return {};
    // Without the SDK's id, only an UNAMBIGUOUS type may stand in for it: with
    // siblings of one type in flight, "the latest" is a guess that closes the
    // wrong one. A key equal to the bare type means `SubagentStart` never claimed
    // an ordinal — nothing ran, nothing to close.
    const key = launched ?? dispatches?.soleFor(requested);
    if (!key || key === requested) return {};
    if (workItem) dispatches?.bindWorkItem(key, workItem);
    dispatches?.markTerminal(key);
    const result = await reconcileOutcome(workspace, childSpec, { dispatch: key });
    if (result.verdict !== "abandoned") return {};
    const packet = await writeContinuationPacket(workspace, key, result.missing, dispatches?.attemptOf(key) ?? 1);
    return {
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: continuationDirective(key, requested, result.missing, packet) },
    };
  };
}

/**
 * Read the SDK's answer to an `Agent` call. Both forms — the terminal result and
 * the `async_launched` acknowledgement — are objects carrying the dispatch's own
 * `agentId` and a `status` drawn from the SAME vocabulary as `background_tasks`,
 * so liveness is decided here with the same {@link isTerminalStatus} predicate
 * used there, and identity comes from the SDK's id instead of a positional guess.
 *
 * `status` answers "has it stopped running?" and NEVER "did it work?": the
 * dispatch that exposed this seam came back `status: "completed"` moments after
 * the turn guillotine killed it mid-sentence with nothing published. Whether the
 * work actually landed is decided in exactly one place — the output plane, via
 * `reconcileOutcome`.
 */
function readAgentReturn(toolResponse: unknown): { terminal: boolean; agentId?: string } {
  if (!toolResponse || typeof toolResponse !== "object") return { terminal: false };
  const response = toolResponse as { status?: unknown; agentId?: unknown };
  return {
    // Fail SAFE on an unrecognized shape: assume still running. Closing a live
    // dispatch invents an `abandoned` verdict and a retry prompt for work that is
    // succeeding; closing a dead one late costs only lateness, because the `Stop`
    // sweep is the backstop that cannot be skipped.
    terminal: typeof response.status === "string" && isTerminalStatus(response.status),
    ...(typeof response.agentId === "string" ? { agentId: response.agentId } : {}),
  };
}

function continuationDirective(key: string, agentType: string, missing: string[], packet: ContinuationPacket): string {
  const evidence = [
    `attempt ${packet.attempt} of ${MAX_DISPATCH_ATTEMPTS}`,
    `${packet.toolCalls} tool calls`,
    `${packet.files.length} file(s) already mutated on disk`,
    packet.thrashing ? `repeated-failure signal: ${packet.thrashing}` : "no repeated-failure signal",
  ].join("; ");
  const lines = [
    `\`${key}\` DID NOT COMPLETE. It terminated without publishing: ${missing.join(", ")}.`,
    "The text this tool call returned is that agent's last narration, NOT a result. Do not treat it as one, do not summarize it as an outcome, and do not mark the plan row done.",
    `Continuation packet (what it actually did, derived from its tool log): \`${packet.path}\`. Read it before deciding.`,
    `Evidence for the operator: ${evidence}.`,
  ];
  if (packet.exhausted) {
    lines.push(
      `This type has now used all ${MAX_DISPATCH_ATTEMPTS} permitted attempts. Do NOT re-dispatch it. Record the row as a named defect in \`runtime-plan.md\`, naming the missing outputs and the mutated files left on disk, and report it to the user.`,
    );
    return lines.join(" ");
  }
  lines.push(
    "Ask the operator through the HITL tool BEFORE re-dispatching — a continuation costs another full turn budget, and whether one more attempt finishes the work or repeats the failure is not decidable from anything the runtime can observe. Put the evidence above in the question so the operator can judge underscoped vs stuck, and offer: continue, re-scope into smaller rows, or stop and report.",
    `On approval, re-dispatch \`${agentType}\` (the registry mints the next attempt automatically) with a prompt that quotes the continuation packet path, names the already-mutated files as MUST-READ-BEFORE-EDIT, and narrows the task to what is left. Never re-dispatch it with the original prompt unchanged.`,
  );
  return lines.join(" ");
}

export function finalizeAgentOutput(workspace: RunWorkspace, spec: AgentSpec, specs?: Map<string, AgentSpec>, dispatches?: DispatchRegistry): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "Stop" && input.hook_event_name !== "SubagentStop") return {};
    // Observed terminal: this is the signal that lets the waiter's deadline tell a
    // finished agent from a slow one instead of declaring every slow one abandoned.
    if (input.hook_event_name === "SubagentStop") dispatches?.markTerminal(input.agent_id);
    if (input.background_tasks?.length) {
      // Fail-closed backstop for the detached-background delegation path: a
      // background subagent can terminate (finish, hit maxTurns, crash, be
      // cancelled) WITHOUT firing a SubagentStop of its own, so the child's own
      // completion gate never runs. Here the PARENT observes the terminal
      // `background_tasks` status directly and reconciles the child's ledger
      // outcome from its published-output ground truth — the run ledger converges
      // even when the child never announced anything.
      for (const task of input.background_tasks) {
        if (task.agent_type && isTerminalStatus(task.status)) {
          const childSpec = specs?.get(task.agent_type);
          // `BackgroundTaskSummary` carries no agent_id; `id` matches it for
          // subagent tasks, so try that first and fall back to the type's latest
          // dispatch. Marking terminal here is what unblocks a waiter whose child
          // died without ever firing its own SubagentStop.
          const key = dispatches?.keyForAgentId(task.id) ?? dispatches?.soleFor(task.agent_type);
          if (key) dispatches?.markTerminal(key);
          if (childSpec) {
            await reconcileOutcome(workspace, childSpec, key ? { dispatch: key } : {});
          }
        }
      }
      // The root session stays open while any background work is still in flight.
      if (input.hook_event_name === "Stop") {
        const pending = input.background_tasks.filter((task) => !isTerminalStatus(task.status));
        if (pending.length) {
          return {
            decision: "block",
            continue: true,
            stopReason: `Background work is still active: ${pending.map((task) => task.agent_type ?? task.description).join(", ")}`,
            hookSpecificOutput: {
              hookEventName: "Stop",
              additionalContext: `Background delegation is still active. Call mcp__run_context__wait_for_outcome exactly once for ${pending[0]?.agent_type ?? "the delegated agent"}; do not poll read_context or repeatedly attempt to stop.`,
            },
          };
        }
      }
    }
    const activeSpec = input.hook_event_name === "SubagentStop" ? specs?.get(input.agent_type) : spec;
    if (!activeSpec) {
      // Fail CLOSED. Returning `{}` here waved a subagent through with no
      // close-out gate at all whenever its spec could not be resolved — the one
      // path where "no rule matched" silently meant "no rule applies".
      if (input.hook_event_name !== "SubagentStop") return {};
      return {
        decision: "block",
        continue: true,
        stopReason: `Unknown agent type '${input.agent_type}': close-out cannot be verified`,
        hookSpecificOutput: {
          hookEventName: "SubagentStop",
          additionalContext: `Your agent type '${input.agent_type}' is not in the validated agent graph, so the runtime cannot check your required outputs. Publish your required outputs with mcp__run_context__publish_output, then record your outcome.`,
        },
      };
    }
    const activeKey = input.hook_event_name === "SubagentStop"
      ? dispatches?.keyForAgentId(input.agent_id) ?? activeSpec.name
      : activeSpec.name;
    const activeWorkspace = await ensureAgentWorkspace(workspace, activeKey);
    const present = new Set(await readdir(activeWorkspace.output));
    const missing = activeSpec.requiredOutputs.filter((name) => !present.has(name));
    if (!missing.length && input.hook_event_name === "SubagentStop") {
      // Every subagent's ledger entry converges at its OWN stop, from the same
      // output ground truth — not only at the coordinator's seams. Idempotent, so
      // a self-recorded verdict is never clobbered.
      await reconcileOutcome(workspace, activeSpec, { dispatch: activeKey });
    }
    if (!missing.length) {
      // Completeness backstop, run at the LAST possible moment: the root has
      // published everything it owes and this `Stop` is the one that actually
      // ends the run. `background_tasks` covers detached work only, and the
      // `Agent`-return seam covers a synchronous dispatch that returned a
      // terminal result — a child killed in a way that produced neither is
      // still open, and the registry is the only structure that knows it
      // started. So the run refuses to end with a dispatch unaccounted for.
      //
      // Deliberately the narrowest possible trigger. Converging a LIVE agent to
      // `abandoned` is what produces spurious retries and duplicate dispatches,
      // so this fires only when nothing is pending in `background_tasks` AND the
      // root is otherwise free to stop — never on an intermediate, blocked Stop
      // while delegated work may still be in flight.
      if (input.hook_event_name === "Stop" && dispatches && !input.background_tasks?.some((task) => !isTerminalStatus(task.status))) {
        for (const key of dispatches.openKeys()) {
          const orphanSpec = specs?.get(dispatches.typeOf(key) ?? "");
          if (!orphanSpec) continue;
          dispatches.markTerminal(key);
          const result = await reconcileOutcome(workspace, orphanSpec, { dispatch: key });
          if (result.verdict === "abandoned") await writeContinuationPacket(workspace, key, result.missing, dispatches.attemptOf(key));
        }
      }
      return {};
    }
    const eventName = input.hook_event_name;
    return {
      decision: "block",
      continue: true,
      stopReason: `Required outputs missing: ${missing.join(", ")}`,
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: `Completion gate failed. Publish required outputs before stopping: ${missing.join(", ")}`,
      },
    };
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
    if (input.hook_event_name !== "PreToolUse") return {};
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
      return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
    }
    return {};
  };
}

export function requireLoadedGuide(toolAreas: Map<string, string>, loaded: Set<string>): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const area = toolAreas.get(input.tool_name);
    if (!area || loaded.has(area)) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Load the '${area}' tool guide with mcp__run_guide__load_guide before calling ${input.tool_name}`,
      },
    };
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
  const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "deny" as const, permissionDecisionReason: reason } });
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
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
    return {};
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
    if (input.hook_event_name !== "PreToolUse" || interactive) return {};
    const command = meteredSpend(input.tool_name, input.tool_input, meteredTools);
    if (!command) return {};
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `\`${command}\` spends money (X API reads about $0.005 per post, or model calls) and needs the operator's approval, which a headless run cannot collect. Report it as \`blocked\`, with the post count and cost you expected, and let the operator run it.` } };
  };
}

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
    if (input.hook_event_name !== "PreToolUse" || !TICKER_GUARD_TOOLS.has(input.tool_name)) return {};
    if (!TICKER_RESEARCH.test(JSON.stringify(input.tool_input ?? {}))) return {};
    const event = { hook_event_name: "PreToolUse", tool_name: input.tool_name, tool_input: input.tool_input, cwd: typeof input.cwd === "string" ? input.cwd : root };
    const run = spawnSync(python, [resolve(root, TICKER_GUARD)], { input: JSON.stringify(event), cwd: root, encoding: "utf8", timeout: 15_000, env: process.env });
    const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "deny" as const, permissionDecisionReason: reason } });
    // Fail closed: a write into ticker research that cannot be checked does not land.
    if (run.error || run.status !== 0) return deny(`The ticker-research guard could not run (${run.error?.message ?? run.stderr?.trim() ?? `exit ${run.status}`}); this write was not checked, so it was refused.`);
    const out = run.stdout.trim();
    if (!out) return {};
    try { return JSON.parse(out) as ReturnType<typeof deny>; } catch { return deny(`The ticker-research guard returned something that is not JSON: ${out.slice(0, 200)}`); }
  };
}
