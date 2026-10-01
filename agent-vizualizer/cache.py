#!/usr/bin/env python3
"""cache.py: how the prompt cache was used in the CURRENT Claude Code session.

Every request re-sends the whole conversation, so each prompt is a growing prefix:

    request #1 = P1      request #2 = P1 A1 Q1      request #3 = P1 A1 Q1 A2 Q2   …

    P   prefix: first request's full prompt (system prompt + tool definitions + first input)
    Ai  answer: what call i returned (sent back in every later request)
    Qi  question: new input after Ai (tool results, user message, notifications, reminders)

Per call, the bar shows the prompt (length ∝ size) split into READ from cache, WRITTEN to cache
and NEW uncached tokens, and the line below names the segments in each region. A prefix map
ribbon shows the final prompt of each agent segment by segment. Totals are exact API usage; the
A/Q split is derived from output_tokens (≈). A shrinking prompt starts a new P segment.

    cache.py               (--legend: list every segment's contents · --compact: bars only · --no-color)
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from cclib import build_request, describe_records, describe_response, hhmmss, load_agents  # noqa: E402
from ui import Ansi, alloc, bar_spans, chip, human, panel, rule, spark, term_width, trunc, width  # noqa: E402

READ_X, WRITE_5M_X, WRITE_1H_X = 0.1, 1.25, 2.0
SEG_COLOR = {"P": "violet", "A": "cyan", "Q": "orange"}


def segments_for(agent):
    segs, counts, p_no = [], [], 0
    calls = agent.calls
    for i, c in enumerate(calls):
        if i == 0 or c.prompt_total < calls[i - 1].prompt_total:
            p_no += 1
            segs.append({"label": "P%d" % p_no, "size": c.prompt_total, "approx": False,
                         "what": ["full prompt of call #%d: system prompt + tools + conversation so far" % c.n]})
        else:
            prev = calls[i - 1]
            delta = c.prompt_total - prev.prompt_total
            a = min(prev.tok["output"], delta)
            segs.append({"label": "A%d" % prev.n, "size": a, "approx": True, "what": describe_response(prev)})
            req = build_request(c)
            prev_uuids = {r.get("uuid") for r in prev.records}
            after, seen = [], False
            for r in req["records"]:
                if r.get("uuid") in prev_uuids:
                    seen, after = True, []
                elif seen:
                    after.append(r)
            segs.append({"label": "Q%d" % prev.n, "size": delta - a, "approx": True, "what": describe_records(after, agent)})
        counts.append(len(segs))
    return segs, counts


def covered(segs, lo, hi):
    out, pos = [], 0
    for s in segs:
        a, b = pos, pos + s["size"]
        pos = b
        if s["size"] == 0 and lo <= a < hi:
            out.append(s["label"])
        elif a < hi and b > lo:
            out.append(s["label"] + ("" if (a >= lo and b <= hi) else "~"))
    if len(out) > 6:
        return "%s %s … %s %s" % (out[0], out[1], out[-2], out[-1])
    return " ".join(out) or "—"


def ribbon(a, segs, total_cells):
    """Segment ribbon (P/A/Q colored, alternating shade) + label row."""
    cells = alloc([(max(1, s["size"]), "x") for s in segs], total_cells)
    top, lab = "", ""
    for i, (s, n) in enumerate(zip(segs, cells)):
        if not n:
            continue
        col = SEG_COLOR[s["label"][0]]
        top += a(("█" if i % 2 == 0 else "▓") * n, col)
        tag = s["label"]
        lab += a(tag + " " * (n - len(tag)), col) if n > len(tag) else " " * n
    return top, lab


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--legend", action="store_true", help="list every segment and what it contained")
    ap.add_argument("--compact", action="store_true", help="bars only, no segment lines")
    ap.add_argument("--no-color", action="store_true")
    args = ap.parse_args()
    a = Ansi(sys.stdout.isatty() and not args.no_color)
    W = term_width(140)

    sid, agents = load_agents()
    all_calls = [c for ag in agents for c in ag.calls]
    plain = sum(c.prompt_total for c in all_calls) or 1
    read = sum(c.tok["cache_read"] for c in all_calls)
    eff = sum(c.tok["input"] + c.tok["cache_read"] * READ_X + c.tok["cw_5m"] * WRITE_5M_X + c.tok["cw_1h"] * WRITE_1H_X
              + (0 if (c.tok["cw_5m"] or c.tok["cw_1h"]) else c.tok["cache_write"] * WRITE_5M_X) for c in all_calls)
    hit = read / plain
    gauge = a("▕", "faint") + a.spans(bar_spans([(hit, "green"), (1 - hit, "track")], 30)) + a("▏", "faint")
    head = [a("cache hit ", "grey") + gauge + a(" %.1f%%" % (hit * 100), "green", bold=True)
            + a("    billed as ", "grey") + a("≈%s" % human(eff), "white", bold=True) + a(" of %s prompt tokens" % human(plain), "grey")
            + a("  (%.0f%% · saved ≈%s)" % (100 * eff / plain, human(plain - eff)), "yellow"),
            " ".join([chip(a, "█ READ 0.1×", "black", "green"), chip(a, "█ WRITE 1.25× / 2× (1h)", "black", "yellow"),
                      chip(a, "█ NEW 1×", "black", "red"), a("   segments:", "grey"), chip(a, "P prefix", "black", "violet"),
                      chip(a, "A answer", "black", "cyan"), chip(a, "Q question/input", "black", "orange")])]
    for ln in panel(a, "◆ PROMPT CACHE · session %s" % sid, head, W, "violet", "%d API calls · %d agents" % (len(all_calls), len(agents))):
        print(ln)

    for ag in agents:
        if not ag.calls:
            continue
        segs, counts = segments_for(ag)
        prompts = [c.prompt_total for c in ag.calls]
        ag_plain = sum(prompts)
        ag_hit = sum(c.tok["cache_read"] for c in ag.calls) / max(1, ag_plain)
        title = ag.label + ("" if ag.id == "main" else " · %s" % ag.meta.get("description", ""))
        print()
        print(rule(a, title, W, "pink", "%d calls · hit %.1f%% · prompt growth %s" % (len(ag.calls), ag_hit * 100, spark(prompts))))
        scale = max(prompts)
        bar_w = max(20, W - 66)
        print(a("  %-4s %-9s %s  %7s %7s %7s %5s %4s  %s" % ("call", "time", "prompt (∝ size) ".ljust(bar_w + 2), "prompt", "read", "write", "new", "ttl", "→ out"), "dim"))
        for i, c in enumerate(ag.calls):
            t = c.tok
            mine = segs[: counts[i]]
            cr, cw, inp = t["cache_read"], t["cache_write"], t["input"]
            ttl = "1h" if t["cw_1h"] and not t["cw_5m"] else "5m" if t["cw_5m"] and not t["cw_1h"] else "mix" if cw else "-"
            filled = max(1, round(bar_w * c.prompt_total / scale))
            bar = a("▕", "faint") + a.spans(bar_spans([(cr, "green"), (cw, "yellow"), (inp, "red")], bar_w, filled, " ")) + a("▏", "faint")
            print("  %s %s %s  %s %s %s %s %s  %s" % (
                a("#%-3d" % c.n, "white", bold=True), a("%-9s" % hhmmss(c.ts), "dim"), bar,
                a("%7s" % human(c.prompt_total), "white"), a("%7s" % human(cr), "green"), a("%7s" % human(cw), "yellow"),
                a("%5s" % human(inp), "red"), a("%4s" % ttl, "dim"), a("→ " + human(t["output"]), "cyan")))
            if not args.compact:
                parts = [a("read ", "dim") + a(covered(mine, 0, cr), "green"),
                         a("write ", "dim") + a(covered(mine, cr, cr + cw), "yellow"),
                         a("new ", "dim") + a(covered(mine, cr + cw, cr + cw + inp), "red"),
                         a("out ", "dim") + a("A%d" % c.n, "cyan")]
                note = ""
                prev = ag.calls[i - 1] if i else None
                if i == 0 and cr:
                    note = "prefix already cached by an earlier request (system prompt + tools)"
                elif prev and mine[-1]["label"].startswith("P"):
                    note = "prompt shrank → new prefix, earlier cache not reusable"
                elif prev and cr < prev.prompt_total - prev.tok["input"]:
                    note = "part of the cached prefix had to be re-written"
                print("       " + a("↳ ", "faint") + a(" · ", "faint").join(parts) + (a("   ⚠ " + note, "orange") if note else ""))

        last = ag.calls[-1]
        mine = segs[: counts[-1]]
        cells = W - 14
        top, lab = ribbon(a, mine, cells)
        reg = a.spans(bar_spans([(last.tok["cache_read"], "green"), (last.tok["cache_write"], "yellow"), (last.tok["input"], "red")], cells))
        print()
        print("  " + a("PREFIX MAP", "white", bold=True) + a("  final prompt of call #%d · %s tokens · %d segments" % (last.n, human(last.prompt_total), len(mine)), "grey"))
        print("  " + a("segments  ", "dim") + top)
        print("  " + a("          ", "dim") + lab)
        print("  " + a("cache     ", "dim") + reg)

        if args.legend:
            print()
            print("  " + a("SEGMENTS", "white", bold=True))
            for s in segs:
                col = SEG_COLOR[s["label"][0]]
                what = "; ".join(s["what"]) or "(no recorded content: tokens added by the harness)"
                print("   %s %s  %s" % (a("%-5s" % s["label"], col, bold=True), a("%s%-7s" % ("≈" if s["approx"] else " ", human(s["size"])), "white"),
                                      a(trunc(what, W - 20), "grey")))


if __name__ == "__main__":
    main()
