// The invest research desk: a chat with the orchestrator, served from the local server.
// No framework and no network beyond this origin. Model text is rendered through DOM nodes
// (never innerHTML), and presented pages load in a sandboxed frame from their own endpoint.

import { $, api, el, markdown, token } from "./ui.js";
import { hitlCard, markAnswered } from "./hitl.js";
import { mountLogs } from "./logs.js";
import { createOrchestrationMap, plain } from "./orch.js";
import { mountResearch } from "./research.js";

// Front-page starters. `prompt` is what is sent (the title when absent); `featured` spans the row and leads the list.
const DEMO_PROMPT = [
  "Demo of the research desk's subagent architecture. Use today's date and run it in two waves.",
  "Wave 1, in parallel (one message, five dispatches): news-scout collects today's macro news; macro-analyst refreshes the macro data and the risk-on/risk-off regime; theme-analyst runs the theme pulse; sentiment-analyst reads allowlist sentiment from the corpus already on disk (do not refresh the X corpus, it is metered); record-keeper checks the registered verdicts against current prices.",
  "When wave 1 has returned, ask me with a multi-select question which names to brief, offering NVDA, META, MU, AMZN and RKLB.",
  "Wave 2, in parallel: one ticker-analyst per name I pick, each rendering its brief through the template.",
  "Then write one combined report: the regime and risk budget, the three leading and three weakest themes, what the record shows, and a one-line call per name. Ask me before anything costs money.",
].join(" ");
// "Daily brief" opens the prompt on purpose: the harness arms its format gate on it (hooks/daily-brief.ts).
const DAILY_BRIEF_PROMPT = [
  "Daily brief for today's date (intent outlook).",
  "Run state.py --intent outlook and bring only the stale products up to date through their specialists (news, macro data and regime, theme pulse, sentiment from the corpus on disk; do not refresh the X corpus, it is metered).",
  "Then build today's outlook with build_outlook.py, write outlook/judgment.json (summary, top_calls, risks, what_changes) and rerun build_outlook.py so the judgment is embedded.",
  "Your final message is data/research/<DATE>/outlook/outlook.md verbatim, exactly as rendered: no preface, no summary, no page, nothing after it.",
].join(" ");
const SUGGESTIONS = {
  chief: [
    { title: "Demo: the full desk, two waves", hint: "Five specialists in parallel (news, macro, themes, sentiment, record), then a question with checkboxes, then one ticker analyst per name you pick, also in parallel. Watch the orchestration map and the Logs tab.", prompt: DEMO_PROMPT, featured: true },
    { title: "Daily brief", hint: "Today's market outlook in its fixed format: the call and risk budget, the read, top calls, theme stances, archetypes, tilts, dated events and allowlist attention.", prompt: DAILY_BRIEF_PROMPT },
    { title: "Risk on or off?", hint: "The macro regime, the risk budget and what would change it." },
    { title: "Which themes lead?", hint: "Semis, AI infrastructure, biotech, Mag 7 vs the rest: who is accelerating and who is fading." },
    { title: "What about NVDA?", hint: "One name joined across regime, themes, price trend and what the accounts say." },
    { title: "Give me the market outlook", hint: "The full read: a risk budget and a stance for every theme." },
  ],
  "corpus-lead": [
    { title: "Refresh the corpus and re-tier it", hint: "Delta capture (asks before it spends), extraction, then the Corpus Probe." },
    { title: "What are the accounts saying about semis?", hint: "Stances and crowding from the paid X corpus." },
  ],
  "runway-lead": [
    { title: "Which of the corpus picks have runway?", hint: "Rank the Corpus Probe's names on twelve signals with a red-team pass." },
  ],
};

const state = { agents: [], agent: null, id: null, source: null, lastSeq: 0, turn: null, lanes: new Map(), tools: new Map(), hitl: new Map(), state: "idle", open: 0, sending: false };
const orch = createOrchestrationMap($("orch"), { session: () => ({ id: state.id, agent: state.agent, state: state.state, open: state.open }) });

