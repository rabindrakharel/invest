# invest: business design

> What the repo is *for*: the outcome, users, use cases, products, economics, success measures,
> non-goals, risks and roadmap. The technical design is in [`design.md`](design.md). How Claude
> answers day to day is in [`/CLAUDE.md`](../CLAUDE.md). Updated 2026-09-24 for the market chain
> (macro, themes, sentiment, outlook, ticker brief); the 2026-09-07 text is in git history.


## Who it is for

A single operator running a personal or small-fund equity book with a stated mandate. The
operator is technical enough to run `pnpm` tasks and Claude Code skills, and wants to read
a finished report, not a spreadsheet. **Private by design:** X's developer terms restrict
redistribution of post content, and the verdicts are the operator's own.

## What the repo buys

1. **Memory.** Every allowlist post is captured once, structured and kept. Who called a
   name first, which themes recur, who revisits calls and who echoes: these become queries.
2. **Judgment on demand.** Repeatable analyses turn the corpus, the macro tape and
   thematic prices into decisions for a stated mandate: the regime and risk budget,
   theme stances, Core/Watch/Satellite tiers, and which names still have runway from
   today's price.
3. **Accountability.** Every pick is cited to a real post. Every outside figure carries its
   source and date. Every verdict is registered with a price, a scenario tree and a kill
   criterion, so later probes score earlier ones.

The asset is the structured corpus, the dated analysis outputs and the verdict ledger.
Reports and pages are renderings.

## Use cases

| # | Use case | Product |
|---|---|---|
| U1 | Build the corpus for a window | `/fetch` |
| U2 | Tier the corpus against a mandate | `/corpus-probe` page |
| U3 | Rank remaining upside, with falsifiable verdicts | `/runway-probe` page, evidence, ledger |
| U4 | Audit an account: beat, style, whether it revisits calls | `data/corpus/analysis/accounts/<handle>.json`, each probe's trust section |
| U5 | Answer a corpus question directly | `pnpm q <saved query>` |
| U6 | Score the record: hit rate, calibration | `data/ledger/verdicts.jsonl` |
| U7 | Read the macro regime and what it means for which stocks | `/macro-regime` |
| U8 | Read thematic direction and leadership | `/theme-pulse` |
| U9 | Read allowlist sentiment and crowding | `/x-sentiment` |
| U10 | One outlook: risk budget and theme stances | `/market-outlook` |
| U11 | A fast read on one name | `/ticker-brief` |

U1 → U2 → U3 is the stock chain. U7-U10 is the market chain, which feeds U2 and U3 their
regime. U6 is the feedback loop that makes both improve.

## Value chain

```
X accounts ──$──► raw posts ──► posts, mentions ──► account analyses, picks ─┐
FRED, Yahoo ─────► macro raw ─► regime (+ news) ──────────────────────────────┤
Yahoo ───────────► theme prices ─► theme pulse ───────────────────────────────┼─► outlook ─► corpus probe ─► runway probe ─► ledger
corpus ──────────► x-sentiment ───────────────────────────────────────────────┘                                                │
                                                                                     next probe's calibration ◄───────────────┘
```

Value is added at three points, and only the first costs money:
- **Acquisition** turns unbuyable history into a kept asset.
- **Structuring** turns text into cited claims, with a citation gate.
- **Judgment** turns claims plus market state into decisions. Mechanical scores come from
  scripts; perception follows written doctrine; top names are red-teamed; verdicts are
  registered.

## Products

- **The corpus** (`data/corpus/`): raw (gzip JSONL, append-only, with a manifest per run), posts
  and mentions (Parquet, deduped, ticker-resolved, sessionized to ET trading days), picks
  and pick_tags (Parquet, cited, provenance-stamped), and account analyses. It is read only
  through `sql/views.sql`. The first corpus was 4,992 posts read for $24.96 (six of fourteen accounts before credits
  ran out, 7 July to 6 September 2026), giving 108 formal picks across 26 symbols after the
  citation gate. As of 2026-09-24: 7,227 posts from 14 accounts, 7 July to 18 September
  2026.
- **The market chain** (`data/research/<DATE>/{macro,themes,sentiment,outlook}`): the
  regime, theme stances and sentiment, with a labelled judgment. First full run
  2026-09-24: Lean risk-off, 60% gross, long-duration cap 15%.
