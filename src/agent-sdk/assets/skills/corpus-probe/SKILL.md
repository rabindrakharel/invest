---
name: corpus-probe
description: Produce a Corpus Probe - a mandate-driven portfolio read across the account analyses in data/corpus/analysis/accounts and the raw post bundles, tiered into Core / Watch / Satellite and published as an artifact. Use when asked to "probe the corpus", "what should my book take from these accounts", or to rerun the September Corpus Probe for a new window or mandate.
argument-hint: "[mandate, e.g. 'high return, medium-to-low risk, 1 to 3 years'] [--accounts handle,handle] [--window-end YYYY-MM-DD]"
---

# Corpus Probe

## The problem, and how it is solved

`/fetch` leaves one analysis per account: what each commentator claimed, with cited
picks. That answers "what did they say", account by account. It does not answer the
question a book actually has: across all of them, what should a stated mandate own, at
what size, and what did the accounts know that never became a formal pick. The probe
solves this in five moves: frame the candidate set from the analyses and the
cross-account queries; deep-read every raw bundle through one subagent per account for
the evidence the extraction contract excludes (earnings scorecards, sell-side relays,
insider filings, regime facts); test every candidate on five fixed axes; derive one
regime rule from the macro accounts and tier against the mandate; publish in a fixed
format so probes from different windows read side by side.

A probe reads *past* the pick lists. The account extraction (`v1-acct`) records what each
commentator claimed. The probe asks what a book with a stated mandate should do about it,
using the earnings scorecards, sell-side relays, Form 4 clusters and macro regime facts that
sit in the raw posts but never became formal picks.

The reference output is the September Corpus Probe (window 7 Jul to 6 Sep 2026). Every
future probe must be structurally identical to it so two probes can be read side by side.

## Inputs

| Input | Where | If missing |
|---|---|---|
| Mandate | first argument; default `high return, medium-to-low risk, 1 to 3 years` | use the default and say so in the meta strip |
| Account analyses | `data/corpus/analysis/accounts/<handle>.json` (profile, narrative, picks with cited post_ids) | run `/fetch` for the window; it ends with these files |
| Raw post bundles | `data/corpus/_session/<handle>.posts.jsonl` (retweets excluded, oldest first) | `pnpm task:session-dump --from <window_start> --to <window_end>`; the directory is gitignored |
| Cross-account tables | `pnpm q account-convergence`, `pnpm q account-repertoire`, `pnpm q account-tag-mix` | they read `picks_v`; rerun ingest first |
| Window | `window_start` / `window_end` from any analysis JSON, stamped by ingest from `data/corpus/_session/WINDOW.json` | never guess dates |
| Coverage gaps | `pnpm q corpus-coverage`: first and last day per account against the window | state each gap in the trust section and the warn callout |
| Market regime | the newest `data/research/<DATE>/macro/regime.json` (with its `narrative.json`) and `data/research/<DATE>/outlook/outlook.json` | run `/macro-regime`, or `/market-outlook` for the theme stances; check with `python3 src/agent-sdk/assets/tools/repo/state/state.py --intent outlook` |
| Theme direction and crowding | `data/research/<DATE>/themes/themes.json`, `data/research/<DATE>/sentiment/x-sentiment.json` | optional; run `/theme-pulse` and `/x-sentiment` |
| Price layer | `prices_v` | usually empty; then the probe quotes **no returns** from the corpus and says so. Current prices for context come from `data/market/<DATE>/yahoo/`, cited as such |
| Build workspace | `data/probes/runs/<DATE>/` for any script, bundle copy or intermediate table | create it; never write working files anywhere else |

`--accounts` restricts the probe to a subset. `--window-end` is only for labelling when the
analyses were built for an earlier window than today.

## Process

Work in this order. Do not write the report until step 4 is complete.

### 1. Frame

Read every analysis JSON in full (profile, narrative, all picks). Run the three saved
queries. From these, write down before reading any raw posts:

- the candidate set: every formal pick with conviction >= 0.70, every convergence row
  (two or more accounts with a stance), and every name the narratives argue about
- each account's coverage gap (e.g. an account whose bundle spans ten days, not the window)
- which accounts are regime sources (rates, credit, macro) versus name sources

### 2. Deep read, one subagent per account

Bundles run to ~2,000 lines. Never read them in the main context. Launch one
`general-purpose` subagent per account, all in one message, with the brief in
`evidence-brief.md` and the candidate set from step 1. Each returns structured evidence
notes; the shape is fixed in that file. The notes are the only source for numbers in the
report.

Cheap pre-filter the subagent should use before reading linearly:

```bash
grep -inE 'vs\.? (est|exp|cons)|consensus|beat|missed|guid' data/corpus/_session/<handle>.posts.jsonl
grep -inE 'upgrade|downgrade|initiat|price target|\bPT\b|overweight' data/corpus/_session/<handle>.posts.jsonl
grep -inE 'insider|form 4|bought|purchase|10% owner' data/corpus/_session/<handle>.posts.jsonl
grep -inE 'fed|fomc|ten-year|10y|oil|payroll|CPI|spread' data/corpus/_session/<handle>.posts.jsonl
```

### 3. Probe every candidate on five axes

