#!/usr/bin/env python3
"""Cache raw estimates for review. Keys come only from environment; never printed."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import re
from urllib.parse import urlencode
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import paths  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ticker')
    parser.add_argument('--provider', choices=['fmp', 'alphavantage'], required=True)
    parser.add_argument('--date', default=paths.today())
    parser.add_argument('--out', type=Path, help='override data/cache/<DATE>-runway/estimates (raw cache, separate from ticker records)')
    args = parser.parse_args()
    args.out = args.out or paths.cache(f'{args.date}-runway') / 'estimates'
    ticker = args.ticker.upper()
    if not re.fullmatch(r'[A-Z0-9.^-]{1,20}', ticker):
        parser.error('invalid ticker')
    env = 'FMP_API_KEY' if args.provider == 'fmp' else 'ALPHAVANTAGE_API_KEY'
    key = os.environ.get(env)
    if not key:
        parser.exit(2, f'{env} is not set; use the documented web/IR fallback.\n')
    if args.provider == 'fmp':
        base = 'https://financialmodelingprep.com/stable/analyst-estimates'
        params = dict(symbol=ticker, period='annual', page=0, limit=10)
    else:
        base = 'https://www.alphavantage.co/query'
        params = dict(function='EARNINGS_ESTIMATES', symbol=ticker)
    source = base + '?' + urlencode(params)
    try:
        with urlopen(source + '&' + urlencode({'apikey': key}), timeout=30) as response:
            data = json.load(response)
        if not data or isinstance(data, dict) and any(k in data for k in ('Error Message', 'Information', 'Note', 'error', 'Error')):
            parser.exit(2, 'Provider returned no usable data, a rate limit, or an entitlement error; log failure and use fallback.\n')
    except Exception as exc:
        parser.exit(2, f'Fetch failed ({type(exc).__name__}); log failure and use fallback.\n')
    stamp = datetime.now(timezone.utc)
    args.out.mkdir(parents=True, exist_ok=True)
    dest = args.out / f'{ticker}-{args.provider}-{stamp.strftime("%Y%m%dT%H%M%S%fZ")}.json'
    dest.write_text(json.dumps(dict(ticker=ticker, source=source, fetched_at=stamp.isoformat(), data=data), indent=2) + '\n')
    print(dest)


if __name__ == '__main__':
    main()