- **The Corpus Probe:** a fixed-format page of tier cards, the regime rule, a five-axis
  table per Core name, deep-inside signals, contested names, satellites, account trust and
  limits. The first probe had 12 Core, 14 Watch and 11 Satellite names. Its regime rule: with
  single-A corporate paper at 6%, the hurdle for equity is a visible free-cash-flow yield or
  a demonstrated earnings inflection.
- **The Runway Probe:** twelve signals in four groups, four gates, a 100-point rubric,
  doctrine, a red team and registered verdicts. It is saved as a page, an evidence file,
  per-ticker records and ledger rows. The first probe (the three-signal version) found ten
  Runway, ten One-leg-missing and sixteen No-runway names, with VST, AVGO, GOOGL, AMZN and
  SNOW named as the mandate's fits.

## Economics

| Item | Cost |
|---|---|
| X API reads | about $0.005 per post: about $25 per two-month window for six accounts, about $60 for all fourteen. `--max-posts` is the hard cap |
| Extraction, probes, market chain | $0: subagents in session, public pages, FRED and Yahoo without keys |
| Storage and query | $0: git, Parquet, DuckDB |
| Daily capture (when enabled) | about $38 per month for X, plus about $12 per month if the API extraction lane is used |

The metered input is kept small and everything derived is free to recompute. A second
mandate, window or rerun costs close to nothing.

## Success measures

| Measure | How it is read | First reading |
|---|---|---|
| Corpus coverage | `pnpm q corpus-coverage` against the window paid for | 5 of 6 accounts complete on the first window; StockSavvyShay reached only 29 August |
| Citation integrity | `session-ingest --check` rejections | 0 of 6 files rejected on the first ingest |
| Pick concentration and convergence | `pnpm q account-repertoire`, `pnpm q account-convergence` | 8 to 32 picks per account; convergence on ASTS, MU, NBIS and TSLA |
| Verdict hit rate and calibration | the ledger scored against price at horizon, by tier and signal | 4 verdicts registered; not yet scorable |
| Regime call accuracy | each `data/research/<DATE>/macro/narrative.json` call against the next 3-6 months | first call 2026-09-24 (Lean risk-off) |
| Account trust | whether an account's picks preceded moves (`mention_episodes` plus prices) | blocked until the corpus price layer is rebuilt |

## What it is not

- **Not investment advice, and no execution.** There are no orders, positions or P&L.
- **Not a price service.** The corpus price layer (`data/corpus/prices/`) is still empty: Stooq
  blocks scripts and Finnhub is the named replacement. The market chain reads Yahoo into
  dated `data/market/` files for its own use. Corpus-derived returns are not computed
  until the price layer exists.
- **Not public.** Post content is restricted by X's terms.
- **Sentiment is measured, not graded as mood.** `/x-sentiment` measures attention,
  velocity, stances and crowding for 14 named accounts, never "the market". The extraction
  tag taxonomy stays at eight fixed values with a dated history.

## Risks and responses

| Risk | Response |
|---|---|
| A post is deleted or an account goes private | Tombstone list filtered in the views, never a mutation of raw (not yet built) |
| Aggregator pages block or change shape | Pinned registry with fallback order and failure logs; reports name unverifiable figures |
| The model invents a citation or number | The ingest gate rejects unresolved `post_id`s and quotes; mechanical scores come from scripts; reports cite files |
| Trusting a loud account | Mandatory trust sections; crowding scored as contrarian; the ledger scores accounts |
| Capture cost overrun | `--max-posts` cap; a manifest is written even on failure; ask before `/fetch` |
| Probes drift in format | Fixed templates and section order; this report shape |

## Roadmap

1. Complete the allowlist backfill; keep the corpus under 3 days stale.
2. Seed and score the ledger, including regime calls.
3. Rebuild the corpus price layer (Finnhub or equivalent) for lead/lag and hit rate.
4. Promote insider filings to a first-class layer.
5. A second copy of raw (nightly sync to object storage).
6. Tombstones for deleted posts.
7. A keyed market-data layer, only if report cadence makes web research the bottleneck.
