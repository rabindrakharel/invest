import { randomUUID } from "node:crypto";
import type { HitlAnswer, HitlContext, HitlQuestion, Prompter } from "../../assets/tools/hitl/terminal.js";
import type { UiEvent } from "./events.js";

/** What the browser sends back for one question: the option labels ticked, or free text. */
export interface WebAnswer { picked?: string[]; text?: string }

interface Pending { questions: HitlQuestion[]; resolve: (answers: HitlAnswer[]) => void; reject: (error: Error) => void }

/**
 * The human-in-the-loop surface for the web chat. An agent's question (the question tool, a permission
 * request, a metered-spend approval) becomes a card in the browser; the run waits on it exactly as it
 * waits on a terminal prompt. Answers are validated against the options that were offered.
 */
export class WebPrompter implements Prompter {
  readonly interactive = true;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly emit: (event: UiEvent) => void) {}

  ask(context: HitlContext, questions: HitlQuestion[], signal?: AbortSignal): Promise<HitlAnswer[]> {
    const id = randomUUID();
    const kind = context.source === "permission" ? "permission" : context.source === "metered" ? "spend" : "question";
    return new Promise<HitlAnswer[]>((resolve, reject) => {
      const close = (answered: boolean) => { if (this.pending.delete(id)) this.emit({ type: "hitl_done", id, answered }); };
      const onAbort = () => { close(false); reject(new Error("Question aborted")); };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        questions,
        resolve: (answers) => { signal?.removeEventListener("abort", onAbort); close(true); resolve(answers); },
        reject: (error) => { signal?.removeEventListener("abort", onAbort); close(false); reject(error); },
      });
      this.emit({ type: "hitl", id, kind, source: context.source, ...(context.agent ? { agent: context.agent } : {}), questions });
    });
  }

  /** Resolve a pending question. Returns false when the id is unknown or the answer is malformed (the card stays open). */
  answer(id: string, answers: WebAnswer[]): boolean {
    const pending = this.pending.get(id);
    if (!pending || !Array.isArray(answers) || answers.length !== pending.questions.length) return false;
    const resolved: HitlAnswer[] = [];
    for (const [index, question] of pending.questions.entries()) {
      const given = answers[index] ?? {};
      const text = typeof given.text === "string" ? given.text.trim().slice(0, 4000) : "";
      const picked = Array.isArray(given.picked) ? given.picked.filter((label): label is string => typeof label === "string") : [];
      if (text) { resolved.push({ question: question.question, answer: text, freeText: true }); continue; }
      const offered = new Set(question.options.map((option) => option.label));
      const unique = [...new Set(picked)];
      if (!unique.length || unique.some((label) => !offered.has(label)) || (!question.multiSelect && unique.length > 1)) return false;
      resolved.push({ question: question.question, answer: unique.join(", "), freeText: false });
    }
    pending.resolve(resolved);
    return true;
  }

  /** Reject everything outstanding: the session ended or was interrupted. */
  cancelAll(reason: string): void {
    for (const pending of [...this.pending.values()]) pending.reject(new Error(reason));
  }

  get open(): number { return this.pending.size; }
}
