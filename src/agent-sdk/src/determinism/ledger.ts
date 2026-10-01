import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ScriptSpec } from "../../assets/tools/script/registry.js";
import { pathMap, type PathMap } from "./paths.js";
import { expandTemplate, localToday, templateMatcher } from "./templates.js";

/**
 * What each dispatch did that its determinism contracts must answer for, kept in memory for one run: the deterministic
 * scripts it ran (with the hash of every product right after the run) and the files it wrote that oblige a check.
 * Keyed by dispatch key (`ticker-analyst/2`, or the orchestrator's own name), so parallel instances never share a
 * record. A later run of the same script with the same arguments replaces the earlier one.
 */

export type Hash = string | null;

export interface RunRecord { kind: "run"; spec: ScriptSpec; input: Record<string, unknown>; products: Map<string, Hash> }
export interface Obligation { kind: "obligation"; spec: ScriptSpec; input: Record<string, unknown>; because: string }
export type Duty = RunRecord | Obligation;

/** sha256 of a file's bytes, or null when it does not exist. */
export async function hashFile(path: string): Promise<Hash> {
  try { return createHash("sha256").update(await readFile(path)).digest("hex"); } catch { return null; }
}

/** Repository-relative paths a call writes under its contract. */
export function productsOf(spec: ScriptSpec, input: Record<string, unknown>, today = localToday()): string[] {
  return [...new Set((spec.determinism?.products ?? []).flatMap((template) => expandTemplate(template, input, today)))];
}

/** The call a write to `path` obliges, for every contract whose `obliged_by` matches it. */
export function obligationsFor(path: string, specs: readonly ScriptSpec[]): Obligation[] {
  const out: Obligation[] = [];
  for (const spec of specs) {
    for (const template of spec.determinism?.obliged_by ?? []) {
      const bound = templateMatcher(template)(path);
      if (!bound) continue;
      // A list parameter takes the one value the path names.
      const input = Object.fromEntries(Object.entries(bound).map(([name, value]) => {
        const param = spec.params?.find((p) => p.name === name);
        return [name, param?.type === "string_list" ? [value] : value];
      }));
      out.push({ kind: "obligation", spec, input, because: path });
    }
  }
  return out;
}

const identity = (duty: Duty) => `${duty.kind}:${duty.spec.name}:${JSON.stringify(Object.entries(duty.input).sort(([a], [b]) => a.localeCompare(b)))}`;

export class DeterminismLedger {
  private readonly duties = new Map<string, Map<string, Duty>>();
  private readonly blocks = new Map<string, number>();

  readonly paths: PathMap;

  constructor(readonly root: string, dataDir?: string) {
    this.paths = pathMap(root, dataDir);
  }

  private bucket(key: string): Map<string, Duty> {
    let bucket = this.duties.get(key);
    if (!bucket) this.duties.set(key, (bucket = new Map()));
    return bucket;
  }

  /** Record a finished deterministic run: hash its products now, as the script left them. */
  async recordRun(key: string, spec: ScriptSpec, input: Record<string, unknown>): Promise<RunRecord> {
    const products = new Map<string, Hash>();
    for (const path of productsOf(spec, input)) products.set(path, await hashFile(this.paths.toDisk(path)));
    const record: RunRecord = { kind: "run", spec, input, products };
    this.bucket(key).set(identity(record), record);
    return record;
  }

  oblige(key: string, obligation: Obligation): void {
    this.bucket(key).set(identity(obligation), obligation);
  }

  dutiesOf(key: string): Duty[] {
    return [...(this.duties.get(key)?.values() ?? [])];
  }

  /** Counts the times a dispatch's stop was blocked, so a check that cannot pass does not trap it forever. */
  blocked(key: string): number {
    const n = (this.blocks.get(key) ?? 0) + 1;
    this.blocks.set(key, n);
    return n;
  }

  /** Template form (`data/...` or repository-relative) of a path a tool named, or undefined outside the repository. */
  templatePath(path: string, cwd = this.root): string | undefined {
    return this.paths.toTemplate(path, cwd);
  }
}
