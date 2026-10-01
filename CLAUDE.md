# invest: how Claude works here

This file is loaded into every session, so it holds only what every interaction needs:
**how to answer** (Part I) and **which skill owns what** (Part II). Everything else lives in
a document with one concern, read when the task touches it (see "Reference documents"
at the end).

**The outcome.** Turn a stream of market commentary, the macro tape and thematic price
action into a compounding, auditable research asset. It tells one book what to own, at
what size and why, and keeps a record of whether it was right.

**The mandate** (the default; an input to every analysis, never a constant): a
hedge-fund lens, a medium to long horizon (1 to 3 years), medium-low risk, and high return
within that risk.

---

# Part I: How to answer

Every interaction ends in a **report**: a cited, dated answer in a fixed shape. This holds
for a one-line question too. Skills produce the evidence; this protocol decides which
skills to run and how to present the result.

## Step 0: Know what is current

```bash
python3 src/agent-sdk/assets/tools/repo/state/state.py --intent <intent>
```

The script prints each product's date, age and freshness, and the ordered commands that
bring this intent up to date. Run only what it lists. Never rerun a fresh product. When
the plan includes `/fetch`, **ask first**: it is the only metered step (about $0.005 per
post). If the answer can stand on a stale corpus, say so and proceed.

## Step 1: Route the request

