---
description: "Write and Edit for the judgment files a skill owns (narrative.json, theme-narrative.json, sentiment-read.json, judgment.json) and its dated outputs. Gated: load this guide before the first call."
---

# Files

## Guardrails

1. Write only the files your granted skill names, into its dated folder (`data/research/<DATE>/<part>/`), and only the judgment files it assigns to an agent. Mechanical outputs (`regime.json`, `themes.json`) are produced by scripts, never hand-written.
2. A date is never overwritten by a later one. A rerun on the same date replaces that date's file.
3. Every value is `{value, source, as_of}` or a signal row with `sources` and `as_of`. Never guess a number; write "not found". A departure from a mechanical result is labelled with its reason.
4. The model never produces a price fact. Prices come from the price layer.
5. `data/corpus/raw|picks|pick_tags|prices` and `data/ledger/` are append-only and denied to `Write` and `Edit`; `.env` is never written.
6. Two parallel dispatches never write one file: a path a live sibling is editing is denied to you, so name the overlap in your evidence instead.
