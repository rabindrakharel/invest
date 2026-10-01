---
description: "X API tools: read the allowlisted accounts from the X API into the paid append-only raw corpus. Every one is METERED (about $0.005 per post) and needs the operator's approval per call; a headless run denies them."
---

# X API

## Guardrails

1. Every tool here spends money: X API reads cost about $0.005 per post, and `corpus_extract_api` bills model calls. In a terminal run each call is put to the operator, who sees the exact call; a headless run denies it. Before you call one, state the expected post count and cost.
2. `data/corpus/raw` is paid for, irreplaceable and append-only. Nothing here rewrites it; a direct edit is denied.
3. Prefer `x_delta` for a refresh: it reads only the posts after each account's last held post. Use `x_backfill` only for a history window the operator named, with `max_posts` set, and run it with `dry_run` first. `x_capture` is the plain newest-posts pass.
4. `x_resolve_accounts` is one-shot: run it only after an account was added to `config/accounts.json`.
5. The in-session extraction lane needs no API key and is the default; `corpus_extract_api` is the API lane and needs one.

| Tool | Does |
|---|---|
| `x_resolve_accounts` | handles to numeric user ids in `config/accounts.json` |
| `x_capture` | newest posts per account into raw |
| `x_backfill` | a history window into raw (`dry_run`, `max_posts`, `accounts`, `refetch`) |
| `x_delta` | only the posts after each account's last held post |
| `corpus_extract_api` | API-lane pick extraction, one model call per session |

Every tool returns the command it ran, its exit status and its output. A non-zero exit, in particular a 402 or a rate limit, is a hard failure: report it with its stderr and the handles that fell short rather than retrying blindly.