// ---------- thread ----------
const thread = $("thread");
const scroller = $("scroll");
let stick = true;
scroller.addEventListener("scroll", () => { stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140; });
const toBottom = () => { if (stick) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; }); };
const add = (node) => { $("empty")?.remove(); thread.append(node); toBottom(); return node; };

function activity() {
  if (state.turn) return state.turn;
  const steps = el("div", { class: "steps" });
  const summary = el("summary", {}, el("span", { class: "label", text: "Working" }));
  const details = el("details", { class: "work", open: true }, summary, steps);
  add(details);
  state.turn = { details, steps, summary, count: 0 };
  return state.turn;
}
function settleActivity(label) {
  if (!state.turn) return;
  state.turn.summary.querySelector(".label").textContent = `${label} · ${state.turn.count} step${state.turn.count === 1 ? "" : "s"}`;
  state.turn.details.open = false;
  state.turn = null;
}

function setState(next) {
  state.state = next;
  const waiting = state.open > 0 && next !== "closed";
  const pill = $("status");
  pill.className = `pill ${waiting ? "waiting" : next === "running" ? "running" : next === "closed" ? "closed" : "idle"}`;
  pill.textContent = waiting ? "Waiting for you" : next === "running" ? "Working…" : next === "closed" ? "Ended" : "Idle";
  $("stop").hidden = next !== "running";
  $("send").disabled = next === "closed";
  orch.schedule();
}

