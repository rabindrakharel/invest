import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, test } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createFileArtifactSink, sanitizeFragment, wrapArtifact } from "../assets/tools/present/document.js";
import { createPresentServer } from "../assets/tools/present/tool.js";
import { buildToolCatalog } from "../assets/tools/catalog.js";
import { loadAgentGraph } from "../src/agents/catalog.js";
import { EventTranslator, describeTool, type SequencedEvent, type UiEvent } from "../src/web/events.js";
import { WebPrompter } from "../src/web/prompter.js";
import { startServer, type RunningServer } from "../src/web/server.js";
import type { SessionLike } from "../src/web/session.js";

const msg = (value: unknown) => value as SDKMessage;

test("the translator maps a turn: orchestrator text, a dispatch lane that opens and closes, and the result", () => {
  const t = new EventTranslator();
  const out: UiEvent[] = [];
  out.push(...t.translate(msg({ type: "assistant", parent_tool_use_id: null, message: { content: [
    { type: "text", text: "Checking the regime." },
    { type: "tool_use", id: "tu1", name: "Agent", input: { subagent_type: "macro-analyst", description: "score 2026-09-30" } },
  ] } })));
  out.push(...t.translate(msg({ type: "assistant", parent_tool_use_id: "tu1", subagent_type: "macro-analyst", message: { content: [{ type: "tool_use", id: "tu2", name: "mcp__invest__macro_fetch", input: { date: "2026-09-30" } }] } })));
  out.push(...t.translate(msg({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "done", is_error: false }] }, tool_use_result: { totalToolUseCount: 7, totalDurationMs: 42000 } })));
  out.push(...t.translate(msg({ type: "result", subtype: "success", is_error: false, num_turns: 4, duration_ms: 50000, total_cost_usd: 0.42, usage: { input_tokens: 1000, output_tokens: 200 } })));
  assert.deepEqual(out.filter((e) => e.type === "assistant").map((e) => (e as { text: string }).text), ["Checking the regime."]);
  const lanes = out.filter((e): e is Extract<UiEvent, { type: "subagent" }> => e.type === "subagent");
  assert.deepEqual(lanes.map((l) => l.state), ["running", "done"]);
  assert.equal(lanes[1]!.stats, "7 tool uses · 42s");
  const sub = out.find((e) => e.type === "tool" && e.agent === "macro-analyst") as Extract<UiEvent, { type: "tool" }>;
  assert.equal(sub.name, "invest › macro fetch");
  const result = out.at(-1) as Extract<UiEvent, { type: "result" }>;
  assert.deepEqual([result.ok, result.turns, result.costUsd, result.tokensIn, result.tokensOut], [true, 4, 0.42, 1000, 200]);
});

test("a lane still open at the end of the turn is settled, and a failed result carries its error", () => {
  const t = new EventTranslator();
  t.translate(msg({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "x", name: "Agent", input: { subagent_type: "news-scout" } }] } }));
  const events = t.translate(msg({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 80, duration_ms: 1000, result: "hit the turn limit" }));
  assert.equal((events[0] as { state: string }).state, "failed");
  assert.equal((events.at(-1) as { ok: boolean; error?: string }).ok, false);
  assert.equal((events.at(-1) as { error?: string }).error, "hit the turn limit");
});

test("tool descriptions are one line and never carry a long payload", () => {
  assert.equal(describeTool("Bash", { command: "pnpm q corpus-coverage" }).summary, "pnpm q corpus-coverage");
  assert.equal(describeTool("Read", { file_path: "data/x.json" }).label, "Read");
  assert(describeTool("Bash", { command: "x ".repeat(500) }).summary.length <= 140);
  assert.equal(describeTool("mcp__present__show_html", { title: "Regime", html: "<p>big</p>".repeat(1000) }).summary, "Regime");
});

