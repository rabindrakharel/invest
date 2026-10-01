#!/usr/bin/env python3
"""Scan the raw session bundles for posts that mention a ticker together with an
analyst or institutional keyword. Run from the repo root:

    python3 src/agent-sdk/assets/tools/repo/runway-probe/mine-corpus-signals.py VST AVGO RKLB

Prints one block per ticker: trading_day, account, A (analyst) / I (institutional or
insider), post_id, and the first 400 characters of the post. This is corpus-side
context only; the runway probe's numbers come from the web research pass.
"""
import glob
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import paths  # noqa: E402

ANALYST = re.compile(
    r"upgrad|downgrad|initiat|price target|\bPT\b|\btarget\b|overweight|outperform|"
    r"buy rating|reiterat|analyst|Morgan Stanley|Goldman|JPMorgan|\bJPM\b|BofA|Bernstein|"
    r"Berenberg|Baird|UBS|Citi|Wells|Jefferies|Evercore|Wedbush|Piper|Needham|Stifel|"
    r"Barclays|Mizuho|KeyBanc|Raymond|Truist|Oppenheimer|Cantor|Rosenblatt|Wolfe|"
    r"TD Cowen|HSBC|Deutsche|Scotia|BMO|RBC|Macquarie", re.I)
INSTITUTION = re.compile(
    r"13F|Berkshire|Buffett|institution|hedge fund|fund manager|\bstake\b|accumulat|"
    r"insider|Form 4|bought|purchase|10% owner|\bCEO\b|director|whale|Burry|Tepper|"
    r"Druckenmiller|Ackman|Soros|Renaissance|Citadel|Millennium|Point72|Tiger|Coatue|"
    r"Baillie|Viking|Appaloosa|Corvex", re.I)


def mentions(ticker: str, text: str) -> bool:
    return re.search(r"(?<![A-Za-z])\$?" + re.escape(ticker) + r"(?![A-Za-z])", text) is not None


def main(tickers: list[str]) -> None:
    hits: dict[str, list[tuple]] = {t: [] for t in tickers}
    for path in sorted(glob.glob(str(paths.session() / "*.posts.jsonl"))):
        handle = os.path.basename(path).split(".")[0]
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                post = json.loads(line)
                text = post["text"]
                for t in tickers:
                    if not mentions(t, text):
                        continue
                    kinds = ("A" if ANALYST.search(text) else "") + ("I" if INSTITUTION.search(text) else "")
                    if kinds:
                        hits[t].append((post["trading_day"], handle, kinds, post["post_id"], text.replace("\n", " ")[:400]))
    for t in tickers:
        rows = sorted(hits[t])
        print(f"\n##### {t}  ({len(rows)} posts)")
        for day, handle, kinds, pid, text in rows:
            print(f"{day} {handle:16} {kinds:2} {pid} | {text}")


if __name__ == "__main__":
    if len(sys.argv) < 2 or not paths.session().is_dir():
        sys.exit("usage (from repo root, after `pnpm task:session-dump`): mine-corpus-signals.py TICKER [TICKER ...]")
    main([a.upper() for a in sys.argv[1:]])
