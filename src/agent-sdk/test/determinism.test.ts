import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, test } from "vitest";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { loadScriptSpecs, type ScriptSpec } from "../assets/tools/script/registry.js";
import { buildArgv, parseArgv } from "../assets/tools/script/tool.js";
import { fromRepoRoot } from "../src/config/paths.js";
import { DeterminismLedger, obligationsFor } from "../src/determinism/ledger.js";
import { pathMap } from "../src/determinism/paths.js";
import { scriptCallsIn } from "../src/determinism/shell.js";
import { expandTemplate, templateMatcher } from "../src/determinism/templates.js";
import { verifyDuties, type ScriptRunner } from "../src/determinism/verify.js";
import { enforceDeterministicOutputs, recordDeterministicWork, type DeterminismOutcome } from "../src/hooks/determinism.js";

// ------------------------------------------------------------------ fixtures: a temp repo root with a data/ tree
let root: string;
beforeAll(async () => { root = await mkdtemp(resolve(tmpdir(), "invest-determinism-")); await mkdir(resolve(root, "data/out"), { recursive: true }); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const scorer: ScriptSpec = {
  name: "score", family: "analysis", description: "d", run: ["python3", "tools/score.py"],
  params: [{ name: "date", flag: "--date", type: "string", description: "d" }, { name: "ticker", type: "string", required: true, description: "d" }],
  determinism: { check: "rerun", products: ["data/out/<DATE>-<TICKER:upper>.json"] },
};
const renderer: ScriptSpec = {
  name: "render", family: "analysis", description: "d", run: ["python3", "tools/render.py"],
  params: [{ name: "date", flag: "--date", type: "string", description: "d" }, { name: "verify", flag: "--verify", type: "boolean", description: "d" },
    { name: "tickers", type: "string_list", list: "positional", required: true, description: "d" }],
  determinism: { check: "verify", verify: { verify: true }, obliged_by: ["data/out/<DATE>-<TICKERS:upper>.judgment.json"] },
};
/** A fake script: writes `content(input)` into the scorer's product, or fails a verify run on demand. */
const fakeRunner = (content: (input: Record<string, unknown>) => string, failVerify = false): ScriptRunner => async (spec, input) => {
  if (spec.name === "render") return { text: failVerify ? "differs from a fresh render" : "ok", isError: failVerify };
  await writeFile(resolve(root, `data/out/${String(input.date)}-${String(input.ticker).toUpperCase()}.json`), content(input));
  return { text: "ok", isError: false };
};

// ------------------------------------------------------------------ pure pieces
test("templates expand placeholders, fan out lists, fix case, default DATE, and skip unsupplied optionals", () => {
  assert.deepEqual(expandTemplate("data/<DATE>/<TICKERS:upper>.md", { date: "2026-09-30", tickers: ["meta", "amzn"] }), ["data/2026-09-30/META.md", "data/2026-09-30/AMZN.md"]);
  assert.deepEqual(expandTemplate("data/<DATE>/x.json", {}, "2026-10-01"), ["data/2026-10-01/x.json"]);
  assert.deepEqual(expandTemplate("data/probes/<RUNWAY>/macro.json", { date: "2026-09-30" }), []);
  assert.deepEqual(templateMatcher("data/<DATE>/<TICKERS:upper>.judgment.json")("data/2026-09-30/META.judgment.json"), { date: "2026-09-30", tickers: "META" });
  assert.equal(templateMatcher("data/<DATE>/<TICKERS:upper>.judgment.json")("data/2026-09-30/sub/META.judgment.json"), undefined);
});

test("argv parsing inverts argv building, and refuses an undeclared flag", () => {
  for (const input of [{ date: "2026-09-30", tickers: ["META", "AMZN"] }, { tickers: ["NVDA"], verify: true }]) {
    assert.deepEqual(parseArgv(renderer, buildArgv(renderer, input).slice(renderer.run.length - 1)), input);
  }
  assert.equal(parseArgv(renderer, ["--nope", "META"]), undefined);
});

test("a registered script typed into Bash is recognised, with its arguments, among other statements", () => {
  const calls = scriptCallsIn("cd /repo && INVEST_DATA_DIR=x python3 ./tools/score.py --date 2026-09-30 meta | tail -3; python3 tools/render.py 'META' AMZN --verify; python3 tools/other.py", [scorer, renderer]);
  assert.deepEqual(calls.map((c) => [c.spec.name, c.input]), [["score", { date: "2026-09-30", ticker: "meta" }], ["render", { tickers: ["META", "AMZN"], verify: true }]]);
});

test("a write obliges the contracts whose obliged_by names it, with a list parameter bound to that one value", () => {
  const [duty] = obligationsFor("data/out/2026-09-30-META.judgment.json", [scorer, renderer]);
  assert.deepEqual([duty!.spec.name, duty!.input], ["render", { date: "2026-09-30", tickers: ["META"] }]);
  assert.equal(obligationsFor("data/out/notes.md", [scorer, renderer]).length, 0);
});

test("template paths follow INVEST_DATA_DIR, and paths outside both trees have no template form", () => {
  const map = pathMap("/repo", "/elsewhere/data");
  assert.equal(map.toDisk("data/research/x.json"), "/elsewhere/data/research/x.json");
  assert.equal(map.toDisk("config/themes.json"), "/repo/config/themes.json");
  assert.equal(map.toTemplate("/elsewhere/data/research/x.json"), "data/research/x.json");
  assert.equal(map.toTemplate("src/a.ts", "/repo"), "src/a.ts");
  assert.equal(map.toTemplate("/tmp/x"), undefined);
});

test("the registry rejects a contract that names a non-parameter, re-runs a metered script, or lacks what its check needs", async () => {
  const specs = await loadScriptSpecs();
  const declared = specs.filter((s) => s.determinism).map((s) => `${s.name}:${s.determinism!.check}`);
  assert.deepEqual(declared, ["macro_regime_compute:rerun", "themes_compute:rerun", "sentiment_compute:rerun", "outlook_build:rerun", "ticker_context:rerun", "ticker_brief_render:verify", "scorecard_build:rerun"]);
  assert(specs.filter((s) => s.metered).every((s) => !s.determinism));
});

// ------------------------------------------------------------------ verification
test("rerun: unchanged products pass; a hand edit and a nondeterministic rerun are told apart", async () => {
  const ledger = new DeterminismLedger(root, resolve(root, "data"));
  const input = { date: "2026-09-30", ticker: "meta" };
  await fakeRunner(() => "v1")(scorer, input);
  await ledger.recordRun("a/1", scorer, input);
  assert.deepEqual(await verifyDuties(ledger.paths, root, ledger.dutiesOf("a/1"), fakeRunner(() => "v1")), []);

  await writeFile(resolve(root, "data/out/2026-09-30-META.json"), "hand edit");
  const edited = await verifyDuties(ledger.paths, root, ledger.dutiesOf("a/1"), fakeRunner(() => "v1"));
  assert.deepEqual(edited.map((f) => [f.problem, f.paths]), [["edited", ["data/out/2026-09-30-META.json"]]]);

  await ledger.recordRun("a/1", scorer, input);
  const changed = await verifyDuties(ledger.paths, root, ledger.dutiesOf("a/1"), fakeRunner(() => `v${Math.random()}`));
  assert.deepEqual(changed.map((f) => f.problem), ["changed"]);
});

test("verify: the script's own check decides, and an obligation says which write required it", async () => {
  const ledger = new DeterminismLedger(root, resolve(root, "data"));
  ledger.oblige("t/1", obligationsFor("data/out/2026-09-30-META.judgment.json", [renderer])[0]!);
  assert.deepEqual(await verifyDuties(ledger.paths, root, ledger.dutiesOf("t/1"), fakeRunner(() => "", false)), []);
  const [failed] = await verifyDuties(ledger.paths, root, ledger.dutiesOf("t/1"), fakeRunner(() => "", true));
  assert.equal(failed!.problem, "failed");
  assert.match(failed!.detail, /required because you wrote data\/out\/2026-09-30-META\.judgment\.json/);
});

// ------------------------------------------------------------------ the hooks
const hookInput = (fields: Record<string, unknown>) => ({ session_id: "s", transcript_path: "t", cwd: root, ...fields }) as unknown as HookInput;
const fire = (hook: ReturnType<typeof recordDeterministicWork>, fields: Record<string, unknown>) => hook(hookInput(fields), undefined, { signal: new AbortController().signal });

test("hooks: a run is recorded per dispatch, the stop is blocked with reasons, then released after the block limit", async () => {
  const ledger = new DeterminismLedger(root, resolve(root, "data"));
  const outcomes: DeterminismOutcome[] = [];
  let verifyFails = true;
  const deps = { ledger, specs: [scorer, renderer], rootAgent: "chief", root, maxBlocks: 1, onOutcome: (o: DeterminismOutcome) => { outcomes.push(o); },
    verify: (map: Parameters<typeof verifyDuties>[0], r: string, duties: Parameters<typeof verifyDuties>[2]) => verifyDuties(map, r, duties, fakeRunner(() => "v1", verifyFails)) };
  const record = recordDeterministicWork(deps);
  const enforce = enforceDeterministicOutputs(deps);

  await fire(record, { hook_event_name: "PostToolUse", agent_type: "ticker-analyst", tool_name: "Write", tool_input: { file_path: resolve(root, "data/out/2026-09-30-META.judgment.json") }, tool_response: {} });
  assert.equal(ledger.dutiesOf("ticker-analyst").length, 1);
  assert.deepEqual(await fire(enforce, { hook_event_name: "SubagentStop", agent_type: "other" }), {}, "no duties, no opinion");

  const blocked = await fire(enforce, { hook_event_name: "SubagentStop", agent_type: "ticker-analyst" }) as { decision?: string; hookSpecificOutput?: { additionalContext?: string } };
  assert.equal(blocked.decision, "block");
  assert.match(blocked.hookSpecificOutput?.additionalContext ?? "", /not deterministic yet[\s\S]*render\(/);
  assert.deepEqual(await fire(enforce, { hook_event_name: "SubagentStop", agent_type: "ticker-analyst" }), {}, "released after the limit");
  assert.deepEqual(outcomes.map((o) => [o.key, o.ok, o.gaveUp]), [["ticker-analyst", false, false], ["ticker-analyst", false, true]]);

  verifyFails = false;
  await fire(record, { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "python3 tools/score.py --date 2026-09-30 nvda" }, tool_response: {} });
  assert.equal(ledger.dutiesOf("chief").length, 1, "the orchestrator's own Bash run is recorded under its name");
  await fakeRunner(() => "v1")(scorer, { date: "2026-09-30", ticker: "nvda" });
  await ledger.recordRun("chief", scorer, { date: "2026-09-30", ticker: "nvda" });
  assert.deepEqual(await fire(enforce, { hook_event_name: "Stop" }), {});
  assert.deepEqual(outcomes.at(-1), { key: "chief", ok: true, findings: [], gaveUp: false });
});

test("integration: the real ticker_brief_render contract fails for a judgment with no rendered brief", async () => {
  const data = resolve(root, "realdata");
  await mkdir(resolve(data, "research/2026-09-30/tickers"), { recursive: true });
  const context = { schema: "ticker-context/1", ticker: "META", as_of: "2026-09-30", inputs: {}, themes: [], gaps: [], verdicts: [] };
  await writeFile(resolve(data, "research/2026-09-30/tickers/META.json"), JSON.stringify(context));
  await writeFile(resolve(data, "research/2026-09-30/tickers/META.judgment.json"), JSON.stringify({ schema: "ticker-judgment/1", ticker: "META", as_of: "2026-09-30", verdict: "Hold", horizon: "6 months", answer: "Wait for the print.", departure: null,
    why: { macro_fit: "a", theme_price: "b", allowlist: "c", record: "d" }, changes: [{ date: "2026-10-29", tell: "Q3" }, { date: "2026-11-05", tell: "kill" }] }));
  const previous = process.env.INVEST_DATA_DIR;
  process.env.INVEST_DATA_DIR = data;
  try {
    const specs = await loadScriptSpecs();
    const ledger = new DeterminismLedger(fromRepoRoot(), data);
    const path = ledger.templatePath(resolve(data, "research/2026-09-30/tickers/META.judgment.json"))!;
    for (const o of obligationsFor(path, specs)) ledger.oblige("t/1", o);
    const [finding] = await verifyDuties(ledger.paths, fromRepoRoot(), ledger.dutiesOf("t/1"));
    assert.equal(finding?.script, "ticker_brief_render");
    assert.match(finding?.detail ?? "", /differs from a fresh render: 2026-09-30-meta\.md/);
    // Rendering it satisfies the obligation.
    const { runScript } = await import("../assets/tools/script/tool.js");
    const rendered = await runScript(specs.find((s) => s.name === "ticker_brief_render")!, { date: "2026-09-30", tickers: ["META"] });
    assert.equal(rendered.isError, false, rendered.text);
    assert.deepEqual(await verifyDuties(ledger.paths, fromRepoRoot(), ledger.dutiesOf("t/1")), []);
    assert.match(await readFile(resolve(data, "reports/2026-09-30-meta.md"), "utf8"), /^# META ticker brief, 2026-09-30\n/);
  } finally {
    if (previous === undefined) delete process.env.INVEST_DATA_DIR; else process.env.INVEST_DATA_DIR = previous;
  }
});
