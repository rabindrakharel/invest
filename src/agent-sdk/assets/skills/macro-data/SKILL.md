---
name: macro-data
description: Download the macro dataset - about 60 FRED series (Treasury curve 3m-30y, TIPS real yield, term premium, fed funds, IG/HY/CCC spreads, NFCI, STLFSI, Fed balance sheet, TGA, RRP, reserves, claims, payrolls, CPI/PCE, breakevens, oil, mortgage rate, housing starts/permits/sales/supply, Case-Shiller, Fed MBS holdings, fiscal) and about 50 Yahoo series (MOVE, VIX term structure, DXY, USD/JPY, oil, gold, copper, bitcoin, SPY/QQQ/IWM/RSP, Treasury/credit/MBS ETFs, 11 sector ETFs, factor ETFs) into a dated raw directory with a fetch log. Data only, no interpretation. Use before /macro-regime, or when asked to "pull macro data", "refresh the rates/credit/housing data".
argument-hint: "[--date YYYY-MM-DD, default today] [--only fred|yahoo]"
---

# Macro data

This skill has one concern: put a complete, dated, auditable copy of the macro inputs on
disk. It does not score or interpret anything; `/macro-regime` does that.

## Run

```bash
python3 src/agent-sdk/assets/tools/repo/macro-data/fetch_macro.py --out data/market/<DATE>
```

It takes about two minutes. FRED downloads in parallel. Yahoo downloads one symbol at a
time with a pause, because it answers bursts with HTTP 429. It needs only the Python
standard library and no API key.

Rerun only one source with `--only fred` or `--only yahoo`. The fetch log merges, so earlier
successes are kept.

## Output

```
data/market/<DATE>
  fred/<SERIES>.csv        FRED CSV verbatim, full history
  yahoo/<SYMBOL>.json      {symbol, dates, close, adjclose, meta}, daily, 10 years
  yahoo/_GSPC_1mo.json     S&P 500 monthly since 1985
  _fetch_log.json          fetched_at, and one row per series: url, rows, last date, or error
```

`fetched_at` is the snapshot's cutoff. The engine drops points dated after it, such as
scheduled IORB values. The last Yahoo bar can be intraday when the fetch runs during
market hours. Say so if the read depends on it.

## The catalog

`src/agent-sdk/assets/tools/repo/macro-data/catalog.py` is the only list of series. To add a series, add it there once, give
it a pillar, then add a rule in `src/agent-sdk/assets/tools/repo/macro-regime/compute_regime.py`. Never fetch a
series inline elsewhere.

## Source behaviour (append new findings)

| Date | Source | Behaviour | Handling |
|---|---|---|---|
| 2026-09-24 | fred.stlouisfed.org `fredgraph.csv` | Stalls on browser user-agents; fine with a plain one | `UA_FRED = "invest-macro/1.0 (research)"` |
| 2026-09-24 | Yahoo chart API | 429 on a full Chrome UA string and on parallel bursts; fine with `Mozilla/5.0`, sequential | `UA_YAHOO = "Mozilla/5.0"`, `--pause 0.3-0.8`, query1/query2 alternation on retry |
| 2026-09-24 | Yahoo `^MOVE` | `longName` says "Northern Trust iBoxx 5-Year Tar", but the history matches the ICE BofA MOVE (about 170 at SVB, about 164 in March 2020) | use it; ignore the label |
| 2026-09-24 | Yahoo `^GSPC` monthly | `range=max` starts in 1985 only | the analog engine uses the FRED OECD share-price index (1957+) instead |
| 2026-09-24 | FRED monthly series | October 2025 is blank (shutdown); rows are not contiguous months | the engine counts calendar months, never rows |

## Report contract

When invoked through CLAUDE.md's "How to answer" protocol, this skill fills these parts of the standard report. Fills the report's **As of** line (`fetched_at`, last bar dates) and **Gaps** (failed series from `_fetch_log.json`). It has no Answer of its own; `/macro-regime` interprets.
