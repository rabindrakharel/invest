---
description: "Raw Bash for the repository's own scripts: skill scripts (python3 src/agent-sdk/assets/tools/repo/<skill>/<script>.py), the state router, saved corpus queries (pnpm q), and read-only inspection. Gated: load this guide before the first call."
---

# Shell

Prefer the registered script tools (`mcp__invest__*`, in the `x-api`, `corpus-ingest`, `corpus-query`, `market-data`, `analysis` and `ledger` families) over typing the same command here: they are typed, bounded and, where they cost money, approved per call. Use Bash for inspection and for what no tool covers.

## Guardrails

1. Run from the repository root and stay inside it; the runtime denies paths that resolve outside.
2. Run what the owning skill's SKILL.md lists, with `--date` and its other flags; scripts resolve every data path themselves, so never pass a hard-coded `data/` path to a script.
3. Read the corpus only through `pnpm q <saved query>`, never by opening the Parquet files.
4. `data/corpus/raw|picks|pick_tags|prices` and `data/ledger/` are append-only. A command that would rewrite or remove anything there is denied; append through the owning pipeline step.
5. Never read or print `.env`. Credentials come from the environment.
6. `/fetch` and `pnpm task:capture` call the metered X API. Do not run them without the operator's yes (ask with `ask_user`).
7. Python scripts are standard library only; do not install packages.
8. A non-zero exit is a hard failure: keep its stderr as evidence and report it rather than retrying blindly.

## Examples

1. What is current: `python3 src/agent-sdk/assets/tools/repo/state/state.py --intent macro`.
2. A saved corpus query: `pnpm q <name>`.
3. A skill's script, exactly as its SKILL.md states it.
