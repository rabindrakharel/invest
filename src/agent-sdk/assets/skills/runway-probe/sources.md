# Source registry

One page per field, in a fixed order. The subagent fetches the primary URL with WebFetch
first. It falls back to the next URL only when the primary returns an error, a paywall,
or lacks the field, and it records which URL actually supplied each value. WebSearch is
the last resort, used only to locate a page this registry does not cover, and the
resulting URL is recorded like any other. Replace `TICKER` with the upper-case symbol.

Aggregators are used because they are fetchable without a key. Where a filing is the
authority (Form 4, 13F, 10-Q), the registry lists the EDGAR page as the verification
source for the figures that decide a gate.

## Per ticker

| Field group | Primary | Secondary | Tertiary | Notes |
|---|---|---|---|---|
| Price, 52w high and low, SMA20/50/200 distance, perf week/month/quarter, short float, short ratio, insider and institutional transaction %, target price, analyst recom, next earnings date | `https://finviz.com/quote.ashx?t=TICKER` | `https://stockanalysis.com/stocks/TICKER/` | `https://finance.yahoo.com/quote/TICKER/` | Finviz's snapshot table carries fourteen of the twenty fields in one fetch. Read it first for every name. Its "Target Price" is a consensus mean; do not use it in place of the StockAnalysis figure, record both |
| Consensus label, analyst count, average, high and low targets | `https://stockanalysis.com/stocks/TICKER/forecast/` | `https://www.marketbeat.com/stocks/EXCHANGE/TICKER/forecast/` | `https://finance.yahoo.com/quote/TICKER/analysis/` | StockAnalysis is S&P Global sourced and reflects target cuts fastest. MarketBeat needs the exchange in the path (NASDAQ or NYSE); it lags cuts. Record both when they differ by more than ten points |
| Analyst actions, last 60 days | `https://stockanalysis.com/stocks/TICKER/forecast/` (ratings table at the bottom) | `https://www.marketbeat.com/stocks/EXCHANGE/TICKER/price-target/` | `https://www.tipranks.com/stocks/TICKER/forecast` | TipRanks is often blocked; use only if the first two are thin |
| Last print: revenue and EPS vs estimate, surprise %, print date | `https://www.marketbeat.com/stocks/EXCHANGE/TICKER/earnings/` | `https://stockanalysis.com/stocks/TICKER/financials/?p=quarterly` for the reported figures | company press release on its investor site | MarketBeat lists the consensus at the time of the print. StockAnalysis gives reported numbers but not the estimate |
| Guidance vs consensus | company press release or call transcript summary on the investor site | `https://www.marketbeat.com/stocks/EXCHANGE/TICKER/earnings/` | news coverage of the print (Reuters, Bloomberg, CNBC) | Record the guided range and the consensus it was measured against |
| Estimate revisions 30d and 90d; EPS trend | `https://finance.yahoo.com/quote/TICKER/analysis/` ("EPS Revisions" and "EPS Trend" tables) | `https://stockanalysis.com/stocks/TICKER/forecast/` (estimate tables) | `https://www.zacks.com/stock/quote/TICKER/detailed-estimates` | Yahoo's up/down counts over 7 and 30 days and the current-quarter EPS figure 7, 30, 60, 90 days ago are the revision signal. Zacks is a fallback for the numbers only, never for its rank |
| FCF vs net income, SBC | `https://stockanalysis.com/stocks/TICKER/financials/cash-flow-statement/?p=quarterly` | `https://stockanalysis.com/stocks/TICKER/financials/?p=quarterly` | 10-Q on EDGAR | Cash conversion = FCF / net income, trailing four quarters |
| Gross margin four quarters; peers; forward P/E, EV/sales | `https://stockanalysis.com/stocks/TICKER/financials/ratios/?p=quarterly` and `https://stockanalysis.com/stocks/TICKER/statistics/` | `https://finviz.com/quote.ashx?t=TICKER` (Forward P/E, P/S) | peer pages on StockAnalysis | Name the two peers in the record; fetch their forward P/E and EV/sales from the same page type |
| Insider buys and sells, 90 days | `https://finviz.com/quote.ashx?t=TICKER` (insider table at the foot of the page) | `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=TICKER&type=4&dateb=&owner=include&count=40` | `https://www.marketbeat.com/stocks/EXCHANGE/TICKER/insider-trades/` | Finviz lists open-market buys and sells with role, date, shares, price and value. Verify any buy or sell that decides the insider gate against the Form 4 on EDGAR and record the accession number. OpenInsider is listed nowhere because it blocked every request in September 2026 |
| 13F net flow, holders up and down, new and exited, named adds and exits | `https://fintel.io/so/us/TICKER` | `https://www.marketbeat.com/stocks/EXCHANGE/TICKER/institutional-ownership/` | `https://www.nasdaq.com/market-activity/stocks/TICKER/institutional-holdings` | Fintel returns 403 to some clients; when it does, say so and use MarketBeat holder counts, never its dollar totals (the CalSTRS row corrupts them). Nasdaq times out often. Record the 13F quarter-end date the figures describe |
| Short interest, days to cover, settlement date | `https://finviz.com/quote.ashx?t=TICKER` (Short Float, Short Ratio) | `https://www.nasdaq.com/market-activity/stocks/TICKER/short-interest` | `https://www.marketbeat.com/stocks/EXCHANGE/TICKER/short-interest/` | Finviz shows the latest FINRA settlement figure without the date; the secondary pages carry the date |
| Chart: relative performance vs SPY and sector ETF, 1m and 3m | `https://stockanalysis.com/stocks/TICKER/` (performance) with `https://stockanalysis.com/etf/SPY/` and the sector ETF page | `https://finviz.com/quote.ashx?t=TICKER` (Perf Month, Perf Quarter) with `https://finviz.com/quote.ashx?t=SPY` | Yahoo quote pages | Relative strength = name minus benchmark over the same span. Sector ETF by GICS: XLK, XLC, XLY, XLP, XLV, XLF, XLI, XLE, XLB, XLU, XLRE |
| Print gap held | Finviz Perf Week and the daily chart image described in the fetch, or StockAnalysis history `https://stockanalysis.com/stocks/TICKER/history/` | Yahoo history | none | Compare the close five sessions after the print with the print-day close |
| Catalysts, 3 months | company investor site events page | `https://stockanalysis.com/stocks/TICKER/` (next earnings date) | `https://www.marketbeat.com/stocks/EXCHANGE/TICKER/earnings/` | Mark each date company-confirmed or aggregator estimate |
| Why it fell | news search limited to the last 6 months | company press releases | none | The only field where WebSearch is the primary tool |

