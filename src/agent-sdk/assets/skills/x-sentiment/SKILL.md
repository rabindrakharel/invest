---
name: x-sentiment
description: Scan the X corpus of the allowlisted accounts for sentiment - attention, velocity against the corpus's own pace, tone, formal long/short stances with conviction, and crowding, per ticker and per theme from config/themes.json (semis, memory, Mag 7, neoclouds, cybersecurity, biotech sub-themes, space, crypto, energy, gold...). It labels each theme or ticker heating, cooling, crowded, contested or neglected, and cites the most-liked posts as evidence. Optionally a subagent grades tone per post. Reads only through the saved DuckDB queries. Use for "what is X / fintwit saying", "which names are getting crowded", "sentiment on NVDA/MU/biotech", or as the sentiment input to /market-outlook and /runway-probe's retail-interest signal.
argument-hint: "[--recent 7] [--prior 28] [--symbols A,B to focus] [--tone]"
---

# X sentiment

This skill has one concern: **what the allowlisted accounts are saying and how
crowded it is.** It never fetches from X; `/fetch` does. It never judges price or macro.

## Inputs

| Input | From | If missing or stale |
|---|---|---|
| Posts and mentions | `pnpm q x-sentiment-posts --days N --json` (`sql/queries/x-sentiment-posts.sql`) | run `/fetch` for the window |
| Formal stances | `pnpm q x-sentiment-stances --json` (the `v1-acct` picks) | run `/fetch` (it ends with ingest) |
| Themes | `config/themes.json` | |
| Tone overrides (optional) | `data/research/<DATE>/sentiment/tone.json` from the tone pass | the lexicon is used |

**The corpus window is anchored on the corpus's last trading day, not today.**
`corpus_stale_days` is reported, and a warning is written when it exceeds 3. Say so in the
first line of any read. A stale corpus measures what the accounts *were* saying.

## Process

1. **Score**:
   ```bash
   python3 src/agent-sdk/assets/tools/repo/x-sentiment/compute_x_sentiment.py --date <DATE> [--recent 7 --prior 28]
   ```
2. **Tone pass** (optional; do it when the read feeds a decision). The lexicon is crude:
   it cannot tell "not bearish" from "bearish". Launch one `general-purpose` subagent
   with [tone-brief.md](tone-brief.md) over the recent-window posts of the top 10 themes by
   posts. It writes `tone.json`. Rerun step 1; it picks up `tone.json` from the same directory.
3. **Read and write `sentiment-read.json`**: `{"as_of", "corpus_last_day", "themes":
   [{"id", "read", "labels", "evidence_post_ids"}], "symbols": [{"symbol", "read",
   "evidence_post_ids"}], "divergences": []}`.
   - For each labelled theme and each of the top 15 symbols, write one line saying what the
     accounts believe and how strongly, citing at least one `post_id`.
   - **Divergences** are the valuable rows: accounts crowded and bullish on a theme that
     `/theme-pulse` shows fading, or the reverse; accounts heating on a name the macro
     archetype fit rejects.

## Labels

| Label | Rule |
|---|---|
| `heating` | Velocity against the corpus's own pace ≥ 1.5, with ≥ 5 recent posts |
| `cooling` | Relative velocity ≤ 0.6, with ≥ 8 prior posts |
| `crowded` | ≥ 40% of active accounts mention it recently, ≥ 50% of posts bullish, and formal net-long ≥ 0.6 |
| `contested` | Shorts ≥ 25% of formal stances, or ≥ 30% bullish and ≥ 30% bearish posts |
| `neglected` | Fewer than 3 posts in the whole window |

**How to use them** (hedge-fund lens): crowding is contrarian at extremes and confirming
early. *Heating + price accelerating* is early confirmation. *Crowded + price fading* is
distribution, so trim. *Neglected + price improving* is where asymmetric setups hide.
*Contested* names need a catalyst to resolve.

## Rules

- Read the corpus only through `sql/queries/`. Never scan parquet directly.
- Every claim about what an account said cites a `post_id`.
- The corpus is 14 accounts, not "the market". Say "the allowlist", not "retail" or
  "everyone".

## Report contract

When invoked through CLAUDE.md's "How to answer" protocol, this skill fills these parts of the standard report. For intent `sentiment`: **Answer** is what the allowlist believes and how crowded it is. **Why** gives labels, velocity against the corpus, stances and at least one `post_id` per claim. The corpus age always goes in **As of**. Divergences against price go in **Why** when `/theme-pulse` is fresh.
