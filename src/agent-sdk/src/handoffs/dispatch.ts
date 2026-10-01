import { stat } from "node:fs/promises";
import type { RunWorkspace } from "../domain/types.js";
import { ensureAgentWorkspace } from "../workspace/run-workspace.js";

/**
 * Per-dispatch identity for delegated agents.
 *
 * The run ledger and the artifact plane used to be keyed by agent TYPE, so a
 * second dispatch of the same type collided with the first: its `wait_for_outcome`
 * resolved instantly against the earlier dispatch's recorded section, and its
 * published outputs overwrote the earlier dispatch's files in a shared `output/`.
 * A retry was therefore unobservable AND destructive.
 *
 * Every delegated dispatch now gets its own key — `<type>/<ordinal>` — which is
 * both the ledger heading and the workspace directory (`{RUN_ROOT}/<type>/<n>/`).
 * The ordinal is assigned at `SubagentStart`, where the SDK hands us the SDK's own
 * `agent_id`; that id is the join key for every later hook on the same dispatch.
 * The root agent is not dispatched, so it keeps its bare name.
 *
 * `/` (not `#`) separates the ordinal on purpose: these paths get pasted into
 * shell commands by agents, and `#` would silently truncate the rest of the line.
 *
 * Several dispatches of ONE type may run at once — an orchestrator fanning five
 * API rows out to five `api-developer` dispatches in one wave. The ordinal is
 * therefore only an identity, never an attempt count: attempts are counted per
 * WORK ITEM, the `name` the orchestrator gave the `Agent` call, and a bare type
 * resolves to a dispatch only while it is unambiguous.
 */
export class DispatchRegistry {
  // SDK agent_id -> dispatch key.
  readonly #keyByAgentId = new Map<string, string>();
  // Agent type -> dispatch keys in launch order.
  readonly #keysByType = new Map<string, string[]>();
  // Dispatch keys observed to have terminated.
  readonly #terminal = new Set<string>();
  readonly #typeByKey = new Map<string, string>();
  // Dispatch key -> the work item (`Agent` call `name`) it was launched for.
  readonly #workItemByKey = new Map<string, string>();
  readonly #root: string;

  constructor(rootAgent: string) {
    // The root agent runs for the whole session and is never re-dispatched.
    this.#root = rootAgent;
    this.#typeByKey.set(rootAgent, rootAgent);
    this.#keysByType.set(rootAgent, [rootAgent]);
  }

  /**
   * Every DELEGATED dispatch this run opened and never observed closing. The
   * registry is the only structure that sees all of them — `background_tasks`
   * lists detached work only, and a synchronous dispatch appears there never —
   * so this is what lets the run refuse to end with a dispatch unaccounted for.
   */
  openKeys(): string[] {
    return [...this.#typeByKey.keys()].filter((key) => key !== this.#root && !this.#terminal.has(key));
  }

  /** Assign (or recall) the dispatch key for one `SubagentStart`. Idempotent. */
  register(agentId: string, agentType: string): string {
    const existing = this.#keyByAgentId.get(agentId);
    if (existing) return existing;
    const siblings = this.#keysByType.get(agentType) ?? [];
    // A re-dispatched root type would collide with the bare root key; ordinals
    // start at 1 and never reuse a slot, so keys are stable for the whole run.
    const key = `${agentType}/${siblings.filter((name) => name !== agentType).length + 1}`;
    this.#keyByAgentId.set(agentId, key);
    this.#keysByType.set(agentType, [...siblings, key]);
    this.#typeByKey.set(key, agentType);
    return key;
  }

  markTerminal(agentIdOrKey: string): void {
    this.#terminal.add(this.#keyByAgentId.get(agentIdOrKey) ?? agentIdOrKey);
  }

  /** Terminal by observation. Unknown keys are NOT terminal — never guess dead. */
  isTerminal(key: string): boolean {
    return this.#terminal.has(key);
  }

  keyForAgentId(agentId: string): string | undefined {
    return this.#keyByAgentId.get(agentId);
  }

  /** The most recent dispatch of a type — its position, never proof of identity. */
  latestFor(agentType: string): string | undefined {
    return this.#keysByType.get(agentType)?.at(-1);
  }

  /** Dispatches of a type that have started and not been observed to terminate. */
  openFor(agentType: string): string[] {
    return (this.#keysByType.get(agentType) ?? []).filter((key) => key !== this.#root && !this.#terminal.has(key));
  }

  /**
   * The ONE dispatch a bare type can safely mean: its only open dispatch, or —
   * when none is open — its latest. Two or more in flight is ambiguous, and
   * guessing closes, waits on, or writes into the wrong sibling.
   */
  soleFor(agentType: string): string | undefined {
    const open = this.openFor(agentType);
    if (open.length > 1) return undefined;
    return open[0] ?? this.latestFor(agentType);
  }

  /** Record the work item (`Agent` call `name`) a dispatch was launched for. First binding wins. */
  bindWorkItem(key: string, workItem: string): void {
    const item = workItem.trim();
    if (item && !this.#workItemByKey.has(key)) this.#workItemByKey.set(key, item);
  }

  workItemOf(key: string): string | undefined {
    return this.#workItemByKey.get(key);
  }

  /**
   * The 1-based attempt this dispatch represents at its work item: how many
   * dispatches of the same type were bound to the same item up to and including
   * it. Unbound dispatches are each their own item — five parallel siblings are
   * five first attempts, never attempts one through five of one row.
   */
  attemptOf(key: string): number {
    const type = this.#typeByKey.get(key);
    const item = this.#workItemByKey.get(key);
    if (!type || !item) return 1;
    const siblings = this.#keysByType.get(type) ?? [];
    return siblings.slice(0, siblings.indexOf(key) + 1).filter((sibling) => this.#workItemByKey.get(sibling) === item).length;
  }

  typeOf(key: string): string | undefined {
    return this.#typeByKey.get(key);
  }

  /**
   * Resolve whatever a caller supplied — a dispatch key, an SDK agent_id, a work
   * item name, or an agent type — to a dispatch key. A type resolves only while
   * it is unambiguous ({@link soleFor}); a work item resolves to its latest attempt.
   */
  resolve(nameOrId: string): string | undefined {
    if (this.#typeByKey.has(nameOrId) && !this.#keysByType.has(nameOrId)) return nameOrId;
    const byId = this.#keyByAgentId.get(nameOrId);
    if (byId) return byId;
    if (this.#keysByType.has(nameOrId)) return this.soleFor(nameOrId);
    let latest: string | undefined;
    for (const [key, item] of this.#workItemByKey) if (item === nameOrId) latest = key;
    return latest;
  }
}

/**
 * Filesystem liveness: the newest mtime across a dispatch's own planes. A worker
 * that published or logged a tool call during the wait is demonstrably alive,
 * whatever it did (or did not) announce — this is what keeps the wait deadline
 * from calling a still-working agent `abandoned`.
 */
export async function lastProgressAt(run: RunWorkspace, key: string): Promise<number> {
  const workspace = await ensureAgentWorkspace(run, key);
  const stamps = await Promise.all(
    [workspace.output, workspace.toolsFile].map((path) => stat(path).then((info) => info.mtimeMs).catch(() => 0)),
  );
  return Math.max(...stamps);
}
