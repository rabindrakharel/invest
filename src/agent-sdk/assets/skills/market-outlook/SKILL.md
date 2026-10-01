---
name: market-outlook
description: Produce the full market outlook by orchestrating the single-concern skills - /macro-data and /macro-news (in parallel), /macro-regime (risk-on vs risk-off, duration regime, archetype fit, history analogs), /theme-pulse (benchmarks and thematic baskets - Mag 7, semis, cloud, cybersecurity, biotech sub-themes, AI infra, space, crypto, energy...), /x-sentiment (allowlist attention, tone, crowding) - then join them into one structured outlook.json/outlook.md with a risk budget, a stance per theme (Overweight/Accumulate/Neutral/Underweight/Avoid), divergence flags, events and a labelled judgment, and publish it. Use for "give me the market outlook", "what should the book do now", "risk on or off and where", or before /corpus-probe and /runway-probe so they inherit the regime.
argument-hint: "[--date YYYY-MM-DD, default today] [--mandate 'medium-low risk, 1-3 years'] [--skip-news] [--themes id,id]"
---

# Market outlook

## The problem, and how it is solved

A useful outlook answers three questions at once: **how much risk** (macro), **where**
(themes and price), and **how crowded** (sentiment). One agent doing all three in one pass
mixes the evidence and cannot be rerun piece by piece. So each concern is its own skill,
with its own deterministic script and its own output file. This skill only sequences them,
joins their files with a fixed rule (`src/agent-sdk/assets/tools/repo/market-outlook/build_outlook.py`), and writes the one
judgment that needs all three.

```
            ┌─ /macro-data  ─┐
 parallel ──┤                ├─► /macro-regime ─┐
            └─ /macro-news  ─┘  (score + read)  │
                                                ├─► build_outlook.py ─► judgment ─► publish
 parallel ──┬─ /theme-pulse (prices, baskets) ──┤
            └─ /x-sentiment (corpus) ───────────┘
```

## Process

Use one date for every step: `<DATE>`, default today.

### 1. Gather (one message, all in parallel)

- Bash: `python3 src/agent-sdk/assets/tools/repo/macro-data/fetch_macro.py --date <DATE>`
- Agent, in the background: the `/macro-news` subagent with `src/agent-sdk/assets/skills/macro-news/brief.md`
  (skip it with `--skip-news`, and say so)
- Bash: `python3 src/agent-sdk/assets/tools/repo/x-sentiment/compute_x_sentiment.py --date <DATE>`

When the macro fetch finishes, run
`python3 src/agent-sdk/assets/tools/repo/theme-pulse/fetch_theme_prices.py --date <DATE>`. It shares
`data/market/<DATE>/` and skips symbols already there.

### 2. Score (deterministic)

```bash
python3 src/agent-sdk/assets/tools/repo/macro-regime/compute_regime.py --date <DATE>
python3 src/agent-sdk/assets/tools/repo/theme-pulse/compute_themes.py --date <DATE>
```

### 3. Read, one concern at a time

Follow each skill's own read step, and write its judgment file:
All judgment files sit in `data/research/<DATE>/`:
1. `/macro-regime` steps 3-4 → `macro/narrative.json`. Then rerun `compute_regime.py`,
   which merges it, and rerun `compute_themes.py` so the macro fit is current.
2. `/theme-pulse` step 3 → `themes/theme-narrative.json`
3. `/x-sentiment` step 3 → `sentiment/sentiment-read.json`

### 4. Join

```bash
python3 src/agent-sdk/assets/tools/repo/market-outlook/build_outlook.py --date <DATE>
```

The stance per theme is mechanical: `0.45 × price + 0.35 × macro fit + 0.20 × sentiment`.
Read `outlook.md`. Then write `data/research/<DATE>/outlook/judgment.json`:

```json
{"summary": "6-10 sentences: the regime call and why, where the book should lean, what the crowd has wrong",
 "top_calls": ["theme or ticker: stance, why, what would invalidate it"],
 "overrides": [{"theme": "", "mechanical": "", "call": "", "reason": ""}],
 "risks": ["risk: probability, impact, tell"],
 "what_changes": ["dated tell from the events list"]}
```

Rerun `build_outlook.py` so the judgment is embedded.
`build_outlook.py --date <DATE> --verify` writes nothing and fails unless `outlook.md` is a fresh render with
the judgment embedded. That rendered file is the **daily brief**: a request starting "Daily brief" ends on it
verbatim, and the harness will not let an agent that built the outlook stop until the check passes.

### 5. Publish

Load `artifact-design` and publish `outlook.md`'s content as one page. The page has these
sections: call and risk budget; the three pillars (macro, themes, sentiment); the theme
stance table; divergences; events; falsifiers. Every number carries its as-of date. Reply
with the link, plus the call, the risk budget and the top five theme stances.

## Downstream

- `/runway-probe` reads `data/probes/runway/<PROBE_ID>/records/macro.json`. Produce it with
  `compute_regime.py --date <DATE> --runway <PROBE_ID>`, and take each ticker's `macro_fit_pts` from its
  archetype.
- `/corpus-probe` uses the regime call and the tilts in its regime-rule section, instead of
  deriving the regime only from the macro accounts.

## Rules

- Never recompute another skill's numbers here. If a number looks wrong, fix it in that
  skill and rerun it.
- A judgment that departs from a mechanical stance goes in `overrides`, with its reason.
- State stale inputs at the top: the X corpus age, and monthly macro prints that predate a
  shock.

## Report contract

When invoked through CLAUDE.md's "How to answer" protocol, this skill fills these parts of the standard report. Intent `outlook`: the whole report. **Answer** is `judgment.summary` with the risk budget. **Why** is the top calls. Add the theme stance table and divergences. **What would change it** is `what_changes`. Publish the page.
