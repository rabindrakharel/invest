import { spawn } from "node:child_process";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z, type ZodType } from "zod";
import { fromRepoRoot } from "../../../src/config/paths.js";
import { SCRIPT_SERVER } from "../catalog.js";
import type { ScriptParam, ScriptSpec } from "./registry.js";

const MAX_OUTPUT_CHARS = 24_000;
const DEFAULT_TIMEOUT_SECONDS = 600;

/** A value that could be read as a flag by the script. Numbers are the one legitimate leading `-`. */
const notAFlag = (value: string) => !value.startsWith("-");

function paramSchema(param: ScriptParam): ZodType {
  const text = () => {
    let schema = z.string().min(1).refine(notAFlag, "a value may not start with '-'");
    if (param.pattern) schema = schema.regex(new RegExp(param.pattern), `must match ${param.pattern}`);
    return schema;
  };
  let schema: ZodType;
  switch (param.type) {
    case "string": schema = text(); break;
    case "number": schema = z.number().finite(); break;
    case "boolean": schema = z.boolean(); break;
    case "enum": schema = z.enum(param.values as [string, ...string[]]); break;
    case "string_list": schema = z.array(text()).min(1); break;
  }
  schema = schema.describe(param.description);
  // Optional, never `.default()`: the SDK tool wrapper rejects a call that omits a defaulted field.
  return param.required ? schema : schema.optional();
}

/** The argv a call expands to: the spec's fixed prefix, then each supplied parameter in declared order. */
export function buildArgv(spec: ScriptSpec, input: Record<string, unknown>): string[] {
  const argv = spec.run.slice(1);
  for (const param of spec.params ?? []) {
    const value = input[param.name];
    if (value === undefined || value === null) continue;
    switch (param.type) {
      case "boolean": if (value === true) argv.push(param.flag!); break;
      case "number": argv.push(...(param.flag ? [param.flag] : []), String(value)); break;
      case "string_list":
        if (param.list === "positional") argv.push(...(value as string[]));
        else argv.push(param.flag!, (value as string[]).join(","));
        break;
      default: argv.push(...(param.flag ? [param.flag] : []), String(value));
    }
  }
  return argv;
}

/**
 * The inverse of {@link buildArgv}: the parameters a raw argv (after the spec's fixed prefix) supplies, or undefined
 * when it uses a flag the spec does not declare. Lets a hook recognise a registered script typed into `Bash`.
 */
export function parseArgv(spec: ScriptSpec, argv: readonly string[]): Record<string, unknown> | undefined {
  const params = spec.params ?? [];
  const byFlag = new Map(params.filter((param) => param.flag).map((param) => [param.flag!, param]));
  const positionals = params.filter((param) => !param.flag);
  const input: Record<string, unknown> = {};
  let next = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const flagged = byFlag.get(arg.includes("=") && arg.startsWith("--") ? arg.slice(0, arg.indexOf("=")) : arg);
    if (flagged) {
      if (flagged.type === "boolean") { input[flagged.name] = true; continue; }
      const raw = arg.includes("=") && arg.startsWith("--") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
      if (raw === undefined) return undefined;
      input[flagged.name] = flagged.type === "number" ? Number(raw) : flagged.type === "string_list" ? raw.split(",") : raw;
      continue;
    }
    if (arg.startsWith("-") && !/^-\d/.test(arg)) return undefined;
    const slot = positionals[next];
    if (!slot) return undefined;
    if (slot.type === "string_list") { input[slot.name] = [...((input[slot.name] as string[] | undefined) ?? []), arg]; continue; }
    input[slot.name] = slot.type === "number" ? Number(arg) : arg;
    next++;
  }
  return input;
}

const clip = (text: string): string => text.length <= MAX_OUTPUT_CHARS ? text
  : `${text.slice(0, MAX_OUTPUT_CHARS / 2)}\n... [${text.length - MAX_OUTPUT_CHARS} characters omitted] ...\n${text.slice(-MAX_OUTPUT_CHARS / 2)}`;

export interface ScriptResult { text: string; isError: boolean }

/** Run one script from the repository root with no shell: the argv is passed as an array, so a parameter cannot inject a command. */
export function runScript(spec: ScriptSpec, input: Record<string, unknown>, cwd = fromRepoRoot()): Promise<ScriptResult> {
  const argv = buildArgv(spec, input);
  const shown = [spec.run[0]!, ...argv].join(" ");
  return new Promise((resolve) => {
    const child = spawn(spec.run[0]!, argv, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, (spec.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { out += chunk; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ text: `$ ${shown}\nfailed to start: ${error.message}`, isError: true }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const status = timedOut ? `timed out after ${spec.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS}s` : `exit ${code}`;
      resolve({ text: `$ ${shown}\n${status}\n---\n${clip(out.trim()) || "(no output)"}`, isError: timedOut || code !== 0 });
    });
  });
}

/** One in-process MCP server, `invest`, with one typed tool per registry entry: `mcp__invest__<name>`. */
export function createScriptServer(specs: ScriptSpec[]) {
  return createSdkMcpServer({ name: SCRIPT_SERVER, version: "0.1.0", tools: specs.map((spec) =>
    tool(
      spec.name,
      `${spec.description}${spec.metered ? " METERED: costs money, and the operator must approve each call." : ""}`,
      Object.fromEntries((spec.params ?? []).map((param) => [param.name, paramSchema(param)])),
      async (input) => {
        const result = await runScript(spec, input as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: result.text }], ...(result.isError ? { isError: true } : {}) };
      },
    )) });
}
