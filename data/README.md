# data/: the one place data lives

Every script and skill reads and writes here, and nowhere else. The layout is encoded once
for each language:
- Python: `src/agent-sdk/assets/tools/repo/lib/paths.py`. Skills import it; none hard-codes a path.
- TypeScript: `src/pipeline/duck/connect.ts` (`dataDir()`, `dataRoot()`, `outputRoot()`).

Move the whole tree with `INVEST_DATA_DIR`.

```
data/
├── corpus/                     the X corpus: the TS pipeline's root (dataRoot, INVEST_DATA_ROOT)
│   ├── raw/                    ingest_dt=<D>/posts-<run>-a<n>-p<n>.jsonl.gz   PAID, append-only, never rewritten
│   ├── posts/ mentions/        ingest_dt=<D>/*.parquet                         derived, rebuildable (pnpm rebuild)
│   ├── picks/ pick_tags/       ingest_dt=<D>/*-<prompt_version>-*.parquet      append-only, never regenerated
│   ├── prices/                 ingest_dt=<D>/eod-<provider>.parquet            append-only (empty until a provider is wired)
│   ├── analysis/accounts/      <handle>.json: one analysis per account (session ingest)
│   ├── analysis/<day>.json     API-lane extraction output
│   └── _session/               subagent bundles and out/          gitignored, regenerable (pnpm task:session-dump)
├── rendered/                   pnpm task:render (outputRoot): daily/, tickers/, INDEX.md
├── market/<DATE>/              downloaded market data                          gitignored, re-downloadable
│   ├── fred/<SERIES>.csv       /macro-data
│   ├── yahoo/<SYMBOL>.json     /macro-data and /theme-pulse share one directory per day
│   └── _fetch_log.json         every request: url, rows, last date, error; fetched_at is the snapshot cutoff
├── research/<DATE>/            dated skill outputs, one folder per concern
│   ├── macro/                  regime.json, regime.md, narrative.json, news.json      /macro-regime, /macro-news
│   ├── themes/                 themes.json, themes.md, theme-narrative.json           /theme-pulse
│   ├── sentiment/              x-sentiment.json, x-sentiment.md, sentiment-read.json, tone.json   /x-sentiment
│   ├── outlook/                outlook.json, outlook.md, judgment.json                /market-outlook
│   └── tickers/                <TICKER>.json (ticker_context.py), <TICKER>.judgment.json (the agent)   /ticker-brief
├── probes/
│   ├── corpus/                 <window_end>-probe.html                                 /corpus-probe
│   ├── runway/<ID>/            probe.html | probe.md, evidence.md, records/            /runway-probe
│   │                           ID = <window_end>[-label]; records/ holds <TICKER>.json, macro.json,
│   │                           retail.json, stances.json, scorecard.*, verdicts.json, _manifest.json
│   └── runs/<DATE>/            probe build workspaces (scripts, bundles, intermediate tables)
├── cache/<DATE>-<topic>/       web pages fetched as evidence (Finviz and the like)    gitignored
├── reports/                    INDEX.md + <DATE>-<slug>.md: every answer (CLAUDE.md, step 4)
├── runs/<run-id>/              agent run workspaces: CONTEXT.md ledger, <agent>/output/, tools.jsonl   gitignored (src/agent)
└── ledger/verdicts.jsonl       registered verdicts: append-only, scored by later probes
```

## Rules

1. **One writer per folder.** Each area names its owner above. Others read it and never
   write into it.
2. **Dated, never overwritten across dates.** A rerun on the same date replaces that date's
   files. Earlier dates are history.
3. **Paid or unrepeatable data is append-only:** `corpus/raw`, `picks`, `pick_tags`,
   `prices` and `ledger/`. Everything else can be rebuilt from them or re-downloaded.
4. **Committed vs ignored.**
   - Committed: corpus layers, rendered, research, probes, reports, ledger.
   - Ignored: `market/`, `cache/` and `runs/`, which are large and free to re-fetch or rerun; research outputs
     cite their URLs and dates. Also `corpus/_session/`.
5. **Read the corpus through `sql/views.sql`** (`pnpm q`), never through the Parquet
   files directly. The same `post_id` appears in several capture partitions.
6. **Configuration is not data.** Lists and definitions (allowlist, tag taxonomy, theme
   baskets, symbol universe) live in `ref/` and `config/accounts.json`, versioned with the code.

## Where things came from (moved 2026-09-24)

| Before | Now |
|---|---|
| `data/{raw,posts,mentions,picks,pick_tags,_session}` | `data/corpus/…` |
| `data/analysis/accounts` | `data/corpus/analysis/accounts` |
| `data/analysis/probes`, `data/analysis/runs` | `data/probes/corpus`, `data/probes/runs` |
| `daily/`, `tickers/`, `INDEX.md` | `data/rendered/…` |
| `analysis_output/<D>-macro/raw`, `<D>-themes/raw` | `data/market/<D>/` (merged) |
| `analysis_output/<D>-{macro,themes,x-sentiment,outlook,tickers}` | `data/research/<D>/{macro,themes,sentiment,outlook,tickers}` |
| `analysis_output/<D>-runway-{probe.html,evidence.md,data}` | `data/probes/runway/<D>/{probe.html,evidence.md,records}` |
| `analysis_output/*-source-cache` | `data/cache/<D>-<topic>` |
| `analysis_output/reports`, `*-deep-dive.md` | `data/reports/` |
| `analysis_output/verdicts.jsonl` | `data/ledger/verdicts.jsonl` |