test("HITL: options are validated against what was offered, then the run resumes", async () => {
  const events: UiEvent[] = [];
  const prompter = new WebPrompter((e) => events.push(e));
  const asked = prompter.ask({ source: "question", agent: "chief" }, [
    { question: "Which windows?", options: [{ label: "7d" }, { label: "28d" }, { label: "90d" }], multiSelect: true },
    { question: "Proceed?", options: [{ label: "Yes" }, { label: "No" }] },
  ]);
  const card = events[0] as Extract<UiEvent, { type: "hitl" }>;
  assert.equal(card.kind, "question");
  assert.equal(prompter.answer("unknown", []), false);
  assert.equal(prompter.answer(card.id, [{ picked: ["7d", "365d"] }, { picked: ["Yes"] }]), false, "a label that was not offered");
  assert.equal(prompter.answer(card.id, [{ picked: ["7d"] }, { picked: ["Yes", "No"] }]), false, "two picks for a single-select question");
  assert.equal(prompter.answer(card.id, [{ picked: ["7d"] }]), false, "wrong number of answers");
  assert.equal(prompter.open, 1, "a rejected answer leaves the card open");
  assert.equal(prompter.answer(card.id, [{ picked: ["7d", "28d"] }, { text: "only if the regime is risk-on" }]), true);
  assert.deepEqual(await asked, [
    { question: "Which windows?", answer: "7d, 28d", freeText: false },
    { question: "Proceed?", answer: "only if the regime is risk-on", freeText: true },
  ]);
  assert.deepEqual(events.at(-1), { type: "hitl_done", id: card.id, answered: true });
  assert.equal(prompter.answer(card.id, [{ picked: ["7d"] }, { picked: ["Yes"] }]), false, "answered once only");
});

test("HITL: a permission or spend prompt is typed, and an abort or close cancels it", async () => {
  const events: UiEvent[] = [];
  const prompter = new WebPrompter((e) => events.push(e));
  void prompter.ask({ source: "metered" }, [{ question: "Approve?", options: [{ label: "Approve once" }, { label: "Deny" }] }]).catch(() => undefined);
  void prompter.ask({ source: "permission" }, [{ question: "Allow?", options: [{ label: "Allow once" }] }]).catch(() => undefined);
  assert.deepEqual(events.map((e) => (e as { kind?: string }).kind), ["spend", "permission"]);
  const controller = new AbortController();
  const aborted = prompter.ask({ source: "question" }, [{ question: "q", options: [] }], controller.signal);
  controller.abort();
  await assert.rejects(aborted, /aborted/);
  prompter.cancelAll("closed");
  assert.equal(prompter.open, 0);
});

test("artifacts are locked down: no network, no navigation tags, no handlers, links open out", () => {
  const hostile = `<h1>ok</h1><meta http-equiv="refresh" content="0;url=https://evil.example"><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input></form><img src=x onerror="fetch('https://evil.example')"><a href="javascript:alert(1)">x</a><link rel=stylesheet href="https://evil.example/a.css">`;
  const cleaned = sanitizeFragment(hostile);
  for (const bad of ["<meta", "<iframe", "<form", "onerror", "javascript:", "<link"]) assert(!cleaned.toLowerCase().includes(bad), bad);
  assert(cleaned.includes("<h1>ok</h1>"));
  const doc = wrapArtifact('Q<&>"1', "<p class=\"lede\">hi</p>");
  assert.match(doc, /^<!doctype html>/);
  assert.match(doc, /Content-Security-Policy" content="default-src 'none'/);
  assert.match(doc, /<title>Q&lt;&amp;&gt;&quot;1<\/title>/);
  assert.match(doc, /prefers-color-scheme: dark/, "the design system ships with dark mode");
  assert.match(doc, /invest-artifact-height/);
});

