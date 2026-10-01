// The research view: what the skills have already written under data/, read-only.
// Routes (after #/research/): "" the desk (latest outlook) · ticker/<T> · doc/<data path> · ledger.
// Every value shown comes from a file on disk; this page computes nothing but formatting.

import { api, el, markdown, token } from "./ui.js";

const pct = (value, digits = 1) => (typeof value === "number" && Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(digits)}%` : "–");
const ratio = (value) => (typeof value === "number" && Number.isFinite(value) ? pct(value * 100) : "–");
const num = (value, digits = 2) => (typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "–");
const tone = (value) => (typeof value === "number" ? (value > 0 ? "up" : value < 0 ? "down" : "") : "");
const stanceClass = (stance) => `stance ${String(stance ?? "").toLowerCase().replace(/[^a-z]+/g, "-")}`;
const tickerLink = (symbol) => el("a", { class: "tk", href: `#/research/ticker/${encodeURIComponent(symbol)}`, text: symbol });
const docHref = (path) => `#/research/doc/${path}`;
const card = (title, ...body) => el("section", { class: "rcard" }, title ? el("h3", { text: title }) : null, ...body);
const kv = (pairs) => el("dl", { class: "kv" }, pairs.filter(([, value]) => value !== undefined && value !== null && value !== "").flatMap(([key, value]) => [el("dt", { text: key }), el("dd", {}, value)]));
const chips = (items, cls = "chip") => el("div", { class: "chips" }, items.map((item) => el("span", { class: cls, text: item })));
const table = (head, rows) => el("div", { class: "tablewrap" }, el("table", { class: "rtable" }, el("thead", {}, el("tr", {}, head.map((h) => el("th", { text: h })))), el("tbody", {}, rows)));
/** Turns "MPC +7.8%" style strings into a ticker link plus the rest. */
const leader = (text) => { const match = /^([A-Z][A-Z0-9.]{0,9})(\s.*)?$/.exec(text); return match ? el("span", { class: "leader" }, tickerLink(match[1]), match[2] ?? "") : el("span", { text }); };

