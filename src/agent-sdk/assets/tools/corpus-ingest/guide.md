---
description: "Corpus ingest tools: normalize raw captures, dump per-account bundles, validate and ingest the extractors' files, render markdown, rebuild derived layers and compute price returns. Local and free; never rewrites the paid raw layer."
---

# Corpus ingest

1. Everything here is local and free. The raw layer is append-only and is only ever read; picks and prices are append-only too, and `corpus_rebuild` re-derives posts, mentions and markdown only.
2. The in-session extraction lane runs in this order: `corpus_session_dump`, then one `extractor` per bundle, then `corpus_session_ingest` with `check` true until it passes, then without `check`. Nothing is written if any file fails, and a rejected quote is sent back to the extractor that produced it, never fixed by hand.
3. `corpus_session_dump` replaces the bundles: use `since_last` for a delta, and do not re-dump while extractors are working.
4. `prices_enrich` is the only source of price facts (closes, YTD, MTD, YoY). A model never produces a price.
5. Commit `data/corpus/raw` with the derived layers after an ingest: it is the one thing that cannot be repurchased.

| Tool | Does |
|---|---|
| `corpus_normalize` | raw to the posts and mentions layers |
| `corpus_session_dump` | per-account bundles, SPEC.md and WINDOW.json in `data/corpus/_session` |
| `corpus_session_ingest` | validate (`check`) and ingest the extractors' files |
| `corpus_render` | `data/rendered` |
| `corpus_rebuild` | re-derive posts, mentions, markdown |
| `prices_enrich` | end-of-day closes and returns into the price layer |
