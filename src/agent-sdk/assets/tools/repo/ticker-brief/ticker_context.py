#!/usr/bin/env python3
"""Assemble everything the repo already knows about one ticker into a single context file.

    python3 src/agent-sdk/assets/tools/repo/ticker-brief/ticker_context.py NVDA [--date YYYY-MM-DD]

It reads only other skills' latest outputs, on or before the date, and never recomputes
them. Locations come from src/agent-sdk/assets/tools/repo/lib/paths.py:
  config/themes.json + research/<d>/themes/themes.json   theme membership, basket direction, member stats
  research/<d>/outlook/outlook.json                   theme stances, regime call, risk budget
  research/<d>/macro/regime.json                      archetype fit (via the ticker's themes)
  research/<d>/sentiment/x-sentiment.json             attention, tone, stances, cited posts
  probes/runway/*/records/scorecard.json              the latest runway score for the ticker
  ledger/verdicts.jsonl                               registered verdicts, kill criteria
Price stats come from data/market/<DATE>/yahoo/. A missing symbol is fetched there with
the macro-data client.

It writes data/research/<DATE>/tickers/<TICKER>.json.  The brief itself is written by the
agent (see SKILL.md); this file is its evidence.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[6]
sys.path.insert(0, str(ROOT / "src" / "agent-sdk" / "assets" / "tools" / "repo" / "macro-data"))
sys.path.insert(0, str(ROOT / "src" / "agent-sdk" / "assets" / "tools" / "repo" / "lib"))
import paths  # noqa: E402
from catalog import safe_name  # noqa: E402


def newest(part: str, file: str, on_or_before: str) -> tuple[str | None, dict | None]:
    p = paths.latest_research(part, file, on_or_before)
    return (p.parent.parent.name, json.loads(p.read_text())) if p else (None, None)


def price_stats(sym: str, day: str) -> dict | None:
    from datetime import datetime, timezone
    from fetch_macro import fetch_yahoo, write_log  # noqa: E402
    raw = paths.market(day)
    p = raw / "yahoo" / f"{safe_name(sym)}.json"
    if not p.exists():
        # Same directory and fetch log as /macro-data, so every price file keeps its provenance.
        (raw / "yahoo").mkdir(parents=True, exist_ok=True)
        started = datetime.now(timezone.utc).isoformat(timespec="seconds")
        write_log(raw, [fetch_yahoo(sym, raw)], started)
    if not p.exists():
        return None
    rec = json.loads(p.read_text())
    s = [v for v in rec["adjclose"] if v]
    if len(s) < 60:
        return None

    def ret(n):
        return round((s[-1] / s[-1 - n] - 1) * 100, 1) if len(s) > n else None

    def sma(n):
        return sum(s[-n:]) / n if len(s) >= n else None
    return {"close": round(s[-1], 2), "as_of": rec["dates"][-1], "ret_1m": ret(21), "ret_3m": ret(63), "ret_12m": ret(252),
            "above_50d": bool(sma(50) and s[-1] > sma(50)), "above_200d": bool(sma(200) and s[-1] > sma(200)),
            "dd_52w_pct": round((s[-1] / max(s[-252:]) - 1) * 100, 1), "source": f"https://finance.yahoo.com/quote/{sym}"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ticker")
    ap.add_argument("--date", default=paths.today())
    args = ap.parse_args()
    T, D = args.ticker.upper(), args.date

    cfg = json.loads((ROOT / "config" / "themes.json").read_text())
    my_themes = [t for t in cfg["themes"] if T in t["members"]]
    d_themes, themes = newest("themes", "themes.json", D)
    d_out, outlook = newest("outlook", "outlook.json", D)
    d_reg, regime = newest("macro", "regime.json", D)
    d_xs, xs = newest("sentiment", "x-sentiment.json", D)

    theme_rows, member = [], None
    by_id = {t["id"]: t for t in (themes or {}).get("themes", [])}
    stance_by_id = {t["id"]: t for t in (outlook or {}).get("themes", [])}
    for t in my_themes:
        row = by_id.get(t["id"], {})
        m = next((x for x in row.get("members", []) if x["symbol"] == T), None)
        member = member or m
        o = stance_by_id.get(t["id"], {})
        theme_rows.append({"id": t["id"], "name": t["name"], "archetype": t["archetype"], "direction": row.get("direction"),
                           "rel_spy_3m": (row.get("rel_spy") or {}).get("3m"), "trend": row.get("trend"),
                           "breadth_50d": row.get("breadth_above_50d_pct"), "stance": o.get("stance"), "stance_score": o.get("score"),
                           "flags": o.get("flags", [])})
    price = price_stats(T, D)

    archetypes = Counter(t["archetype"] for t in my_themes)
    arch = archetypes.most_common(1)[0][0] if archetypes else None
    fit = (regime or {}).get("archetypes", {}).get(arch) if arch else None

    sym = next((s for s in (xs or {}).get("symbols", []) if s["symbol"] == T), None)

    score = None
    for probe in reversed(paths.runway_probes()):
        p = probe / "records" / "scorecard.json"
        if not p.exists():
            continue
        rows = json.loads(p.read_text()).get("rows", [])
        r = next((x for x in rows if x.get("ticker") == T), None)
        if r:
            score = {"probe": probe.name, "tier": r.get("tier"), "total": r.get("total"), "points": r.get("points"),
                     "gates_failed": r.get("gates_failed"), "upside_pct": r.get("upside_pct"), "risk_reward": r.get("risk_reward"),
                     "close": r.get("close"), "price_as_of": r.get("price_as_of")}
            break
    verdicts = []
    vf = paths.ledger()
    if vf.exists():
        for line in vf.read_text().splitlines():
            v = json.loads(line)
            if v.get("ticker") == T:
                verdicts.append({k: v.get(k) for k in ("probe", "tier", "close", "price_as_of", "expected_return", "kill", "size", "horizon_months")})

    doc = {
        "schema": "ticker-context/1", "ticker": T, "as_of": D,
        "inputs": {"themes": d_themes, "outlook": d_out, "regime": d_reg, "x_sentiment": d_xs,
                   "corpus_last_day": (xs or {}).get("corpus_last_day"), "corpus_stale_days": (xs or {}).get("corpus_stale_days")},
        "regime": None if not outlook else {"call": outlook["regime"]["call"], "gross_exposure_pct": outlook["risk_budget"]["gross_exposure_pct"],
                                            "long_duration_cap_pct": outlook["risk_budget"]["long_duration_cap_pct"]},
        "archetype": arch, "macro_fit": None if not fit else {"fit": fit["fit"], "stance": fit["stance"], "runway_macro_fit_pts": fit["runway_macro_fit_pts"],
                                                             "headwinds": fit["headwinds"], "tailwinds": fit["tailwinds"]},
        "themes": theme_rows,
        "price": member and price and {**price, **{k: member[k] for k in ("above_50d", "above_200d")}} or price,
        "sentiment": sym,
        "runway_score": score,
        "verdicts": verdicts,
        "gaps": [g for g, ok in (("not in any theme basket: add it to config/themes.json if it recurs", bool(my_themes)),
                                 ("no allowlist posts in the sentiment window", bool(sym)),
                                 ("never scored by a runway probe", bool(score)),
                                 ("no price file", bool(price))) if not ok],
    }
    out = paths.research(D, "tickers")
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{T}.json").write_text(json.dumps(doc, indent=1))
    print(json.dumps(doc, indent=1)[:4000])


if __name__ == "__main__":
    main()
