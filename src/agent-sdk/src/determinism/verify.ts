import { runScript as spawnScript, type ScriptResult } from "../../assets/tools/script/tool.js";
import type { ScriptSpec } from "../../assets/tools/script/registry.js";
import { hashFile, productsOf, type Duty, type Hash } from "./ledger.js";
import type { PathMap } from "./paths.js";

/**
 * Proves a dispatch's duties at its stop. The question for every deterministic script is the same: are the files on
 * disk exactly what the script produces from the inputs on disk now? A `rerun` contract answers it by re-running and
 * comparing bytes (after first checking nothing touched the products since the script wrote them); a `verify`
 * contract asks the script itself. The runner is injected so tests need not spawn processes.
 */

export type ScriptRunner = (spec: ScriptSpec, input: Record<string, unknown>) => Promise<ScriptResult>;

export interface Finding { script: string; call: string; problem: "edited" | "changed" | "failed"; detail: string; paths: string[] }

const describeCall = (spec: ScriptSpec, input: Record<string, unknown>) =>
  `${spec.name}(${Object.entries(input).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`).join(", ")})`;
const tail = (text: string, max = 1200) => (text.length > max ? `…${text.slice(-max)}` : text);

async function hashes(map: PathMap, paths: string[]): Promise<Map<string, Hash>> {
  const out = new Map<string, Hash>();
  for (const path of paths) out.set(path, await hashFile(map.toDisk(path)));
  return out;
}

async function checkRerun(map: PathMap, duty: Duty, run: ScriptRunner): Promise<Finding[]> {
  const { spec, input } = duty;
  const call = describeCall(spec, input);
  const paths = duty.kind === "run" ? [...duty.products.keys()] : productsOf(spec, input);
  const before = await hashes(map, paths);
  const findings: Finding[] = [];
  if (duty.kind === "run") {
    const edited = paths.filter((path) => duty.products.get(path) !== before.get(path));
    if (edited.length) findings.push({ script: spec.name, call, problem: "edited", paths: edited,
      detail: `changed after ${spec.name} wrote ${edited.length === 1 ? "it" : "them"}. Mechanical outputs are only ever written by their script; put judgment in its own file.` });
  }
  const result = await run(spec, input);
  if (result.isError) return [...findings, { script: spec.name, call, problem: "failed", paths, detail: `re-running it failed:\n${tail(result.text)}` }];
  const after = await hashes(map, paths);
  const changed = paths.filter((path) => before.get(path) !== after.get(path));
  if (changed.length && !findings.length) findings.push({ script: spec.name, call, problem: "changed", paths: changed,
    detail: "re-running it with the same arguments produced different bytes: an input changed after it ran (for example a judgment file it merges), or the script is not deterministic. The files now hold the fresh output; re-run anything that read them." });
  return findings;
}

async function checkVerify(duty: Duty, run: ScriptRunner): Promise<Finding[]> {
  const { spec } = duty;
  const input = { ...duty.input, ...spec.determinism!.verify };
  const result = await run(spec, input);
  if (!result.isError) return [];
  const paths = productsOf(spec, duty.input);
  return [{ script: spec.name, call: describeCall(spec, duty.input), problem: "failed", paths,
    detail: `its own determinism check failed${duty.kind === "obligation" ? ` (required because you wrote ${duty.because})` : ""}:\n${tail(result.text)}` }];
}

/** Checks every duty in order (a dispatch's scripts may feed one another) and returns what failed. */
export async function verifyDuties(map: PathMap, root: string, duties: readonly Duty[], run: ScriptRunner = (spec, input) => spawnScript(spec, input, root)): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const duty of duties) {
    const contract = duty.spec.determinism;
    if (!contract) continue;
    findings.push(...(contract.check === "verify" ? await checkVerify(duty, run) : await checkRerun(map, duty, run)));
  }
  return findings;
}

/** The message a blocked agent reads: each failure, what it means, and what to do. */
export function explain(findings: readonly Finding[]): string {
  return [
    "Your outputs are not deterministic yet, so you cannot stop. Fix each item, then stop again:",
    ...findings.map((f) => `- ${f.call}: ${f.paths.length ? `${f.paths.join(", ")} ` : ""}${f.detail}`),
    "Re-run the script rather than editing its outputs. If a check cannot pass, say why in your final report.",
  ].join("\n");
}