| The operator asks… | Intent | Skills, in order | Report |
|---|---|---|---|
| "Risk on or off?", "what do rates, oil, housing, the Fed or MBS mean?" | `macro` | `/macro-data` ∥ `/macro-news` → `/macro-regime` | macro report |
| "Which themes lead?", "Mag 7 vs the rest", semis, cloud, cybersecurity, biotech, AI infrastructure | `themes` | `/macro-data` → `/macro-regime` → `/theme-pulse` | theme report |
| "What are the accounts saying?", "is X crowded?" | `sentiment` | `/x-sentiment` | sentiment report |
| "Give me the outlook", "what should the book do?", "morning read" | `outlook` | `/market-outlook` (runs all of the above) | full outlook |
| "What about NVDA?", "should I add MU?" | `ticker` | the fresh products, then `/ticker-brief` | ticker brief |
| "Tier the corpus", "what should I own from these accounts?" | `corpus` | `/fetch` (ask) ∥ `/macro-data` → `/macro-regime` → `/corpus-probe` | Corpus Probe page |
| "Which have runway?", "rank these names" | `runway` | `/macro-data` → `/macro-regime` → `/theme-pulse` ∥ `/x-sentiment` → `/corpus-probe` → `/runway-probe` (which writes its macro file with `compute_regime.py --runway <PROBE_ID>`) | Runway Probe page |
| "Were we right?", "check the verdicts" | `record` | read `data/ledger/verdicts.jsonl` against current prices (ticker-brief's price files) | record report |
| A corpus fact ("who mentioned X first?") | none | `pnpm q <saved query>` | short answer, same header |

For a mixed question, take the widest intent that covers it. "Should I add NVDA given the
Fed?" is `ticker`: the brief carries the regime.

## Step 2: Run, in parallel where the chain allows

- Gather steps are independent: the macro fetch, the news subagent, x-sentiment, and
  theme prices once the macro raw data exists. Launch them in one message.
- Scoring steps are deterministic scripts. Judgment files come after scoring.
- Subagents run in the background. Never report their results before they return.

## Step 3: Write the report

Every report uses this shape. Scale its length to the question, never its structure:

```
# <Title>, <DATE>
As of: macro <date> · prices <date> · X corpus through <date> (<n>d stale) · news <date>
Regime: <call> (composite <x>) · risk budget <gross>% gross, long-duration cap <y>%

## Answer
<the direct answer in 2-5 sentences: a verdict, not a survey>

## Why
<the three to six pieces of evidence that carry it, each cited: signal id, file, URL or post_id>

## What would change it
<two or three observable tells, each with a date from the events calendar>

## Gaps and stale inputs
<what was missing, stale or judged rather than measured>
```

Add sections only as the intent needs them: a theme stance table for `themes` and
`outlook`, a signal table for `macro`, the record for `ticker`.

## Step 4: Save and link

- Save every report to `data/reports/<DATE>-<slug>.md`, and append one line to
  `data/reports/INDEX.md`: `- <DATE> [<title>](<file>) — <one-line answer>`.
- Reply in the terminal with the report itself when it is short (under about 40 lines).
  Otherwise reply with the Answer section and the file path.
- In the web chat (`pnpm web`) the orchestrator shows the finished report inline with `present` (see
  `src/agent-sdk/assets/tools/present/guide.md`); the saved report below stays the record.
- Publish as an artifact (load `artifact-design` first) when the operator asks, or for the
  full `outlook`, Corpus Probe and Runway Probe pages. For anything else, offer it in one
  line.

## Step 5: Leave the record better

- A new source failure goes into the owning skill's source-behaviour table.
- A ticker asked about twice that sits outside every basket gets proposed for
  `config/themes.json`.
- A verdict or call made in a report that is meant to be tracked goes into the ledger
  through `/runway-probe`'s register step, not by hand.

---

# Part II: Skills (one concern each)

| Skill | Concern | Writes (under `data/`) | Needs |
|---|---|---|---|
| `/fetch` | X API capture → normalize → per-account analyses (subagents, no API key) | `corpus/`, `corpus/analysis/accounts/` | `X_BEARER_TOKEN`; **metered** |
| `/macro-data` | FRED (about 60) and Yahoo (about 50) macro series. Data only | `market/<DATE>/` | network |
| `/macro-news` | Dated news: Fed, auctions, housing, oil, outlooks, themes, events | `research/<DATE>/macro/news.json` | WebSearch/WebFetch subagent |
| `/macro-regime` | 54 signals → risk-on/off, flags, quadrant, duration regime, archetype fit, analogs; the macro judgment | `research/<DATE>/macro/regime.json`, `narrative.json`, `regime.md` | macro-data (+ news) |
| `/theme-pulse` | Benchmarks and about 30 baskets: relative strength, trend, breadth, direction | `market/<DATE>/yahoo/` + `research/<DATE>/themes/themes.json`, `theme-narrative.json` | `config/themes.json` |
| `/x-sentiment` | Allowlist attention, velocity, tone, stances, crowding per ticker and theme | `research/<DATE>/sentiment/x-sentiment.json`, `sentiment-read.json` | the corpus |
| `/ticker-brief` | One name: joins every product above plus the runway record; the brief is rendered from a fixed template, never hand-written (a hook enforces it) | `research/<DATE>/tickers/<T>.json`, `<T>.judgment.json`, `reports/<DATE>-<t>.md` via `render_brief.py` | the fresh products |
| `/market-outlook` | Orchestrator: risk budget plus a stance per theme | `research/<DATE>/outlook/outlook.json`, `outlook.md` | all of the above |
| `/corpus-probe` | Mandate-driven Core/Watch/Satellite from the accounts | `probes/corpus/` | `/fetch`; research/<DATE>/macro (the regime rule) |
| `/runway-probe` | Rank names by runway on twelve signals; register verdicts | `probes/runway/<PROBE_ID>/`, `ledger/verdicts.jsonl` | `/corpus-probe`, research/<DATE>/{macro,themes,sentiment} |

Skills and the repo's Python tools live once, under `src/agent-sdk/assets/` (`skills/`, `tools/repo/`).
`.claude/skills/` and `.claude/agents/` hold generated pointers to them (`pnpm agents:shims`), so each
skill is a slash-command here and, through `pnpm agents`, work a subagent owns.
`src/agent-sdk/assets/tools/repo/state/state.py` is the router's eyes. Each skill's SKILL.md has a "Report
contract" saying which Part I sections it fills.

## Conventions every skill follows

1. **Separation of concerns.** A skill owns its files. It reads others' outputs and never
   recomputes their numbers. If an input looks wrong, fix it in the owning skill and rerun.
2. **Mechanical, then judgment.** Scripts are deterministic: same inputs, same output.
   Agents write judgment into separate, named files (`narrative.json`,
   `theme-narrative.json`, `sentiment-read.json`, `judgment.json`). A departure from the
   mechanical result is labelled with its reason.
3. **Every value is sourced.** Use `{value, source, as_of}` or a signal row with
   `sources` and `as_of`. Never guess a number; write "not found". Cite `post_id`s for
   anything an account said.
4. **One data location.** All data lives under `data/`; the tree and its owners are in
   `data/README.md`. Python resolves every path through `src/agent-sdk/assets/tools/repo/lib/paths.py`, TypeScript
   through `src/pipeline/duck/connect.ts`. Scripts take `--date`, not paths. Outputs are dated
   (`research/<DATE>/<part>/`, `market/<DATE>/`), and a date is never overwritten by a
   later one.
5. **Stale inputs are stated first**, in the report's As-of line.
6. **One definition per list.**
   - Macro series: `src/agent-sdk/assets/tools/repo/macro-data/catalog.py`.
   - Themes and benchmarks: `config/themes.json`.
   - Corpus reads: `sql/queries/*.sql` via `pnpm q`, over `sql/views.sql`.
   - Accounts: `config/accounts.json`.
7. **Source failures are logged forward** in the owning skill.
8. Python scripts use the standard library only. Do not add pandas.
9. **Wiring is checked, not hoped for.** After changing any skill, script, command or
   path, run `python3 src/agent-sdk/assets/tools/repo/wiring/check_wiring.py`. It verifies that every skill is in the
   table above, every documented command, flag and saved query exists, every `data/` path
   sits in a defined area, and no script hard-codes a path. Probe placeholders are
   `<DATE>` and `<PROBE_ID>` (`<window_end>[-label]`).

---

# Reference documents (read when the task touches them)

| Document | Concern | Read it before |
|---|---|---|
| [`docs/business.md`](docs/business.md) | Outcome, users, use cases U1-U11, value chain, products and their first readings, economics, success measures, non-goals, risks, roadmap | scoping new work, judging whether a feature is in scope, anything about cost or X's terms, reporting on progress or the record |
| [`docs/agents.md`](docs/agents.md) | The agent harness (`src/agent-sdk`): orchestrator and subagents, profiles, tool families, hooks, what was ported from pmo | adding or changing an agent, a tool family or a hook; running `pnpm agents` |
| [`docs/design.md`](docs/design.md) | Storage decision and rejected options, data layout, append-only rules, pipeline, correctness boundaries, design-review corrections, data findings, deployment, verification | touching `src/`, `sql/`, `data/` layout, capture, normalize, extract, the price layer, CI, or any claim about determinism |
| [`data/README.md`](data/README.md) | The data tree: every area, its owner, what is committed or ignored, where things moved from | reading or writing any data, adding a skill output |
| [`README.md`](README.md) | Commands | running a `pnpm` task |
| `src/agent-sdk/assets/skills/<skill>/SKILL.md` | Each skill's procedure and report contract | running that skill |
| `src/agent-sdk/assets/skills/macro-regime/{indicators,history,playbook}.md` | What macro signals mean, the historical eras, the transmission from regime to stocks | writing any macro judgment |

**Invariants to remember without opening them:**
- `data/corpus/raw/` is paid for, irreplaceable and append-only.
- DuckDB is a query engine over files, never a committed database.
- Picks and prices are never regenerated.
- Read the corpus only through `sql/views.sql` and `sql/queries/`.
- The model never produces a price fact.
- Nothing here is investment advice, and the repo stays private.
