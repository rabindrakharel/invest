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
   This writes `data/research/<DATE>/tickers/<TICKER>.json`, the mechanical evidence. Never edit it.
3. Write your judgment, and only your judgment, to
   `data/research/<DATE>/tickers/<TICKER>.judgment.json` with the Write tool. The schema is
   `ticker-judgment/1` (full text in `render_brief.py`'s docstring):
   - `verdict`: one of Add, Accumulate on weakness, Hold, Trim, Avoid. `horizon`: `6 months`, `1-3 years`.
   - `answer`: 2 to 4 sentences, one paragraph. Don't open with the verdict; the template prints it.
   - `departure`: required when the verdict differs from the mechanical lean (the best theme
     stance: Overweight→Add, Accumulate→Accumulate on weakness, Neutral→Hold, Underweight→Trim,
     Avoid→Avoid), or when it is Add in a risk-off regime. `null` otherwise.
   - `why`: `macro_fit`, `theme_price`, `allowlist` (cite a `post_id` from the context when it has
     posts), `record`. Plain prose, one paragraph each, no numbers the context does not hold.
   - `changes`: 2 or 3 `{date, tell}`, dated on or after the brief, from the events calendar.
   - `gaps`: anything judged or missing that the context's own gaps don't already say.
   A hook checks the file against the context before it lands and tells you every rule it breaks.
4. Render: `python3 src/agent-sdk/assets/tools/repo/ticker-brief/render_brief.py <TICKER> [<TICKER> ...] --date <DATE>`.
   It writes `data/reports/<DATE>-<ticker>.md` per name, a joint
   `data/reports/<DATE>-<t1>-<t2>-....md` when given several (in the order given), and their
   `INDEX.md` lines. The title, the As-of and Regime header, the sections and the evidence
   tables come from the template, so they never vary between runs. To change a brief, rewrite
   the judgment and render again; `--verify` fails if a rendered file was edited by hand.

## Rules

- Every number comes from the context file; the renderer prints the numbers, you write the reasoning.
- Ticker briefs are written only by `render_brief.py`. A hook (`brief_guard.py`, run by the agent
  harness and by `.claude/settings.json`) refuses a hand-written brief, a hand-written ticker-brief
  line in `INDEX.md`, any edit to the context file, a shell write to either, and a judgment that
  breaks the schema.
- A ticker outside every basket takes its macro fit from the closest archetype in
  `macro-regime/playbook.md` §4. Say that it was mapped by judgment.
- If it recurs in questions, propose adding it to `config/themes.json`.

## Report contract

When invoked through CLAUDE.md's "How to answer" protocol, this skill fills these parts of the standard report. Intent `ticker`: the whole report, rendered by `render_brief.py` in the CLAUDE.md shape (Answer, Why, What would change it, Gaps and stale inputs) with an Evidence table under Why. **Answer** is the verdict and horizon then the judgment's answer; **Why** covers macro fit, theme and price, the allowlist and the record; **Gaps** join the stale inputs, the context's gaps and the judgment's.
