#!/usr/bin/env python3
"""Deterministic part of the Runway Probe scorecard.

Reads data/probes/runway/<PROBE_ID>/records/ (one JSON record per ticker, plus
macro.json, retail.json, stances.json, _manifest.json) and writes, in the same
directory:

  scorecard.json   - per ticker: derived numbers, mechanical points, gates, total
  scorecard.md     - the same as a table, for the evidence file

Mechanical signals are computed here from the rubric in ../scorecard.md so two runs
over the same records give the same points. Judgment signals (prospect, competition,
macro fit, narrative) are read from the record's "judgment" block, which the main agent
fills, and are added without modification.

Usage, from the repo root:
    python3 src/agent-sdk/assets/tools/repo/runway-probe/build-scorecard.py 2026-09-17
"""
from __future__ import annotations

import json
import sys
from forward_metrics import calculate
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import paths  # noqa: E402


def v(rec: dict, *path, default=None):
    """Read a leaf {value,...} object by path; None when missing or null."""
    cur = rec
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    if isinstance(cur, dict) and "value" in cur:
        cur = cur["value"]
    return default if cur is None else cur


def pct(a, b):
    return None if a is None or b in (None, 0) else (a / b - 1.0) * 100.0


# ---------------------------------------------------------------- rubric ----

def upside_pts(up):
    if up is None: return 0
    if up >= 50: return 10
    if up >= 35: return 8
    if up >= 20: return 6
    if up >= 10: return 3
    return 1 if up > 0 else 0


def rr_pts(rr):
    if rr is None: return 0
    if rr >= 3: return 10
    if rr >= 2: return 7
    if rr >= 1.5: return 4
    return 1 if rr > 0 else 0


def earnings_pts(rec):
    ra, re_ = v(rec, "earnings", "revenue_actual"), v(rec, "earnings", "revenue_estimate")
    ea, ee = v(rec, "earnings", "eps_actual"), v(rec, "earnings", "eps_estimate")
    guide = v(rec, "earnings", "guide")
    r90 = v(rec, "earnings", "revisions_90d")
    if ra is None and ea is None:
        return 0, "no print found"
    beat_rev = ra is not None and re_ is not None and ra >= re_
    beat_eps = ea is not None and ee is not None and ea >= ee
    if beat_rev and beat_eps and guide == "raised" and r90 == "up":
        pts, why = 14, "beat both, guide raised, revisions up"
    elif beat_rev and guide in ("raised", "held") and r90 in ("up", "flat"):
        pts, why = 10, "beat, guide held or raised, revisions not down"
    elif guide == "cut" or r90 == "down" or (not beat_rev and not beat_eps):
        pts, why = 3, "miss, guide cut, or revisions down"
    else:
        pts, why = 6, "mixed print"
    fcf, ni = v(rec, "earnings", "fcf_ttm"), v(rec, "earnings", "net_income_ttm")
    if fcf is not None and ni not in (None, 0) and ni > 0 and fcf / ni < 0.7:
        pts, why = min(pts, 6), why + "; cash conversion below 70% caps at 6"
    return pts, why


