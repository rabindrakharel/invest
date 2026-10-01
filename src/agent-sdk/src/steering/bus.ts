import { emitAudit, type AuditEvent } from "../observability.js";

/**
 * Operator steering: human input pushed INTO a live run, at any moment.
 *
 * The complement to `mcp__hitl__ask_user`, which is pull-only — the operator can
 * speak solely when an agent decides to ask. Here the operator initiates.
 *
 * One bus, two delivery routes, because the two addressees are reachable by
 * genuinely different means and nothing can paper over that:
 *
 *  - the ROOT agent is the SDK session itself, so its notes are yielded as
 *    additional `SDKUserMessage`s from the streaming-input generator and arrive
 *    at the next turn boundary;
 *  - a DELEGATED dispatch is a separate, context-isolated session the input
 *    channel cannot address at all, so its notes ride out on the next hook that
 *    fires for that dispatch (`PreToolUse`, before it acts — steering means
 *    redirect, not comment-after-the-fact).
 *
 * Both routes drain the same queue and append to the same `steering.jsonl`, so
 * "what did the human say, to whom, when, and did it land" has one answer.
 */

/** `> note` steers the root; `>@uiux-developer/1 note` steers one dispatch. */
const STEERING_LINE = /^\s*>\s*(?:@([a-z][a-z0-9-]*(?:\/\d+)?)[\s:]+)?(\S[\s\S]*?)\s*$/;

export interface SteeringSubmission {
  /** False when the line was not steering syntax at all — caller keeps it. */
  accepted: boolean;
  /** Dispatch key or agent type; null means the root agent. */
  addressee: string | null;
  text: string;
  /** Set when the line WAS steering syntax but could not be routed. */
  rejection?: string;
}

export class SteeringBus {
  readonly #root: string[] = [];
  readonly #byAddressee = new Map<string, string[]>();
  #wake: (() => void) | undefined;
  #closed = false;
  // Appends are chained, not fired and forgotten: `offer` must stay synchronous
  // (the terminal decides then and there whether it consumed the line), but the
  // steering log is the audit trail for human intervention and must not lose a
  // note to a process that exits first — nor interleave two partial lines.
  #writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly logFile: string,
    /** Agent type names from the validated graph — the only routable addressees. */
    private readonly knownAgents: Set<string>,
    private readonly rootAgent: string,
  ) {}

  /**
   * Offer a raw input line. Returns true when the bus consumed it, so the caller
   * can fall through to its own handling (typed-ahead answers) when it did not.
   * A line that IS steering syntax but names an unknown agent is consumed and
   * reported rather than silently dropped — a steering note that vanishes is
   * worse than one that is refused.
   */
  offer(line: string): SteeringSubmission {
    const match = STEERING_LINE.exec(line);
    if (!match) return { accepted: false, addressee: null, text: line };
    const [, addressee, text] = match;
    const target = addressee ?? null;
    if (target && !this.#isRoutable(target)) {
      return {
        accepted: true, addressee: target, text: text!,
        rejection: `Unknown agent '${target}'. Address one of: ${[...this.knownAgents].sort().join(", ")} (optionally with a dispatch ordinal, e.g. @uiux-developer/2).`,
      };
    }
    if (target === null || target === this.rootAgent) this.#root.push(text!);
    else this.#byAddressee.set(target, [...(this.#byAddressee.get(target) ?? []), text!]);
    this.#append({ event: "steering_submitted", agent: target ?? this.rootAgent, data: { text: text! } });
    this.#wake?.();
    this.#wake = undefined;
    return { accepted: true, addressee: target, text: text! };
  }

  #append(event: AuditEvent): void {
    this.#writes = this.#writes.then(() => emitAudit(this.logFile, event)).catch(() => undefined);
  }

  /** Settle every queued append. Awaited at run end so the log is complete. */
  async flush(): Promise<void> {
    await this.#writes;
  }

  /** An addressee is routable if it names a known agent type, with or without an ordinal. */
  #isRoutable(addressee: string): boolean {
    const type = addressee.split("/")[0]!;
    return type === this.rootAgent || this.knownAgents.has(type);
  }

  /** Notes waiting for the ROOT agent's streaming-input channel. */
  hasPendingForRoot(): boolean {
    return this.#root.length > 0;
  }

  /** Every note submitted but never delivered — reported at run end, never lost. */
  undelivered(): Array<{ addressee: string; text: string }> {
    return [
      ...this.#root.map((text) => ({ addressee: this.rootAgent, text })),
      ...[...this.#byAddressee].flatMap(([addressee, texts]) => texts.map((text) => ({ addressee, text }))),
    ];
  }

  /**
   * Take the notes addressed to one dispatch. A note addressed to a TYPE
   * (`@uiux-developer`) matches whichever dispatch of that type asks first,
   * including one that has not started yet — "tell the next uiux-developer
   * this" is a thing an operator legitimately wants to say. Delivery is
   * exactly-once: drained notes are removed.
   */
  drainFor(dispatchKey: string, agentType?: string): string[] {
    const taken: string[] = [];
    for (const addressee of new Set([dispatchKey, agentType].filter((name): name is string => Boolean(name)))) {
      const queued = this.#byAddressee.get(addressee);
      if (!queued?.length) continue;
      taken.push(...queued);
      this.#byAddressee.delete(addressee);
    }
    if (taken.length) this.#append({ event: "steering_delivered", agent: dispatchKey, data: { notes: taken } });
    return taken;
  }

  /** No further input will arrive; unblocks a generator parked on the queue. */
  close(): void {
    this.#closed = true;
    this.#wake?.();
    this.#wake = undefined;
  }

  /**
   * The root agent's notes, as they arrive. Parks on an empty queue rather than
   * spinning, and drains whatever is still queued at close so a note submitted
   * in the same tick as the final result is delivered rather than dropped.
   */
  async *rootNotes(): AsyncGenerator<string> {
    while (!this.#closed) {
      const next = this.#root.shift();
      if (next !== undefined) {
        this.#append({ event: "steering_delivered", agent: this.rootAgent, data: { notes: [next] } });
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => { this.#wake = resolve; });
    }
    for (let next = this.#root.shift(); next !== undefined; next = this.#root.shift()) {
      this.#append({ event: "steering_delivered", agent: this.rootAgent, data: { notes: [next] } });
      yield next;
    }
  }
}