test("show_html saves a numbered page under the run and tells the agent not to repeat it", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "invest-present-"));
  try {
    const sink = createFileArtifactSink(root, root);
    const server = createPresentServer(sink, "chief");
    const tools = (server.instance as unknown as { _registeredTools: Record<string, { handler: (input: unknown, extra: unknown) => Promise<{ content: Array<{ text: string }> }>; inputSchema: { safeParse: (v: unknown) => { success: boolean } } }> })._registeredTools;
    assert(tools.show_html!.inputSchema.safeParse({ title: "T", html: "<p>x</p>" }).success);
    assert(!tools.show_html!.inputSchema.safeParse({ title: "", html: "<p>x</p>" }).success);
    const result = await tools.show_html!.handler({ title: "Regime, 2026-09-30", html: "<p class=lede>Risk-off</p>" }, {});
    assert.match(result.content[0]!.text, /Presented "Regime, 2026-09-30" \(#1\); saved at artifacts\/01-regime-2026-09-30\.html/);
    assert.match(await readFile(resolve(root, "artifacts/01-regime-2026-09-30.html"), "utf8"), /Risk-off/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("only the orchestrators may present", async () => {
  const graph = await loadAgentGraph();
  const holders = [...graph.agents.values()].filter((a) => a.tools.some((t) => t.name === "present")).map((a) => a.name).sort();
  assert.deepEqual(holders, ["chief", "corpus-lead", "runway-lead"]);
  assert.deepEqual((await buildToolCatalog()).groups.get("present")!.toolNames, ["mcp__present__show_html"]);
});

// ------------------------------------------------------------------ the server, with a fake session
class FakeSession implements SessionLike {
  readonly id = "fake-session-1";
  readonly events: SequencedEvent[] = [];
  readonly sent: string[] = [];
  closed = false;
  private listeners = new Set<(e: SequencedEvent) => void>();
  private seq = 0;
  private prompter = new WebPrompter((e) => this.push(e));
  constructor(readonly agent: string) {}
  push(e: UiEvent) { const s = { ...e, seq: ++this.seq, at: "t" } as SequencedEvent; this.events.push(s); for (const l of this.listeners) l(s); }
  subscribe(l: (e: SequencedEvent) => void) { this.listeners.add(l); return () => this.listeners.delete(l); }
  async send(text: string) { this.sent.push(text); this.push({ type: "user", text }); this.push({ type: "artifact", n: 1, title: "Regime" }); }
  answer(id: string, answers: Parameters<WebPrompter["answer"]>[1]) { return this.prompter.answer(id, answers); }
  async interrupt() { this.push({ type: "notice", text: "stopped" }); }
  close() { this.closed = true; }
  artifact(n: number) { return n === 1 ? "<!doctype html><p>page</p>" : undefined; }
  ask() { return this.prompter.ask({ source: "question" }, [{ question: "Pick", options: [{ label: "a" }, { label: "b" }], multiSelect: true }]); }
}

let running: RunningServer;
let fake: FakeSession;
const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  fetch(`${running.url}${path}`, { ...init, headers: { "x-invest-token": running.token, origin: running.url, "content-type": "application/json", ...(init.headers ?? {}) } });

// A tiny data/ tree for the research view: one outlook, one ticker brief, one runway probe, one verdict, two reports.
let dataDir: string;
async function seedData(root: string) {
  const put = async (path: string, body: string) => { await mkdir(resolve(root, path, ".."), { recursive: true }); await writeFile(resolve(root, path), body); };
  await put("reports/INDEX.md", "# Reports\n\n- 2026-09-24 [Market outlook](../research/2026-09-24/outlook/outlook.md) — Lean risk-off\n- 2026-09-25 [NVDA ticker brief](2026-09-25-nvda.md) — Hold\n");
  await put("reports/2026-09-25-nvda.md", "# NVDA ticker brief, 2026-09-25\n\n## Answer\nHold.\n");
  await put("reports/2026-09-26-unindexed.md", "# Memory names, 2026-09-26\n\nMU and $SNDK lead.\n");
  await put("research/2026-09-24/outlook/outlook.md", "# Outlook\n");
  await put("research/2026-09-24/outlook/outlook.json", JSON.stringify({ as_of: "2026-09-24", regime: { call: "Lean risk-off" }, themes: [] }));
  await put("research/2026-09-25/tickers/NVDA.json", JSON.stringify({ ticker: "NVDA", price: { close: 224.58 } }));
  await put("probes/runway/2026-09-24/probe.html", "<!doctype html><p>probe</p>");
  await put("probes/runway/2026-09-24/records/MU.json", JSON.stringify({ ticker: "MU", judgment: { prospect_pts: 7, prospect_why: "HBM" } }));
  await put("probes/runway/2026-09-24/records/scorecard.json", JSON.stringify({ rows: [{ ticker: "MU", tier: "runway", total: 71 }, { ticker: "NVDA", tier: "no_runway", total: 58 }] }));
  await put("ledger/verdicts.jsonl", `${JSON.stringify({ probe: "2026-09-24", ticker: "MU", tier: "runway", total: 71 })}\n`);
  await put("secret.md", "not for the browser");
}

beforeAll(async () => {
  dataDir = await mkdtemp(resolve(tmpdir(), "invest-web-data-"));
  await seedData(dataDir);
  running = await startServer({ port: 0, dataDir, createSession: (agent) => (fake = new FakeSession(agent)) });
});
afterAll(async () => { await running.close(); await rm(dataDir, { recursive: true, force: true }); });

test("the server only answers loopback hosts, and the page carries the launch token", async () => {
  const page = await fetch(running.url, { headers: { host: `127.0.0.1:${running.port}` } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert(html.includes(running.token) && !html.includes("__TOKEN__"));
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal((await fetch(`${running.url}/app.js`)).status, 200);
  assert.equal((await fetch(`${running.url}/styles.css`)).status, 200);
  const rebound = await new Promise<number>((resolveStatus) => {
    import("node:http").then(({ request }) => request({ host: "127.0.0.1", port: running.port, path: "/", headers: { host: "evil.example" } }, (res) => { res.resume(); resolveStatus(res.statusCode ?? 0); }).end());
  });
  assert.equal(rebound, 403, "a DNS-rebinding Host header is refused");
});

test("every API call needs the token, and every write needs a same-origin request", async () => {
  assert.equal((await fetch(`${running.url}/api/agents`)).status, 401);
  assert.equal((await fetch(`${running.url}/api/agents`, { headers: { "x-invest-token": "wrong-token-of-the-same-length-as-real-00000" } })).status, 401);
  assert.equal((await call("/api/agents")).status, 200);
  assert.equal((await call("/api/sessions", { method: "POST", body: "{}", headers: { origin: "https://evil.example" } })).status, 403);
  const noOrigin = await fetch(`${running.url}/api/sessions`, { method: "POST", headers: { "x-invest-token": running.token, "content-type": "application/json" }, body: "{}" });
  assert.equal(noOrigin.status, 403, "a write with no Origin is refused too");
});

test("the agents endpoint lists the orchestrators with their rosters", async () => {
  const body = await (await call("/api/agents")).json() as { default: string; agents: Array<{ name: string; roster: string[] }> };
  assert.equal(body.default, "chief");
  assert.deepEqual(body.agents.map((a) => a.name).sort(), ["chief", "corpus-lead", "runway-lead"]);
  assert(body.agents.find((a) => a.name === "chief")!.roster.includes("macro-analyst"));
});

test("a conversation: create, message, stream with replay, answer a HITL card, fetch the page, close", async () => {
  assert.equal((await call("/api/sessions", { method: "POST", body: JSON.stringify({ agent: "macro-analyst" }) })).status, 400, "a subagent cannot be chatted with");
  const created = await (await call("/api/sessions", { method: "POST", body: JSON.stringify({ agent: "chief" }) })).json() as { id: string };
  assert.equal(created.id, "fake-session-1");
  assert.equal((await call(`/api/sessions/${created.id}`)).status, 200);

  assert.equal((await call(`/api/sessions/${created.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Risk on or off?" }) })).status, 202);
  assert.equal((await call(`/api/sessions/${created.id}/messages`, { method: "POST", body: JSON.stringify({ text: "  " }) })).status, 400);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(fake.sent, ["Risk on or off?"]);

  // The event stream replays what happened before it connected, then delivers live events.
  const stream = await fetch(`${running.url}/api/sessions/${created.id}/events?token=${running.token}&after=1`);
  assert.equal(stream.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const read = async (until: RegExp) => { while (!until.test(text)) { const { value, done } = await reader.read(); if (done) break; text += decoder.decode(value); } };
  await read(/"type":"artifact"/);
  assert(!text.includes('"type":"user"'), "after=1 skips the first event");
  const asking = fake.ask();
  await read(/"type":"hitl"/);
  const card = JSON.parse(/data: (\{"type":"hitl".*)\n/.exec(text)![1]!) as { id: string };

  const bad = await call(`/api/sessions/${created.id}/answer`, { method: "POST", body: JSON.stringify({ id: card.id, answers: [{ picked: ["zzz"] }] }) });
  assert.equal(bad.status, 422);
  const good = await call(`/api/sessions/${created.id}/answer`, { method: "POST", body: JSON.stringify({ id: card.id, answers: [{ picked: ["a", "b"] }] }) });
  assert.equal(good.status, 200);
  assert.deepEqual((await asking)[0]!.answer, "a, b");
  await reader.cancel();

  const page = await call(`/api/sessions/${created.id}/artifacts/1`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /^sandbox allow-scripts/);
  assert.equal((await call(`/api/sessions/${created.id}/artifacts/9`)).status, 404);

  assert.equal((await call(`/api/sessions/${created.id}`, { method: "DELETE" })).status, 200);
  assert.equal(fake.closed, true);
  assert.equal((await call(`/api/sessions/${created.id}`)).status, 404);
});

test("a request body over the limit is refused", async () => {
  const created = await (await call("/api/sessions", { method: "POST", body: "{}" })).json() as { id: string };
  const huge = await call(`/api/sessions/${created.id}/messages`, { method: "POST", body: JSON.stringify({ text: "x".repeat(300_000) }) });
  assert.equal(huge.status, 413);
});

// ------------------------------------------------------------------ the research view (read-only over data/)
test("the research index lists reports (indexed and not), probes, dates, tickers and the ledger", async () => {
  const index = await (await call("/api/research")).json() as { reports: { title: string; path: string }[]; probes: { id: string; page?: string; names?: number }[]; tickers: string[]; verdicts: number; latestOutlook?: string };
  assert.deepEqual(index.reports.map((r) => r.path), ["reports/2026-09-26-unindexed.md", "reports/2026-09-25-nvda.md", "research/2026-09-24/outlook/outlook.md"]);
  assert.equal(index.reports[0]!.title, "Memory names");
  assert.deepEqual(index.probes.map((p) => [p.id, p.page, p.names]), [["2026-09-24", "probes/runway/2026-09-24/probe.html", 1]]);
  assert.deepEqual(index.tickers, ["MU", "NVDA"]);
  assert.equal(index.verdicts, 1);
  assert.equal(index.latestOutlook, "2026-09-24");
  assert.equal(((await (await call("/api/research/outlook")).json()) as { outlook: { regime: { call: string } } }).outlook.regime.call, "Lean risk-off");
});

test("a ticker dossier joins briefs, runway records and scores, verdicts and the reports that mention it", async () => {
  const mu = await (await call("/api/research/tickers/mu")).json() as { ticker: string; runway: { probe: string; record?: unknown; score?: { total: number } }[]; verdicts: unknown[]; reports: { path: string }[] };
  assert.equal(mu.ticker, "MU");
  assert.equal(mu.runway[0]!.score!.total, 71);
  assert(mu.runway[0]!.record);
  assert.equal(mu.verdicts.length, 1);
  assert.deepEqual(mu.reports.map((r) => r.path), ["reports/2026-09-26-unindexed.md"]);
  const nvda = await (await call("/api/research/tickers/NVDA")).json() as { briefs: { date: string }[]; runway: { record?: unknown }[] };
  assert.deepEqual(nvda.briefs.map((b) => b.date), ["2026-09-25"]);
  assert.equal(nvda.runway[0]!.record, undefined);
  assert.equal((await call("/api/research/tickers/not-a-ticker")).status, 404);
});

test("documents: only allowlisted areas and extensions, never a traversal; pages are sandboxed; writes refused", async () => {
  const doc = await (await call(`/api/research/doc?path=${encodeURIComponent("reports/2026-09-25-nvda.md")}`)).json() as { kind: string; body: string };
  assert.equal(doc.kind, "md");
  assert(doc.body.startsWith("# NVDA"));
  for (const path of ["secret.md", "reports/../secret.md", "../package.json", "reports/x.json", "/etc/passwd", "research/2026-09-24/outlook/../../../secret.md"]) {
    assert.equal((await call(`/api/research/doc?path=${encodeURIComponent(path)}`)).status, 400, path);
  }
  assert.equal((await call(`/api/research/doc?path=${encodeURIComponent("reports/missing.md")}`)).status, 404);
  const page = await call(`/api/research/page?path=${encodeURIComponent("probes/runway/2026-09-24/probe.html")}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /^sandbox /);
  assert.equal((await fetch(`${running.url}/api/research`)).status, 401);
  assert.equal((await call("/api/research", { method: "POST", body: "{}" })).status, 405);
  for (const asset of ["/ui.js", "/research.js"]) assert.equal((await fetch(`${running.url}${asset}`)).status, 200);
});
