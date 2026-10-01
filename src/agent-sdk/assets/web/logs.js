// The Logs tab: a verbose, filterable log of one session (live, streamed) or one past run (read from its
// workspace), split by agent: the orchestrator and each subagent dispatch, parallel instances apart.
// Routes (after #/logs/): "" the current chat, else s/<session id>[/<lane>] or r/<run id>[/<lane>].

import { api, el, token } from "./ui.js";

const KINDS = [["messages", "Messages"], ["tools", "Tool calls"], ["results", "Results"], ["thinking", "Thinking"], ["orchestration", "Orchestration"], ["system", "System"]];
const kindOf = (e) => ({ assistant: "messages", user: "messages", thinking: "thinking", tool: "tools", tool_result: "results", subagent: "orchestration", progress: "orchestration", hitl: "orchestration", hitl_done: "orchestration", artifact: "orchestration", result: "system", status: "system", system: "system", notice: "system", error: "system" })[e.type] ?? "system";
const clock = (at) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? "" : `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`; };
const secs = (ms) => (ms === undefined ? "" : ms >= 60000 ? `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s` : `${Math.round(ms / 1000)}s`);

export function mountLogs(root, { currentSession }) {
  const model = { key: null, live: null, agent: "", events: [], lanes: new Map(), filter: { lane: "all", text: "", kinds: new Set(KINDS.map(([k]) => k)), errors: false }, follow: true };
  let source = null;
  const side = el("aside", { class: "lside" });
  const toolbar = el("div", { class: "ltools" });
  const list = el("div", { class: "llist", role: "log", "aria-live": "off" });
  const main = el("div", { class: "lmain" }, toolbar, list);
  root.append(side, main);
  list.addEventListener("scroll", () => { model.follow = list.scrollHeight - list.scrollTop - list.clientHeight < 80; followBox.checked = model.follow; });

  // ---------- the model: every event, and one lane per dispatch ----------
  function lane(id) {
    if (!model.lanes.has(id)) model.lanes.set(id, { id, label: id.slice(0, 10), name: "", description: "", state: "running", count: 0, tools: 0, errors: 0, start: null, end: null, stats: "" });
    return model.lanes.get(id);
  }
  function absorb(e) {
    if (e.type === "status" && !model.agent) model.agent = e.agent;
    if (e.type === "subagent") {
      const l = lane(e.id);
      Object.assign(l, { name: e.name, state: e.state }, e.label ? { label: e.label } : {}, e.description ? { description: e.description } : {}, e.stats ? { stats: e.stats } : {});
      if (e.state === "running") l.start ??= e.at; else l.end = e.at;
    }
    if (e.lane) { const l = lane(e.lane); l.count++; if (e.type === "tool") l.tools++; if (e.type === "tool_result" && e.error) l.errors++; }
    if (e.type === "progress") { const l = lane(e.id); l.tools = Math.max(l.tools, e.tools); }
  }
  const owner = (e) => e.lane ?? ((e.type === "subagent" || e.type === "progress") ? e.id : null);
  const who = (e) => { const id = owner(e); return id ? (model.lanes.get(id)?.label ?? e.agent ?? "subagent") : (model.agent || "orchestrator"); };
  const matches = (e) => {
    const f = model.filter;
    const id = owner(e);
    if (f.lane === "orchestrator" ? (id && e.type !== "subagent") : f.lane !== "all" && id !== f.lane) return false;
    if (!f.kinds.has(kindOf(e))) return false;
    if (f.errors && !(e.type === "error" || (e.type === "tool_result" && e.error) || (e.type === "subagent" && e.state === "failed") || (e.type === "result" && !e.ok))) return false;
    if (f.text) { const hay = JSON.stringify(e).toLowerCase(); if (!hay.includes(f.text)) return false; }
    return true;
  };

  // ---------- one row per event ----------
  function line(e) {
    switch (e.type) {
      case "user": return ["you", e.text];
      case "assistant": return ["says", e.text];
      case "thinking": return ["thinks", e.text];
      case "tool": return [e.name, e.summary];
      case "tool_result": return [e.error ? "error" : "result", e.summary || "(empty)"];
      case "subagent": return [`subagent ${e.state}`, [e.label ?? e.name, e.description, e.stats].filter(Boolean).join(" · ")];
      case "progress": return ["progress", [`${e.tools} tools`, `${Math.round(e.tokens / 1000)}k tokens`, secs(e.durationMs), e.lastTool && `last: ${e.lastTool}`, e.summary].filter(Boolean).join(" · ")];
      case "hitl": return [`asks (${e.kind})`, e.questions.map((q) => q.question).join(" | ")];
      case "hitl_done": return ["answered", e.answered ? "answered" : "cancelled"];
      case "artifact": return ["presents", e.title];
      case "result": return [e.ok ? "turn done" : "turn failed", [`${e.turns} turns`, secs(e.durationMs), e.costUsd !== undefined && `$${e.costUsd.toFixed(3)}`, e.tokensIn !== undefined && `${e.tokensIn} in / ${e.tokensOut} out`, e.error].filter(Boolean).join(" · ")];
      case "status": return ["status", e.state];
      case "system": return ["system", e.text];
      case "notice": return ["notice", e.text];
      case "error": return ["error", e.message];
      default: return [e.type, ""];
    }
  }
  function details(e) {
    const blocks = [];
    if (e.type === "tool" && e.input) blocks.push(["input", e.input]);
    if (e.type === "tool_result" && e.output) blocks.push(["output", e.output]);
    if (e.type === "subagent" && e.prompt) blocks.push(["dispatch brief", e.prompt]);
    if ((e.type === "assistant" || e.type === "thinking" || e.type === "user") && e.text.length > 160) blocks.push(["text", e.text]);
    if (e.type === "system" && e.detail) blocks.push(["detail", e.detail]);
    if (e.type === "hitl") blocks.push(["questions", JSON.stringify(e.questions, null, 2)]);
    return blocks;
  }
  function row(e) {
    const [verb, text] = line(e);
    const bad = e.type === "error" || (e.type === "tool_result" && e.error) || (e.type === "subagent" && e.state === "failed") || (e.type === "result" && !e.ok);
    const id = owner(e);
    const head = el("div", { class: "lhead" },
      el("span", { class: "lt", text: clock(e.at) }),
      el("span", { class: `lwho ${id ? "sub" : "root"}`, text: who(e), title: id ?? "" }),
      el("span", { class: `lverb k-${kindOf(e)}`, text: verb }),
      el("span", { class: "ltext", text: String(text ?? "").replace(/\s+/g, " ").slice(0, 400) }));
    const blocks = details(e);
    if (!blocks.length) return el("div", { class: `lrow${bad ? " bad" : ""}` }, head);
    return el("details", { class: `lrow${bad ? " bad" : ""}` }, el("summary", {}, head), blocks.map(([label, body]) => el("div", { class: "lblock" }, el("div", { class: "llabel", text: label }), el("pre", { text: body }))));
  }

  // ---------- rendering ----------
  const followBox = el("input", { type: "checkbox", checked: true, onchange: () => { model.follow = followBox.checked; if (model.follow) list.scrollTop = list.scrollHeight; } });
  function renderToolbar() {
    const search = el("input", { type: "search", class: "lsearch", placeholder: "Filter text, tool, path…", value: model.filter.text, oninput: (ev) => { model.filter.text = ev.target.value.trim().toLowerCase(); renderList(); } });
    toolbar.replaceChildren(search,
      el("div", { class: "lkinds" }, KINDS.map(([k, label]) => el("label", { class: "lk" }, el("input", { type: "checkbox", checked: model.filter.kinds.has(k), onchange: (ev) => { ev.target.checked ? model.filter.kinds.add(k) : model.filter.kinds.delete(k); renderList(); } }), label)),
        el("label", { class: "lk" }, el("input", { type: "checkbox", checked: model.filter.errors, onchange: (ev) => { model.filter.errors = ev.target.checked; renderList(); } }), "Errors only"),
        el("label", { class: "lk" }, followBox, "Follow")),
      el("button", { class: "btn ghost small", type: "button", onclick: download }, "Download .jsonl"));
  }
  function renderSide(sources) {
    const lanes = [...model.lanes.values()];
    const running = lanes.filter((l) => l.state === "running").length;
    const orchCount = model.events.filter((e) => !owner(e)).length;
    const pick = (value) => () => { model.filter.lane = value; renderSide(sources); renderList(); };
    const item = (value, label, sub, state, count) => el("button", { type: "button", class: `lagent${model.filter.lane === value ? " on" : ""}`, onclick: pick(value) },
      el("span", { class: `dot ${state ?? ""}` }), el("span", { class: "nm" }, el("b", { text: label }), sub ? el("span", { class: "sub", text: sub }) : null), el("span", { class: "ct", text: String(count) }));
    side.replaceChildren(
      sources ?? side.querySelector(".lsource") ?? "",
      el("div", { class: "lsum" }, el("div", {}, el("b", { text: model.agent || "orchestrator" }), " orchestrates"),
        el("div", { class: "muted small", text: `${lanes.length} subagent dispatch${lanes.length === 1 ? "" : "es"} · ${running} running · ${lanes.filter((l) => l.state === "done").length} done · ${lanes.filter((l) => l.state === "failed").length} failed` })),
      item("all", "Everything", `${model.events.length} events`, null, model.events.length),
      item("orchestrator", model.agent || "orchestrator", "orchestrator: its own messages, calls and dispatches", model.live?.state === "running" ? "running" : "idle", orchCount),
      el("div", { class: "ltree" }, lanes.map((l) => item(l.id, l.label, [l.description, l.tools ? `${l.tools} tools` : "", l.errors ? `${l.errors} errors` : "", l.start && l.end ? secs(Date.parse(l.end) - Date.parse(l.start)) : ""].filter(Boolean).join(" · "), l.state, l.count))),
    );
  }
  function renderList() {
    const rows = model.events.filter(matches).map(row);
    list.replaceChildren(...(rows.length ? rows : [el("div", { class: "muted lempty", text: model.events.length ? "Nothing matches the filters." : "No events yet." })]));
    if (model.follow) list.scrollTop = list.scrollHeight;
  }
  function append(e) {
    absorb(e);
    model.events.push(e);
    if (matches(e)) { list.querySelector(".lempty")?.remove(); list.append(row(e)); if (model.follow) list.scrollTop = list.scrollHeight; }
  }
  function download() {
    const blob = new Blob([model.events.map((e) => JSON.stringify(e)).join("\n") + "\n"], { type: "application/x-ndjson" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `${model.key?.replace(/[/:]/g, "-") ?? "log"}.jsonl` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- sources: live sessions and past runs ----------
  async function sourcePicker() {
    const [{ sessions }, { runs }] = await Promise.all([api("/api/sessions"), api("/api/runs").catch(() => ({ runs: [] }))]);
    const liveRuns = new Set(sessions.map((s) => s.runId).filter(Boolean));
    const select = el("select", { class: "lpick", "aria-label": "Session or run", onchange: (ev) => { location.hash = `#/logs/${ev.target.value}`; } },
      el("optgroup", { label: "Live sessions" }, sessions.length ? sessions.map((s) => el("option", { value: `s/${s.id}`, text: `${s.state === "running" ? "● " : ""}${s.agent}: ${s.title || "(no message yet)"}` })) : el("option", { disabled: true, text: "none" })),
      el("optgroup", { label: "Past runs" }, runs.filter((r) => !liveRuns.has(r.id)).map((r) => el("option", { value: `r/${r.id}`, text: `${r.at.replace("T", " ")} ${r.agent}: ${r.title}${r.source === "audit" ? " (audit trail)" : ""}` }))));
    select.value = model.key ?? "";
    return el("div", { class: "lsource" }, el("label", { class: "llabel", text: "Session" }), select);
  }

  async function open(key, laneFilter) {
    if (key !== model.key) {
      source?.close(); source = null;
      Object.assign(model, { key, live: null, agent: "", events: [], lanes: new Map(), follow: true });
      model.filter.lane = laneFilter ?? "all";
      renderToolbar();
      list.replaceChildren(el("div", { class: "muted lempty", text: "Loading…" }));
      const [kind, id] = key.split("/");
      if (kind === "s") {
        model.live = await api(`/api/sessions/${id}`).then((s) => ({ ...s, state: s.closed ? "closed" : "idle" }));
        renderSide(await sourcePicker());
        list.replaceChildren();
        source = new EventSource(`/api/sessions/${id}/events?token=${token}&after=0`);
        let pending = false;
        source.onmessage = (message) => {
          const e = JSON.parse(message.data);
          if (e.type === "status" && model.live) model.live.state = e.state;
          append(e);
          if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; renderSide(); }); }
        };
      } else {
        const log = await api(`/api/runs/${encodeURIComponent(id)}/events`);
        model.agent = log.agent ?? "";
        for (const e of log.events) absorb(e);
        model.events = log.events;
        renderSide(await sourcePicker());
        renderList();
      }
    } else if (laneFilter && laneFilter !== model.filter.lane) {
      model.filter.lane = laneFilter; renderSide(); renderList();
    }
  }

  async function show(route) {
    try {
      const [kind, id, laneId] = route.split("/");
      if ((kind === "s" || kind === "r") && id) return await open(`${kind}/${id}`, laneId);
      const current = currentSession();
      if (current) return await open(`s/${current}`);
      const { runs } = await api("/api/runs");
      if (runs[0]) return await open(`r/${runs[0].id}`);
      side.replaceChildren(); toolbar.replaceChildren();
      list.replaceChildren(el("div", { class: "muted lempty", text: "No sessions or runs yet. Start a chat and its log appears here." }));
    } catch (failure) {
      list.replaceChildren(el("div", { class: "banner", role: "alert", text: failure.message }));
    }
  }
  return { show, leave: () => { source?.close(); source = null; model.key = null; } };
}