## Macro, once per probe

| Item | Primary | Secondary |
|---|---|---|
| Fed funds target range, last decision, vote | `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm` and the latest statement it links | Reuters coverage |
| Priced path | `https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html` | news coverage quoting FedWatch |
| 2y, 10y, 2s10s, 10y real | `https://fred.stlouisfed.org/series/DGS2`, `DGS10`, `T10Y2Y`, `DFII10` | Treasury daily yield curve page |
| IG and HY OAS | `https://fred.stlouisfed.org/series/BAMLC0A0CM`, `BAMLH0A0HYM2` | ICE index pages |
| Dollar index | `https://fred.stlouisfed.org/series/DTWEXBGS` | `https://stockanalysis.com/etf/UUP/` |
| WTI | `https://fred.stlouisfed.org/series/DCOILWTICO` | EIA |
| VIX | `https://fred.stlouisfed.org/series/VIXCLS` | Cboe |
| Payrolls, unemployment, CPI, core CPI | `https://www.bls.gov/news.release/empsit.nr0.htm`, `https://www.bls.gov/news.release/cpi.nr0.htm` | `https://fred.stlouisfed.org/series/PAYEMS`, `UNRATE`, `CPIAUCSL` |
| Index and factor performance 1m and 3m | `https://stockanalysis.com/etf/SPY/`, `QQQ`, `MTUM`, `VLUE`, `QUAL`, `IWM`, `SPHB`, `SPLV` | Finviz ETF quote pages |
| Sector leadership | `https://finviz.com/groups.ashx?g=sector&v=140&o=-perf4w` | StockAnalysis XL* ETF pages |
| Breadth | `https://www.barchart.com/stocks/indices/sp/sp500?viewName=breadth` or news citing % above the 200-day | none |
| Live themes | news search for the last two weeks | the corpus probe's "lens" section |
| Dated macro events | `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm`, `https://www.bls.gov/schedule/news_release/empsit.htm`, `https://www.bls.gov/schedule/news_release/cpi.htm` | none |

## Failure log

Append to this table when a source changes behaviour, so the next run does not repeat
the discovery.

