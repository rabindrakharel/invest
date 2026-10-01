#!/usr/bin/env python3
"""What does the repo know right now, and what must run before answering?

    python3 src/agent-sdk/assets/tools/repo/state/state.py [--intent macro|themes|sentiment|outlook|ticker|corpus|runway|record] [--json]

Step 0 of every interaction (see CLAUDE.md, "How to answer"). Locations come from paths.py. It prints, for each product,
its latest date, its age, and whether it is fresh. For the given intent it prints the
minimal ordered list of commands that brings the answer up to date. Read-only.

Freshness rules (calendar days; weekends count, which is conservative):
  macro, themes, outlook, news   fresh when dated today
  x-sentiment                    fresh when newer than the corpus's last capture
  corpus                         stale after 3 days (needs /fetch, which is metered)
  corpus probe, runway probe     stale after 14 days
"""
from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import paths  # noqa: E402

ROOT = paths.REPO


def latest(part: str, must: str) -> str | None:
    """Newest date with data/research/<date>/<part>/<must>."""
    dates = paths.research_dates(part, must)
    return dates[-1] if dates else None


def corpus() -> dict:
    try:
        out = subprocess.run(["pnpm", "-s", "q", "corpus-freshness", "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60).stdout
        return json.loads(out)[0]
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


def age(d: str | None, today: date) -> int | None:
    return None if not d else (today - date.fromisoformat(d)).days


PLANS = {
    "macro": ["macro-data", "macro-news", "macro-regime"],
    "themes": ["macro-data", "macro-regime", "theme-pulse"],
    "sentiment": ["x-sentiment"],
    "outlook": ["macro-data", "macro-news", "macro-regime", "theme-pulse", "x-sentiment", "market-outlook"],
    "ticker": ["macro-data", "macro-regime", "theme-pulse", "x-sentiment", "ticker-brief"],
    "corpus": ["fetch", "macro-data", "macro-regime", "corpus-probe"],
    "runway": ["macro-data", "macro-regime", "theme-pulse", "x-sentiment", "corpus-probe", "runway-probe"],
    "record": [],
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--intent", choices=sorted(PLANS))
    ap.add_argument("--today", default=date.today().isoformat())
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    today = date.fromisoformat(args.today)
    t = args.today

    c = corpus()
    probes = sorted(paths.corpus_probes().glob("*-probe.html"))
    runway = [p for p in paths.runway_probes() if any((p / f).exists() for f in ("probe.html", "probe.md"))]
    verdicts = paths.ledger()
    xs = latest("sentiment", "x-sentiment.json")
    md = paths.market_dates()
    products = {
        "corpus": {"date": c.get("last_day"), "detail": c, "fresh": age(c.get("last_day"), today) is not None and age(c.get("last_day"), today) <= 3},
        "macro-data": {"date": md[-1] if md else None},
        "macro-news": {"date": latest("macro", "news.json")},
        "macro-regime": {"date": latest("macro", "regime.json"), "judgment": latest("macro", "narrative.json")},
        "theme-pulse": {"date": latest("themes", "themes.json"), "judgment": latest("themes", "theme-narrative.json")},
        "x-sentiment": {"date": xs, "fresh": bool(xs and c.get("last_ingest") and xs >= c["last_ingest"])},
        "market-outlook": {"date": latest("outlook", "outlook.json")},
        "corpus-probe": {"date": probes[-1].name[:10] if probes else None},
        "runway-probe": {"date": max(p.name[:10] for p in runway) if runway else None},
        "verdict-ledger": {"date": None, "rows": sum(1 for _ in verdicts.open()) if verdicts.exists() else 0},
    }
    for k, v in products.items():
        v["age_days"] = age(v["date"], today)
        if "fresh" not in v:
            limit = 14 if k in ("corpus-probe", "runway-probe") else 0
            v["fresh"] = v["age_days"] is not None and v["age_days"] <= limit
        if k == "verdict-ledger":
            v["fresh"] = True

    plan = []
    if args.intent:
        for skill in PLANS[args.intent]:
            p = products.get(skill, {})
            if skill == "fetch":
                if not products["corpus"]["fresh"]:
                    plan.append(f"/fetch \"from {c.get('last_day')} to {t}\"   # METERED (~$0.005/post): ask before running")
            elif skill == "ticker-brief":
                plan.append(f"python3 src/agent-sdk/assets/tools/repo/ticker-brief/ticker_context.py <TICKER> --date {t}")
            elif not p.get("fresh"):
                plan.append(COMMANDS[skill].format(t=t))
    doc = {"today": t, "products": products, "intent": args.intent, "plan": plan}
    if args.json:
        print(json.dumps(doc, indent=1))
        return
    print(f"state as of {t}")
    for k, v in products.items():
        extra = f" rows={v['rows']}" if "rows" in v else ""
        j = f" judgment={v['judgment']}" if v.get("judgment") is not None or "judgment" in v else ""
        print(f"  {'OK ' if v['fresh'] else '-- '} {k:15s} {v['date'] or 'none':10s} age={v['age_days']}{extra}{j}")
    if args.intent:
        print(f"\nplan for intent '{args.intent}':" if plan else f"\nintent '{args.intent}': everything needed is fresh; answer from the files")
        for i, s in enumerate(plan, 1):
            print(f"  {i}. {s}")


COMMANDS = {
    "macro-data": "python3 src/agent-sdk/assets/tools/repo/macro-data/fetch_macro.py --date {t}",
    "macro-news": "/macro-news (background subagent with src/agent-sdk/assets/skills/macro-news/brief.md -> data/research/{t}/macro/news.json)",
    "macro-regime": "python3 src/agent-sdk/assets/tools/repo/macro-regime/compute_regime.py --date {t}  (then write data/research/{t}/macro/narrative.json and rerun)",
    "theme-pulse": "python3 src/agent-sdk/assets/tools/repo/theme-pulse/fetch_theme_prices.py --date {t} && python3 src/agent-sdk/assets/tools/repo/theme-pulse/compute_themes.py --date {t}",
    "x-sentiment": "python3 src/agent-sdk/assets/tools/repo/x-sentiment/compute_x_sentiment.py --date {t}",
    "market-outlook": "python3 src/agent-sdk/assets/tools/repo/market-outlook/build_outlook.py --date {t}  (then write outlook/judgment.json and rerun)",
    "corpus-probe": "/corpus-probe",
    "runway-probe": "/runway-probe",
}

if __name__ == "__main__":
    main()
