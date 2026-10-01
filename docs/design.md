# invest: technical design

> Architecture, decisions, what was rejected and why, correctness boundaries, deployment and
> verification. The business side is in [`business.md`](business.md). How Claude answers is in
> [`/CLAUDE.md`](../CLAUDE.md). Updated 2026-09-24; the 2026-09-06 text is in git history.


## The two economic facts that shape everything

1. **X API reads are metered per post (about $0.005).** There is no free tier; the legacy
   flat tiers are closed. Every re-read costs money, so capture once and derive many times.
2. **Recent search reaches back about 7 days.** The full archive is Enterprise-only (about
   $42k per month), so history not captured is effectively unbuyable. The user-timeline
   endpoint (`task:backfill`) is the only affordable way past that wall.

Therefore **`data/corpus/raw/` is expensive, irreplaceable and append-only, and everything
downstream is free to recompute.** Nearly every decision below follows from that
asymmetry.

## Storage: git plus Parquet plus DuckDB ($0 per month)

The workload is about 250 rows a day (about 90k a year, about 90 MB a year), one writer
and one analytical reader. The whole multi-year corpus fits in RAM, so anything with a
server or a bill is over-engineering.

| Option | Cost/mo | Real SQL | Verdict |
|---|---|---|---|
| **Git repo (Parquet) + DuckDB** | **$0** | yes, including window functions | **Chosen** |
| SQLite committed to the repo | $0 | yes | Rejected: the git trap |
| `.duckdb` file committed | $0 | yes | Rejected: the same git trap |
| Cloudflare R2 + DuckDB | about $0.01 | yes | The escape hatch, not day one |
| Turso / libSQL free tier | $0 | yes | An irreplaceable dataset on a startup free tier, for no gain at 90k rows a year |
| Neon / Supabase free | $0 | yes | No diffability or audit trail over data changes; a backup pipeline would be needed anyway, making Postgres a redundant middleman |
| DynamoDB | about $0.10 | no | An OLTP key-value store, and every query shape is a scan with grouping and windowing; wrong even with GSIs |
| S3 + Athena | about $0.02 + $5/TB | yes | Glue catalog, latency, per-query cost and AWS coupling for scale not reached in a decade; DuckDB already reads S3 with no catalog |

**The git trap.** A binary database file is rewritten on every commit and git cannot
delta it; a 20 MB `.db` committed daily is about 7 GB of objects a year. Date-partitioned
Parquet adds one small file a day and never rewrites history. **The rule: DuckDB is a
query engine over files, never a committed binary database.** This applies to every layer.
The first draft broke it in the price layer (see Corrections).

At about 90 MB a year of immutable new bytes, GitHub's 1 GB "recommended" ceiling is reached
around year 11 and the 5 GB "we may contact you" mark around year 55. File count reaches
about 15,000 by year 10; the Linux kernel has about 80,000. Every file is written once, so
the cost is exactly the compressed byte size. CI uses
`fetch-depth: 1`; sparse checkout is the fix if the working tree ever grows too large.
Outgrowing git is one environment variable (`INVEST_DATA_ROOT` pointing at `s3://` or
`r2://`), not a migration. The storage layer *is* the version history and the backup.

## Layout

```
data/                         one root for all data (INVEST_DATA_DIR); the full contract is data/README.md
  corpus/                     the X corpus: dataRoot(), INVEST_DATA_ROOT
    raw/        ingest_dt=YYYY-MM-DD/posts-<run_id>-a<attempt>-p<page>.jsonl.gz
    posts/      ingest_dt=YYYY-MM-DD/posts.parquet
    mentions/   ingest_dt=YYYY-MM-DD/mentions.parquet
    picks/      ingest_dt=YYYY-MM-DD/picks-<prompt_version>-<day>.parquet
    pick_tags/  ingest_dt=YYYY-MM-DD/pick_tags-<prompt_version>-<day>.parquet
    prices/     ingest_dt=YYYY-MM-DD/eod-<provider>.parquet
    analysis/   accounts/<handle>.json, <day>.json (API lane)
    _session/   subagent bundles (gitignored)
  rendered/                   daily/, tickers/, INDEX.md: outputRoot(), INVEST_OUTPUT_ROOT
  market/<DATE>/              fred/, yahoo/, _fetch_log.json (gitignored; re-downloadable)
  research/<DATE>/<part>/     macro, themes, sentiment, outlook, tickers
  probes/                     corpus/, runway/<id>/{probe,evidence,records}, runs/
  cache/ reports/ ledger/     fetched evidence pages (gitignored), answers, verdicts.jsonl
config/                       configuration, not data: accounts.json, tag_taxonomy, symbols, bare_allowlist,
                              blocklist, universe, enums, themes.json
sql/views.sql                 the only sanctioned read path
sql/queries/                  saved analyses (pnpm q)
src/pipeline/                 the TypeScript pipeline: x, capture, normalize, extract, prices, render, duck, lib
src/agent-sdk/                the agents: orchestrators, subagents, skills, and the tools that call the pipeline
docs/                         business.md, design.md, agents.md
```