export function mountResearch(root, { ask }) {
  let index = null;
  const side = el("aside", { class: "rside" });
  const pane = el("div", { class: "rpane", tabindex: "-1" });
  root.append(side, pane);

  async function loadIndex(force = false) {
    if (index && !force) return index;
    index = await api("/api/research");
    renderSide();
    return index;
  }

  // ---------- sidebar ----------
  function renderSide() {
    const input = el("input", { type: "search", class: "tsearch", placeholder: "Ticker, e.g. NVDA", "aria-label": "Open a ticker", list: "tickers", autocapitalize: "characters", spellcheck: "false" });
    const datalist = el("datalist", { id: "tickers" }, index.tickers.map((t) => el("option", { value: t })));
    const form = el("form", { class: "tform", onsubmit: (event) => { event.preventDefault(); const t = input.value.trim().toUpperCase().replace(/^\$/, ""); if (/^[A-Z][A-Z0-9.]{0,9}$/.test(t)) { location.hash = `#/research/ticker/${t}`; input.value = ""; } } }, input, datalist);
    const nav = (href, label, sub) => el("a", { class: "nav", href }, el("span", { class: "l", text: label }), sub ? el("span", { class: "s", text: sub }) : null);
    const group = (title, items, open = true) => el("details", { class: "group", open }, el("summary", { text: title }), el("div", {}, items));
    side.replaceChildren(
      form,
      nav("#/research", "Desk", index.latestOutlook ? `outlook ${index.latestOutlook}` : "no outlook yet"),
      nav("#/research/ledger", "Verdict ledger", `${index.verdicts} registered`),
      group(`Tickers on file (${index.tickers.length})`, el("div", { class: "tgrid" }, index.tickers.map(tickerLink)), false),
      group("Reports", index.reports.map((r) => nav(docHref(r.path), r.title, r.date))),
      group("Probes", index.probes.filter((p) => p.page).map((p) => nav(docHref(p.page), `${p.kind === "corpus" ? "Corpus" : "Runway"} probe ${p.id}`, p.kind === "runway" && p.names ? `${p.names} names` : p.date))),
      group("Research by date", index.dates.map((d) => el("div", { class: "day" }, el("div", { class: "dlabel", text: d.date }),
        Object.entries(d.parts).flatMap(([part, files]) => files.filter((f) => f.endsWith(".md")).map((f) => nav(docHref(`research/${d.date}/${part}/${f}`), `${part} · ${f.replace(/\.md$/, "")}`))))), false),
      el("p", { class: "fine", text: "Read-only view of data/. Research, not investment advice." }),
    );
    markActive();
  }
  function markActive() {
    for (const link of side.querySelectorAll("a.nav")) link.classList.toggle("active", link.getAttribute("href") === location.hash || (link.getAttribute("href") === "#/research" && (location.hash === "#/research" || location.hash === "#/research/")));
  }

  // ---------- views ----------
  async function show(route) {
    pane.replaceChildren(el("div", { class: "loading", text: "Loading…" }));
    try {
      await loadIndex();
      markActive();
      const [kind, ...rest] = route.split("/");
      const arg = decodeURIComponent(rest.join("/"));
      if (kind === "ticker" && arg) await showTicker(arg.toUpperCase());
      else if (kind === "doc" && arg) await showDoc(arg);
      else if (kind === "ledger") await showLedger();
      else await showDesk();
      pane.scrollTop = 0;
    } catch (failure) {
      pane.replaceChildren(el("div", { class: "banner", role: "alert", text: failure.message }));
    }
  }

  async function showDesk() {
    let found;
    try { found = await api("/api/research/outlook"); } catch (failure) {
      if (failure.status !== 404) throw failure;
      pane.replaceChildren(el("div", { class: "rhead" }, el("h1", { text: "No outlook on file yet" })), el("p", { text: "Ask the desk for the market outlook to produce one." }), el("button", { class: "btn primary", onclick: () => ask("Give me the market outlook") }, "Ask for the outlook"));
      return;
    }
    const o = found.outlook;
    const inputs = o.inputs ?? {};
    const regime = o.regime ?? {};
    const budget = o.risk_budget ?? {};
    const outlookMd = index.dates.find((d) => d.date === found.date)?.parts.outlook?.includes("outlook.md") ? `research/${found.date}/outlook/outlook.md` : null;
    const themes = [...(o.themes ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const asOf = [`macro ${inputs.regime_as_of ?? "–"}`, `themes ${inputs.themes_as_of ?? "–"}`, `X corpus through ${inputs.corpus_last_day ?? "–"}`];
    pane.replaceChildren(
      el("div", { class: "rhead" },
        el("div", {}, el("h1", { text: `Market outlook, ${o.as_of ?? found.date}` }), el("div", { class: "asof", text: `As of: ${asOf.join(" · ")}` })),
        el("div", { class: "actions" }, outlookMd ? el("a", { class: "btn ghost", href: docHref(outlookMd) }, "Full outlook") : null, el("button", { class: "btn primary", onclick: () => ask("Give me the outlook: what changed since the last one?") }, "Refresh with the desk"))),
      el("div", { class: "cards3" },
        card("Regime", el("div", { class: "big", text: regime.call ?? regime.mechanical ?? "–" }), kv([["Composite", num(regime.composite, 1)], ["Quadrant", regime.quadrant], ["Duration", regime.duration]]), regime.flags?.length ? chips(regime.flags, "chip warn") : null),
        card("Risk budget", el("div", { class: "big", text: `${budget.gross_exposure_pct ?? "–"}% gross` }), kv([["Long-duration cap", budget.long_duration_cap_pct !== undefined ? `${budget.long_duration_cap_pct}%` : undefined]]), budget.hedges?.length ? el("ul", { class: "tight" }, budget.hedges.map((h) => el("li", { text: h }))) : null),
        card("What would change it", el("ul", { class: "tight" }, (o.judgment?.what_changes ?? (o.events ?? []).slice(0, 5).map((e) => `${e.date} ${e.event}`)).map((w) => el("li", { text: w })))),
      ),
      o.judgment?.summary ? card("The read", el("p", { class: "lead", text: o.judgment.summary }), o.judgment.top_calls?.length ? el("ol", { class: "tight" }, o.judgment.top_calls.map((c) => el("li", { text: c }))) : null) : null,
      card(`Theme stances (${themes.length})`, table(["Theme", "Stance", "Score", "Direction", "vs SPY 3m", "Breadth 50d", "Leaders 1m", "Sentiment"], themes.map((t) => el("tr", {},
        el("td", {}, el("b", { text: t.name ?? t.id }), el("div", { class: "muted", text: t.group ?? "" })),
        el("td", {}, el("span", { class: stanceClass(t.stance), text: t.stance ?? "–" })),
        el("td", { class: "num", text: num(t.score) }),
        el("td", { text: t.price?.direction ?? "–" }),
        el("td", { class: `num ${tone(t.price?.rel_spy_3m)}`, text: pct(t.price?.rel_spy_3m) }),
        el("td", { class: "num", text: t.price?.breadth_50d !== undefined ? `${Math.round(t.price.breadth_50d)}%` : "–" }),
        el("td", { class: "leaders" }, (t.price?.leaders_1m ?? []).slice(0, 3).map(leader)),
        el("td", { class: "muted small", text: t.sentiment?.read ?? (t.sentiment?.labels ?? []).join(", ") }),
      )))),
      el("div", { class: "cards2" },
        card("Events", table(["Date", "Event", "Why it matters"], (o.events ?? []).map((e) => el("tr", {}, el("td", { class: "nowrap", text: e.date }), el("td", { text: e.event }), el("td", { class: "muted", text: e.why_it_matters ?? "" }))))),
        card("Risks", table(["Risk", "Probability", "Tell"], (o.risks ?? []).map((r) => el("tr", {}, el("td", {}, el("b", { text: r.risk }), el("div", { class: "muted small", text: r.impact ?? "" })), el("td", { text: r.probability ?? "" }), el("td", { class: "muted", text: r.tell ?? "" }))))),
      ),
    );
  }

  async function showTicker(symbol) {
    const d = await api(`/api/research/tickers/${encodeURIComponent(symbol)}`);
    const latest = d.briefs[0]?.brief;
    const head = el("div", { class: "rhead" },
      el("div", {}, el("h1", { text: symbol }), el("div", { class: "asof", text: latest ? `Latest brief ${d.briefs[0].date}${latest.regime?.call ? ` · regime: ${latest.regime.call}` : ""}` : "No ticker brief on file" })),
      el("div", { class: "actions" }, el("button", { class: "btn primary", onclick: () => ask(`What about ${symbol}?`) }, `Ask the desk about ${symbol}`)));
    const sections = [head];
    const call = d.briefs[0]?.judgment;
    if (call) {
      sections.push(card(`Verdict, ${d.briefs[0].date}`, el("div", { class: "big", text: `${call.verdict}, ${call.horizon}` }), el("p", { class: "lead", text: call.answer }),
        call.departure ? el("p", { class: "muted small", text: `Departs from the mechanical lean: ${call.departure}` }) : null,
        d.briefs[0].report ? el("a", { href: docHref(d.briefs[0].report), text: "Read the brief" }) : null));
    }
    if (!d.briefs.length && !d.runway.length && !d.verdicts.length && !d.reports.length) {
      sections.push(card(null, el("p", { text: `Nothing on file for ${symbol} yet. Ask the desk for a brief: it joins the regime, its themes, price trend, what the accounts say and any runway record.` })));
      pane.replaceChildren(...sections);
      return;
    }
    if (latest) {
      const p = latest.price ?? {};
      const fit = latest.macro_fit ?? {};
      const s = latest.sentiment ?? {};
      sections.push(el("div", { class: "cards3" },
        card("Price", el("div", { class: "big", text: p.close !== undefined ? `$${num(p.close)}` : "–" }), kv([["As of", p.as_of], ["1m", el("span", { class: tone(p.ret_1m), text: pct(p.ret_1m) })], ["3m", el("span", { class: tone(p.ret_3m), text: pct(p.ret_3m) })], ["12m", el("span", { class: tone(p.ret_12m), text: pct(p.ret_12m) })], ["From 52w high", pct(p.dd_52w_pct)], ["Trend", [p.above_50d ? "above 50d" : "below 50d", p.above_200d ? "above 200d" : "below 200d"].join(" · ")]]), p.source ? el("a", { class: "src", href: p.source, target: "_blank", rel: "noopener noreferrer", text: "source" }) : null),
        card("Macro fit", el("div", { class: "big", text: `${fit.stance ?? "–"} (${num(fit.fit)})` }), kv([["Archetype", latest.archetype], ["Tailwinds", (fit.tailwinds ?? []).join(", ")], ["Headwinds", (fit.headwinds ?? []).join(", ")]])),
        card("Allowlist sentiment", el("div", { class: "big", text: `${s.posts_recent ?? 0} posts · ${s.accounts_recent ?? 0} accounts` }), kv([["Velocity vs pace", num(s.velocity_rel)], ["Tone (recent)", num(s.tone_recent)], ["Bull / bear share", s.bull_share_recent !== undefined ? `${Math.round(s.bull_share_recent * 100)}% / ${Math.round((s.bear_share_recent ?? 0) * 100)}%` : undefined], ["Stances", s.stance ? `${s.stance.longs ?? 0} long · ${s.stance.shorts ?? 0} short · conviction ${num(s.stance.avg_conviction)}` : undefined]])),
      ));
      if (latest.themes?.length) sections.push(card("Themes", table(["Theme", "Stance", "Direction", "vs SPY 3m", "Trend", "Breadth 50d"], latest.themes.map((t) => el("tr", {}, el("td", { text: t.name }), el("td", {}, el("span", { class: stanceClass(t.stance), text: t.stance ?? "–" })), el("td", { text: t.direction ?? "–" }), el("td", { class: `num ${tone(t.rel_spy_3m)}`, text: pct(t.rel_spy_3m) }), el("td", { text: t.trend ?? "–" }), el("td", { class: "num", text: t.breadth_50d !== undefined ? `${Math.round(t.breadth_50d)}%` : "–" }))))));
      if (s.evidence?.length) sections.push(card("What the accounts said", el("div", { class: "posts" }, s.evidence.map((post) => el("blockquote", { class: "post" }, el("div", { class: "meta", text: `@${post.author} · ${post.day} · ${post.likes ?? 0} likes · post ${post.post_id}` }), el("div", { text: post.text }))))));
    }
    if (d.verdicts.length) {
      sections.push(card(`Registered verdicts (${d.verdicts.length})`, ...[...d.verdicts].reverse().map((v) => el("div", { class: "verdict" },
        el("div", { class: "vhead" }, el("span", { class: `tier ${v.tier}`, text: v.tier }), el("b", { text: ` ${v.total ?? "–"}/100` }), el("span", { class: "muted", text: ` · probe ${v.probe} · close $${num(v.close)} on ${v.price_as_of}${v.size ? ` · size: ${v.size}` : ""}${v.horizon_months ? ` · ${v.horizon_months} months` : ""}` })),
        v.edge ? el("p", { text: v.edge }) : null,
        v.scenarios ? table(["Case", "Price", "p", "If"], ["bull", "base", "bear"].filter((k) => v.scenarios[k]).map((k) => el("tr", {}, el("td", { text: k }), el("td", { class: "num", text: `$${num(v.scenarios[k].price)}` }), el("td", { class: "num", text: num(v.scenarios[k].p) }), el("td", { class: "muted", text: v.scenarios[k].if ?? "" })))) : null,
        kv([["Expected return", el("span", { class: tone(v.expected_return), text: ratio(v.expected_return) })], ["Bear loss", ratio(v.bear_loss)], ["Kill", v.kill ? `${v.kill.observation} (by ${v.kill.by})` : undefined], ["Gates failed", (v.gates_failed ?? []).join(", ") || undefined], ["Pre-mortem", v.premortem], ["Red team", v.redteam_fact]]),
      ))));
    }
    if (d.runway.length) {
      sections.push(card("Runway probe history", table(["Probe", "Tier", "Score", "Close", "Upside to PT", "Risk/reward", "Gates failed", "Points"], d.runway.map((r) => {
        const s = r.score ?? {};
        return el("tr", {},
          el("td", {}, r.page ? el("a", { href: docHref(r.page), text: r.probe }) : r.probe),
          el("td", {}, s.tier ? el("span", { class: `tier ${s.tier}`, text: s.tier }) : "–"),
          el("td", { class: "num", text: s.total ?? "–" }),
          el("td", { class: "num", text: s.close !== undefined ? `$${num(s.close)}` : "–" }),
          el("td", { class: `num ${tone(s.upside_pct)}`, text: pct(s.upside_pct) }),
          el("td", { class: "num", text: num(s.risk_reward, 1) }),
          el("td", { text: (s.gates_failed ?? []).join(", ") || "none" }),
          el("td", { class: "points" }, Object.entries(s.points ?? {}).map(([k, v]) => el("span", { class: "pt", title: k, text: `${k.replace(/_/g, " ")} ${v}` }))),
        );
      }))));
      const judged = d.runway.find((r) => r.record?.judgment);
      if (judged) {
        const j = judged.record.judgment;
        sections.push(card(`Analyst judgment, probe ${judged.probe}`, kv(Object.keys(j).filter((k) => k.endsWith("_why")).map((k) => [`${k.replace(/_why$/, "").replace(/_/g, " ")} (${j[k.replace(/_why$/, "_pts")] ?? "–"} pts)`, j[k]])), el("div", { class: "muted small", text: [j.label, j.by].filter(Boolean).join(" · ") })));
      }
    }
    if (d.briefs.length > 1) sections.push(card("Earlier briefs", el("div", { class: "muted", text: d.briefs.slice(1).map((b) => b.date).join(" · ") })));
    if (d.reports.length) sections.push(card("Reports that mention it", el("ul", { class: "tight" }, d.reports.map((r) => el("li", {}, el("a", { href: docHref(r.path), text: r.title }), el("span", { class: "muted", text: ` · ${r.date}${r.answer ? ` — ${r.answer}` : ""}` }))))));
    pane.replaceChildren(...sections);
  }

  async function showDoc(path) {
    const isHtml = path.endsWith(".html");
    const probe = index.probes.find((p) => p.page === path || p.evidence === path);
    const name = index.reports.find((r) => r.path === path)?.title
      ?? (probe ? `${probe.kind === "corpus" ? "Corpus" : "Runway"} probe ${probe.id}${probe.evidence === path ? ": evidence" : ""}` : path);
    const pageUrl = `/api/research/page?path=${encodeURIComponent(path)}&token=${token}`;
    const head = el("div", { class: "rhead" },
      el("div", {}, el("h1", { text: name }), el("div", { class: "asof", text: `data/${path}` })),
      el("div", { class: "actions" }, el("a", { class: "btn ghost", href: pageUrl, target: "_blank", rel: "noopener", text: "Open raw" }), el("button", { class: "btn primary", onclick: () => ask(`Read data/${path} and tell me what has changed since it was written.`) }, "Ask what changed")));
    if (isHtml) {
      pane.replaceChildren(head, el("iframe", { class: "docframe", sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox", src: pageUrl, title: name }));
      return;
    }
    const doc = await api(`/api/research/doc?path=${encodeURIComponent(path)}`);
    pane.replaceChildren(head, el("article", { class: "rcard doc" }, markdown(doc.body, { base: doc.path })));
  }

  async function showLedger() {
    const { verdicts } = await api("/api/research/ledger");
    const rows = [...verdicts].sort((a, b) => String(b.registered_at).localeCompare(String(a.registered_at)));
    pane.replaceChildren(
      el("div", { class: "rhead" }, el("div", {}, el("h1", { text: "Verdict ledger" }), el("div", { class: "asof", text: `data/ledger/verdicts.jsonl · ${rows.length} verdicts · prices are as registered, not current` })),
        el("div", { class: "actions" }, el("button", { class: "btn primary", onclick: () => ask("Were we right? Check the verdicts against current prices.") }, "Check the record"))),
      card(null, table(["Registered", "Probe", "Ticker", "Tier", "Score", "Close", "E[return]", "Bear loss", "Size", "Kill by"], rows.map((v) => el("tr", {},
        el("td", { class: "nowrap", text: String(v.registered_at ?? "").slice(0, 10) }),
        el("td", { text: v.probe ?? "" }),
        el("td", {}, typeof v.ticker === "string" ? tickerLink(v.ticker) : "–"),
        el("td", {}, el("span", { class: `tier ${v.tier}`, text: v.tier ?? "–" })),
        el("td", { class: "num", text: v.total ?? "–" }),
        el("td", { class: "num", text: v.close !== undefined ? `$${num(v.close)}` : "–" }),
        el("td", { class: `num ${tone(v.expected_return)}`, text: ratio(v.expected_return) }),
        el("td", { class: "num down", text: ratio(v.bear_loss) }),
        el("td", { text: v.size ?? "" }),
        el("td", { class: "nowrap", text: v.kill?.by ?? "" }),
      )))),
    );
  }

  return { show, refresh: () => loadIndex(true) };
}