def insider_pts(rec, close):
    buys = v(rec, "insiders", "buys_90d", default=[]) or []
    sells = v(rec, "insiders", "sells_90d", default=[]) or []
    if v(rec, "insiders", "coverage_complete") is not True:
        return 0, "insider coverage unverified; no conviction credit", False
    buys = [b for b in buys if b.get("transaction_code") == "P" and b.get("open_market") is True and b.get("form4")]
    sells = [s for s in sells if s.get("transaction_code") == "S" and s.get("form4")]
    # Multiple executions by one person are not independent conviction votes.
    unique_buyers = {b.get("name") for b in buys if b.get("name")}
    buy_usd = sum(b.get("usd") or 0 for b in buys)
    officer_buy = any((b.get("role") or "").upper() in ("CEO", "CFO", "PRESIDENT AND CEO", "CHAIRMAN") for b in buys)
    big_buy = any((b.get("usd") or 0) >= 1_000_000 for b in buys)
    hist = " ".join((b.get("history") or "").lower() for b in buys)
    first_in_years = "first" in hist or "largest" in hist
    open_sells = [s for s in sells if s.get("plan_10b5_1") is False]
    sell_usd = sum(s.get("usd") or 0 for s in sells)
    ceo_sell_big = any((s.get("role") or "").upper() == "CEO" and (s.get("usd") or 0) >= 50_000_000 for s in sells)
    hi, lo = v(rec, "price", "high_52w"), v(rec, "price", "low_52w")
    drawdown = pct(close, hi) if close and hi else None
    after_drawdown = drawdown is not None and drawdown <= -30
    if len(unique_buyers) >= 3 and officer_buy or (officer_buy and first_in_years):
        pts = 10 if after_drawdown else 9
        why = f"{len(buys)} buys incl. officer; ${buy_usd:,.0f}"
    elif big_buy or len(unique_buyers) >= 2:
        pts, why = 7, f"{len(buys)} buys, ${buy_usd:,.0f}"
    elif buys:
        pts, why = 4, f"small buys ${buy_usd:,.0f}"
    elif ceo_sell_big or len(open_sells) >= 3:
        pts, why = 0, f"clustered or CEO selling ${sell_usd:,.0f}, no buys"
    elif sells:
        # Only a sale whose Form 4 box is checked is a plan sale; unverified (None) is said as such.
        plan = "all 10b5-1" if all(s.get("plan_10b5_1") is True for s in sells) else \
               "plan status unverified" if not open_sells else "some outside a plan"
        pts, why = 2, f"no buys; sells ${sell_usd:,.0f} ({plan})"
    else:
        pts, why = 3, "verified no qualifying insider activity; neutral, not positive conviction"
    gate = bool(buys) or (not ceo_sell_big and sell_usd < 50_000_000)
    return pts, why, gate


def institution_pts(rec):
    net = v(rec, "institutions", "net_shares")
    up, down = v(rec, "institutions", "holders_up"), v(rec, "institutions", "holders_down")
    new, exited = v(rec, "institutions", "holders_new"), v(rec, "institutions", "holders_exited")
    adds = v(rec, "institutions", "named_adds", default=[]) or []
    exits = v(rec, "institutions", "named_exits", default=[]) or []
    si = v(rec, "institutions", "short_pct_float")
    count_pos = up is not None and down is not None and up > down
    if net is not None and net > 0 and (new or 0) >= (exited or 0) and adds:
        pts, why = 9, f"net +{net:,.0f} sh, new {new} vs exited {exited}, named adds"
    elif (net is not None and net > 0) or count_pos:
        pts, why = 7, f"net adds or holders up {up} vs down {down}"
    elif net is None and up is None:
        pts, why = 3, "not cleanly measurable"
    elif count_pos is False and (net is None or net <= 0):
        pts, why = 1, f"holders down {down} vs up {up}"
    else:
        pts, why = 4, "mixed"
    if exits and pts <= 4:
        pts, why = 0, why + "; named exits"
    if si is not None and si > 30:
        pts, why = min(pts, 3), why + f"; short interest {si}% of float"
    gate = (net is not None and net > 0) or count_pos or (bool(adds) and not exits)
    return pts, why, gate


def retail_pts(rec, retail_row, close, delivery_ok):
    if retail_row is None:
        return 5, "no corpus data"
    accounts, posts = retail_row.get("accounts") or 0, retail_row.get("posts") or 0
    stances = retail_row.get("stances") or ""
    high_conv_longs = stances.count(":long:0.8") + stances.count(":long:0.9")
    hi = v(rec, "price", "high_52w")
    near_high = close is not None and hi is not None and close >= 0.85 * hi
    drawdown = pct(close, hi) if close and hi else None
    if posts >= 60 and high_conv_longs >= 2 and near_high:
        return 0, f"loudest: {posts} posts, {accounts} accounts, {high_conv_longs} high-conviction longs, near high"
    if posts >= 60 and drawdown is not None and drawdown <= -40:
        return 6, f"loud after a {drawdown:.0f}% drawdown: capitulation watch"
    if posts >= 25:
        return 3, f"loud: {posts} posts across {accounts} accounts"
    if posts <= 12 and delivery_ok:
        return 9, f"quiet with fundamentals: {posts} posts, {accounts} accounts"
    return 6, f"moderate: {posts} posts, {accounts} accounts"


