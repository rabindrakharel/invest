"""The one place that knows where data lives. Every Python script imports this module.

The layout is documented in data/README.md. Everything sits under one root:

    data/                       INVEST_DATA_DIR (default <repo>/data)
      corpus/                   the X corpus; the TS pipeline's INVEST_DATA_ROOT
        raw/ posts/ mentions/ picks/ pick_tags/ prices/   Parquet/JSONL layers (append-only rules apply)
        analysis/accounts/      one analysis per account (session ingest)
        analysis/<day>.json     API-lane extraction output
        _session/               subagent bundles (gitignored, regenerable)
      rendered/                 daily/, tickers/, INDEX.md (pnpm task:render; INVEST_OUTPUT_ROOT)
      market/<DATE>/            downloaded market data: fred/, yahoo/, _fetch_log.json (gitignored)
      research/<DATE>/<part>/   skill outputs; part is macro | themes | sentiment | outlook | tickers
      probes/corpus/            <DATE>-probe.html (Corpus Probe pages)
      probes/runway/<ID>/       probe.html|probe.md, evidence.md, records/ (ID is <window_end>[-label])
      probes/runs/<DATE>/       probe build workspaces
      cache/<DATE>-<topic>/     fetched web pages kept as evidence (gitignored)
      reports/                  INDEX.md and <DATE>-<slug>.md (the CLAUDE.md answer protocol)
      ledger/verdicts.jsonl     registered verdicts

To import it from a skill script:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib")); import paths
"""
from __future__ import annotations

from datetime import date
import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[6]
DATA = Path(os.environ.get("INVEST_DATA_DIR", REPO / "data"))
RESEARCH_PARTS = ("macro", "themes", "sentiment", "outlook", "tickers")


def today() -> str:
    return date.today().isoformat()


def corpus() -> Path:
    return Path(os.environ.get("INVEST_DATA_ROOT", DATA / "corpus"))


def session() -> Path:
    return corpus() / "_session"


def accounts() -> Path:
    return corpus() / "analysis" / "accounts"


def rendered() -> Path:
    return Path(os.environ.get("INVEST_OUTPUT_ROOT", DATA / "rendered"))


def market(day: str) -> Path:
    return DATA / "market" / day


def research(day: str, part: str | None = None) -> Path:
    if part is not None and part not in RESEARCH_PARTS:
        raise ValueError(f"unknown research part {part!r}; one of {RESEARCH_PARTS}")
    base = DATA / "research" / day
    return base / part if part else base


def research_dates(part: str, file: str | None = None, on_or_before: str | None = None) -> list[str]:
    """Dates (ascending) that have research/<date>/<part>[/file]."""
    root = DATA / "research"
    out = []
    for d in sorted(root.iterdir()) if root.exists() else []:
        p = d / part
        if p.is_dir() and (file is None or (p / file).exists()) and (on_or_before is None or d.name <= on_or_before):
            out.append(d.name)
    return out


def latest_research(part: str, file: str, on_or_before: str | None = None) -> Path | None:
    dates = research_dates(part, file, on_or_before)
    return research(dates[-1], part) / file if dates else None


def market_dates() -> list[str]:
    root = DATA / "market"
    return sorted(d.name for d in root.iterdir() if (d / "_fetch_log.json").exists()) if root.exists() else []


def corpus_probes() -> Path:
    return DATA / "probes" / "corpus"


def runway_probe(probe_id: str) -> Path:
    """probe_id is <window_end> or <window_end>-<label>."""
    return DATA / "probes" / "runway" / probe_id


def runway_records(probe_id: str) -> Path:
    return runway_probe(probe_id) / "records"


def runway_probes() -> list[Path]:
    root = DATA / "probes" / "runway"
    return sorted(p for p in root.iterdir() if p.is_dir()) if root.exists() else []


def cache(name: str) -> Path:
    return DATA / "cache" / name


def reports() -> Path:
    return DATA / "reports"


def ledger() -> Path:
    return DATA / "ledger" / "verdicts.jsonl"
