import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { createFileArtifactSink, type ArtifactSink } from "../../assets/tools/present/document.js";
import type { AgentGraph } from "../agents/catalog.js";
import { fromRepoRoot } from "../config/paths.js";
import type { RunWorkspace, RuntimeConfig } from "../domain/types.js";
import { buildOptions } from "../orchestrator/build-options.js";
import { buildInitialPrompt, userMessage } from "../orchestrator/run.js";
import { createRunWorkspace } from "../workspace/run-workspace.js";
import { EventTranslator, type SequencedEvent, type UiEvent } from "./events.js";
import { WebPrompter, type WebAnswer } from "./prompter.js";

const MAX_EVENTS = 5000;
const MAX_MESSAGE_CHARS = 20_000;

/** What the server needs from a conversation; tests substitute a fake. */
export interface SessionLike {
  readonly id: string;
  readonly agent: string;
  readonly events: readonly SequencedEvent[];
  subscribe(listener: (event: SequencedEvent) => void): () => void;
  send(text: string): Promise<void>;
  answer(id: string, answers: WebAnswer[]): boolean;
  interrupt(): Promise<void>;
  close(): void;
  artifact(n: number): string | undefined;
  readonly closed: boolean;
}

/** An unbounded async queue: the SDK's streaming input, fed one user message at a time. */
class Inbox {
  private items: string[] = [];
  private waiter: ((value: string | undefined) => void) | undefined;
  private done = false;
  push(text: string): void {
    if (this.waiter) { this.waiter(text); this.waiter = undefined; } else this.items.push(text);
  }
  close(): void { this.done = true; this.waiter?.(undefined); this.waiter = undefined; }
  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    while (true) {
      const next = this.items.shift();
      if (next !== undefined) { yield next; continue; }
      if (this.done) return;
      const value = await new Promise<string | undefined>((resolvePromise) => { this.waiter = resolvePromise; });
      if (value === undefined) return;
      yield value;
    }
  }
}

/**
 * One chat with one orchestrator. The SDK session starts on the first message and then stays open, so a
 * follow-up ("now what about MU?") continues the same run with its context, ledger and dispatch registry.
 * The orchestrator dispatches subagents exactly as it does headless; its questions and approvals come
 * back through {@link WebPrompter}, and what it presents arrives as `artifact` events.
 */
export class ChatSession implements SessionLike {
  readonly id = randomUUID();
  readonly events: SequencedEvent[] = [];
  private readonly listeners = new Set<(event: SequencedEvent) => void>();
  private readonly translator = new EventTranslator();
  private readonly prompter = new WebPrompter((event) => this.emit(event));
  private readonly inbox = new Inbox();
  private readonly artifacts = new Map<number, string>();
  private sdk: Query | undefined;
  private starting: Promise<void> | undefined;
  private seq = 0;
  private _closed = false;

  constructor(readonly agent: string, private readonly config: RuntimeConfig, private readonly graph: AgentGraph) {}

  get closed(): boolean { return this._closed; }

  subscribe(listener: (event: SequencedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: UiEvent): void {
    const sequenced = { ...event, seq: ++this.seq, at: new Date().toISOString() } as SequencedEvent;
    this.events.push(sequenced);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    for (const listener of this.listeners) listener(sequenced);
  }

  async send(text: string): Promise<void> {
    if (this._closed) throw new Error("This conversation is closed");
    const clean = text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!clean) throw new Error("Empty message");
    this.emit({ type: "user", text: clean });
    this.emit({ type: "status", state: "running", agent: this.agent });
    if (!this.sdk) {
      this.starting ??= this.start(clean).catch((error: unknown) => {
        this.emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
        this.close();
      });
      await this.starting;
    } else this.inbox.push(clean);
  }

  private async start(first: string): Promise<void> {
    const spec = this.graph.agents.get(this.agent);
    if (!spec?.orchestrator) throw new Error(`'${this.agent}' is not an orchestrator`);
    const workspace: RunWorkspace = await createRunWorkspace(process.env.AGENT_RUNS_DIR ?? this.config.runsDirectory, this.agent, first);
    const prompt = buildInitialPrompt(workspace, first);
    await writeFile(resolve(workspace.root, "initial-prompt.md"), prompt, "utf8");
    const fileSink = createFileArtifactSink(workspace.root, fromRepoRoot());
    const sink: ArtifactSink = async (artifact) => {
      const published = await fileSink(artifact);
      this.artifacts.set(published.n, published.document);
      this.emit({ type: "artifact", n: published.n, title: artifact.title, ...(artifact.caption ? { caption: artifact.caption } : {}) });
      return published;
    };
    const options = await buildOptions(this.config, spec, workspace, this.prompter, undefined, sink);
    const inbox = this.inbox;
    async function* input() {
      yield userMessage(prompt);
      for await (const text of inbox) yield userMessage(text);
    }
    this.sdk = query({ prompt: input(), options });
    void this.pump(this.sdk);
  }

  private async pump(session: Query): Promise<void> {
    try {
      for await (const message of session) {
        for (const event of this.translator.translate(message)) this.emit(event);
        if (message.type === "result") this.emit({ type: "status", state: "idle", agent: this.agent });
      }
    } catch (error) {
      if (!this._closed) this.emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.close();
    }
  }

  answer(id: string, answers: WebAnswer[]): boolean {
    return this.prompter.answer(id, answers);
  }

  async interrupt(): Promise<void> {
    this.prompter.cancelAll("Interrupted by the operator");
    await this.sdk?.interrupt().catch(() => undefined);
    this.emit({ type: "notice", text: "Stopped the current turn." });
    this.emit({ type: "status", state: "idle", agent: this.agent });
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.prompter.cancelAll("The conversation was closed");
    this.inbox.close();
    this.emit({ type: "status", state: "closed", agent: this.agent });
  }

  artifact(n: number): string | undefined { return this.artifacts.get(n); }
}
