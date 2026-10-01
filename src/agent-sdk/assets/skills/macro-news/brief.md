# News and outlook brief (one subagent, once per run)

Launch one `general-purpose` subagent in the background at step 2, with this brief, today's date
and the output path. It runs while the fetch and the engine run.

---

Today is <DATE>. You are the news-and-outlook collector for a macro regime read on US
equities (hedge-fund lens, medium/long horizon, medium-low risk). Load WebSearch and
WebFetch with ToolSearch ("select:WebSearch,WebFetch") first. Every fact carries the URL
you read and the date the page states. Mark a fact "via search snippet" when the page
itself could not be fetched. Write "not found" when you cannot find it. Never guess, and
never fill from memory: your knowledge is stale.

Cover the last three weeks:

1. **Fed.** The latest FOMC decision (date, range, vote, dissents), the latest SEP
   medians (funds rate by year and longer run, PCE, core PCE, unemployment, GDP) against
   the previous SEP, the chair's key press-conference lines, and notable Fed speakers since.
   The market-priced path: CME FedWatch, or news quoting it, for the next two meetings and
   the implied year-end rate.
2. **Treasuries and the long end.** Why the 10-year and 30-year are where they are. Term
   premium; deficits and issuance; the last refunding statement and the date of the next;
   results of the latest 10-, 20- and 30-year auctions (tail, bid-to-cover, indirect
   share); TIC foreign holdings; Japan's yields and the BoJ; forecast changes by major
   houses.
3. **Housing and MBS.** PMMS mortgage rate, the MBS spread, starts, permits, new and
   existing home sales, NAHB, builder earnings and guidance, Fed MBS runoff, GSE or bank MBS
   demand.
4. **Inflation and oil.** Latest CPI and PCE against consensus, oil drivers (OPEC+,
   geopolitics, SPR), tariff pass-through, PMI price components.
5. **Growth and labour.** Payrolls against consensus, unemployment, claims, ISM and PMI,
   GDPNow, retail sales, the earnings-season tone and guidance, AI capex and its financing.
6. **Credit and liquidity.** HY and IG spread commentary, private-credit stress, bank
   stress, QT, reserves, TGA, the dollar, yen carry.
7. **Fiscal, political, geopolitical.** Funding deadlines, tariffs, elections, wars,
   China.
8. **Outlooks** published in the last six weeks: S&P 500 year-end targets, 10-year
   forecasts, recession probabilities, sector preferences, one line each with URL and date.
9. **Live themes.** The three to six narratives dominating coverage in the last two
   weeks, each marked accelerating, stable or fading, with its counter-narrative and the
   evidence.
10. **Dated events** from today to the end of next quarter: FOMC, CPI, PCE, payrolls,
    GDP, refunding, notable auctions, fiscal deadlines, elections, OPEC+, mega-cap
    earnings.

Write `data/research/<DATE>/macro/news.json`:

```json
{
  "as_of": "<DATE>",
  "fed": {"decision": {"value", "source", "as_of"}, "sep": {}, "chair_lines": [{"line", "source", "as_of"}],
          "speakers": [], "priced_path": {"value", "source", "as_of"}},
  "rates_long_end": [{"fact", "source", "as_of"}],
  "housing_mbs": [], "inflation_oil": [], "growth_labour": [], "credit_liquidity": [], "fiscal_geopolitics": [],
  "outlooks": [{"house", "date", "view", "sp500_target", "ten_year_forecast", "recession_prob", "source"}],
  "themes": [{"theme", "direction": "accelerating|stable|fading", "counter", "evidence", "source"}],
  "events": [{"date": "YYYY-MM-DD", "event", "why_it_matters", "source"}],
  "failures": [{"url", "behaviour"}]
}
```

Then reply with a summary of the most decision-relevant findings in under 400 words.

---

## Reconciling news with the data files

The engine's numbers come from FRED and Yahoo files on disk; the news comes from pages.
When they disagree:

- **For levels, the data files win.** A news level is often a stale snippet (the
  September 2026 run's "MOVE 81" was mid-month; the file showed 104.6 live).
- **For facts the data cannot know, the news wins:** decisions, votes, auction tails,
  guidance, quotes.
- Record each disagreement in `narrative.json` under `reconciliation`.
