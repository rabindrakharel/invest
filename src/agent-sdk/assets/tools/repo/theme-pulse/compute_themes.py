#!/usr/bin/env python3
"""Score benchmarks and thematic baskets on price direction, breadth and leadership.

    python3 src/agent-sdk/assets/tools/repo/theme-pulse/compute_themes.py [--date YYYY-MM-DD]

Locations come from src/agent-sdk/assets/tools/repo/lib/paths.py. It reads prices from data/market/<DATE>/yahoo/
and, when present, data/research/<DATE>/macro/regime.json. It writes
data/research/<DATE>/themes/.

Each theme in config/themes.json becomes an equal-weight daily basket (the mean of member
daily returns on days both closes exist, chained into an index).  For every basket:
returns over 1w/1m/3m/6m/12m, relative return against its benchmark and SPY, trend state
against its 50d and 200d, breadth (members above their 50d and 200d), drawdown from the
52-week high, dispersion, leaders and laggards, a direction label and a -2..+2 price score.
When the day's regime exists, each theme also carries its archetype's macro fit.

Writes themes.json and themes.md.  Deterministic over the raw directory.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parents[6]
sys.path.insert(0, str(ROOT / "src" / "agent-sdk" / "assets" / "tools" / "repo" / "macro-data"))
from catalog import safe_name  # noqa: E402

sys.path.insert(0, str(ROOT / "src" / "agent-sdk" / "assets" / "tools" / "repo" / "lib"))
import paths  # noqa: E402

WINDOWS = {"1w": 5, "1m": 21, "3m": 63, "6m": 126, "12m": 252}


def load(raw: Path, sym: str) -> dict[str, float] | None:
    p = raw / "yahoo" / f"{safe_name(sym)}.json"
    if not p.exists():
        return None
    rec = json.loads(p.read_text())
    out = {d: v for d, v in zip(rec["dates"], rec["adjclose"]) if v}
    return out or None


def r(x, n=1):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(x, n)


def ret(series: list[float], n: int) -> float | None:
    return None if len(series) <= n or not series[-1 - n] else (series[-1] / series[-1 - n] - 1) * 100


def sma(series: list[float], n: int) -> float | None:
    return None if len(series) < n else sum(series[-n:]) / n


def basket(closes: dict[str, dict[str, float]], members: list[str]) -> tuple[list[str], list[float]]:
    """Equal-weight index from member daily returns, on the union of trading days."""
    have = [m for m in members if m in closes]
    days = sorted({d for m in have for d in closes[m]})
    idx, level, prev = [], 100.0, None
    out_days = []
    for d in days:
        if prev is not None:
            rs = [closes[m][d] / closes[m][prev] - 1 for m in have if d in closes[m] and prev in closes[m]]
            if rs:
                level *= 1 + sum(rs) / len(rs)
        prev = d
        out_days.append(d)
        idx.append(level)
    return out_days, idx


def series_of(closes: dict[str, float]) -> list[float]:
    return [closes[d] for d in sorted(closes)]


def direction(rel1: float | None, rel3: float | None) -> str:
    if rel1 is None or rel3 is None:
        return "unknown"
    pace = rel3 / 3
    if rel3 > 0 and rel1 > 0:
        return "accelerating" if rel1 > pace + 1 else ("steady leader" if rel1 >= pace - 1 else "leader, slowing")
    if rel3 > 0 and rel1 <= 0:
        return "fading"
    if rel3 <= 0 and rel1 > 0:
        return "improving"
    return "lagging, worsening" if rel1 < pace - 1 else "lagging"


def trend(level: float, s50: float | None, s200: float | None) -> str:
    if s50 is None or s200 is None:
        return "short history"
    if level > s50 > s200:
        return "uptrend"
    if level < s50 < s200:
        return "downtrend"
    if level > s200:
        return "above 200d, pulling back" if level < s50 else "above 200d, 50d below 200d"
    return "below 200d, basing" if level > s50 else "below 200d"


def price_score(rel1, rel3, breadth50, tr) -> int:
    s = 0.0
    s += 1 if (rel3 or 0) >= 5 else (-1 if (rel3 or 0) <= -5 else 0)
    s += 0.5 if (rel1 or 0) >= 2 else (-0.5 if (rel1 or 0) <= -2 else 0)
    s += 0.5 if (breadth50 or 0) >= 60 else (-0.5 if (breadth50 or 0) <= 35 else 0)
    s += {"uptrend": 0.5, "downtrend": -0.5}.get(tr, 0)
    return int(max(-2, min(2, round(s))))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=paths.today())
    ap.add_argument("--themes", type=Path, default=ROOT / "config" / "themes.json")
    ap.add_argument("--raw", type=Path, help="override data/market/<DATE> (tests only)")
    ap.add_argument("--out", type=Path, help="override data/research/<DATE>/themes (tests only)")
    args = ap.parse_args()
    args.raw = args.raw or paths.market(args.date)
    args.out = args.out or paths.research(args.date, "themes")
    args.regime = paths.research(args.date, "macro") / "regime.json"
    cfg = json.loads(args.themes.read_text())
    regime = json.loads(args.regime.read_text()) if args.regime and args.regime.exists() else None

    syms = {b["symbol"] for b in cfg["benchmarks"]}
    for t in cfg["themes"]:
        syms |= set(t["members"]) | {t["benchmark"]} | ({t["etf"]} if t.get("etf") else set())
    closes = {s: c for s in sorted(syms) if (c := load(args.raw, s))}
    missing = sorted(syms - set(closes))
    spy = series_of(closes["SPY"]) if "SPY" in closes else []
    as_of = max(closes["SPY"]) if "SPY" in closes else max(max(c) for c in closes.values())

    def rets(s: list[float]) -> dict:
        return {k: r(ret(s, n)) for k, n in WINDOWS.items()}

    bench = []
    for b in cfg["benchmarks"]:
        if b["symbol"] in closes:
            s = series_of(closes[b["symbol"]])
            bench.append({"symbol": b["symbol"], "name": b["name"], **{f"ret_{k}": v for k, v in rets(s).items()},
                          "vs_200d_pct": r((s[-1] / sma(s, 200) - 1) * 100) if sma(s, 200) else None})

    rows = []
    for t in cfg["themes"]:
        days, idx = basket(closes, t["members"])
        if len(idx) < 70:
            rows.append({"id": t["id"], "name": t["name"], "status": "insufficient data"})
            continue
        bm = series_of(closes[t["benchmark"]]) if t["benchmark"] in closes else spy
        R = rets(idx)
        rel = {k: r((R[k] or 0) - (ret(bm, n) or 0)) for k, n in WINDOWS.items() if R[k] is not None}
        rel_spy = {k: r((R[k] or 0) - (ret(spy, n) or 0)) for k, n in WINDOWS.items() if R[k] is not None}
        mem = []
        for m in t["members"]:
            if m not in closes:
                continue
            s = series_of(closes[m])
            mem.append({"symbol": m, "ret_1m": r(ret(s, 21)), "ret_3m": r(ret(s, 63)),
                        "above_50d": bool(sma(s, 50) and s[-1] > sma(s, 50)),
                        "above_200d": bool(sma(s, 200) and s[-1] > sma(s, 200)),
                        "dd_52w_pct": r((s[-1] / max(s[-252:]) - 1) * 100)})
        b50 = r(100 * sum(m["above_50d"] for m in mem) / len(mem), 0)
        b200 = r(100 * sum(m["above_200d"] for m in mem) / len(mem), 0)
        tr = trend(idx[-1], sma(idx, 50), sma(idx, 200))
        d = direction(rel.get("1m"), rel.get("3m"))
        three = [m["ret_3m"] for m in mem if m["ret_3m"] is not None]
        by1m = sorted([m for m in mem if m["ret_1m"] is not None], key=lambda m: -m["ret_1m"])
        etf_cmp = None
        if t.get("etf") and t["etf"] in closes:
            e = series_of(closes[t["etf"]])
            etf_cmp = {"etf": t["etf"], "etf_ret_3m": r(ret(e, 63)), "basket_ret_3m": R["3m"]}
        row = {
            "id": t["id"], "name": t["name"], "group": t["group"], "benchmark": t["benchmark"], "archetype": t["archetype"],
            "status": "ok", "members_priced": len(mem), "members_total": len(t["members"]),
            "returns": R, "rel_benchmark": rel, "rel_spy": rel_spy,
            "trend": tr, "direction": d, "breadth_above_50d_pct": b50, "breadth_above_200d_pct": b200,
            "dd_52w_pct": r((idx[-1] / max(idx[-252:]) - 1) * 100),
            "dispersion_3m_pp": r(statistics.pstdev(three)) if len(three) > 1 else None,
            "leaders_1m": [f"{m['symbol']} {m['ret_1m']:+.1f}%" for m in by1m[:3]],
            "laggards_1m": [f"{m['symbol']} {m['ret_1m']:+.1f}%" for m in by1m[-3:][::-1]],
            "price_score": price_score(rel.get("1m"), rel.get("3m"), b50, tr),
            "etf_check": etf_cmp, "members": mem,
        }
        if regime:
            a = regime.get("archetypes", {}).get(t["archetype"], {})
            row["macro_fit"] = a.get("fit")
            row["macro_stance"] = a.get("stance")
        rows.append(row)

    ok = [x for x in rows if x["status"] == "ok"]
    ranked = sorted(ok, key=lambda x: -(x["rel_spy"].get("3m") or -999))
    for i, x in enumerate(ranked):
        x["rs_rank_3m"] = i + 1
    mag = next((x for x in ok if x["id"] == "mag7"), None)
    rsp = next((b for b in bench if b["symbol"] == "RSP"), None)
    concentration = None
    if mag and rsp:
        concentration = {"mag7_minus_rsp_3m_pp": r((mag["returns"]["3m"] or 0) - (rsp["ret_3m"] or 0)),
                         "mag7_minus_rsp_12m_pp": r((mag["returns"]["12m"] or 0) - (rsp["ret_12m"] or 0)),
                         "read": "mega-cap concentration rising" if (mag["returns"]["3m"] or 0) > (rsp["ret_3m"] or 0) + 3
                         else ("broadening away from mega caps" if (mag["returns"]["3m"] or 0) < (rsp["ret_3m"] or 0) - 3 else "balanced")}
    groups = {}
    for x in ok:
        groups.setdefault(x["group"], []).append(x["rel_spy"].get("3m") or 0)
    doc = {"schema": "theme-pulse/1", "as_of": as_of, "themes_version": cfg.get("version"),
           "benchmarks": bench, "concentration": concentration,
           "groups": {g: r(sum(v) / len(v)) for g, v in sorted(groups.items(), key=lambda kv: -sum(kv[1]) / len(kv[1]))},
           "themes": sorted(rows, key=lambda x: x.get("rs_rank_3m", 999)),
           "missing_symbols": missing,
           "regime": {"label": regime["regime"]["label"], "composite": regime["regime"]["composite"]} if regime else None}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "themes.json").write_text(json.dumps(doc, indent=1))
    (args.out / "themes.md").write_text(render(doc))
    print(f"{len(ok)} themes scored as of {as_of}; missing symbols: {', '.join(missing) or 'none'}")


def f(x, spec="+.1f"):
    return "n/a" if x is None else format(x, spec)


def render(doc: dict) -> str:
    L = [f"# Theme pulse, {doc['as_of']}\n"]
    if doc.get("regime"):
        L.append(f"Macro regime: **{doc['regime']['label']}** ({doc['regime']['composite']:+.1f})\n")
    L.append("## Benchmarks\n\n| Symbol | Name | 1w | 1m | 3m | 6m | 12m | vs 200d |\n|---|---|---:|---:|---:|---:|---:|---:|")
    for b in doc["benchmarks"]:
        L.append(f"| {b['symbol']} | {b['name']} | {f(b['ret_1w'])} | {f(b['ret_1m'])} | {f(b['ret_3m'])} | {f(b['ret_6m'])} | {f(b['ret_12m'])} | {f(b['vs_200d_pct'])} |")
    c = doc.get("concentration")
    if c:
        L.append(f"\nMag 7 minus equal-weight S&P: {f(c['mag7_minus_rsp_3m_pp'])}pp over 3m, {f(c['mag7_minus_rsp_12m_pp'])}pp over 12m: {c['read']}.\n")
    L.append("## Groups (mean 3m return vs SPY)\n")
    L.append(" · ".join(f"{g} {f(v)}pp" for g, v in doc["groups"].items()) + "\n")
    L.append("## Themes (ranked by 3m relative strength vs SPY)\n\n| # | Theme | 1m | 3m | vs bench 1m | vs bench 3m | vs SPY 3m | Trend | Direction | >50d | >200d | DD 52w | Score | Macro fit | Leaders 1m | Laggards 1m |\n|---:|---|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---:|---|---|")
    for x in doc["themes"]:
        if x["status"] != "ok":
            L.append(f"| | {x['name']} | {x['status']} |")
            continue
        L.append(f"| {x['rs_rank_3m']} | {x['name']} ({x['benchmark']}) | {f(x['returns']['1m'])} | {f(x['returns']['3m'])} | {f(x['rel_benchmark'].get('1m'))} | {f(x['rel_benchmark'].get('3m'))} | {f(x['rel_spy'].get('3m'))} | {x['trend']} | {x['direction']} | {f(x['breadth_above_50d_pct'], '.0f')}% | {f(x['breadth_above_200d_pct'], '.0f')}% | {f(x['dd_52w_pct'])} | {x['price_score']:+d} | {f(x.get('macro_fit'))} | {', '.join(x['leaders_1m'])} | {', '.join(x['laggards_1m'])} |")
    if doc["missing_symbols"]:
        L.append(f"\nMissing price files: {', '.join(doc['missing_symbols'])}")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    main()