// ---------- events ----------
function onEvent(event) {
  if (event.seq <= state.lastSeq) return;
  state.lastSeq = event.seq;
  orch.track(event);
  switch (event.type) {
    case "status": setState(event.state); break;
    case "user": state.turn = null; add(el("div", { class: "msg user", text: event.text })); break;
    case "assistant":
      if (event.agent) { const turn = activity(); turn.steps.append(el("div", { class: "say", text: `${event.agent}: ${event.text.length > 260 ? event.text.slice(0, 259) + "…" : event.text}` })); }
      else add(el("div", { class: "msg assistant" }, el("div", { class: "who", text: state.agent }), markdown(event.text)));
      break;
    case "tool": {
      const turn = activity(); turn.count++;
      if (event.name === "dispatch") break; // the lane below says it better
      const row = el("div", { class: `tool${event.agent ? " sub" : ""}` }, el("span", { class: "t", text: `${event.agent ? event.agent + " · " : ""}${event.name}` }), el("span", { class: "s", text: event.summary }));
      state.tools.set(event.id, row); turn.steps.append(row); toBottom();
      break;
    }
    case "tool_result": { const row = state.tools.get(event.id); if (row && event.error) { row.classList.add("err"); row.querySelector(".s").textContent = event.summary || "failed"; } break; }
    case "subagent": {
      const turn = activity();
      let lane = state.lanes.get(event.id);
      if (!lane) {
        lane = el("div", { class: "lane running" }, el("span", { class: "dot" }), el("div", {}, el("div", {}, el("span", { class: "name", text: event.label ?? event.name }), " ", el("span", { class: "desc", text: event.description ?? "" })), el("div", { class: "stats" })));
        state.lanes.set(event.id, lane); turn.steps.append(lane);
      }
      lane.className = `lane ${event.state}`;
      lane.querySelector(".stats").textContent = event.state === "running" ? "running…" : `${event.state}${event.stats ? " · " + plain(event.stats) : ""}`;
      toBottom();
      break;
    }
    case "artifact": add(artifactCard(event)); break;
    case "hitl": {
      const card = hitlCard(event, { submit: (answers) => api(`/api/sessions/${state.id}/answer`, { method: "POST", body: JSON.stringify({ id: event.id, answers }) }) });
      state.hitl.set(event.id, card);
      add(card); state.open++; setState(state.state);
      break;
    }
    case "hitl_done": {
      const card = state.hitl.get(event.id);
      if (card && !card.classList.contains("done")) markAnswered(card, event.answered ? null : "Cancelled");
      state.open = Math.max(0, state.open - 1); setState(state.state);
      break;
    }
    case "result": {
      settleActivity(event.ok ? "Done" : "Stopped");
      const parts = [event.ok ? "Done" : `Ended: ${event.subtype}`, `${event.turns} turns`, `${Math.round(event.durationMs / 1000)}s`];
      if (event.costUsd !== undefined) parts.push(`$${event.costUsd.toFixed(3)}`);
      if (event.tokensIn !== undefined) parts.push(`${fmt(event.tokensIn)} in / ${fmt(event.tokensOut)} out`);
      add(el("div", { class: "result", text: parts.join(" · ") }));
      research.refresh().catch(() => undefined); // the turn may have saved a report
      if (!event.ok && event.error) add(el("div", { class: "banner", text: event.error }));
      break;
    }
    case "error": settleActivity("Failed"); add(el("div", { class: "banner", role: "alert", text: event.message })); break;
    case "notice": add(el("div", { class: "notice", text: event.text })); break;
    case "check": {
      // A determinism check at an agent's stop: a step in the turn when it passes, a visible warning when it gives up.
      const turn = activity();
      turn.steps.append(el("div", { class: `tool${event.ok ? "" : " err"}` }, el("span", { class: "t", text: `${event.agent} · determinism` }),
        el("span", { class: "s", text: event.ok ? "outputs match a fresh run" : event.findings.map((f) => `${f.script}: ${f.problem}`).join("; ") })));
      if (event.gaveUp) add(el("div", { class: "banner", role: "alert", text: `${event.agent} stopped with outputs that are not deterministic: ${event.findings.map((f) => `${f.script} ${f.paths.join(", ")}`).join("; ")}. See Logs for the details.` }));
      break;
    }
  }
}
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ---------- artifacts ----------
// Presented pages report their height from their sandboxed frame; one listener sizes whichever frame sent it.
const frames = new Set();
addEventListener("message", (message) => {
  if (message.data?.type !== "invest-artifact-height") return;
  for (const frame of frames) {
    if (message.source !== frame.contentWindow) continue;
    frame.style.height = `${Math.min(Math.max(Number(message.data.height) || 0, 120) + 4, 3200)}px`;
    toBottom();
  }
});
function artifactCard(event) {
  const base = `/api/sessions/${state.id}/artifacts/${event.n}?token=${token}`;
  const frame = el("iframe", { sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox", src: base, title: event.title, loading: "eager", style: "height:240px" });
  frames.add(frame);
  return el("article", { class: "artifact" },
    el("div", { class: "top" }, el("span", { class: "title", text: event.title }),
      el("span", { class: "tools" }, el("a", { href: base, target: "_blank", rel: "noopener", text: "Open" }), el("a", { href: base, download: `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`, text: "Download" }))),
    event.caption ? el("div", { class: "caption", text: event.caption }) : null, frame);
}

// ---------- conversation lifecycle ----------
function connect(id, after = 0) {
  state.source?.close();
  state.lastSeq = after;
  const source = new EventSource(`/api/sessions/${id}/events?token=${token}&after=${after}`);
  source.onmessage = (message) => onEvent(JSON.parse(message.data));
  source.onerror = () => { if (source.readyState === EventSource.CLOSED) setState("closed"); };
  state.source = source;
}

async function ensureSession() {
  if (state.id) return;
  const { id } = await api("/api/sessions", { method: "POST", body: JSON.stringify({ agent: state.agent }) });
  state.id = id;
  sessionStorage.setItem("invest.session", JSON.stringify({ id, agent: state.agent }));
  connect(id);
}

async function send(text) {
  if (state.sending || !text.trim()) return;
  state.sending = true;
  try {
    await ensureSession();
    await api(`/api/sessions/${state.id}/messages`, { method: "POST", body: JSON.stringify({ text }) });
    $("input").value = ""; autosize();
  } catch (failure) { add(el("div", { class: "banner", role: "alert", text: failure.message })); }
  finally { state.sending = false; }
}

async function reset() {
  const old = state.id;
  state.source?.close(); Object.assign(state, { id: null, source: null, lastSeq: 0, turn: null, open: 0 });
  state.lanes.clear(); state.tools.clear(); state.hitl.clear(); frames.clear();
  orch.reset();
  sessionStorage.removeItem("invest.session");
  if (old) api(`/api/sessions/${old}`, { method: "DELETE" }).catch(() => undefined);
  thread.replaceChildren(emptyState());
  setState("idle");
}

function emptyState() {
  const box = el("section", { id: "empty", class: "empty" },
    el("h1", { text: "What do you want researched?" }),
    el("p", { class: "lede", text: "Ask about the macro regime, thematic leadership, a ticker, or what the book should do. The desk dispatches its specialists, asks you before anything costs money, and answers with a page you can read at a glance." }),
    el("div", { id: "suggestions", class: "suggestions" }), el("p", { class: "fine", text: "Research, not investment advice. Every figure is sourced and dated." }));
  for (const { title, hint, prompt, featured } of SUGGESTIONS[state.agent] ?? []) {
    box.querySelector("#suggestions").append(el("button", { class: `suggestion${featured ? " featured" : ""}`, type: "button", title: prompt ?? title, onclick: () => send(prompt ?? title) },
      featured ? el("span", { class: "tag", text: "Subagent demo" }) : null, el("b", { text: title }), el("span", { text: hint })));
  }
  return box;
}

function autosize() { const input = $("input"); input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }

// ---------- boot ----------
async function boot() {
  const { agents, default: def } = await api("/api/agents");
  state.agents = agents;
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem("invest.session") ?? "null"); } catch { return null; } })();
  state.agent = saved?.agent ?? def;
  const select = $("agent");
  for (const agent of agents) select.append(el("option", { value: agent.name, text: agent.name }));
  select.value = state.agent;
  const describe = () => { $("agent-desc").textContent = agents.find((a) => a.name === state.agent)?.description ?? ""; };
  describe();
  select.addEventListener("change", () => { state.agent = select.value; describe(); reset(); });
  $("new").addEventListener("click", reset);
  $("stop").addEventListener("click", () => api(`/api/sessions/${state.id}/interrupt`, { method: "POST" }).catch(() => undefined));
  $("composer").addEventListener("submit", (event) => { event.preventDefault(); send($("input").value); });
  $("input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send($("input").value); } });
  $("input").addEventListener("input", autosize);
  thread.replaceChildren(emptyState());
  if (saved?.id) {
    try { await api(`/api/sessions/${saved.id}`); state.id = saved.id; thread.replaceChildren(); connect(saved.id); } catch { sessionStorage.removeItem("invest.session"); }
  }
  addEventListener("hashchange", route);
  route();
}

