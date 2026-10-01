# Output schemas

## 1. `regime.json` (written by `compute_regime.py`; schema `macro-regime/1`)

| Key | Shape | Notes |
|---|---|---|
| `as_of` | date | The latest of the DGS10, SPY and HY OAS dates |
| `regime` | `{label, mechanical_label, composite, flag_notches, quadrant{name, growth, inflation_pressure, conviction, note}, duration_regime, flags[{id, kind, text}], divergence, coverage, macro_pillars_mean, tape_mean, judgment_call?}` | `label` is after flags; `mechanical_label` is from the composite alone |
| `pillars` | `{<pillar>: {name, weight, mean, score_100, signals_ok, signals_total, worst[], best[]}}` | Eight pillars; weights sum to 100 |
| `signals` | `[{id, pillar, name, rule, status, score, read, value{}, as_of, sources[]}]` | `status` is `ok`, `missing` or `error` |
| `archetypes` | `{<name>: {description, examples[], fit, stance, runway_macro_fit_pts, headwinds[], tailwinds[], drivers[]}}` | 12 archetypes; `fit` runs from -2 to +2 |
| `tilts` | `{quadrant, overweight[], underweight[], duration, overlays[]}` | Overlays applied over the quadrant table |
| `runway_read` | `{long_duration, cash_flow, small_caps, regime}` | One line each |
| `series` | `{<id>: {value, as_of, source, chg_1m, chg_3m, chg_12m, pctile_5y, pctile_20y}}` | Headline levels |
| `derived` | `NET_LIQ_BN`, `MORTGAGE_SPREAD`, `CCC_HY_GAP`, `COPPER_GOLD` snapshots | |
| `performance` | `{indexes[], sectors[], factors[]}` of `{symbol, name, ret_1m, ret_3m, ret_6m, ret_12m, rel_1m, rel_3m, above_200d}` | |
| `analogs` | `{now_month, now_features, method, analogs[{month, distance, era, features, eq_fwd_6m_pct, eq_fwd_12m_pct, eq_max_dd_12m_pct, ten_year_chg_12m_pp}], summary}` | |
| `delta` | `{prev_as_of, composite_prev, label_prev, pillars{}, signals_changed[]}` | Present when an earlier run exists |
| `missing` | `[string]` | |
| `narrative` | the whole `narrative.json` | Present when `narrative.json` exists beside `regime.json` |

## 2. `narrative.json` (written by the main agent)

```json
{
  "as_of": "YYYY-MM-DD",
  "judgment": {
    "regime_call": "one of: Risk-on | Lean risk-on | Neutral / mixed | Lean risk-off | Risk-off, optionally with a qualifier",
    "agrees_with_composite": true,
    "override_reason": "required when false",
    "confidence": "low | medium | high",
    "horizon": "e.g. 3-6 months",
    "summary": "5-8 sentences: the discount rate, the risk premium, the cash flows, the tape, and the call",
    "drivers": [{"signal": "R_REAL10", "why": "one line"}],
    "historical_frame": [{"era": "1994 bond massacre", "similar": "...", "different": "..."}],
    "positioning": ["one line per tilt, naming archetypes, sectors or tickers"],
    "archetype_overrides": [{"archetype": "banks", "fit_adjustment": 0, "reason": "..."}],
    "erp": {"forward_pe": 22.2, "earnings_yield_pct": 4.5, "real_10y_pct": 2.76, "erp_pct": 1.7, "source": "url"},
    "what_changes_my_mind": ["tell, with its date"]
  },
  "fed": {"target": "...", "last_decision": "...", "priced_path": "...", "sources": ["url"]},
  "themes": [{"theme": "", "direction": "accelerating|stable|fading", "counter": "", "evidence": "", "source": ""}],
  "events": [{"date": "YYYY-MM-DD", "event": "", "why_it_matters": ""}],
  "risks": [{"risk": "", "probability": "low|medium|high", "impact": "", "tell": ""}],
  "outlooks": [{"house": "", "view": "", "source": ""}],
  "reconciliation": [{"item": "MOVE", "data": "104.6 (Yahoo, live)", "news": "80.6 (mid-Sept snippet)", "used": "data"}]
}
```

## 3. Runway Probe `macro.json` (written with `--runway <PROBE_ID>` to `data/probes/runway/<PROBE_ID>/records/macro.json`)

It keeps the legacy keys the Runway Probe reads: `fed_target_pct`, `dgs2_pct`,
`dgs10_pct`, `real10y_pct` and `hy_oas_pct`, each `{value, source, as_of}`, plus `vix`,
`themes`, `events` and `regime_read`. It adds `dgs30_pct`, `t10y2y_pct`, `ig_oas_pct`,
`move`, `dxy`, `wti`, `mortgage30_pct` and `unrate_pct`, and a `macro_regime` block
`{label, composite, quadrant, archetype_fit, runway_macro_fit_pts}`.