| Date | Source | Behaviour | Action taken |
|---|---|---|---|
| 2026-09-07 | fintel.io | 403 on most `/so/us/` pages | fell back to MarketBeat holder counts |
| 2026-09-07 | openinsider.com | failed to load, 7 of 7 | removed from the registry; Finviz insider table instead |
| 2026-09-07 | whalewisdom.com | paywalled stock pages | not used |
| 2026-09-07 | nasdaq.com holdings and short-interest | timeouts | used only as tertiary |
| 2026-09-07 | marketbeat.com institutional pages | CalSTRS row with multi-thousand-percent increases | dollar totals excluded on every affected name; holder counts used |
| 2026-09-07 | tipranks.com | mostly blocked | tertiary only |
| 2026-09-07 | finance.yahoo.com `/analysis/` | load error or empty EPS Revisions and EPS Trend tables on 5 of 8 names | no 30d/90d revision direction from the primary; derived the 90d direction for IONQ and TEM from pre-print consensus against current consensus, recorded with the derivation |
| 2026-09-07 | stockanalysis.com `/forecast/` | no estimate-revision or estimate-trend table exists on the page for any name | cannot be used as the revisions secondary; only current-year and next-year consensus levels |
| 2026-09-07 | stockanalysis.com `/forecast/` for PLPC | 404, coverage too thin for the consensus product | only MarketBeat's stale 2-analyst target existed; upside recorded as not found rather than computed from a March target |
| 2026-09-07 | cmegroup.com FedWatch | timed out at 60s, twice | fell back to centralbank.watch/federal-reserve/ for the priced path |
| 2026-09-07 | barchart.com breadth pages | returned empty content | used a dated StockCharts article for percent above the 200-day |
| 2026-09-07 | stockanalysis.com ETF pages | WebFetch surfaces only 1-year total return, not 1m/3m performance | used Finviz quote pages for index and factor performance |
| 2026-09-07 | fred.stlouisfed.org `fredgraph.csv?id=` | without explicit cosd/coed parameters, long series return rows from 2008-2012 | always pass explicit date parameters |
| 2026-09-07 | federalreserve.gov fomccalendars.htm | does not carry the current target range or vote split | fetch the individual statement press release as well |
| 2026-09-07 | finviz vs marketbeat short interest | material disagreement from different float denominators (TEM 27.75 vs 21.86, AMKR 15.96 vs 5.27, RKT 5.50 vs 8.56) | record both as a range; prefer the one that states a settlement date |
| 2026-09-07 | marketbeat.com institutional pages | the buyer/seller counts are trailing-12-month, not a quarter-over-quarter 13F holders table | usable only as a proxy for the flow gate; say so per ticker |
| 2026-09-24 | finance.yahoo.com `/analysis/` and the quoteSummary API | page errored on most of 74 names; API returned 429 | revisions from Zacks detailed-estimates (numbers only) and StockAnalysis levels |
| 2026-09-24 | api.nasdaq.com (JSON, via curl) | works: 4-week EPS revision counts, 13F summaries with holders up/down/new/exited for the quarter, short interest with settlement date (Nasdaq-listed only) | add as the secondary for 13F counts and revisions next run |
| 2026-09-24 | marketbeat.com `/price-target/` | 301 for every name | use `/forecast/` |
| 2026-09-24 | stockanalysis.com `/financials/?p=quarterly` | now serves an overview page | use `/financials/income-statement/?p=quarterly` |
| 2026-09-24 | stockanalysis.com `/forecast/` | FY2 estimates, FY2 EBIT and the full ratings history are behind Pro | FY2 from Yahoo or Zacks; forward margin checks uncovered |
| 2026-09-24 | finviz insider table | capped at 100 rows (SE reached back only to 8/11); ADR sale valued at per-ADS price times ordinary shares (BABA, 8x overstated); rows for another issuer where the filer is a fund (GOOGL, GV) | check the Form 4 for any trade that decides a gate |
| 2026-09-24 | finviz via curl without a browser User-Agent | empty body | use the fetch-finviz-snapshots.py User-Agent |
| 2026-09-24 | SEC EDGAR | requires a contact User-Agent; one subagent used the operator's email without asking | the research brief should name a project contact string, never the operator's address |

## Rubric behaviour to fix, found 2026-09-07

| Signal | Behaviour | Proposed fix |
|---|---|---|
| Risk : reward | **Implemented 2026-09-24.** When the downside anchor lands within about 1% of the close the ratio explodes and is arithmetic, not analysis. QCOM's 200-day sat 0.54% below the close giving 26.9:1; RKT's low target of $14.00 sat 0.4% below the $14.06 close giving 60.7:1. | Reject an anchor closer than about 5% to the close and fall back to the next anchor down; if none qualifies, return "not meaningful" rather than a number. |
| Delivery gate | **Implemented 2026-09-24.** The gate requires the guide to be held or raised, so a company that does not guide can never pass it. PLPC beat EPS by 86% and rose 30% on the day and still failed. TPL does not guide either. | Treat "no guidance issued as a matter of policy" as neutral and decide the gate on the print and the revision direction alone. |
| Retail interest | Zero corpus coverage scores 6 to 9 points as "quiet with fundamentals", which is indistinguishable from "the six accounts never mentioned it". Five of eight names in this probe scored on an absent signal. | Return "not covered" and drop the 10 points from the denominator for that name, rather than awarding a contrarian score to silence. |
| Insider and earnings signals on non-operating instruments | GLD, a commodity trust, scored 3 for "no insider activity found" and 0 for "no print". The four gates do not apply to it at all. | Detect non-operating instruments and route them to a separate, shorter rubric instead of scoring them against equity gates. |

## Forward-quality extension

Read [forward-research.md](forward-research.md) for the eight required forward metrics,
normalized `forward` record fields, optional API cache commands, missing-data rules
and verified insider-conviction inputs. This extension is required for every ticker;
keep its metrics and coverage separate from the legacy total. Older records without
these fields remain readable but do not establish forward quality or insider coverage.