The pipeline is ordinary code with `pnpm` tasks. The agents do not import it: each entry point
(and each Python scraper and scorer) is registered once in `src/agent-sdk/assets/config/scripts.yaml`
and called as a typed tool, so the code can move without touching an agent.

- **`ingest_dt` is the capture date, never the post's creation date.** Keying on creation
  would force rewrites of committed files. Consequently the same `post_id` can sit in
  several partitions, so never read Parquet directly; the views dedupe (enforced by test).
- **Run-scoped filenames** (run, attempt, page), so a retry can never truncate a complete
  file.
- **Append-only layers are never regenerated.** These are raw, picks, pick_tags and
  prices. Prices are restated after splits, so overwriting destroys point-in-time truth.
  Picks come from a non-deterministic model that will be retired, and `prompt_version` in
  the filename makes a new prompt additive. `pnpm rebuild` regenerates posts, mentions and
  markdown only, and refuses `--picks` and `--prices`.
- **"Regenerable" means content equality**, not bytes (Parquet embeds its writer version).
  Raw gzip is byte-stable (header MTIME zero, asserted). Rendered markdown is
  byte-identical.

## Pipeline

| # | Stage | Output | Entry point |
|---|---|---|---|
| 1 | capture: one recent-search request with a `from:` disjunction over the allowlist; cost guard at 3× the trailing median | `data/corpus/raw/` | `pnpm task:capture` (daily) / `task:backfill` (timeline, `--max-posts`) |
| 2 | normalize: dedupe, ticker resolution, `post_type`, `metric_age_seconds` | posts, mentions | `pnpm task:normalize` |
| 3 | extract: an API lane (one call per session) or the session lane (one subagent per account, no key) | picks, pick_tags, account analyses | `task:extract` / `task:session-dump` → subagents → `task:session-ingest` |
| 4 | enrich: provider interface; Stooq is blocked, Finnhub is next | prices | `pnpm task:enrich` |
| 5 | render | `data/rendered/{daily,tickers,INDEX.md}` | `pnpm task:render` |

Provenance travels with every pick: `model`, `prompt_version`, `prompt_sha256`,
`schema_hash`, `llm_response_sha256`. The session lane swaps the model call, not the
validation: every quote must appear verbatim in the exact post it cites.

**One data root (reorganised 2026-09-24).** Everything the system reads or writes sits
under `data/`, in areas by concern and owner. Python resolves paths only through
`src/agent-sdk/assets/tools/repo/lib/paths.py` and TypeScript only through `src/pipeline/duck/connect.ts`, so moving the
tree is one environment variable (`INVEST_DATA_DIR`). `market/` and `cache/` are
gitignored: they are about 35 MB a day of free-to-refetch history, and the research
outputs that cite them record URL and date. That keeps the git-growth budget above
intact.

## Correctness boundaries

- **Price facts have one source, and it is not the model.** The extraction lane is barred
  from importing the price layer by lint (`no-restricted-imports`). Absent data renders as
  an em dash, never 0.
- **Citations are checked.** `assertCitationsResolve` fails the run rather than writing a
  fabricated `post_id`.
- **Bare tickers come from an allowlist, not the universe.** About 41 English words are
  live tickers (NOW, OPEN, ALL, IT, ON…). `$CASHTAG` always resolves; a bare token only
  from `config/bare_allowlist.csv`. The rest land in `unresolved`, the loop that grows the
  allowlist.
- **Nothing is discarded at normalize.** Crypto and private names keep `asset_class` with
  NULL prices.
- **Attribution excludes echoes.** `mention_events` drops retweets and LLM-inferred
  mentions.
- **Lead/lag is measured within episodes.** A gap of more than 7 days starts a new episode.
- **Tag drift needs a denominator.** `config/tag_taxonomy.csv` has validity dates.
- **Engagement is a capture-time snapshot** (`*_at_ingest` plus `metric_age_seconds`).
- **The capture cursor comes from raw** (`max(post_id)`), never from a state file or the
  normalized layer.
- **Market-chain determinism.** Every script reads a dated raw directory and writes the
  same output twice. Monthly FRED transforms count calendar months, because unpublished
  months are blank (October 2025, the shutdown). Points dated after the fetch are dropped.

## Corrections made during design review

1. **The price layer was a git-churn bomb:** per-symbol files rewritten daily (about 2.9 GB
   a year). Now append-only by capture date.
2. **"Regenerable byte-identically" was false,** and the draft's rollback would have deleted
   a model's judgments. Replaced by content equality plus append-only protection.
3. The partition key is resolved to `ingest_dt`.
4. Retries could truncate a capture; filenames are now run-scoped.
5. `metric_age_seconds` was missing; it cannot be reconstructed later.
6. Lead/lag needed episodes.

On the record: Neon and Supabase were first rejected for auto-suspend, which was wrong
reasoning. The conclusion stands for the table's reasons.

## Findings from the code and the data

- `occurrences` was always 1. It was rewritten with span-masking.
- `mtime` is not a Node zlib option, so determinism is asserted on the gzip header bytes.
- `source` is a DuckDB reserved word, so the columns are `mention_source` and
  `price_source`.
