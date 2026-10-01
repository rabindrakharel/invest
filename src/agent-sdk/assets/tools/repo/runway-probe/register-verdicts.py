#!/usr/bin/env python3
"""Append this probe's verdicts to the ledger so the next probe can score them.

Usage, from the repo root:
    python3 src/agent-sdk/assets/tools/repo/runway-probe/register-verdicts.py <PROBE_ID>

Reads scorecard.json and verdicts.json from the data directory. verdicts.json is written
by the main agent after the red-team pass, one entry per Runway or One-leg-missing name:

  {"VST": {"edge": "...", "bull": {"price": 240, "p": 0.3, "if": "..."},
           "base": {"price": 200, "p": 0.5, "if": "..."}, "bear": {"price": 120, "p": 0.2, "if": "..."},
           "kill": {"observation": "...", "by": "2026-11-30"}, "premortem": "...",
           "redteam_fact": "...", "size": "core|sleeve|pass", "horizon_months": 12}}

Each ledger line carries the close and date the verdict was made at, so a later probe
can compute the realised return against the scenario tree.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import paths  # noqa: E402


def main(data_dir: Path) -> None:
    score = json.loads((data_dir / "scorecard.json").read_text())
    verdicts = json.loads((data_dir / "verdicts.json").read_text())
    manifest = score.get("manifest", {})
    rows = {r["ticker"]: r for r in score["rows"]}
    ledger = paths.ledger()
    ledger.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with ledger.open("a") as fh:
        for ticker, vd in verdicts.items():
            r = rows.get(ticker)
            if r is None:
                print(f"skip {ticker}: not in scorecard")
                continue
            tree = {k: vd[k] for k in ("bull", "base", "bear")}
            close = r["close"]
            exp = sum(tree[k]["p"] * (tree[k]["price"] / close - 1) for k in tree) if close else None
            fh.write(json.dumps({
                "registered_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "probe": manifest.get("window_end"), "ticker": ticker,
                "close": close, "price_as_of": r["price_as_of"],
                # The red team can move a verdict down; the mechanical tier is kept beside it.
                "tier": vd.get("tier_override", r["tier"]), "tier_mechanical": r["tier"],
                "total": r["total"], "gates_failed": r["gates_failed"],
                "edge": vd.get("edge"), "scenarios": tree, "expected_return": exp,
                "bear_loss": (tree["bear"]["price"] / close - 1) if close else None,
                "kill": vd.get("kill"), "premortem": vd.get("premortem"),
                "redteam_fact": vd.get("redteam_fact"), "size": vd.get("size"),
                "horizon_months": vd.get("horizon_months", 12),
            }) + "\n")
            written += 1
    print(f"{written} verdicts appended to {ledger}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: register-verdicts.py <PROBE_ID>   (or a records directory)")
    arg = Path(sys.argv[1])
    # A probe id (2026-09-17, 2026-09-18-zeta-abcl) resolves through paths.py; a directory is used as given.
    main(arg if arg.is_dir() else paths.runway_records(sys.argv[1]))