// ---------- views: #/chat (default), #/logs[/…] and #/research[/…] ----------
const logs = mountLogs($("logs"), { currentSession: () => state.id });
const research = mountResearch($("research"), {
  // "Ask the desk" from a dossier or a document: switch to the chat and send the question there.
  ask: (text) => { location.hash = "#/chat"; send(text); },
});
function route() {
  const view = location.hash.startsWith("#/research") ? "research" : location.hash.startsWith("#/logs") ? "logs" : "chat";
  const chat = view === "chat";
  $("scroll").hidden = !chat;
  document.querySelector(".composer-wrap").hidden = !chat;
  $("research").hidden = view !== "research";
  $("logs").hidden = view !== "logs";
  for (const tab of document.querySelectorAll(".tabs a")) tab.setAttribute("aria-current", String(tab.dataset.view === view));
  for (const id of ["stop", "new"]) $(id).classList.toggle("off", !chat);
  document.querySelector(".bar-mid").classList.toggle("off", !chat);
  if (view !== "logs") logs.leave();
  if (view === "research") research.show(location.hash.slice("#/research".length).replace(/^\//, ""));
  else if (view === "logs") logs.show(location.hash.slice("#/logs".length).replace(/^\//, ""));
  else $("input").focus();
}
boot().catch((failure) => add(el("div", { class: "banner", role: "alert", text: `Could not start: ${failure.message}` })));