For each name in the candidate set, plus every name the deep read surfaced with an
insider cluster or an earnings scorecard, answer all five. A blank axis is written as
"None in corpus", never left out.

1. **Theme.** Structural driver or flow story.
2. **Sentiment.** Position on the hated-to-crowded axis, and whether more than one account agrees.
3. **Earnings.** An actual print with consensus comparisons in the corpus, or only a chart.
4. **Analyst and insider.** Sell-side initiation, target change, or Form 4 cluster relayed by an account.
5. **Risk.** Balance sheet, binary events, concentration, and the reliability of the sponsoring account.

### 4. Tier against the mandate

Derive one **regime rule** first, from two sources:
1. **The measured regime**, from `/macro-regime`: its call, duration regime, flags and
   risk budget (gross exposure, long-duration cap), and the archetype fits.
2. **The macro accounts' own view** from the corpus.

The September rule was: with 30-year single-A paper at 6.02%, equity needs a real
free-cash-flow yield or a demonstrated earnings inflection. When the two sources disagree,
say so in the regime section and apply the stricter one. Apply the rule before conviction:
- a name whose archetype fit is a headwind (fit -0.5 or lower) cannot be Core unless it has
  a print that clears the rule;
- in a hostile duration regime, long-duration names cap at Satellite.

| Tier | Test | Instruction to the reader |
|---|---|---|
| **Core** | a real print in the corpus, valuation reset or FCF visible, no binary event, passes the regime rule | size these |
| **Watch** | insider cluster or split view, no formal pick or a single-source pick, question the corpus cannot answer | do your own work before sizing |
| **Satellite** | high conviction from an account, real evidence, but a risk the mandate cannot carry at core size | cap the sleeve |

A name with conviction 0.9 and no print is Satellite or a Pass, never Core. A name no
account picked can be Core if the deep read found the print and the insider buy (PFE was).

### 5. Write, then publish

The reference output is saved at `data/probes/corpus/2026-09-06-probe.html`; read it once before writing so the register matches. Copy `template.html` to `data/probes/corpus/<window_end>-probe.html`, fill every
section in the fixed order below, and publish it with the Artifact tool. Title is
`<Month> Corpus Probe` using the month of `window_end`. Favicon is 🔍 on first publish;
omit it when republishing the same file. Set `description` to one sentence naming the
window and account count.

## Section order (fixed)

1. Eyebrow, H1, lede, meta strip (mandate, posts read, formal picks and account count, price-layer status).
2. Three tier cards with ticker lists and a one-line sizing instruction each.
3. **The lens the corpus itself supplies.** Regime paragraph, then the portfolio-implication callout, then the counterweight accounts.
4. **How each name was probed.** The five axes, verbatim from step 3.
5. **Core** table: Name, Theme, Sentiment, Earnings evidence, Analyst / insider, Risk, Verdict. One `.src` line under it stating figures are as posted and unchecked.
6. **Deep-inside signals no account turned into a pick.** One bullet per name, insider intensity first, ending with the question the corpus cannot answer.
7. **Contested names, and how to read the disagreement.** `dl.acct` rows, each ending with a one-sentence read.
8. **Satellites.** Bullets, each naming the evidence and the disqualifying risk.
9. **How much to trust each account.** `dl.acct`, one row per account, strengths then the discount.
10. **What this probe cannot tell you yet.** Warn callout, then three concrete next steps for the pipeline.
11. Footer: sources line and "Nothing here is investment advice."

## Rules

- **Every figure is as posted.** Attribute each number to an account and a date in the sentence that uses it. Never compute a return, never quote a price the corpus does not contain, never check a figure against filings and imply you did.
- **A mention is not a pick, a filing is not a stance.** CEOStockWatcher-type feeds are data for axis 4, never sponsors of a Core name on their own.
- **Verdicts are actions.** The Verdict column and every tier card `small` say what to do at what size, in one or two sentences.
- **Disagreement is kept, not netted.** Contested names show both sides and then the read.
- **Coverage gaps are stated per account** in both the trust section and the warn callout.
- **Prose style.** Short sentences. No em dashes, no parentheticals, no arrows. Tickers in `<span class="t">`, numbers in `<span class="num">`, risk cell as one of `low`, `low-medium`, `medium-low`, `medium`, `high`.
- **Do not change the template CSS or section order.** Coherence across probes is the point. If a section has nothing to say, keep the heading and write one sentence saying why.

## What follows a corpus probe

The corpus probe tiers names on what the accounts said. To rank those names by their chance
of further gain from today's price, on twelve signals from earnings and competition through
insider and institutional flow, retail crowding, chart, macro fit and narrative harmony, run
`/runway-probe` next. It reads this probe's tier cards as its input and writes to
`data/probes/runway/<window_end>/probe.html`.

## Done when

- every candidate from step 1 appears in exactly one of Core, Watch, Satellite, Contested, or is named as a Pass
- every number in the report traces to an evidence note with a post_id
- the file exists under `data/probes/corpus/` and the artifact URL is in the final message

## Report contract

When invoked through CLAUDE.md's "How to answer" protocol, this skill fills these parts of the standard report. Intent `corpus`: the Corpus Probe page is the report. Reply with the report header (As of, Regime from the latest `/market-outlook`), the tier counts, the regime rule and the link.
