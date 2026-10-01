#!/usr/bin/env python3
"""Fill the runway-probe template for 2026-09-24 from records, scorecard, screen and prose.py.
Cells are taken from the records; prose (verdict lines, groupings) comes from prose.py."""
import html, json, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
REC = ROOT / "data/probes/runway/2026-09-24/records"
TPL = ROOT / "src/agent-sdk/assets/skills/runway-probe/template.html"
OUT = ROOT / "data/probes/runway/2026-09-24/probe.html"
import sys; sys.path.insert(0, str(HERE))
import prose  # noqa: E402

score = {r["ticker"]: r for r in json.loads((REC / "scorecard.json").read_text())["rows"]}
screen = {r["ticker"]: r for r in json.loads((HERE / "screen.json").read_text())}
verd = json.loads((REC / "verdicts.json").read_text())


def rec(t):
    return json.loads((REC / f"{t}.json").read_text())


def val(r, *p):
    cur = r
    for k in p:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur.get("value") if isinstance(cur, dict) and "value" in cur else cur


def money(x):
    if x is None: return "n/f"
    return f"${x:,.2f}" if x < 100 else f"${x:,.0f}"


def usd(x):
    if not x: return "$0"
    return f"${x/1e9:.1f}B" if x >= 1e9 else f"${x/1e6:.1f}M" if x >= 1e6 else f"${x/1e3:.0f}K"


def flow(r):
    up, dn = val(r, "institutions", "holders_up"), val(r, "institutions", "holders_down")
    si = val(r, "institutions", "short_pct_float")
    f = f"TTM buyers {up} / sellers {dn}" if up is not None else "not found"
    return f + (f" · SI {si:.1f}%" if isinstance(si, (int, float)) else " · SI n/f")


def insiders(r):
    cov = val(r, "insiders", "coverage_complete")
    buys = val(r, "insiders", "buys_90d") or []
    sells = val(r, "insiders", "sells_90d") or []
    b = [x for x in buys if x.get("transaction_code") == "P"]
    s = [x for x in sells if x.get("transaction_code") == "S"]
    parts = []
    if b:
        top = max(b, key=lambda x: x.get("usd") or 0)
        parts.append(f"Buys {usd(sum(x.get('usd') or 0 for x in b))}, top {html.escape(str(top.get('role') or top.get('name')))} {usd(top.get('usd'))}")
    else:
        parts.append("No buys" if cov else "No Form 4 coverage")
    if s:
        parts.append(f"sells {usd(sum(x.get('usd') or 0 for x in s))}")
    return ". ".join(parts)


def next_event(r):
    c = val(r, "catalysts") or []
    c = [x for x in c if isinstance(x, dict) and (x.get("date") or "") >= "2026-09-24"]
    c.sort(key=lambda x: x.get("date") or "9999")
    if not c: return "not found"
    x = c[0]
    return f"{x['date'][5:]} {html.escape(x.get('event',''))[:48]}{'' if x.get('confirmed') else ' (est.)'}"


def cons(r, t):
    lab, n = val(r, "consensus", "label"), val(r, "consensus", "analysts")
    sc = score[t]["total"]
    rev = val(r, "earnings", "revisions_90d") or "n/f"
    return f"{html.escape(str(lab))}, {n} · <span class=\"num\">{sc}</span>", rev


PILL = {"runway": "core", "one_leg_missing": "watch", "no_runway": "sat"}


def row_appx(t):
    if t in score:
        r = rec(t); s = score[t]
        c, _ = cons(r, t)
        up = s["upside_pct"]
        final = verd.get(t, {}).get("tier_override", s["tier"])
        return (f"<tr><td class=\"tk\">{t}</td><td><span class=\"pill {PILL[final]}\">{prose.TIERLABEL[final]}</span></td>"
                f"<td class=\"num\">{money(s['close'])}</td><td class=\"num\">{money(s['pt_avg'])}</td>"
                f"<td class=\"num\">{'n/f' if up is None else f'{up:+.0f}%'}</td><td>{c}</td><td>{flow(r)}</td><td>{insiders(r)}</td><td>{next_event(r)}</td></tr>")
    x = screen[t]
    up = x["upside_pct"]
    fl = f"Finviz inst trans {x['inst_trans_pct']:+.1f}% · SI {x['short_float_pct']}%" if x["inst_trans_pct"] is not None else "n/f"
    it = f"Finviz insider trans {x['insider_trans_pct']:+.1f}%" if x["insider_trans_pct"] is not None else "n/f"
    return (f"<tr><td class=\"tk\">{t}</td><td><span class=\"pill sat\">screened</span></td><td class=\"num\">{money(x['price'])}</td>"
            f"<td class=\"num\">{money(x['target'])}</td><td class=\"num\">{'n/f' if up is None else f'{up:+.0f}%'}</td>"
            f"<td>Finviz recom {x['recom']} · screen fails {', '.join(x['gates_failed'])}</td><td>{fl}</td><td>{it}</td><td>{html.escape(str(x['earnings']))}</td></tr>")