- TypeScript is pinned at 5.9.3 and vitest at 4.1.11, because of `typescript-eslint` and
  Node constraints.
- **Stooq (2026-09-06)** answers with a JavaScript proof-of-work page. The `Bar[] | null`
  contract turned 698 failures into 698 skips and no corruption. The challenge was
  deliberately not solved: defeating a bot control is a liability.
- **X cashtag entities include money amounts** (`$1.77M` in "CFO sold $1.77M of stock").
  The entity path skipped the shape check the text path applied, so money amounts became
  "symbols". The first backfill had 11 fabricated symbols out of 698 (0.3% of mentions).
  `isTickerShaped()` now applies to both paths, and a rejected span stays masked so `$25MM`
  cannot come back as a bare `MM`. Private names (ANTHROPIC, OPENAI, SPACEX) resolve through
  the security-name path. Only mentions were rebuilt, with no re-purchase.
- **FRED stalls browser user-agents while Yahoo rejects library ones,** so there is one
  user-agent per source (`macro-data`). Yahoo labels `^MOVE` wrongly; the data is the ICE
  BofA MOVE.

## Deployment

`.github/workflows/daily.yml` runs at 20:15 UTC (16:15 ET) with `cancel-in-progress:
false`, because a cancelled capture spends money and commits nothing. **There are two
jobs:** `capture` uploads raw as an artifact *before* committing; `derive` runs from a fresh
checkout. A render bug must never cost a day of paid data. Secrets are `X_BEARER_TOKEN`
and `ANTHROPIC_API_KEY`. `main` blocks deletion and force-push, with no admin bypass.

| Running cost | Monthly |
|---|---|
| X API (about 250 posts a day at about $0.005) | about $38 |
| Claude (one API extraction call a day, when that lane is used) | about $12 |
| Storage and query | $0 |
| GitHub Actions | $0 (within the Team allowance) |
| **Total** | **about $50** |

The X API is about 75% of the bill, which is why read discipline is a cost control.

## Verification

| Claim | Proof |
|---|---|
| Dedupe across partitions | `src/pipeline/duck/views.test.ts` |
| ET session boundary across DST | `src/pipeline/lib/time.test.ts` |
| A retry cannot truncate | `src/pipeline/capture/writer.test.ts` |
| Common words are not tickers | `src/pipeline/normalize/tickers.test.ts`, against the real universe |
| Fabricated citations fail | `src/pipeline/extract/validate.test.ts` |
| Private names are never priced | `src/pipeline/prices/returns.test.ts`, `src/pipeline/render/daily.test.ts` |
| Whole chain, raw → markdown | `src/pipeline/pipeline.test.ts` |
| Regime engine rules, gaps, determinism | `src/agent-sdk/assets/tools/repo/macro-regime/test_compute_regime.py` |
| Runway forward metrics | `src/agent-sdk/assets/tools/repo/runway-probe/test_forward_metrics.py` |

```bash
pnpm test && pnpm typecheck && pnpm lint
cd src/agent-sdk/assets/tools/repo/macro-regime && python3 -m unittest test_compute_regime
cd src/agent-sdk/assets/tools/repo/runway-probe && python3 -m unittest test_forward_metrics
```

67 TypeScript tests, typecheck and lint pass in CI, plus the Python suites above.

**Verified against the live API** (2026-09-06, 10 posts, $0.05, `--max-pages 1 --max-results 10`
into a scratch data root):

| Check | Result |
|---|---|
| Field completeness | 0 missing handles, hashes, ages or sessions |
| `post_type` from real `referenced_tweets` | original, reply, quote and retweet all present and correct |
| ET session roll | posts created on 09-06 after 16:00 ET correctly assigned to the 09-07 session |
| Attribution excludes echoes | 4 mentions, 3 attributable, 1 retweet excluded |
| Ticker resolution | GOOGL, NVDA, TSLA and UBER, all via cashtag, all `equity` |
| Bare-allowlist precision | `AGI` (a live ticker, Alamos Gold) in an AI post created no mention; it went to `unresolved` |
| `metric_age_seconds` spread | 94s to 9,398s, a 100x range within one page; this is the bias the column exists to condition on |

**Market chain, verified 2026-09-24:** 115 of 115 macro series fetched after the user-agent
fixes; 54 of 54 signals scored; 228 of 229 theme symbols priced (MNMD returned 404); two
identical engine runs produce byte-identical `regime.json`.

## Remaining engineering work

1. Keep capture current: the 7-day window makes every missed week unbuyable.
2. Verify the API extraction lane against a live model call (the session lane is proven).
3. Honour deletions with tombstones plus a view filter.
4. Replace the price provider (one file: `toStooqSymbol` is the only Stooq-shaped code).
5. Grow `config/bare_allowlist.csv` from `unresolved`.
6. A second copy of raw (nightly `rclone` to R2).
7. A weekly integrity job (gunzip every raw file, check against manifests).
8. Sparse checkout in CI when the tree grows.
