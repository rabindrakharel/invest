#!/usr/bin/env python3
"""Download daily prices for every benchmark, theme member and theme ETF in config/themes.json.

    python3 src/agent-sdk/assets/tools/repo/theme-pulse/fetch_theme_prices.py [--date YYYY-MM-DD] [--pause 0.3]

Writes into data/market/<DATE>/yahoo/, the same directory /macro-data fills. A symbol
already there for the day is not downloaded again. Rows are merged into the day's
_fetch_log.json. It uses the macro-data Yahoo client, so one HTTP policy covers the repo.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[6]
sys.path.insert(0, str(ROOT / "src" / "agent-sdk" / "assets" / "tools" / "repo" / "macro-data"))
sys.path.insert(0, str(ROOT / "src" / "agent-sdk" / "assets" / "tools" / "repo" / "lib"))
import paths  # noqa: E402
from catalog import safe_name  # noqa: E402
from fetch_macro import fetch_yahoo, write_log  # noqa: E402


def universe(themes_path: Path) -> list[str]:
    cfg = json.loads(themes_path.read_text())
    syms = {b["symbol"] for b in cfg["benchmarks"]}
    for t in cfg["themes"]:
        syms.update(t["members"])
        syms.add(t["benchmark"])
        if t.get("etf"):
            syms.add(t["etf"])
    return sorted(syms)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=paths.today())
    ap.add_argument("--themes", type=Path, default=ROOT / "config" / "themes.json")
    ap.add_argument("--pause", type=float, default=0.3)
    args = ap.parse_args()
    out = paths.market(args.date)
    (out / "yahoo").mkdir(parents=True, exist_ok=True)

    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows, skipped = [], 0
    for sym in universe(args.themes):
        if (out / "yahoo" / f"{safe_name(sym)}.json").exists():
            skipped += 1
            continue
        rows.append(fetch_yahoo(sym, out))
        time.sleep(args.pause)
    write_log(out, rows, started)
    failed = [r for r in rows if "error" in r]
    print(f"prices: {len(rows) - len(failed)} downloaded, {skipped} already present, {len(failed)} failed, in {out}")
    for r in failed:
        print(f"  FAILED {r['id']}  {r['error']}")


if __name__ == "__main__":
    main()
