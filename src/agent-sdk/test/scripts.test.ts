import assert from "node:assert/strict";
import { test } from "vitest";
import { buildToolCatalog, scriptToolName } from "../assets/tools/catalog.js";
import { assertScriptTargets, commandLine, loadScriptSpecs, type ScriptSpec } from "../assets/tools/script/registry.js";
import { buildArgv, createScriptServer, runScript } from "../assets/tools/script/tool.js";
import { loadAgentGraph } from "../src/agents/catalog.js";
import { meteredSpend } from "../src/hooks/policy.js";

const byName = async (name: string) => (await loadScriptSpecs()).find((spec) => spec.name === name)!;

test("the registry loads, and every entry points at a real pnpm task or script file", async () => {
  const specs = await loadScriptSpecs();
  assert(specs.length >= 25);
  await assertScriptTargets(specs);
});

test("every script belongs to a declared family, and every scripts family has tools", async () => {
  const catalog = await buildToolCatalog();
  for (const spec of catalog.scripts) assert(catalog.groups.get(spec.family)?.toolNames.includes(scriptToolName(spec.name)), spec.name);
  for (const family of ["x-api", "corpus-ingest", "corpus-query", "market-data", "analysis", "ledger"]) assert(catalog.groups.get(family)!.toolNames.length > 0, family);
  assert.equal(catalog.groups.get("x-api")!.gated, true);
  assert.equal(catalog.groups.get("ledger")!.gated, true);
});

test("the paid and outward-facing tools are flagged, the free ones are not", async () => {
  const specs = await loadScriptSpecs();
  const metered = specs.filter((spec) => spec.metered).map((spec) => spec.name).sort();
  assert.deepEqual(metered, ["corpus_extract_api", "x_backfill", "x_capture", "x_delta", "x_resolve_accounts"]);
  assert(specs.filter((spec) => spec.family === "x-api").every((spec) => spec.metered), "every x-api tool is metered");
  const set = new Set(metered.map(scriptToolName));
  assert(meteredSpend(scriptToolName("x_capture"), { max_pages: 1 }, set));
  assert.equal(meteredSpend(scriptToolName("corpus_query"), {}, set), undefined);
});

test("least privilege: only corpus-lead holds the X API, only runway-lead the ledger", async () => {
  const graph = await loadAgentGraph();
  const holders = (family: string) => [...graph.agents.values()].filter((a) => a.tools.some((t) => t.name === family)).map((a) => a.name);
  assert.deepEqual(holders("x-api"), ["corpus-lead"]);
  assert.deepEqual(holders("ledger"), ["runway-lead"]);
});

test("argv is the fixed prefix then each parameter in declared order, with no shell", async () => {
  const backfill = await byName("x_backfill");
  assert.deepEqual(buildArgv(backfill, { start: "2026-07-07T00:00:00Z", max_posts: 500, accounts: ["a", "b"], dry_run: true, refetch: false }),
    ["-s", "task:backfill", "--start", "2026-07-07T00:00:00Z", "--max-posts", "500", "--accounts", "a,b", "--dry-run"]);
  const finviz = await byName("finviz_snapshots_fetch");
  assert.deepEqual(buildArgv(finviz, { tickers: ["VST", "AVGO"], pause: 2 }).slice(1), ["--pause", "2", "VST", "AVGO"]);
  assert.match(commandLine(finviz), /\[--pause <pause>\] <tickers>\.\.\./);
});

test("the tool schema rejects flag injection and malformed values", async () => {
  const server = createScriptServer(await loadScriptSpecs());
  const tools = (server.instance as unknown as { _registeredTools: Record<string, { inputSchema: { safeParse: (v: unknown) => { success: boolean } } }> })._registeredTools;
  const ok = (name: string, input: unknown) => tools[name]!.inputSchema.safeParse(input).success;
  assert(ok("corpus_query", { name: "corpus-coverage" }));
  assert(ok("corpus_query", {}), "no name lists the queries");
  assert(!ok("corpus_query", { name: "--json" }), "a leading dash is never a value");
  assert(!ok("corpus_query", { name: "a b; rm -rf /" }), "pattern-checked");
  assert(!ok("macro_fetch", { date: "yesterday" }));
  assert(!ok("macro_fetch", { only: "bloomberg" }));
  assert(ok("macro_fetch", { date: "2026-09-30", only: "fred" }));
  assert(!ok("ticker_context", {}), "a required positional");
  assert(!ok("finviz_snapshots_fetch", { tickers: [] }));
});

test("a registered tool runs the real script and reports the command and exit status", async () => {
  const router = await runScript(await byName("state_router"), { intent: "macro" });
  assert.equal(router.isError, false);
  assert.match(router.text, /^\$ python3 .*state\.py --intent macro\nexit 0\n---\nstate as of /);
  const listing = await runScript(await byName("corpus_query"), {});
  assert.equal(listing.isError, false);
  assert.match(listing.text, /Saved queries:/);
  assert.match(listing.text, /corpus-coverage/);
});

test("a failing or hanging script is an error result, never a hang", async () => {
  const failing: ScriptSpec = { name: "t", family: "f", description: "d", run: ["node", "-e", "console.error('boom'); process.exit(3)"] };
  const result = await runScript(failing, {});
  assert(result.isError);
  assert.match(result.text, /exit 3[\s\S]*boom/);
  const hanging: ScriptSpec = { name: "t", family: "f", description: "d", run: ["node", "-e", "setTimeout(()=>{}, 60000)"], timeoutSeconds: 0.3 };
  const timed = await runScript(hanging, {});
  assert(timed.isError);
  assert.match(timed.text, /timed out/);
  const missing: ScriptSpec = { name: "t", family: "f", description: "d", run: ["definitely-not-a-binary-xyz"] };
  assert((await runScript(missing, {})).isError);
});