def chart_pts(rec):
    s50, s200 = v(rec, "price", "sma50_pct"), v(rec, "price", "sma200_pct")
    p3, spy3, sec3 = v(rec, "price", "perf_3m_pct"), v(rec, "price", "spy_3m_pct"), v(rec, "price", "sector_3m_pct")
    gap = v(rec, "price", "print_gap_held")
    structure = v(rec, "price", "structure")
    if s50 is None or s200 is None:
        return 0, "moving averages not found"
    rs = None if p3 is None or sec3 is None else p3 - sec3
    above_both = s50 > 0 and s200 > 0
    fifty_over_200 = s50 < s200  # price further above the 200 than the 50 means the 50 sits above the 200
    if above_both and fifty_over_200 and (rs is None or rs > 0) and gap is not False:
        return 5, f"above both averages, RS 3m {rs if rs is not None else 'n/a'}"
    if s200 > 0 or structure in ("breakout",):
        return 3, f"above the 200 ({s200:+.1f}%) or breaking out; RS 3m {rs}"
    if s200 <= 0 and structure in ("base",):
        return 2, f"below the 200 ({s200:+.1f}%) in a base"
    return 0, f"below both ({s50:+.1f}% / {s200:+.1f}%), structure {structure}"


# --------------------------------------------------------------- main -------

