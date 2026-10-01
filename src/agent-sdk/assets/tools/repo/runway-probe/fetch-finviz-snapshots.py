#!/usr/bin/env python3
"""Persist current Finviz quote snapshots for a reviewed ticker list.

The raw HTML is retained beside a compact JSON extraction so every displayed
metric can be audited.  Finviz is an aggregator, so these fields remain a
secondary source and never substitute for SEC Form 4 or issuer guidance.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import paths  # noqa: E402


class SnapshotParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.mode: str | None = None
        self.buf: list[str] = []
        self.pending: str | None = None
        self.values: dict[str, str] = {}

    def handle_starttag(self, tag, attrs):
        classes = dict(attrs).get("class", "").split()
        if tag == "div" and "snapshot-td-label" in classes:
            self.mode, self.buf = "label", []
        elif tag == "div" and "snapshot-td-content" in classes:
            self.mode, self.buf = "content", []

    def handle_data(self, data):
        if self.mode:
            self.buf.append(data)

    def handle_endtag(self, tag):
        if tag != "div" or not self.mode:
            return
        value = " ".join(" ".join(self.buf).split())
        if self.mode == "label":
            self.pending = value
        elif self.pending:
            self.values[self.pending] = value
            self.pending = None
        self.mode, self.buf = None, []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("tickers", nargs="+")
    ap.add_argument("--date", default=paths.today())
    ap.add_argument("--pause", type=float, default=1.0, help="seconds between requests")
    ap.add_argument("--out", type=Path, help="override data/cache/<DATE>-runway/finviz")
    args = ap.parse_args()
    args.out = args.out or paths.cache(f"{args.date}-runway") / "finviz"
    args.out.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).isoformat()
    rows, failed = [], []
    for ticker in [x.upper() for x in args.tickers]:
        url = f"https://finviz.com/quote.ashx?t={ticker}&p=d"
        req = Request(url, headers={"User-Agent": "Mozilla/5.0 corpus-runway-research/1.0"})
        try:
            with urlopen(req, timeout=30) as response:
                raw = response.read().decode("utf-8", errors="replace")
        except Exception as exc:  # a delisted, foreign or private symbol; log it and go on
            failed.append({"ticker": ticker, "source": url, "error": str(exc)})
            continue
        time.sleep(args.pause)
        (args.out / f"{ticker}-finviz.html").write_text(raw)
        parser = SnapshotParser()
        parser.feed(raw)
        title_match = re.search(r"<title>(.*?)</title>", raw, re.S | re.I)
        rows.append({
            "ticker": ticker,
            "source": url,
            "fetched_at": fetched_at,
            "title": unescape(title_match.group(1).strip()) if title_match else ticker,
            "metrics": parser.values,
        })
    (args.out / "finviz-snapshots.json").write_text(json.dumps(rows, indent=2) + "\n")
    (args.out / "finviz-failed.json").write_text(json.dumps(failed, indent=2) + "\n")
    print(f"persisted {len(rows)} raw snapshots and finviz-snapshots.json; {len(failed)} failed: "
          + " ".join(f["ticker"] for f in failed))


if __name__ == "__main__":
    main()
