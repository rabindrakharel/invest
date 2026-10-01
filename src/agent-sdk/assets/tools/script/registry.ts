import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { fromRepoRoot, fromSdkRoot } from "../../../src/config/paths.js";

export type ScriptParamType = "string" | "number" | "boolean" | "string_list" | "enum";

export interface ScriptParam {
  name: string;
  /** `--flag value`; absent for a positional. */
  flag?: string;
  type: ScriptParamType;
  /** string_list: `comma` joins after the flag, `positional` passes each value as its own argument. */
  list?: "comma" | "positional";
  values?: string[];
  pattern?: string;
  required?: boolean;
  description: string;
}

export interface ScriptSpec {
  name: string;
  family: string;
  description: string;
  run: string[];
  metered?: boolean;
  timeoutSeconds?: number;
  params?: ScriptParam[];
}

/**
 * The registry of script tools (assets/config/scripts.yaml). Validated here so a typo fails
 * `pnpm agents:check`, never mid-run: unique snake_case names, a fixed argv prefix, typed
 * parameters with coherent flag, list and enum declarations.
 */
export async function loadScriptSpecs(): Promise<ScriptSpec[]> {
  const raw = parse(await readFile(fromSdkRoot("assets/config/scripts.yaml"), "utf8")) as { scripts?: ScriptSpec[] };
  const specs = raw.scripts ?? [];
  const names = new Set<string>();
  for (const spec of specs) {
    const where = `scripts.yaml '${spec.name}'`;
    if (!/^[a-z][a-z0-9_]*$/.test(spec.name ?? "")) throw new Error(`${where}: name must be snake_case`);
    if (names.has(spec.name)) throw new Error(`${where}: declared twice`);
    names.add(spec.name);
    if (!spec.family?.trim()) throw new Error(`${where}: no family`);
    if (!spec.description?.trim()) throw new Error(`${where}: no description`);
    if (!Array.isArray(spec.run) || !spec.run.length || !spec.run.every((part) => typeof part === "string" && part.length)) throw new Error(`${where}: run must be a non-empty argv array`);
    if (spec.timeoutSeconds !== undefined && !(spec.timeoutSeconds > 0)) throw new Error(`${where}: invalid timeoutSeconds`);
    const seen = new Set<string>();
    for (const param of spec.params ?? []) {
      const at = `${where} param '${param.name}'`;
      if (!/^[a-z][a-z0-9_]*$/.test(param.name ?? "")) throw new Error(`${at}: name must be snake_case`);
      if (seen.has(param.name)) throw new Error(`${at}: declared twice`);
      seen.add(param.name);
      if (!param.description?.trim()) throw new Error(`${at}: no description`);
      if (!["string", "number", "boolean", "string_list", "enum"].includes(param.type)) throw new Error(`${at}: unknown type '${param.type}'`);
      if (param.type === "boolean" && !param.flag) throw new Error(`${at}: a boolean needs a flag`);
      if (param.type === "enum" && !param.values?.length) throw new Error(`${at}: an enum needs values`);
      if (param.type === "string_list" && param.list !== "comma" && param.list !== "positional") throw new Error(`${at}: a string_list needs list: comma | positional`);
      if (param.list === "comma" && !param.flag) throw new Error(`${at}: a comma list needs a flag`);
      if (param.list === "positional" && param.flag) throw new Error(`${at}: a positional list takes no flag`);
      if (param.pattern) new RegExp(param.pattern);
    }
  }
  return specs;
}

/** The command a script expands to with no parameters, then its parameters as a usage line. */
export function commandLine(spec: ScriptSpec): string {
  const params = (spec.params ?? []).map((param) => {
    const token = param.type === "boolean" ? param.flag! : `${param.flag ? `${param.flag} ` : ""}<${param.name}>${param.type === "string_list" && param.list === "positional" ? "..." : ""}`;
    return param.required ? token : `[${token}]`;
  });
  return [...spec.run, ...params].join(" ");
}

/**
 * Every entry must point at something real: a `pnpm` task that package.json declares, or a script file in the
 * repository. A registry that names a moved or renamed script fails `pnpm agents:check`, not a live run.
 */
export async function assertScriptTargets(specs: ScriptSpec[]): Promise<void> {
  const tasks = new Set(Object.keys((JSON.parse(await readFile(fromRepoRoot("package.json"), "utf8")) as { scripts: Record<string, string> }).scripts));
  for (const spec of specs) {
    const [bin, ...rest] = spec.run;
    if (bin === "pnpm") {
      const task = rest.find((part) => !part.startsWith("-"));
      if (!task || !tasks.has(task)) throw new Error(`scripts.yaml '${spec.name}': pnpm task '${task ?? ""}' is not in package.json`);
    } else if (bin === "python3" || bin === "node") {
      const file = rest[0];
      if (!file || !existsSync(fromRepoRoot(file))) throw new Error(`scripts.yaml '${spec.name}': ${file ?? "(no file)"} does not exist`);
    } else {
      throw new Error(`scripts.yaml '${spec.name}': run must start with pnpm, python3 or node (got '${bin}')`);
    }
  }
}
