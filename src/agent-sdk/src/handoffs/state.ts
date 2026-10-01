import { readFile, writeFile } from "node:fs/promises";
import type { RunContext } from "../prompt/model.js";

/**
 * One write chain per ledger file, shared by every `HandoffBus` over that file.
 * `record` is read-merge-write; parallel dispatches of a wave close together, and
 * two unserialized records each rewrite the file from the same stale read — the
 * second silently drops the first dispatch's section.
 */
const writeChains = new Map<string, Promise<unknown>>();

function serialized<T>(file: string, write: () => Promise<T>): Promise<T> {
  const next = (writeChains.get(file) ?? Promise.resolve()).then(write, write);
  writeChains.set(file, next.catch(() => undefined));
  return next;
}

export class HandoffBus {
  constructor(readonly contextFile: string) {}

  async init(request: string, artifactPlane?: string): Promise<void> {
    const planeSection = artifactPlane ? `\n## Artifact Plane\n\n${artifactPlane.trim()}\n` : "";
    await writeFile(this.contextFile, `# Run Context\n\n## Original Request\n\n${request.trim()}\n${planeSection}`, { flag: "wx" });
  }

  async read(): Promise<string> {
    return readFile(this.contextFile, "utf8");
  }

  /**
   * Parse the markdown ledger into the structured {@link RunContext} the prompt
   * assembler feeds into the `<context>` region. The ledger stays markdown (it is
   * the shared human-readable outcome log); this is the one place its `## Original
   * Request` / `## Artifact Plane` / `## <agent>` grammar is read back as data.
   */
  async readRunContext(): Promise<RunContext> {
    const sections = new Map<string, string>();
    for (const chunk of (await this.read()).split(/\n## /).slice(1)) {
      const newline = chunk.indexOf("\n");
      const heading = (newline < 0 ? chunk : chunk.slice(0, newline)).trim();
      sections.set(heading, (newline < 0 ? "" : chunk.slice(newline + 1)).trim());
    }
    const priorOutcomes: RunContext["priorOutcomes"] = [];
    for (const [heading, body] of sections) {
      if (heading === "Original Request" || heading === "Artifact Plane") continue;
      const verdict = body.match(/^- Verdict: (.*)$/m)?.[1];
      const summary = body.match(/^- Summary: (.*)$/m)?.[1];
      const output = body.match(/^- Output dir: (.*)$/m)?.[1];
      priorOutcomes.push({
        agent: heading,
        ...(verdict ? { verdict } : {}),
        ...(summary ? { summary } : {}),
        ...(output ? { output } : {}),
      });
    }
    const artifactPlane = sections.get("Artifact Plane");
    return {
      originalRequest: sections.get("Original Request") ?? "",
      ...(artifactPlane ? { artifactPlane } : {}),
      priorOutcomes,
    };
  }

  // The single, canonical parse of one agent's ledger section. Returns the
  // trimmed `## <agent>` block, or null when the agent has no recorded outcome
  // yet. Shared by the waiter (`wait_for_outcome`) and the reconciler so the
  // heading grammar lives in exactly one place.
  async readAgent(agent: string): Promise<string | null> {
    const current = await this.read();
    const heading = `## ${agent}`;
    const start = current.indexOf(heading);
    if (start < 0) return null;
    const next = current.indexOf("\n## ", start + heading.length);
    return current.slice(start, next < 0 ? undefined : next).trim();
  }

  async record(agent: string, verdict: string, summary: string, outputDirectory: string): Promise<void> {
    return serialized(this.contextFile, () => this.#record(agent, verdict, summary, outputDirectory));
  }

  async #record(agent: string, verdict: string, summary: string, outputDirectory: string): Promise<void> {
    const current = await this.read();
    const heading = `## ${agent}`;
    // `Output dir` + trailing slash, not `Output`: readers were file-reading this
    // pointer and hitting EISDIR. The label names what it is; list it, don't read it.
    const block = `${heading}\n\n- Verdict: ${verdict}\n- Summary: ${summary}\n- Output dir: ${outputDirectory.replace(/\/$/, "")}/\n`;
    const start = current.indexOf(heading);
    if (start < 0) {
      await writeFile(this.contextFile, `${current.trimEnd()}\n\n${block}`);
      return;
    }
    const next = current.indexOf("\n## ", start + heading.length);
    await writeFile(this.contextFile, `${current.slice(0, start)}${block}${next < 0 ? "" : current.slice(next + 1)}`);
  }
}
