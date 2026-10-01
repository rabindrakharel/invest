# Forward metrics: acquisition and interpretation

Freeze a run cutoff in `_manifest.json.price_date`. Use the latest completed market
session and the estimates available by that cutoff. Refresh after each earnings or
material guidance release. Never substitute retrieval time for estimate publication
vintage. The helper rejects numeric leaves older than 120 days or after the cutoff;
this is an outer validity limit, not permission to use pre-earnings estimates today.
A historical run requires historical snapshots, not today's API response.

## Sources and executable acquisition

1. Company IR releases, 10-K/10-Q or 20-F/6-K establish reported numbers, capex,
   cash, debt, share count, guidance and commitments. SEC Company Facts is historical
   reported data, not a source of forecasts. Check consolidated units and fiscal dates.
2. Consensus: use entitled analyst feeds when available, then the forecast/analysis
   pages in `sources.md`. Optional raw-cache commands, from the repository root:

   ```bash
   python3 src/agent-sdk/assets/tools/repo/runway-probe/fetch-forward-inputs.py NVDA --provider fmp --date <DATE>
   python3 src/agent-sdk/assets/tools/repo/runway-probe/fetch-forward-inputs.py NVDA --provider alphavantage --date <DATE>
   ```

   Set `FMP_API_KEY` or `ALPHAVANTAGE_API_KEY` in the environment. No key or no
   entitlement means use the web/IR fallback; do not purchase access. Caches retain
   source and retrieval time, without credentials, and must stay outside the ticker
   records directory. These are raw inputs, not automatically validated records.
   [FMP financial estimates](https://site.financialmodelingprep.com/developer/docs/stable/financial-estimates)
   documents `stable/analyst-estimates`, including annual period selection.
   [Alpha Vantage documentation](https://www.alphavantage.co/documentation/#earnings-estimates)
   documents `EARNINGS_ESTIMATES` for EPS/revenue forecasts and revision history.
   Inspect actual payload fields and analyst counts before mapping. Neither endpoint
   should be assumed to supply forward FCF, invested capital or WACC.
3. Map revenue/EPS and, if present, EBIT estimates for the exact fiscal-year end.
   Do not substitute EBITDA for EBIT. Get forecast CFO/capex from a disclosed
   analyst cash-flow model or company guidance. Otherwise construct and label a
   model with revenue, margins, cash taxes, working capital and capex assumptions.
   Save the calculation bridge and each assumption's source. Never label that model
   as consensus. Leave unavailable inputs null. A growth percentage of the consensus
   EPS level is not revision breadth.
4. Ratings require buy/hold/sell counts, provider, analyst population and snapshot
   date. Group strong-buy with buy, strong-sell with sell. Keep broker upgrades and
   downgrades separate from target changes and proprietary quant ratings.
5. Verify conviction-changing insider trades in the original Form 4 and footnotes.
   P/S codes include private transactions; confirm market purchases explicitly.
   Capture accession, transaction and filing dates, owner identity, role, shares,
   dollars, ownership before/after and plan status (`true`, `false`, unknown).
   The [SEC disclosure guide](https://www.sec.gov/resources-small-businesses/small-business-compliance-guides/insider-trading-arrangements-and-related-disclosures)
   explains the Form 4/5 Rule 10b5-1 checkbox. Deduplicate amendments and executions;
   three trades by one officer are not three independent buyers. Exclude grants,
   exercises, tax withholding and gifts from conviction buys/sells. Foreign issuer
   disclosure gaps mean unknown coverage, not verified absence.

## Definitions

Use FY1, the current unreported fiscal year, and FY2, the consecutive fiscal year.
Show both year-end dates and estimate vintage. If NTM is additionally shown, build
it from four quarterly estimates; never relabel FY1 as NTM. Match currency, units,
consolidation and GAAP/adjusted basis. Explain adjusted-to-GAAP reconciliation.

| Metric | Calculation and interpretation |
|---|---|
| Analyst ratings | Buy count / total ratings, plus count and recent upgrades/downgrades. A small or uniformly bullish sample is weak evidence, not independent proof of upside. |
| Forward operating-margin expansion | FY2 EBIT/revenue minus FY1 EBIT/revenue, in percentage points. Require operating leverage supported by gross margin and spending assumptions. |
| Forward FCF-margin expansion | FY2 (CFO minus positive capex outflow)/revenue minus FY1 equivalent, in percentage points. Show working-capital swings, SBC, capitalized spending and lease treatment. |
| Forward FCF growth | (FY2 FCF / FY1 FCF − 1) × 100, only if both are positive. For negative/zero bases show dollars, margin change and breakeven date instead. Also compare per diluted share. |
| Forward ROIC | FY1 EBIT × (1 − normalized tax rate) / average beginning/end FY1 invested capital. Use debt + equity − excess cash with consistent leases/goodwill treatment; nonpositive capital means not meaningful. Forecast capital needs, do not silently reuse historical ROIC. |
| ROIC minus WACC | Forward ROIC minus modeled WACC in percentage points. WACC = equity weight × (risk-free + beta × equity risk premium) + debt weight × borrowing cost × (1 − tax rate). Use market-value weights and dated inputs; show ±2 pp WACC and capex sensitivity. No assumed tax benefit for losses without support. |
| EPS revision breadth | (Distinct upward revisers − distinct downward revisers) / all covering analysts for the same fiscal period, × 100; unchanged analysts remain in denominator. Show 30d and 90d independently if available. If provider supplies revision events rather than unique analysts, retain its definition and do not map to this formula. |
| Forward valuation vs growth | FY1 P/E divided by FY1–FY2 EPS growth in percent units for PEG; meaningful only with positive EPS and growth. This two-year PEG is not a vendor's five-year PEG. EV/FCF uses current EV / FY1 FCF and requires cash-flow basis disclosure: CFO−capex is generally levered, so also show market-cap/FCF or use explicitly modeled unlevered FCF for enterprise comparison. Never mix bases across peers. |

EV/FCF has no universal cheap threshold. Compare peers with similar growth, returns,
capital intensity and accounting; model exit multiples and dilution in each scenario.
For unprofitable names, EV/revenue plus an explicit margin/capex bridge is an
alternative valuation model, not a fabricated PEG. Distinguish a good company from
a good entry price. Consensus-target upside and a technical stop are not the bear
case; model fundamental downside and financing stress separately.

## Normalized record contract

Add a `forward` object to each ticker JSON. Every numeric field below is a leaf
`{value, source, as_of, kind, note}`. `kind` is `consensus`, `guidance`, `reported`
or `model`; modeled leaves cite source inputs and explain the bridge in `note`.
Null leaves include a reason. All monetary values use the same currency and scale;
EPS and stock price are in currency per share. Rates use percent units, not decimals.

- Metadata: `periods_aligned: true` only after manual verification, `currency`,
  `units`, `accounting_basis`, `fy1_end`, `fy2_end`, `estimate_vintage`,
  `model_assumptions`, `fcf_basis`, and `revision_period_end`.
- `fy1` and `fy2`: `revenue`, `ebit`, `cfo`, `capex` (positive outflow), `eps`,
  `tax_rate_pct`, `invested_capital_begin`, `invested_capital_end`.
- `ratings`: `buy`, `hold`, `sell` from the same population/date.
- `revisions`: `up_30d`, `down_30d`, `analysts` for one fiscal period. Also retain
  `up_90d`, `down_90d` if available; the helper currently computes 30-day breadth.
- `valuation`: `price`, `enterprise_value`, `wacc_pct`; attach WACC assumptions,
  peer multiples, forward diluted shares and sensitivity tables in the evidence.

`build-scorecard.py` calls `forward_metrics.py` and emits all eight metrics (both
PEG and EV/FCF), FY1/FY2 calculations, missing-data issues, and six checkpoints.
This is separate from the legacy 100-point score and gates. Heuristic checkpoints:
buy share ≥60%; operating margin expanding; positive FCF growth ≥15% with no FCF
margin contraction; ROIC−WACC ≥3 pp; revision breadth >0; PEG ≤2. Correlated
metrics share checkpoints. These are screening defaults, not calibrated return
probabilities. An EV/FCF-only valuation needs a written peer/scenario assessment;
the automatic PEG checkpoint remains unknown. Show passed / covered / six possible,
never normalize sparse coverage into a high-conviction rating.

## Insider conviction overlay

Set sourced `insiders.coverage_complete` true only after checking the full trailing
90 days through the cutoff. Null/unavailable coverage gets zero points and cannot
pass the insider gate. Include `transaction_code`, `open_market`, `form4`, `name`
and tri-state `plan_10b5_1` on trade entries. Unknown plan status is never described
as a confirmed discretionary sale. Keep all observed sale dollars visible.

Show unique buyers/sellers, gross purchases and sales, net dollars, executive roles,
and each material sale as a fraction of holdings. Distinguish routine plans from
unexpected large disposals. Multiple independent purchasers and meaningful personal
commitments increase conviction; verified absence is neutral. A tiny buy cannot
cancel material selling in the qualitative verdict. Inspect 30-day clusters manually;
the legacy score's unique-buyer count covers the full 90-day window and does not
prove clustering within a month. Insider evidence corroborates economics; it cannot
rescue deteriorating cash generation or excessive valuation.
