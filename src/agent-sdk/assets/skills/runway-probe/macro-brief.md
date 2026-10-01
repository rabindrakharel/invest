# Macro brief (one subagent, once per probe)

**Prefer the macro skills.** When `/macro-regime` has run for the probe date, do not launch
this subagent. Instead run

```bash
python3 src/agent-sdk/assets/tools/repo/macro-regime/compute_regime.py --date <DATE> --runway <WINDOW_END>
```

It writes `macro.json` in the shape below, plus `regime_read` and `macro_regime.runway_macro_fit_pts`
per archetype. Score each ticker's macro climate from its archetype (see
`src/agent-sdk/assets/skills/macro-regime/playbook.md` §4). The brief below is the fallback when the
macro skills cannot run.

Paste this brief and today's date.

---

Today is <DATE>. Collect the current macro climate for US equities in the fixed shape
below. WebFetch the pinned URLs in the "Macro" table of
`src/agent-sdk/assets/skills/runway-probe/sources.md` first (FRED series pages, the Fed calendar,
BLS releases, CME FedWatch, the factor and sector ETF pages); use WebSearch only for the
live themes and for any pinned page that fails, and record the URL you read instead.
Every figure carries its source URL and the date the page states. If a datum cannot be
found write "not found". Never guess.

Return ONE markdown table with these rows, columns Item | Value (date) | Source | One-line read:

- Fed funds target range, and the last decision date with the vote split
- Market-priced path: probability of a move at the next two meetings, and the year-end
  implied rate
- 2-year and 10-year Treasury yields; 2s10s spread; 10-year real yield
- Investment-grade and high-yield option-adjusted spreads, and their one-month change
- Dollar index level and one-month change
- WTI crude, and one-month change
- VIX level and one-month range
- Last payrolls print versus consensus; unemployment rate
- Last CPI and core CPI year over year versus consensus
- S&P 500 and Nasdaq-100 one-month and three-month performance
- Factor leadership over one and three months: momentum, value, quality, small versus
  large, high beta versus low volatility, using the common factor ETFs
- Sector leadership over one and three months: the top three and bottom three sectors
- Breadth: share of S&P 500 above the 200-day moving average, if published
- Live market themes: the three to five narratives dominating coverage in the last two
  weeks, each with whether it is accelerating or fading and its counter-narrative
- Dated macro events in the next three months: FOMC, CPI, payrolls, quarterly refunding,
  major fiscal or trade deadlines

Also write the same content as `data/probes/runway/<PROBE_ID>/records/macro.json`:
one object keyed by item, each `{value, source, as_of}`, plus `themes` as a list of
`{theme, direction, counter}` and `events` as a list of `{date, event}`, and
`regime_read` with three keys: `long_duration`, `cash_flow`, `small_caps`.

Then three sentences: what regime this is for long-duration growth equities, for
cash-flow equities, and for small caps. No other prose.