def build(data_dir: Path) -> None:
    manifest = json.loads((data_dir / "_manifest.json").read_text()) if (data_dir / "_manifest.json").exists() else {}
    retail = {r["symbol"]: r for r in json.loads((data_dir / "retail.json").read_text())} if (data_dir / "retail.json").exists() else {}
    rows = []
    for path in sorted(data_dir.glob("*.json")):
        if path.name in ("macro.json", "retail.json", "stances.json", "_manifest.json", "scorecard.json", "verdicts.json"):
            continue
        rec = json.loads(path.read_text())
        if not isinstance(rec, dict) or "ticker" not in rec:
            continue
        t = rec["ticker"]
        forward = calculate(rec, manifest.get("price_date") or date.today().isoformat())
        close = v(rec, "price", "close")
        hi, lo = v(rec, "price", "high_52w"), v(rec, "price", "low_52w")
        pt_avg, pt_low, pt_alt = v(rec, "consensus", "pt_avg"), v(rec, "consensus", "pt_low"), v(rec, "consensus", "pt_avg_alt")
        upside = pct(pt_avg, close)
        upside_alt = pct(pt_alt, close) if pt_alt else None
        upside_low = min(x for x in (upside, upside_alt) if x is not None) if upside is not None else None
        drawdown = pct(close, hi)
        # Downside anchor: the highest of the low target, the 52w low, and the 200-day if price is above it.
        s200 = v(rec, "price", "sma200_pct")
        sma200_px = close / (1 + s200 / 100) if close and s200 is not None else None
        # An anchor closer than 5% below the close makes the ratio arithmetic, not analysis
        # (QCOM 26.9:1, RKT 60.7:1 in September 2026); fall back to the next anchor down.
        anchors = [x for x in (pt_low, lo, sma200_px if (s200 is not None and s200 > 0) else None)
                   if x is not None and close and x <= close * 0.95]
        anchor = max(anchors) if anchors else None
        rr = None
        if close and pt_avg and anchor and close > anchor:
            rr = (pt_avg - close) / (close - anchor)
        e_pts, e_why = earnings_pts(rec)
        guide, r90 = v(rec, "earnings", "guide"), v(rec, "earnings", "revisions_90d")
        ra, re_ = v(rec, "earnings", "revenue_actual"), v(rec, "earnings", "revenue_estimate")
        # "none" means no guidance as a matter of policy: neutral, so the print and the
        # revision direction decide the gate (PLPC, TPL, GS, GOOGL do not guide).
        delivery = (ra is not None and re_ is not None and ra >= re_) and guide in ("raised", "held", "none") and r90 in ("up", "flat", None)
        i_pts, i_why, i_gate = insider_pts(rec, close)
        f_pts, f_why, f_gate = institution_pts(rec)
        r_pts, r_why = retail_pts(rec, retail.get(t), close, delivery)
        c_pts, c_why = chart_pts(rec)
        j = rec.get("judgment") or {}
        judgment = {k: j.get(k) for k in ("prospect_pts", "competition_pts", "macro_fit_pts", "narrative_pts")}
        missing_judgment = [k for k, val in judgment.items() if val is None]
        upside_gate = upside is not None and (upside >= 20 if upside_alt is None or abs(upside - upside_alt) <= 10 else upside_low >= 25)
        gates = {"upside": bool(upside_gate), "flow": bool(f_gate), "insider": bool(i_gate), "delivery": bool(delivery)}
        fails = [k for k, ok in gates.items() if not ok]
        if not fails and rr is not None and rr >= 2:
            tier = "runway"
        elif len(fails) == 1 and (upside is None or upside > 0) and (rr is None or rr >= 1.5):
            tier = "one_leg_missing"
        else:
            tier = "no_runway"
        mech = upside_pts(upside) + rr_pts(rr) + e_pts + i_pts + f_pts + r_pts + c_pts
        total = mech + sum(val or 0 for val in judgment.values())
        rows.append({
            "forward_quality": forward,
            "ticker": t, "probe_tier": rec.get("probe_tier"),
            "close": close, "price_as_of": (rec.get("price") or {}).get("close", {}).get("as_of"),
            "drawdown_pct": drawdown, "pt_avg": pt_avg, "pt_avg_alt": pt_alt,
            "upside_pct": upside, "upside_alt_pct": upside_alt,
            "downside_anchor": anchor, "risk_reward": rr,
            "points": {
                "earnings": e_pts, "prospect": judgment["prospect_pts"], "competition": judgment["competition_pts"],
                "insider": i_pts, "institutional": f_pts, "retail": r_pts,
                "upside": upside_pts(upside), "risk_reward": rr_pts(rr), "chart": c_pts,
                "macro_fit": judgment["macro_fit_pts"], "narrative": judgment["narrative_pts"],
            },
            "why": {"earnings": e_why, "insider": i_why, "institutional": f_why, "retail": r_why, "chart": c_why},
            "gates": gates, "gates_failed": fails, "tier": tier,
            "total": total, "judgment_missing": missing_judgment,
        })
    order = {"runway": 0, "one_leg_missing": 1, "no_runway": 2}
    rows.sort(key=lambda r: (order[r["tier"]], -r["total"], -(r["upside_pct"] or 0)))
    (data_dir / "scorecard.json").write_text(json.dumps({"manifest": manifest, "rows": rows}, indent=2) + "\n")

    def f(x, d=0):
        return "n/f" if x is None else (f"{x:.{d}f}")
    lines = ["| # | Ticker | Tier | Close | Upside | R:R | Earn | Prosp | Comp | Insd | Inst | Retail | Up | RR | Chart | Macro | Narr | Total | Gates failed |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        p = r["points"]
        lines.append(f"| {i} | {r['ticker']} | {r['tier']} | {f(r['close'],2)} | {f(r['upside_pct'])}% | {f(r['risk_reward'],1)} | "
                     f"{p['earnings']} | {p['prospect'] if p['prospect'] is not None else '?'} | {p['competition'] if p['competition'] is not None else '?'} | "
                     f"{p['insider']} | {p['institutional']} | {p['retail']} | {p['upside']} | {p['risk_reward']} | {p['chart']} | "
                     f"{p['macro_fit'] if p['macro_fit'] is not None else '?'} | {p['narrative'] if p['narrative'] is not None else '?'} | {r['total']} | {', '.join(r['gates_failed']) or 'none'} |")
    lines += ["", "Why, per mechanical signal:", ""]
    for r in rows:
        lines.append(f"- **{r['ticker']}** earnings: {r['why']['earnings']}; insider: {r['why']['insider']}; institutional: {r['why']['institutional']}; retail: {r['why']['retail']}; chart: {r['why']['chart']}"
                     + (f"; judgment missing: {', '.join(r['judgment_missing'])}" if r['judgment_missing'] else ""))
    lines += ["", "Forward quality (separate from the legacy total; unknown is not zero):", ""]
    for r in rows:
        fq = r["forward_quality"]
        lines.append(f"- **{r['ticker']}**: {fq['passed']}/{fq['covered']} covered checkpoints passed (6 possible); " + "; ".join(f"{k}={f(val, 2)}" for k, val in fq["metrics"].items()))
        lines.extend(f"  - {issue}" for issue in fq["issues"])
    (data_dir / "scorecard.md").write_text("\n".join(lines) + "\n")
    print(f"{len(rows)} tickers -> {data_dir/'scorecard.json'} and scorecard.md")
    incomplete = [r["ticker"] for r in rows if r["judgment_missing"]]
    if incomplete:
        print(f"judgment blocks incomplete for: {', '.join(incomplete)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: build-scorecard.py <PROBE_ID>   (or a records directory)")
    arg = Path(sys.argv[1])
    # A probe id (2026-09-17, 2026-09-18-zeta-abcl) resolves through paths.py; a directory is used as given.
    build(arg if arg.is_dir() else paths.runway_records(sys.argv[1]))
