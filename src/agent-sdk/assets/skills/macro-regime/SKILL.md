---
name: macro-regime
description: Decide whether the US market is in a risk-on or risk-off regime and say what that means for which stocks. It scores 54 signals in eight pillars from the /macro-data files - the 10-year and 30-year levels and speed, real yields, term premium, curve shape, MOVE, stock-bond correlation, priced Fed path, IG/HY/CCC credit, VIX term structure, net liquidity, funding, dollar, yen carry, claims, Sahm, GDPNow, copper/gold, CPI momentum, breakevens, oil shock, mortgage rate, mortgage-Treasury (MBS) spread, permits, supply, home prices, builders, breadth and trend. It combines them into a composite, stress flags, a growth-inflation quadrant, a duration regime, sector and factor tilts, a fit score for 12 stock archetypes, and historical analogs since 1954. It then interprets the result against the macro history (post-war boom, 1970s oil and stagflation, Volcker, 1987, 1994, dot-com, 2008, QE, COVID money printing, 2022 inflation) and the news, and writes a structured regime.json plus a labelled judgment. Use for "risk on or risk off", "what's the macro regime", "how do rates/oil/housing affect my stocks", or the macro-fit input to /runway-probe.
argument-hint: "[--date YYYY-MM-DD, default today] [--runway <window_end>[-label]]"
---

# Macro regime

## The problem, and how it is solved

A macro read is usually a mood: someone picks three charts that agree with them. This skill
makes it a **procedure** with two layers that never mix:

1. **The mechanical layer** (`src/agent-sdk/assets/tools/repo/macro-regime/compute_regime.py`). Fixed rules turn the raw series
   into signals scored from -2 to +2. It is deterministic: the same raw directory always
   gives the same `regime.json`. Every score shows its rule, its inputs, its date and its
   source URL.
2. **The judgment layer** (`narrative.json`, written by you). You read the mechanical
   output, the news, the history and the playbook, then make the call. You may disagree
   with the composite, but you must say so and why (`agrees_with_composite: false` plus
   `override_reason`). Your call is stored beside the composite, never in place of it.

The knowledge that turns numbers into a read lives in three files. Read them before
writing the judgment:

| File | What it gives you |
|---|---|
| [indicators.md](indicators.md) | What each signal measures, why it matters, its traps, and which stocks it moves: 10-year, 30-year, real yields, term premium, MOVE, MBS spread, housing and the rest |
| [history.md](history.md) | 17 eras from 1946 to 2026: setting, winners, losers, the tell before the turn, the lesson; plus a table of cross-era rules |
| [playbook.md](playbook.md) | Quadrants, overlays, the driver-to-stock transmission map, archetype mapping for the Runway Probe, the hedge-fund checklist |

## Inputs

| Input | From | If missing |
|---|---|---|
| `data/market/<DATE>` | `/macro-data` | run it first (about two minutes) |
| `data/research/<DATE>/macro/news.json` | `/macro-news` subagent | the judgment can still be written, but mark themes and events "not collected" |
| Previous run | the newest earlier `data/research/*/macro/regime.json` | the engine finds it and writes `delta` itself |

## Process

### 1. Data and news, in parallel

```bash
python3 src/agent-sdk/assets/tools/repo/macro-data/fetch_macro.py --out data/market/<DATE>
```

In the same message, launch the `/macro-news` subagent in the background. Skip this when
`/market-outlook` has already done both.

### 2. Mechanical read

```bash
python3 src/agent-sdk/assets/tools/repo/macro-regime/compute_regime.py --date <DATE>
```

It reads `data/market/<DATE>/` and writes `data/research/<DATE>/macro/`. Every location
comes from `src/agent-sdk/assets/tools/repo/lib/paths.py`; do not pass paths.

Read `regime.md` top to bottom. Then check:
- **Coverage.** Every `missing` or `error` signal is either fixed with a refetch or named
  in the judgment.
- **Stale inputs.** Monthly series (CPI, permits, Case-Shiller) lag by one to three
  months. When a shock is newer than the last print (an oil spike after the last CPI),
  the inflation pillar understates it. Say so.
- **Intraday bars.** Yahoo's last bar may be live.

### 3. Interpret

Work through these in order, writing notes as you go:

1. **The discount rate.** Split the 10-year move into real yield and breakeven, and read
   the term premium. Is the rise growth, inflation, term premium or the Fed
   (`R_FED_PATH`)? Read the MOVE against the VIX. Label the curve move (see
   `indicators.md` §A).
2. **The risk premium.** Does credit confirm the equity tape? Is the weak tail (CCC)
   diverging? What are funding, the dollar and the yen doing?
3. **The cash flows.** Growth and labour momentum; the inflation trend against the oil
   shock; housing and the MBS spread.
4. **The tape.** Trend, breadth, leadership. Is there a divergence line?
5. **History.** For each analog month, reread that era in `history.md`, and check the
   cross-era rules table against the current flags. Name the one or two eras this most
   resembles *and how it differs*.
6. **Positioning.** Run the checklist in `playbook.md` §5. Use the archetype fits and the
   tilts, and adjust by name where the archetype misses something.
7. **Falsifiers.** Name two or three observable tells, each with a date from the events
   calendar, that would change the call.

### 4. Write `narrative.json`

Write `data/research/<DATE>/macro/narrative.json` in the shape of
[schema.md](schema.md) §2. Copy `themes` and `events` from `news.json`, trimmed to what
matters. The `judgment` block is yours.

### 5. Merge and publish

```bash
python3 src/agent-sdk/assets/tools/repo/macro-regime/compute_regime.py --date <DATE> [--runway <WINDOW_END>]
```

The engine merges `narrative.json` automatically when it sits beside `regime.json`.
`--runway <PROBE_ID>` also writes `data/probes/runway/<PROBE_ID>/records/macro.json`: the the legacy keys, plus
`regime_read` and the archetype `runway_macro_fit_pts`. Use it when this run feeds a
Runway Probe.

Reply with the call, the composite, the flags, the three signals that matter most, the
archetype stances, and the falsifiers. Keep it to 15 lines or fewer, and link
`regime.md`. When run under `/market-outlook`, stop here; the orchestrator publishes.

## Rules

- **Never guess a number.** Every level in the judgment comes from `regime.json` or
  `news.json`, and is cited by signal id or URL.
- **The composite is the record, the call is the opinion.** Keep both.
- **Change the rules only in code.** A threshold change goes into `compute_regime.py`,
  gets a test in `src/agent-sdk/assets/tools/repo/macro-regime/test_compute_regime.py`, and is mentioned in `indicators.md` if
  the reasoning changes. Rerun the tests:
  `cd src/agent-sdk/assets/tools/repo/macro-regime && python3 -m unittest test_compute_regime`.

## Report contract

When invoked through CLAUDE.md's "How to answer" protocol, this skill fills these parts of the standard report. For intent `macro`: **Answer** is the `judgment.regime_call` plus the risk budget. **Why** is the top `drivers` by signal id, plus one historical frame. **What would change it** is `what_changes_my_mind`. Add a pillar table and the archetype fit table. For every other intent it supplies the report's **Regime** line.
