#!/usr/bin/env python3
"""Download every series in catalog.py into the day's market directory.

    python3 src/agent-sdk/assets/tools/repo/macro-data/fetch_macro.py [--date YYYY-MM-DD] [--only fred|yahoo]

Writes data/market/<DATE>/ (the location comes from src/agent-sdk/assets/tools/repo/lib/paths.py):
  fred/<ID>.csv          FRED's CSV verbatim (full history)
  yahoo/<SYM>.json       {symbol, dates, close, adjclose, meta} daily for 10y
  yahoo/_GSPC_1mo.json   S&P 500 monthly, max history (analog forward returns)
  _fetch_log.json        one row per request: url, rows, last date, error
/theme-pulse writes its prices into the same yahoo/ directory and log.

Standard library only.  Retries each request three times.  A failed series is logged,
never fatal: the macro-regime engine marks every signal that needed it as "missing".
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import paths  # noqa: E402
from catalog import FRED, YAHOO, YAHOO_CHART, fred_url, safe_name  # noqa: E402

# FRED stalls browser user agents; Yahoo rejects bare library ones.
UA_FRED = "invest-macro/1.0 (research)"
UA_YAHOO = "Mozilla/5.0"  # a full browser string draws 429s without a cookie crumb


def get(url: str, ua: str, tries: int = 4, timeout: int = 45) -> bytes:
    last: Exception | None = None
    for attempt in range(tries):
        # Yahoo throttles one host at a time; alternate query1 and query2 on retry.
        u = url.replace("query1.", "query2.") if attempt % 2 else url
        try:
            with urlopen(Request(u, headers={"User-Agent": ua}), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - logged, retried
            last = e
            throttled = getattr(e, "code", None) == 429
            time.sleep((6 if throttled else 1.5) * (attempt + 1))
    raise RuntimeError(f"{type(last).__name__}: {last}")


def fetch_fred(series_id: str, out: Path) -> dict:
    url = fred_url(series_id)
    row = {"source": "fred", "id": series_id, "url": url}
    try:
        body = get(url, UA_FRED).decode("utf-8")
        lines = [ln for ln in body.strip().splitlines() if ln]
        if len(lines) < 2 or "," not in lines[0]:
            raise RuntimeError("unexpected body")
        (out / "fred" / f"{series_id}.csv").write_text(body)
        row.update(rows=len(lines) - 1, last=lines[-1].split(",")[0])
    except Exception as e:  # noqa: BLE001
        row["error"] = str(e)
    return row


def fetch_yahoo(sym: str, out: Path, rng: str = "10y", interval: str = "1d", suffix: str = "") -> dict:
    from urllib.parse import quote
    url = YAHOO_CHART.format(sym=quote(sym, safe=""), range=rng, interval=interval)
    row = {"source": "yahoo", "id": sym + suffix, "url": url}
    try:
        data = json.loads(get(url, UA_YAHOO))
        res = data["chart"]["result"]
        if not res:
            raise RuntimeError(str(data["chart"].get("error")))
        r = res[0]
        ts = r.get("timestamp") or []
        q = r["indicators"]["quote"][0]
        adj = (r["indicators"].get("adjclose") or [{}])[0].get("adjclose") or q["close"]
        tz = r["meta"].get("gmtoffset", 0)
        dates = [datetime.fromtimestamp(t + tz, tz=timezone.utc).strftime("%Y-%m-%d") for t in ts]
        rec = {
            "symbol": sym, "interval": interval, "dates": dates, "close": q["close"], "adjclose": adj,
            "meta": {k: r["meta"].get(k) for k in ("longName", "currency", "regularMarketPrice", "regularMarketTime", "exchangeName")},
        }
        (out / "yahoo" / f"{safe_name(sym)}{suffix}.json").write_text(json.dumps(rec))
        row.update(rows=len(dates), last=dates[-1] if dates else None)
    except Exception as e:  # noqa: BLE001
        row["error"] = str(e)
    return row


def write_log(out: Path, rows: list[dict], started: str) -> None:
    """Merge this run's rows into the day's fetch log (one log per market directory)."""
    log_path = out / "_fetch_log.json"
    prior = json.loads(log_path.read_text()) if log_path.exists() else {}
    keep = {(r["source"], r["id"]): r for r in prior.get("rows", [])}
    keep.update({(r["source"], r["id"]): {**r, "fetched_at": started} for r in rows})
    # The first fetch of the day is the snapshot cutoff; later top-ups (theme prices, a
    # ticker brief) must not move it, so each row carries its own time instead.
    log = {"fetched_at": prior.get("fetched_at", started), "rows": sorted(keep.values(), key=lambda r: (r["source"], r["id"]))}
    log_path.write_text(json.dumps(log, indent=1))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=paths.today())
    ap.add_argument("--out", type=Path, help="override data/market/<DATE> (tests only)")
    ap.add_argument("--only", choices=["fred", "yahoo"])
    ap.add_argument("--workers", type=int, default=8, help="parallel FRED requests")
    ap.add_argument("--pause", type=float, default=0.8, help="seconds between Yahoo requests")
    args = ap.parse_args()
    args.out = args.out or paths.market(args.date)
    for sub in ("fred", "yahoo"):
        (args.out / sub).mkdir(parents=True, exist_ok=True)

    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = []
    if args.only in (None, "fred"):
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            rows += list(ex.map(lambda s: fetch_fred(s, args.out), [s for s, *_ in FRED]))
    if args.only in (None, "yahoo"):
        # Sequential with a pause: Yahoo answers 429 to parallel bursts.
        for sym, *_ in YAHOO:
            rows.append(fetch_yahoo(sym, args.out))
            time.sleep(args.pause)
        rows.append(fetch_yahoo("^GSPC", args.out, rng="max", interval="1mo", suffix="_1mo"))

    write_log(args.out, rows, started)

    failed = [r for r in rows if "error" in r]
    print(f"fetched {len(rows) - len(failed)}/{len(rows)} series into {args.out}")
    for r in failed:
        print(f"  FAILED {r['source']}:{r['id']}  {r['error']}")


if __name__ == "__main__":
    main()
