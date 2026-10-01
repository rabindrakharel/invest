import { createInterface, type Interface } from "node:readline/promises";
import { box, colorsEnabled, style } from "../../../src/terminal/ansi.js";

export interface HitlOption { label: string; description?: string | undefined }

export interface HitlQuestion {
  question: string;
  header?: string | undefined;
  options: HitlOption[];
  multiSelect?: boolean | undefined;
}

export interface HitlAnswer { question: string; answer: string; freeText: boolean }

export interface HitlContext { source: string; agent?: string | undefined }

/**
 * What an agent run needs from a human: a yes/no on whether one can answer at all, and a way to put
 * questions to them. The terminal implements it over the TTY; the web UI implements it over the
 * browser. Everything that asks (the question tool, the permission bridge, the metered-spend gate)
 * depends on this, never on a concrete surface.
 */
export interface Prompter {
  readonly interactive: boolean;
  ask(context: HitlContext, questions: HitlQuestion[], signal?: AbortSignal): Promise<HitlAnswer[]>;
}

interface LineWaiter { resolve: (line: string) => void; reject: (error: Error) => void }

/**
 * Serialized dialog surface over the process TTY. All prompts — from the
 * supervisor, any subagent, or the permission bridge — funnel through one
 * instance so concurrent agents never interleave half-rendered dialogs. A
 * single persistent readline interface owns stdin: typed-ahead lines are
 * buffered for the next question instead of being dropped, and EOF rejects
 * pending questions instead of crashing. Call `dispose()` when the run ends
 * so stdin no longer keeps the process alive.
 */
export class TerminalPrompter implements Prompter {
  private queue: Promise<unknown> = Promise.resolve();
  private rl: Interface | undefined;
  private buffered: string[] = [];
  private waiters: LineWaiter[] = [];
  private closed = false;

  constructor(
    private readonly output: NodeJS.WriteStream = process.stdout,
    private readonly input: NodeJS.ReadStream = process.stdin,
    /**
     * Offered every line that no pending question claimed. Returns true when it
     * consumed the line (operator steering); false leaves today's typed-ahead
     * behaviour intact, so a line typed a beat before a question renders still
     * answers that question instead of vanishing into the steering queue.
     *
     * The grammar lives entirely in the handler: this class stays a dumb,
     * serialized terminal and knows nothing about steering syntax.
     */
    private readonly onUnclaimedLine?: (line: string) => boolean,
  ) {}

  /**
   * Start reading stdin now, without waiting for the first question. The
   * readline interface is otherwise created lazily by `ask`, which would mean no
   * steering line is seen until some agent happens to ask something.
   */
  listen(): void {
    if (this.interactive) this.ensureInterface();
  }

  get interactive(): boolean {
    return Boolean(this.input.isTTY) && !this.closed;
  }

  dispose(): void {
    this.closed = true;
    this.rl?.close();
    this.rl = undefined;
  }

  ask(context: HitlContext, questions: HitlQuestion[], signal?: AbortSignal): Promise<HitlAnswer[]> {
    const run = this.queue.then(() => this.prompt(context, questions, signal));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private ensureInterface(): Interface {
    if (this.rl) return this.rl;
    this.rl = createInterface({ input: this.input, output: this.output });
    this.rl.on("line", (line) => {
      const waiter = this.waiters.shift();
      if (waiter) { waiter.resolve(line); return; }
      if (this.onUnclaimedLine?.(line)) return;
      this.buffered.push(line);
    });
    this.rl.on("close", () => {
      this.closed = true;
      for (const waiter of this.waiters.splice(0)) waiter.reject(new Error("Interactive terminal closed"));
    });
    return this.rl;
  }

  private nextLine(signal?: AbortSignal): Promise<string> {
    const buffered = this.buffered.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (this.closed) return Promise.reject(new Error("Interactive terminal closed"));
    this.ensureInterface();
    return new Promise<string>((resolve, reject) => {
      const waiter: LineWaiter = {
        resolve: (line) => { signal?.removeEventListener("abort", onAbort); resolve(line); },
        reject: (error) => { signal?.removeEventListener("abort", onAbort); reject(error); },
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("Question aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private async prompt(context: HitlContext, questions: HitlQuestion[], signal?: AbortSignal): Promise<HitlAnswer[]> {
    if (!this.interactive) throw new Error("No interactive terminal attached (stdin is not a TTY)");
    const enabled = colorsEnabled(this.output);
    const s = (codes: string, text: string) => style(codes, text, enabled);
    const answers: HitlAnswer[] = [];
    for (const question of questions) {
      const title = [s("1;33", "✳ HUMAN INPUT"), context.source, context.agent, question.header]
        .filter(Boolean)
        .join(s("33", " · "));
      const numberWidth = String(question.options.length).length;
      const labelWidth = Math.max(0, ...question.options.map((option) => option.label.length));
      const hint = question.options.length
        ? question.multiSelect
          ? "Pick numbers (comma-separated, e.g. 1,3) or type your own answer"
          : `Pick a number (1-${question.options.length}) or type your own answer`
        : "Type your answer";
      this.output.write("\n" + box([
        s("1", question.question),
        ...(question.options.length ? [""] : []),
        ...question.options.map((option, index) =>
          `  ${s("1;36", `${String(index + 1).padStart(numberWidth)}.`)} ${option.label.padEnd(labelWidth)}${option.description ? s("2", `  ${option.description}`) : ""}`),
        "",
        s("3;2", hint),
      ], { title, width: Math.max(40, Math.min(this.output.columns || 80, 90)), borderCodes: "33", enabled }));
      answers.push(await this.readAnswer(question, enabled, signal));
    }
    return answers;
  }

  private async readAnswer(question: HitlQuestion, enabled: boolean, signal?: AbortSignal): Promise<HitlAnswer> {
    const s = (codes: string, text: string) => style(codes, text, enabled);
    while (true) {
      this.output.write(s("1;33", "❯ "));
      const raw = (await this.nextLine(signal)).trim();
      if (!raw) continue;
      if (!question.options.length) return { question: question.question, answer: raw, freeText: true };
      const picks = raw.split(",").map((part) => part.trim());
      const numeric = picks.every((part) => /^\d+$/.test(part));
      if (!numeric) return { question: question.question, answer: raw, freeText: true };
      const indexes = picks.map(Number);
      if (indexes.some((index) => index < 1 || index > question.options.length)) {
        this.output.write(s("31", `  Enter 1-${question.options.length}, or type a full answer.`) + "\n");
        continue;
      }
      if (!question.multiSelect && indexes.length > 1) {
        this.output.write(s("31", "  This question takes a single choice.") + "\n");
        continue;
      }
      const labels = [...new Set(indexes)].map((index) => question.options[index - 1]!.label);
      this.output.write(s("32", `  ✓ ${labels.join(", ")}`) + "\n");
      return { question: question.question, answer: labels.join(", "), freeText: false };
    }
  }
}
