---
name: macro-news
description: Collect the dated macro news and outlook for US equities into news.json - the latest FOMC decision, dot plot and priced Fed path, Treasury auctions and refunding, long-end and term-premium drivers, housing and MBS, inflation and oil, labour and growth prints, credit and liquidity, fiscal and geopolitics, sell-side S&P and 10-year outlooks, live market themes with counter-narratives, and a dated events calendar. Every fact carries its URL and page date. Use for "what's the macro news", "Fed and bond market update", "sell-side outlooks", or as the narrative input to /macro-regime and /market-outlook.
argument-hint: "[--date YYYY-MM-DD, default today] [--weeks 3]"
---

# Macro news

This skill has one concern: what the world *said* in the last few weeks, with sources.
Numbers come from `/macro-data`. Interpretation happens in `/macro-regime`.

## Run

Launch **one** `general-purpose` subagent in the background, and paste
[brief.md](brief.md) with today's date and the output path
`data/research/<DATE>/macro/news.json`. It takes about 10 minutes and about 130 tool
calls. Do other work while it runs, and do not do its searches yourself.

When it returns:

1. Check that `news.json` parses and that every list item has `source` and `as_of`.
2. Reconcile it against the data files, following the rules at the foot of `brief.md`.
   For levels, the data files win; for decisions, quotes, auctions and guidance, the news
   wins. Carry each disagreement into `narrative.json.reconciliation` when `/macro-regime`
   writes it.
3. Add any failing site to the `failures` list. The next run's brief can then skip it.

## Output contract

`news.json` has keys `fed`, `rates_long_end`, `housing_mbs`, `inflation_oil`,
`growth_labour`, `credit_liquidity`, `fiscal_geopolitics`, `outlooks`, `themes`, `events`
and `failures`. The shape is in `brief.md`. `themes` and `events` are read directly by
`/macro-regime` (into `narrative.json`), by `/theme-pulse` (theme direction) and by the
Runway Probe's legacy `macro.json`.

## Report contract

When invoked through CLAUDE.md's "How to answer" protocol, this skill fills these parts of the standard report. Fills **What would change it** (dated `events`) and cited context for **Why** (Fed decisions, auctions, outlooks). The reconciliation rows go to **Gaps**.
