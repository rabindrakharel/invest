// The invest research desk: a chat with the orchestrator, served from the local server.
// No framework and no network beyond this origin. Model text is rendered through DOM nodes
// (never innerHTML), and presented pages load in a sandboxed frame from their own endpoint.

import { $, api, el, markdown, token } from "./ui.js";
import { mountResearch } from "./research.js";

const SUGGESTIONS = {
  chief: [
    ["Risk on or off?", "The macro regime, the risk budget and what would change it."],
    ["Which themes lead?", "Semis, AI infrastructure, biotech, Mag 7 vs the rest: who is accelerating and who is fading."],
    ["What about NVDA?", "One name joined across regime, themes, price trend and what the accounts say."],
    ["Give me the market outlook", "The full read: a risk budget and a stance for every theme."],
  ],
  "corpus-lead": [
    ["Refresh the corpus and re-tier it", "Delta capture (asks before it spends), extraction, then the Corpus Probe."],
    ["What are the accounts saying about semis?", "Stances and crowding from the paid X corpus."],
  ],
  "runway-lead": [
    ["Which of the corpus picks have runway?", "Rank the Corpus Probe's names on twelve signals with a red-team pass."],
  ],
};

const state = { agents: [], agent: null, id: null, source: null, lastSeq: 0, turn: null, lanes: new Map(), tools: new Map(), hitl: new Map(), state: "idle", open: 0, sending: false };

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
}

// ---------- events ----------
function onEvent(event) {
  if (event.seq <= state.lastSeq) return;
  state.lastSeq = event.seq;
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
        lane = el("div", { class: "lane running" }, el("span", { class: "dot" }), el("div", {}, el("div", {}, el("span", { class: "name", text: event.name }), " ", el("span", { class: "desc", text: event.description ?? "" })), el("div", { class: "stats" })));
        state.lanes.set(event.id, lane); turn.steps.append(lane);
      }
      lane.className = `lane ${event.state}`;
      lane.querySelector(".stats").textContent = event.state === "running" ? "running…" : `${event.state}${event.stats ? " · " + event.stats : ""}`;
      toBottom();
      break;
    }
    case "artifact": add(artifactCard(event)); break;
    case "hitl": add(hitlCard(event)); state.open++; setState(state.state); break;
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
  }
}
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ---------- human in the loop ----------
function hitlCard(event) {
  const kindLabel = { question: "Needs your input", permission: "Permission", spend: "Spends money" }[event.kind];
  const form = el("form", { class: `hitl ${event.kind}` });
  form.append(el("div", { class: "head" }, el("span", { class: "tag", text: kindLabel }), event.agent ? el("span", { class: "from", text: `from ${event.agent}` }) : null));
  const fields = event.questions.map((question, qi) => {
    const group = el("fieldset", {}, el("legend", { text: question.header ? `${question.header}: ${question.question}` : question.question }));
    const multi = Boolean(question.multiSelect);
    const name = `q${event.id}-${qi}`;
    question.options.forEach((option) => {
      group.append(el("label", { class: "opt" }, el("input", { type: multi ? "checkbox" : "radio", name, value: option.label }), el("span", {}, el("span", { class: "l", text: option.label }), option.description ? el("span", { class: "d", text: option.description }) : null)));
    });
    const other = el("input", { class: "other", type: "text", placeholder: question.options.length ? "Or type something else…" : "Type your answer…", "aria-label": "Your own answer", maxlength: "4000" });
    group.append(other);
    return { question, name, other, multi, group };
  });
  const error = el("span", { class: "err", role: "alert" });
  const submit = el("button", { class: `btn ${event.kind === "spend" ? "danger" : "primary"}`, type: "submit", text: event.kind === "spend" ? "Submit decision" : "Submit" });
  for (const field of fields) form.append(field.group);
  form.append(el("div", { class: "actions" }, submit, error));
  form.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const answers = fields.map((field) => {
      const picked = [...form.querySelectorAll(`input[name="${field.name}"]:checked`)].map((input) => input.value);
      const text = field.other.value.trim();
      return text ? { text } : { picked };
    });
    if (answers.some((answer) => !answer.text && !answer.picked.length)) { error.textContent = "Choose an option or type an answer."; return; }
    submit.disabled = true; error.textContent = "";
    try {
      await api(`/api/sessions/${state.id}/answer`, { method: "POST", body: JSON.stringify({ id: event.id, answers }) });
      markAnswered(form, answers.map((answer) => answer.text ?? answer.picked.join(", ")).join(" · "));
    } catch (failure) { submit.disabled = false; error.textContent = failure.message; }
  });
  state.hitl.set(event.id, form);
  setTimeout(() => form.querySelector("input")?.focus({ preventScroll: true }), 50);
  return form;
}
function markAnswered(card, summary) {
  card.className = "hitl done";
  card.replaceChildren(el("span", { text: summary === null ? "Answered." : summary === "Cancelled" ? "Cancelled." : `Answered: ${summary}` }));
}

// ---------- artifacts ----------
function artifactCard(event) {
  const base = `/api/sessions/${state.id}/artifacts/${event.n}?token=${token}`;
  const frame = el("iframe", { sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox", src: base, title: event.title, loading: "eager", style: "height:240px" });
  const card = el("article", { class: "artifact" },
    el("div", { class: "top" }, el("span", { class: "title", text: event.title }),
      el("span", { class: "tools" }, el("a", { href: base, target: "_blank", rel: "noopener", text: "Open" }), el("a", { href: base, download: `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`, text: "Download" }))),
    event.caption ? el("div", { class: "caption", text: event.caption }) : null, frame);
  addEventListener("message", (message) => {
    if (message.source !== frame.contentWindow || message.data?.type !== "invest-artifact-height") return;
    frame.style.height = `${Math.min(Math.max(Number(message.data.height) || 0, 120) + 4, 3200)}px`;
    toBottom();
  });
  return card;
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
  state.lanes.clear(); state.tools.clear(); state.hitl.clear();
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
  for (const [title, hint] of SUGGESTIONS[state.agent] ?? []) box.querySelector("#suggestions").append(el("button", { class: "suggestion", type: "button", onclick: () => send(title) }, el("b", { text: title }), el("span", { text: hint })));
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

// ---------- views: #/chat (default) and #/research[/…] ----------
const research = mountResearch($("research"), {
  // "Ask the desk" from a dossier or a document: switch to the chat and send the question there.
  ask: (text) => { location.hash = "#/chat"; send(text); },
});
function route() {
  const onResearch = location.hash.startsWith("#/research");
  $("scroll").hidden = onResearch;
  document.querySelector(".composer-wrap").hidden = onResearch;
  $("research").hidden = !onResearch;
  for (const tab of document.querySelectorAll(".tabs a")) tab.setAttribute("aria-current", String(tab.dataset.view === (onResearch ? "research" : "chat")));
  for (const id of ["stop", "new"]) $(id).classList.toggle("off", onResearch);
  document.querySelector(".bar-mid").classList.toggle("off", onResearch);
  if (onResearch) research.show(location.hash.slice("#/research".length).replace(/^\//, ""));
  else $("input").focus();
}
boot().catch((failure) => add(el("div", { class: "banner", role: "alert", text: `Could not start: ${failure.message}` })));
