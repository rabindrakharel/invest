# Per-ticker record

Each subagent writes one JSON file per ticker to
`data/probes/runway/<PROBE_ID>/records/<TICKER>.json`. Every leaf value is an
object `{ "value": ..., "source": "<url>", "as_of": "YYYY-MM-DD" }`. A value that could
not be found is `{ "value": null, "source": null, "as_of": null, "note": "not found: <why>" }`.
Numbers are numbers, not strings. Percentages are plain numbers (46.2 means 46.2%).
Dates are ISO. Text fields are short.

```json
{
  "ticker": "VST",
  "probe_tier": "watch",
  "fetched_at": "2026-09-07T14:05:00Z",
  "price": {
    "close": {"value": 149.30, "source": "https://finviz.com/quote.ashx?t=VST", "as_of": "2026-09-04"},
    "high_52w": {...}, "low_52w": {...},
    "sma50_pct": {...}, "sma200_pct": {...},
    "perf_1m_pct": {...}, "perf_3m_pct": {...},
    "spy_1m_pct": {...}, "spy_3m_pct": {...},
    "sector_etf": {"value": "XLU", ...}, "sector_1m_pct": {...}, "sector_3m_pct": {...},
    "structure": {"value": "base|breakout|breakdown|trend_up|trend_down", ...},
    "print_gap_held": {"value": true, ...}
  },
  "consensus": {
    "label": {...}, "analysts": {...},
    "pt_avg": {...}, "pt_high": {...}, "pt_low": {...},
    "pt_avg_alt": {"value": 212.0, "source": "https://www.marketbeat.com/...", "as_of": "..."},
    "actions_60d": {"value": [
      {"date": "2026-08-21", "broker": "Morgan Stanley", "action": "raise", "target": 227, "reason": "..."}
    ], "source": "...", "as_of": "..."}
  },
  "earnings": {
    "print_date": {...},
    "revenue_actual": {...}, "revenue_estimate": {...},
    "eps_actual": {...}, "eps_estimate": {...},
    "guide": {"value": "raised|held|cut|none", ...}, "guide_detail": {...},
    "reaction_day_pct": {...}, "reaction_5d_pct": {...},
    "revisions_30d": {"value": "up|flat|down", ...}, "revisions_90d": {...},
    "eps_trend": {"value": {"current": 2.10, "d30": 2.05, "d90": 1.98}, ...},
    "fcf_ttm": {...}, "net_income_ttm": {...}, "sbc_pct_revenue": {...}
  },
  "prospect": {
    "case": {"value": "one sentence, labelled as the case", ...},
    "depends_on": {...}, "bear_case": {...},
    "visibility": {"value": "reported|guided|story", ...}
  },
  "competition": {
    "peers": {"value": ["CEG", "NRG"], ...},
    "share_trend": {"value": "gaining|stable|losing|unknown", ...},
    "gross_margin_4q": {"value": [..., ..., ..., ...], ...},
    "fwd_pe": {...}, "peer_fwd_pe": {"value": {"CEG": 22.1, "NRG": 14.3}, ...},
    "ev_sales": {...}, "peer_ev_sales": {...},
    "substitute": {...}
  },
  "insiders": {
    "buys_90d": {"value": [
      {"date": "2026-09-01", "name": "Jim Burke", "role": "CEO", "shares": 3000, "price": 135.2, "usd": 405600, "history": "3rd buy in 30 days, largest ever", "form4": "https://www.sec.gov/Archives/edgar/data/..."}
    ], ...},
    "sells_90d": {"value": [ {"date": "...", "name": "...", "role": "...", "usd": ..., "plan_10b5_1": true} ], ...}
  },
  "institutions": {
    "quarter_end": {"value": "2026-06-30", ...},
    "net_shares": {...}, "holders_up": {...}, "holders_down": {...},
    "holders_new": {...}, "holders_exited": {...},
    "named_adds": {"value": [{"fund": "Goldman Sachs", "change_pct": 42, "shares": 4700000}], ...},
    "named_exits": {...},
    "short_pct_float": {...}, "days_to_cover": {...}, "short_as_of": {...}
  },
  "catalysts": {"value": [
    {"date": "2026-11-05", "event": "Q3 earnings", "confirmed": false}
  ], ...},
  "why_it_fell": {...},
  "judgment": {
    "prospect_pts": 6, "prospect_why": "...",
    "competition_pts": 4, "competition_why": "...",
    "macro_fit_pts": 5, "macro_fit_why": "...",
    "narrative_pts": 6, "narrative_why": "..."
  }
}
```

`judgment` is filled by the main agent after the macro brief and the corpus read, not by
the research subagent. Everything else is filled by the subagent from the registry.

The macro subagent writes `data/probes/runway/<PROBE_ID>/records/macro.json`, one
object with the items in `macro-brief.md` as keys, each `{value, source, as_of}`, plus
`themes` as a list of `{theme, direction: "accelerating|fading|stable", counter}` and
`events` as a list of `{date, event}`.

Corpus-side files in the same directory, written by the main agent:

- `retail.json` from `pnpm -s q retail-interest --symbols "..." --json`
- `stances.json`: per ticker, the formal picks from `data/corpus/analysis/accounts/*.json` as
  `[{account, direction, conviction, time_frame}]`
- `_manifest.json`: `{window_end, price_date, thirteen_f_quarter_end, tickers, groups,
  fetched_at, sources_failed: [{source, tickers, behaviour}]}`

## Forward-quality extension

Read [forward-research.md](forward-research.md) for the eight required forward metrics,
normalized `forward` record fields, optional API cache commands, missing-data rules
and verified insider-conviction inputs. This extension is required for every ticker;
keep its metrics and coverage separate from the legacy total. Older records without
these fields remain readable but do not establish forward quality or insider coverage.
