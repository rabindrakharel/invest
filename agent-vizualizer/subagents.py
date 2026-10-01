#!/usr/bin/env python3
"""subagents.py: how the orchestrator and its subagents coordinated in the CURRENT session.

    ① swimlane sequence diagram  USER · ORCH · A1 · A2 …  (spawn → ack → work → notification → read)
    ② activity timeline           when each agent was busy, every API call as a tick
    ③ one card per subagent       spawn point, run time, tokens, tools, steps, return path,
                                  the exact instruction it was sent and the report it returned

    subagents.py            (--full: complete reports · --no-color)
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from cclib import block_text, hhmmss, load_agents, secs, short, tag  # noqa: E402
from ui import Ansi, bar_spans, chip, human, panel, pad, rule, term_width, trunc, width, wrap  # noqa: E402

LANE_COLORS = ["green", "cyan", "pink", "violet", "orange", "teal", "yellow", "blue"]


def circled(i):
    return chr(0x2460 + i - 1) if 1 <= i <= 20 else "(%d)" % i


def collect(agents):
    spawns = []
    for parent in agents:
        for call in parent.calls:
            for b in call.content:
                if b.get("type") == "tool_use" and b.get("name") in ("Agent", "Task"):
                    spawns.append({"parent": parent, "call": call, "block": b, "child": None,
                                   "ack": None, "notify": None, "consumed_by": None})
    by_tool = {s["block"]["id"]: s for s in spawns}
    for a in agents[1:]:
        if a.meta.get("toolUseId") in by_tool:
            by_tool[a.meta["toolUseId"]]["child"] = a
    for parent in agents:
        for r in parent.recs:
            if r.get("type") != "user":
                continue
            content = (r.get("message") or {}).get("content")
            if isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("tool_use_id") in by_tool:
                        by_tool[b["tool_use_id"]]["ack"] = r
            text = block_text(content)
            if "<task-notification>" in text and tag(text, "tool-use-id") in by_tool:
                s = by_tool[tag(text, "tool-use-id")]
                s["notify"] = r
                s["consumed_by"] = next((cl for cl in parent.calls if cl.ts > r.get("timestamp", "")), None)
    return spawns


def swimlanes(a, agents, spawns, names, W):
    lanes = ["USER"] + [names[ag.id] for ag in agents]
    lane_of = {n: i for i, n in enumerate(lanes)}
    color = {n: LANE_COLORS[i % len(LANE_COLORS)] for i, n in enumerate(lanes)}
    x0 = 11
    step = max(16, min(34, (W - x0 - 6) // max(1, len(lanes) - 1) if len(lanes) > 1 else 20))
    cx = [x0 + 2 + i * step for i in range(len(lanes))]
    span = {names[ag.id]: (ag.start, ag.end) for ag in agents[1:]}

    ev = []  # (ts, kind, src, dst, label, color)
    orch = agents[0]
    humans = [r for r in orch.recs if r.get("type") == "user" and r.get("turnOrigin") == "human"]
    for i, r in enumerate(humans):
        ev.append((r["timestamp"], "msg", "USER", "ORCH", short(block_text(r["message"]["content"]), 60), "green", False))
        nxt = humans[i + 1]["timestamp"] if i + 1 < len(humans) else "9999"
        ans = [c for c in orch.calls if r["timestamp"] < c.ts < nxt and c.response.get("stop_reason") == "end_turn"]
        if ans:
            ev.append((ans[-1].ts, "msg", "ORCH", "USER", "answer · %s tokens" % human(ans[-1].tok["output"]), "green", True))
    for s in spawns:
        a_ = s["child"]
        tgt = names.get(a_.id, "?") if a_ else "?"
        src = names[s["parent"].id]
        inp = s["block"].get("input") or {}
        ev.append((s["call"].ts, "msg", src, tgt, "Agent · %s" % inp.get("description", ""), "cyan", False))
        if s["ack"]:
            tur = s["ack"].get("toolUseResult") if isinstance(s["ack"].get("toolUseResult"), dict) else {}
            asyn = tur.get("status") == "async_launched"
            ev.append((s["ack"]["timestamp"], "msg", tgt, src, "ack · async_launched" if asyn else "result (inline)",
                       "dim" if asyn else "green", True))
        if a_:
            tools = {}
            for cl in a_.calls:
                for b in cl.content:
                    if b.get("type") == "tool_use":
                        tools[b["name"]] = tools.get(b["name"], 0) + 1
            ev.append((a_.start, "self", tgt, None, "working · %d calls · %s" % (
                len(a_.calls), " ".join("%s×%d" % kv for kv in tools.items()) or "no tools"), color[tgt], False))
            if a_.calls:
                ev.append((a_.calls[-1].ts, "self", tgt, None, "report ready · %s tokens" % human(a_.calls[-1].tok["output"]), color[tgt], False))
        if s["notify"]:
            ev.append((s["notify"]["timestamp"], "msg", tgt, src, "⚑ task-notification · %s" % tag(block_text(s["notify"]["message"]["content"]), "status"), "yellow", False))
            if s["consumed_by"]:
                ev.append((s["consumed_by"].ts, "self", src, None, "reads %s's report · call #%d" % (tgt, s["consumed_by"].n), "cyan", False))
    ev.sort(key=lambda e: (e[0], e[1] == "msg" and e[3] == "USER"))  # answers to USER last within a second

    def active(lane, ts):
        if lane == "ORCH":
            return True
        if lane in span:
            return span[lane][0] <= ts <= span[lane][1]
        return False

    def base_row(ts, idle=False):
        cells = [(" ", None)] * W
        for i, n in enumerate(lanes):
            if idle:
                ch, col = "┆", "faint"
            elif active(n, ts):
                ch, col = "┃", color[n]
            else:
                ch, col = "│", "faint"
            cells[cx[i]] = (ch, col)
        return cells

    def render(cells, tlabel, tcol="dim"):
        out, run, rc = a(pad(tlabel, x0), tcol), "", None
        for ch, col in cells[x0:]:
            if col != rc and run:
                out += a(run, rc) if rc else run
                run = ""
            run, rc = run + ch, col
        out += a(run, rc) if rc else run
        return out.rstrip()

    lines = [rule(a, "① SWIMLANES", W, "violet", "who talked to whom, in order")]
    hdr = [(" ", None)] * W
    for i, n in enumerate(lanes):
        lab = " %s " % n
        st = max(x0, cx[i] - len(lab) // 2)
        for j, ch in enumerate(lab):
            if st + j < W:
                hdr[st + j] = (ch, "lane:" + n)
    # header row with chips
    row = a(pad("", x0))
    i = x0
    while i < W:
        ch, col = hdr[i]
        if col and col.startswith("lane:"):
            n = col[5:]
            j = i
            while j < W and hdr[j][1] == col:
                j += 1
            row += a("".join(c for c, _ in hdr[i:j]), "black", bg=color[n], bold=True)
            i = j
        else:
            row += ch
            i += 1
    lines.append(row.rstrip())
    sub = [(" ", None)] * W
    for ag in agents[1:]:
        d = trunc(ag.meta.get("description", ""), step - 2)
        st = max(x0, cx[lane_of[names[ag.id]]] - width(d) // 2)
        for j, ch in enumerate(d):
            if st + j < W:
                sub[st + j] = (ch, "dim")
    lines.append(render(sub, ""))

    prev = None
    for ts, kind, src, dst, label, col, dashed in ev:
        if prev and secs(prev, ts) > 90:
            gap = secs(prev, ts)
            cells = base_row(ts, idle=True)
            txt = " ⋯ %s idle " % ("%dm %02ds" % divmod(int(gap), 60))
            for j, ch in enumerate(txt):
                if x0 + j < W:
                    cells[x0 + j] = (ch, "dim")
            lines.append(render(cells, ""))
        prev = ts
        cells = base_row(ts)
        if kind == "msg":
            s, d = cx[lane_of[src]], cx[lane_of[dst]]
            lo, hi = min(s, d), max(s, d)
            line_ch = "┄" if dashed else "─"
            for x in range(lo, hi + 1):
                cells[x] = (line_ch, col)
            cells[s] = ("●", col)
            cells[d] = ("▶" if d > s else "◀", col)
            room = hi - lo - 3
            lab = " %s " % trunc(label, max(4, room - 2))
            if width(lab) <= room:
                st = lo + 2 + (room - width(lab)) // 2
                for j, ch in enumerate(lab):
                    cells[st + j] = (ch, "white" if col != "dim" else "dim")
            elif hi + 2 < W:
                for j, ch in enumerate(" " + trunc(label, W - hi - 3)):
                    if hi + 1 + j < W:
                        cells[hi + 1 + j] = (ch, col)
        else:
            s = cx[lane_of[src]]
            cells[s] = ("◉", col)
            txt = " " + trunc(label, W - s - 2)
            for j, ch in enumerate(txt):
                if s + 1 + j < W:
                    cells[s + 1 + j] = (ch, col)
        lines.append(render(cells, hhmmss(ts)))
    return lines, color


def timeline(a, agents, spawns, names, color, W):
    times = [s["call"].ts for s in spawns] + [s["consumed_by"].ts for s in spawns if s["consumed_by"]] + \
            [ag.end for ag in agents[1:]]
    if not times:
        return []
    from datetime import datetime, timedelta
    f = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
    lo, hi = f(min(times)) - timedelta(seconds=3), f(max(times)) + timedelta(seconds=3)
    total = (hi - lo).total_seconds() or 1
    label_w = 26
    cells = W - label_w - 2

    def pos(ts):
        return int((f(ts) - lo).total_seconds() / total * (cells - 1))

    lines = [rule(a, "② ACTIVITY", W, "violet", "%s → %s · %ds window around the hand-offs" % (
        lo.strftime("%H:%M:%S"), hi.strftime("%H:%M:%S"), total))]
    for ag in agents:
        n = names[ag.id]
        row = [("─", "faint")] * cells
        if ag.id != "main":
            for x in range(max(0, pos(ag.start)), min(cells, pos(ag.end) + 1)):
                row[x] = ("━", color[n])
        for cl in ag.calls:
            if lo <= f(cl.ts) <= hi:
                row[pos(cl.ts)] = ("▮", color[n])
        if ag.id == "main":
            for s in spawns:
                if s["parent"] is ag:
                    row[pos(s["call"].ts)] = ("◆", "cyan")
                if s["notify"] and lo <= f(s["notify"]["timestamp"]) <= hi:
                    row[pos(s["notify"]["timestamp"])] = ("⚑", "yellow")
        desc = "orchestrator" if ag.id == "main" else ag.meta.get("description", "")
        lab = a(" %-4s" % n, "black", bg=color[n], bold=True) + " " + a(pad(trunc(desc, label_w - 7), label_w - 6), "grey")
        lines.append(lab + "".join(a(ch, c) for ch, c in row))
    axis = [" "] * cells
    for frac in (0, 0.25, 0.5, 0.75, 1):
        x = min(cells - 8, int(frac * (cells - 1)))
        t = (lo + timedelta(seconds=total * frac)).strftime("%H:%M:%S")
        for j, ch in enumerate(t):
            axis[x + j] = ch
    lines.append(" " * label_w + a("".join(axis), "dim"))
    lines.append(" " * label_w + a("▮ API call   ━ subagent running   ◆ spawn   ⚑ notification", "dim"))
    return lines


def card(a, s, names, color, W, full):
    ag, b = s["child"], s["block"]
    inp = b.get("input") or {}
    n = names.get(ag.id, "?") if ag else "?"
    tur = s["ack"].get("toolUseResult") if s["ack"] and isinstance(s["ack"].get("toolUseResult"), dict) else {}
    model = tur.get("resolvedModel") or (ag.calls[0].model if ag and ag.calls else "?")
    mode = "background" if tur.get("status") == "async_launched" else "foreground"
    inner = W - 4
    L = []
    k = lambda t: a("%-10s" % t, "dim")
    L.append(k("spawned") + a(names[s["parent"].id], "cyan", bold=True) + a(" call #%d " % s["call"].n, "cyan")
             + a("%s · tool_use %s · %s" % (s["call"].mid, b["id"], hhmmss(s["call"].ts)), "grey"))
    if ag:
        tot = {x: sum(c.tok[x] for c in ag.calls) for x in ("input", "cache_write", "cache_read", "output")}
        prompt = tot["input"] + tot["cache_write"] + tot["cache_read"]
        L.append(k("ran") + a("%s → %s" % (hhmmss(ag.start), hhmmss(ag.end)), "white") + a("  ·  %.0fs  ·  %d API calls" % (secs(ag.start, ag.end), len(ag.calls)), "grey"))
        L.append(k("tokens") + a("▕", "faint") + a.spans(bar_spans([(tot["cache_read"], "green"), (tot["cache_write"], "yellow"), (tot["input"], "red")], 24))
                 + a("▏ ", "faint") + a("prompt %s" % human(prompt), "white") + a("  read %s · write %s · new %s" % (
                     human(tot["cache_read"]), human(tot["cache_write"]), human(tot["input"])), "grey")
                 + a("  → out ", "faint") + a(human(tot["output"]), "cyan", bold=True))
        tools = {}
        for c in ag.calls:
            for bl in c.content:
                if bl.get("type") == "tool_use":
                    tools[bl["name"]] = tools.get(bl["name"], 0) + 1
        L.append(k("tools") + " ".join(chip(a, "%s ×%d" % kv, "black", "blue") for kv in tools.items()) if tools else k("tools") + a("none", "dim"))
        steps = []
        for c in ag.calls:
            names_ = [bl["name"] for bl in c.content if bl.get("type") == "tool_use"]
            if names_:
                uniq = sorted(set(names_), key=names_.index)
                steps.append("%s %s" % (circled(c.n), " ".join("%s%s" % (x, "×%d" % names_.count(x) if names_.count(x) > 1 else "") for x in uniq)))
            else:
                steps.append("%s report" % circled(c.n))
        st = a(" → ", "faint").join(a(x, color[n]) for x in steps)
        L.append(k("steps") + (st if width(st) <= inner - 10 else a(trunc(" → ".join(steps), inner - 10), color[n])))
    if s["notify"]:
        L.append(k("returned") + a("⚑ task-notification ", "yellow", bold=True) + a(hhmmss(s["notify"]["timestamp"]), "white")
                 + (a("  →  read by ORCH call #%d " % s["consumed_by"].n, "cyan") + a(s["consumed_by"].mid, "grey") if s["consumed_by"] else ""))
    elif s["ack"]:
        L.append(k("returned") + a("inline tool_result of %s" % b["id"], "green"))
    prompt_text = inp.get("prompt") or ""
    L.append(("---", "▶ INSTRUCTION SENT  ·  exact Agent input.prompt  ·  %d words" % len(prompt_text.split()), "cyan"))
    for ln in wrap(prompt_text, inner - 2):
        L.append(a("▎ ", "cyan") + a(ln, "white"))
    if ag and ag.calls:
        rep = "\n".join(bl.get("text", "") for bl in ag.calls[-1].content if bl.get("type") == "text")
        rl = wrap(rep, inner - 2)
        cut = not full and len(rl) > 14
        L.append(("---", "◀ REPORT RETURNED  ·  %d words%s" % (len(rep.split()), "  ·  first 14 lines, --full for all" if cut else ""), "green"))
        for ln in (rl[:14] if cut else rl):
            L.append(a("▎ ", "green") + a(ln, "grey"))
    title = "%s · %s" % (n, inp.get("description", ""))
    return panel(a, title, L, W, color.get(n, "pink"), "%s · %s · %s" % (inp.get("subagent_type", "general-purpose"), model, mode))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--full", action="store_true", help="print complete final reports")
    ap.add_argument("--no-color", action="store_true")
    args = ap.parse_args()
    a = Ansi(sys.stdout.isatty() and not args.no_color)
    W = term_width(140)

    sid, agents = load_agents()
    names = {ag.id: "A%d" % i for i, ag in enumerate(agents[1:], 1)}
    names["main"] = "ORCH"
    spawns = collect(agents)

    calls = sum(len(ag.calls) for ag in agents)
    head = [" ".join([chip(a, "ORCH · %d calls" % len(agents[0].calls), "black", "cyan")] +
                     [chip(a, "%s · %s · %d calls" % (names[ag.id], trunc(ag.meta.get("description", ""), 24), len(ag.calls)), "black", LANE_COLORS[(i + 2) % len(LANE_COLORS)])
                      for i, ag in enumerate(agents[1:])]),
            a("%d hand-offs out · %d answers back · %d API calls in total" % (
                len(spawns), sum(1 for s in spawns if s["notify"] or s["ack"]), calls), "grey")]
    for ln in panel(a, "◆ ORCHESTRATION · session %s" % sid, head, W, "violet",
                    "%s → %s" % (hhmmss(agents[0].start), hhmmss(agents[0].end))):
        print(ln)
    print()
    lanes, color = swimlanes(a, agents, spawns, names, W)
    for ln in lanes:
        print(ln)
    print()
    for ln in timeline(a, agents, spawns, names, color, W):
        print(ln)
    print()
    print(rule(a, "③ SUBAGENTS", W, "violet", "instruction in · report out"))
    for s in spawns:
        for ln in card(a, s, names, color, W, args.full):
            print(ln)


if __name__ == "__main__":
    main()
