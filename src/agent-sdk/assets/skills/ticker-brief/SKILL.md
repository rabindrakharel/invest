---
name: ticker-brief
description: Answer "what about <TICKER>?" by joining everything the repo already knows about one name - its theme baskets and their direction, the market-outlook stance of those themes, its macro archetype fit under today's regime, price trend and drawdown, allowlist attention/tone/stances with cited posts, its last Runway Probe score and gates, and any registered verdict with its kill criterion - into a short brief. Use for single-name questions ("should I add MU", "how does NVDA look", "is CAKE crowded"); use /runway-probe instead for a full ranked, researched verdict across many names.
argument-hint: "<TICKER> [--date YYYY-MM-DD]"
---

# Ticker brief

This skill has one concern: **a fast, cited read on one name from the outputs that already
exist.** It adds no new research. When the answer needs earnings, insider, 13F or
competitive research, say so and offer `/runway-probe --tickers <T>`.

## Process

1. Check freshness with `python3 src/agent-sdk/assets/tools/repo/state/state.py --intent ticker`, and run what it
   lists. It is usually nothing when `/market-outlook` already ran today.
2. Build the context:
   `python3 src/agent-sdk/assets/tools/repo/ticker-brief/ticker_context.py <TICKER> --date <DATE>`.
   This writes `data/research/<DATE>/tickers/<TICKER>.json`.
3. Write the brief in the CLAUDE.md report shape, using these sections:
   - **Verdict, in one line:** Add, Accumulate on weakness, Hold, Trim or Avoid, with the
     horizon. It must be consistent with the regime's risk budget and the theme stance.
     Say so when you depart from them.
   - **Macro fit:** the archetype, its fit, and the two signals driving it.
   - **Theme and price:** the basket's direction and the stock's own trend, 1m/3m return
     and drawdown. Does the stock lead or lag its theme?
   - **Allowlist:** attention, velocity, tone and formal stances, citing a `post_id`. Say
     whether it is crowded, heating or neglected.
   - **Record:** the last runway tier and score, the gates it failed, any verdict and its
     kill criterion, and whether the kill has been hit.
   - **Gaps:** from the context file's `gaps`. State the corpus age.
4. Save the brief to `data/reports/<DATE>-<ticker>.md`.

## Rules

- Every number comes from the context file. Cite its source file or `post_id`.
- A ticker outside every basket takes its macro fit from the closest archetype in
  `macro-regime/playbook.md` §4. Say that it was mapped by judgment.
- If it recurs in questions, propose adding it to `config/themes.json`.

## Report contract

When invoked through CLAUDE.md's "How to answer" protocol, this skill fills these parts of the standard report. Intent `ticker`: the whole report. **Answer** is a one-line verdict; **Why** covers macro fit, theme and price, the allowlist and the record; **Gaps** come from the context file.
