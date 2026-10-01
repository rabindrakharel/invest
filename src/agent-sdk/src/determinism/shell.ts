import type { ScriptSpec } from "../../assets/tools/script/registry.js";
import { parseArgv } from "../../assets/tools/script/tool.js";

/**
 * Registered scripts invoked by hand in a shell command (`cd x && python3 src/.../compute_regime.py --date D`), so a
 * script run through `Bash` is held to the same contract as one run through its MCP tool. Deliberately modest: it
 * splits on the shell's statement separators and honours quotes; anything it cannot parse is ignored, never guessed.
 */

/** Words of one shell statement, with single and double quotes honoured. */
function words(statement: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  let any = false;
  for (const char of statement) {
    if (quote) { if (char === quote) quote = null; else current += char; continue; }
    if (char === "'" || char === "\"") { quote = char; any = true; continue; }
    if (/\s/.test(char)) { if (current || any) out.push(current); current = ""; any = false; continue; }
    current += char;
  }
  if (current || any) out.push(current);
  return out;
}

const normalise = (path: string) => path.replace(/^\.\//, "");

export interface ScriptCall { spec: ScriptSpec; input: Record<string, unknown> }

export function scriptCallsIn(command: string, specs: readonly ScriptSpec[]): ScriptCall[] {
  const calls: ScriptCall[] = [];
  for (const statement of command.split(/&&|\|\||[;|\n]/)) {
    const argv = words(statement.trim());
    // Skip leading environment assignments (`INVEST_DATA_DIR=x python3 ...`).
    while (argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]!)) argv.shift();
    if (argv.length < 2) continue;
    for (const spec of specs) {
      const [bin, file] = spec.run;
      if (bin !== argv[0] || !file || !(normalise(argv[1]!) === file || normalise(argv[1]!).endsWith(`/${file}`))) continue;
      const input = parseArgv(spec, argv.slice(spec.run.length));
      if (input) calls.push({ spec, input });
    }
  }
  return calls;
}
