// The orchestration map pinned above the chat: the orchestrator and every subagent dispatch of the current turn,
// live. It reads the same event stream as the thread and owns nothing else; `session()` tells it the conversation's
// id, orchestrator, state and open questions.

import { el } from "./ui.js";

const since = (start, end) => {
  if (!start) return "";
  const s = Math.max(0, Math.round(((end ? Date.parse(end) : Date.now()) - Date.parse(start)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};
export const plain = (text) => String(text ?? "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
const kilo = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n ?? 0));
const fresh = () => ({ turn: 0, turnStart: null, turnEnd: null, tools: 0, lastTool: "", dispatches: new Map(), collapsed: false, foldedForQuestion: false });

export function createOrchestrationMap(box, { session }) {
  let o = fresh();
  let frame = 0;
  const dispatchByLabel = (label) => [...o.dispatches.values()].find((d) => d.label === label);

  function track(event) {
    switch (event.type) {
      case "user": Object.assign(o, { turn: o.turn + 1, turnStart: event.at, turnEnd: null, tools: 0, lastTool: "" }); break;
      case "result": o.turnEnd = event.at; break;
      case "tool": {
        const line = event.summary ? `${event.name}: ${event.summary}` : event.name;
        if (event.lane) { const d = o.dispatches.get(event.lane); if (d) { d.seen = (d.seen ?? 0) + 1; d.tools = Math.max(d.tools, d.seen); d.lastTool = line; } }
        else if (event.name !== "dispatch") { o.tools++; o.lastTool = line; }
        break;
      }
      case "subagent": {
        const d = o.dispatches.get(event.id) ?? { id: event.id, turn: o.turn, tools: 0, tokens: 0, start: event.at };
        Object.assign(d, { name: event.name, state: event.state }, event.label ? { label: event.label } : {}, event.description ? { description: event.description } : {},
          event.tools !== undefined ? { tools: event.tools } : {}, event.tokens !== undefined ? { tokens: event.tokens } : {},
          event.state !== "running" ? { end: event.at, summary: event.stats ?? d.summary } : {});
        o.dispatches.set(event.id, d);
        break;
      }
      case "progress": {
        const d = o.dispatches.get(event.id);
        if (d) Object.assign(d, { tools: event.tools, tokens: event.tokens }, event.lastTool ? { lastTool: event.lastTool } : {}, event.summary ? { summary: event.summary } : {});
        break;
      }
      // A determinism check at an agent's stop: its dispatch key is the label the map shows.
      case "check": { const d = dispatchByLabel(event.agent); if (d) d.check = event.ok ? "ok" : event.gaveUp ? "gave_up" : "blocked"; break; }
      // A question card needs the room: fold the map to its header while the run waits on the operator.
      case "hitl": o.foldedForQuestion = !o.collapsed; o.collapsed = true; break;
      case "hitl_done": if (o.foldedForQuestion && session().open <= 1) { o.collapsed = false; o.foldedForQuestion = false; } break;
      default: return;
    }
    schedule();
  }

  function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); }

  function node(cls, dot, title, meta, detail, href) {
    return el("div", { class: `onode ${cls}` },
      el("span", { class: `dot ${dot}` }),
      el("div", { class: "obody" }, el("div", { class: "otitle" }, title, el("span", { class: "ometa", text: meta })), detail ? el("div", { class: "odetail", text: detail }) : null),
      href ? el("a", { class: "olog", href, title: "Open this agent's log", text: "log" }) : null);
  }

  function render() {
    const s = session();
    const all = [...o.dispatches.values()];
    if (!o.turn && !all.length) { box.hidden = true; return; }
    box.hidden = false;
    const current = all.filter((d) => d.turn === o.turn);
    const earlier = all.length - current.length;
    const count = (state) => current.filter((d) => d.state === state).length;
    const status = s.open > 0 ? "waiting" : s.state === "running" ? "running" : s.state === "closed" ? "closed" : "idle";
    const logHref = (lane) => (s.id ? `#/logs/s/${s.id}/${lane}` : null);
    const head = el("button", { type: "button", class: "ohead", "aria-expanded": String(!o.collapsed), onclick: () => { o.collapsed = !o.collapsed; o.foldedForQuestion = false; render(); } },
      el("span", { class: "ocaret", text: o.collapsed ? "▸" : "▾" }),
      el("b", { text: "Orchestration" }),
      el("span", { class: "ocounts" }, el("span", { class: "c running", text: `${count("running")} running` }), el("span", { class: "c done", text: `${count("done")} done` }),
        count("failed") ? el("span", { class: "c failed", text: `${count("failed")} failed` }) : null),
      el("span", { class: "ometa", text: `turn ${o.turn}${o.turnStart ? ` · ${since(o.turnStart, o.turnEnd)}` : ""}` }));
    const badge = (check) => (check ? el("span", { class: `obadge ${check}`, title: "Determinism check at this agent's stop", text: check === "ok" ? "deterministic" : check === "blocked" ? "fixing outputs" : "not deterministic" }) : null);
    const children = o.collapsed ? [] : [
      node("root", status, el("span", {}, el("b", { text: s.agent }), el("span", { class: "orole", text: " orchestrator" })),
        `${status === "waiting" ? "waiting for you" : status} · ${o.tools} tool call${o.tools === 1 ? "" : "s"}`, o.lastTool ? `last: ${o.lastTool}` : "", logHref("orchestrator")),
      // Running agents first, then finished ones; a finished agent is one line, so the map stays short.
      el("div", { class: "okids" }, [...current].sort((x, y) => Number(y.state === "running") - Number(x.state === "running")).map((d) => node(`kid ${d.state}`, d.state,
        el("span", {}, el("b", { text: d.label ?? d.name }), d.description ? el("span", { class: "orole", text: ` ${d.description}` }) : null, badge(d.check)),
        [d.state === "running" ? since(d.start) : d.end ? since(d.start, d.end) : "", `${d.tools ?? 0} tools`, d.tokens ? `${kilo(d.tokens)} tokens` : ""].filter(Boolean).join(" · "),
        plain(d.summary ?? (d.lastTool ? `last: ${d.lastTool}` : d.state === "running" ? "starting…" : "")), logHref(d.id)))),
      earlier ? el("div", { class: "oearlier", text: `${earlier} dispatch${earlier === 1 ? "" : "es"} in earlier turns · see Logs` }) : null,
    ];
    box.replaceChildren(head, ...children.filter(Boolean));
  }

  // Running timers tick once a second.
  setInterval(() => { if (session().state === "running" && !box.hidden) render(); }, 1000);

  return { track, schedule, reset: () => { o = fresh(); box.hidden = true; } };
}
