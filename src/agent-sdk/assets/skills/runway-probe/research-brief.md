# Research brief (one subagent per group of at most eight tickers)

Paste this brief, then today's date and the ticker group.

---

Today is <DATE>. For each of these US-listed tickers: <TICKERS> — collect the fields
below, in this order of sources:

1. **WebFetch the pinned URL for each field group** from
   `src/agent-sdk/assets/skills/runway-probe/sources.md`, primary first. Start every ticker with the
   Finviz quote page; it supplies fourteen fields in one fetch.
2. Fall back to the secondary and tertiary URLs only when the primary errors, is
   paywalled, or lacks the field. Record which URL supplied each value.
3. Use WebSearch only for "why it fell" and to locate a page the registry does not
   cover. Record the URL you end up reading.

SEC EDGAR requires a contact User-Agent. Never put the operator's email or any personal address in a request header; if EDGAR refuses a generic project string, cite the Finviz row and mark the Form 4 unopened.

Never guess a number. A field you cannot find is `null` with a note saying why. Every
value carries the URL it came from and the date the page states for it. Budget 6 to 10
fetches per ticker.

Collect, per ticker:

1. **Price.** Close with date; 52-week high and low; drawdown from the high.
2. **Consensus.** Analyst count and label; average, high and low 12-month targets;
   implied upside to the average. Give both StockAnalysis and MarketBeat when they
   differ by more than ten points.
3. **Analyst actions, last 60 days.** Broker, action, target, one-line reason. Sell-side
   only; exclude Zacks, Weiss and X commentators.
4. **Earnings.** Last print date; revenue and EPS versus consensus; guidance versus
   consensus and whether it was raised, held or cut; the stock's move on print day and
   five sessions later; direction of consensus EPS revisions over 30 and 90 days; free
   cash flow versus net income for the last quarter or year; stock-based compensation as
   a share of revenue if above 10%.
5. **Prospect.** The twelve-month bull case in one sentence as the company and the
   bulls state it, the number it depends on, and what the bears say. Label it as the
   case, not as fact.
6. **Competition.** The two nearest competitors; share trend if any source states it;
   gross margin over the last four quarters; any named substitute or new entrant; forward
   P/E or EV/sales against those peers.
7. **Insiders, last 90 days.** Open-market buys with name, role, shares, price, dollars
   and any history the source gives (first buy in N years, largest ever). Sells the same
   way, marking 10b5-1. Exclude exercises, vests and tax withholding.
8. **Institutions.** Latest 13F cycle: net share change, holders increasing versus
   decreasing, new versus exited, named adds and exits with sizes. Short interest as
   % of float, shares, days to cover, settlement date.
9. **Chart.** Distance from the 50-day and 200-day moving averages; whether the 50 is
   above the 200; 1-month and 3-month performance against SPY and the sector ETF; whether
   price is in a base, a breakout or a breakdown; whether the last print gap held.
10. **Catalysts, next 3 months.** Earnings date and whether company-confirmed or an
    aggregator estimate; regulatory, legal, vote, launch, lock-up or index events.
11. **Why it fell**, if down more than 30% from the high: one or two sentences with a
    source.

**Output, two parts.**

First, write one JSON file per ticker to
`data/probes/runway/<PROBE_ID>/records/<TICKER>.json` in the exact shape of
`src/agent-sdk/assets/skills/runway-probe/record.schema.md`. Leave the `judgment` block absent; the
main agent fills it. Create the directory if needed. The file is the deliverable; the
scorecard is computed from it.

Second, return ONE markdown table with a row per ticker and exactly these columns, in
this order, as the human-readable summary:

Ticker | Price (date) / 52w hi-lo / drawdown | Consensus / #analysts | Avg PT | High/Low PT | Upside % | Analyst actions 60d | Last print (rev, EPS vs est; guide) | Print reaction (day, +5d) | Revisions 30d/90d | FCF vs NI; SBC % | Prospect (the case) | Competition (peers, GM trend, valuation vs peers) | Insider buys 90d | Insider sells 90d | 13F flow (net, up/down, new/exit, named) | Short interest (% float, DTC, date) | Chart (vs 50/200 DMA, 50>200?, RS 1m/3m, base/breakout, gap held?) | Catalysts 3m | Why it fell

After the table, a "Notes" list of at most ten bullets: every source that was blocked
or lacked a field (URL, ticker, behaviour), figures that conflict between sources, and
anything material that did not fit. The blocked-source bullets go into the run
manifest and the registry's failure log. No prose beyond that.

## Forward-quality extension

Read [forward-research.md](forward-research.md) for the eight required forward metrics,
normalized `forward` record fields, optional API cache commands, missing-data rules
and verified insider-conviction inputs. This extension is required for every ticker;
keep its metrics and coverage separate from the legacy total. Older records without
these fields remain readable but do not establish forward quality or insider coverage.

Collect these fields alongside the existing summary columns; return the forward
metrics in a separate per-ticker evidence table. Fetch budgets are planning estimates,
not permission to omit required metrics. Record missing fields and fallback attempts.