def runway_rows():
    out = []
    for i, t in enumerate(prose.RUNWAY, 1):
        r, s = rec(t), score[t]
        c, rev = cons(r, t)
        up, rr = s["upside_pct"], s["risk_reward"]
        rrs = "n/m" if rr is None else f"{rr:.1f}:1"
        out.append(f"<tr><td class=\"rk\">{i}</td><td class=\"tk\">{t}</td><td class=\"up\">{up:+.0f}% · {rrs}<span class=\"bar\"><i style=\"width:{min(max(up,0),100):.0f}%\"></i></span></td>"
                   f"<td>{c}; revisions {rev} 90d</td><td>{flow(r)}</td><td>{insiders(r)}</td><td>{prose.BREAK[t]}</td></tr>")
    return "\n".join(out)


def main():
    s = TPL.read_text()
    universe = list(screen)
    universe = [t for t in universe if screen[t]["screen"] != "non_operating"]
    N = len(universe)
    rep = [
        ("<title>MONTH Runway Probe</title>", "<title>September Runway Probe</title>"),
        ("follow-up to the MONTH Corpus Probe · prices at D Mon YYYY close", "every ticker the 14 accounts named, 7 Jul to 25 Sep · prices at 24 Sep 2026 close"),
        (">MONTH Runway Probe</h1>", ">September Runway Probe</h1>"),
        ("LEDE: which of the N names from the corpus probe still have room to run, judged by the three outside signals.", prose.LEDE),
        ("<span><b>Mandate</b> MANDATE</span>", "<span><b>Mandate</b> high return, medium-to-low risk, 1 to 3 years · horizon read 3 to 6 months</span>"),
        ("<span><b>Names probed</b> N</span>", f"<span><b>Names probed</b> {N} screened · {len(score)} researched</span>"),
        ("positions as of D Mon YYYY", "positions as of 30 Jun 2026"),
    ]
    for a, b in rep:
        assert a in s, a; s = s.replace(a, b)
    # tier cards
    names = [" ".join(prose.RUNWAY), " ".join(prose.ONELEG), prose.NORUN_CARD]
    for n in names:
        s = s.replace('<div class="names">TICKERS</div>', f'<div class="names">{n}</div>', 1)
    s = s.replace("dated QUARTER END so N weeks stale", "dated 30 June 2026, so twelve weeks stale")
    s = s.replace("<h2>Runway: the N that pass</h2>", f"<h2>Runway: the {len(prose.RUNWAY)} that pass</h2>")
    s = re.sub(r"<tbody>\s*<tr><td class=\"rk\">1</td>.*?</tbody>", "<tbody>\n" + runway_rows() + "\n      </tbody>", s, count=1, flags=re.S)
    s = re.sub(r"<dl class=\"acct\">.*?</dl>", "<dl class=\"acct\">\n" + prose.ONELEG_DL + "\n  </dl>", s, count=1, flags=re.S)
    s = re.sub(r"<h2>No runway on the numbers</h2>\s*<ul>.*?</ul>", "<h2>No runway on the numbers</h2>\n  <ul>\n" + prose.NORUN_UL + "\n  </ul>", s, count=1, flags=re.S)
    s = re.sub(r"<h2>Fit to the mandate</h2>.*?<!-- 8\.", "<h2>Fit to the mandate</h2>\n" + prose.FIT + "\n\n  <!-- 8.", s, count=1, flags=re.S)
    s = s.replace("<h2>All N names</h2>", f"<h2>All {N} names</h2>")
    s = s.replace("<th>Price D Mon</th>", "<th>Price 24 Sep</th>")
    s = s.replace("<th>Probe tier</th>", "<th>Tier</th>")
    order = prose.RUNWAY + prose.ONELEG + [t for t in sorted(score, key=lambda t: -score[t]["total"]) if t not in prose.RUNWAY + prose.ONELEG] + sorted(t for t in universe if t not in score)
    s = re.sub(r"(<table class=\"appx\">.*?<tbody>).*?(</tbody>)", lambda m: m.group(1) + "\n" + "\n".join(row_appx(t) for t in order) + "\n      " + m.group(2), s, count=1, flags=re.S)
    s = re.sub(r"<p class=\"src\">Probe tier is the MONTH Corpus Probe.*?</p>", prose.APPX_SRC, s, count=1, flags=re.S)
    s = re.sub(r"<div class=\"callout warn\">.*?</div>\s*<p>Three things.*?</p>", prose.LIMITS, s, count=1, flags=re.S)
    s = re.sub(r"<div class=\"foot\">.*?</div>", prose.FOOT, s, count=1, flags=re.S)
    assert "TICKERS" not in s and "MONTH" not in s, "placeholder left"
    OUT.write_text(s)
    print("wrote", OUT, len(s), "bytes;", len(order), "appendix rows")


if __name__ == "__main__":
    main()
