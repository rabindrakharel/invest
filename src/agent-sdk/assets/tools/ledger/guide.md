---
description: "Verdict ledger: append a runway probe's verdicts to data/ledger/verdicts.jsonl so later probes can score them. Append-only, run once per probe after the red-team pass."
---

# Ledger

1. `data/ledger/verdicts.jsonl` is append-only and scored by every later probe. `verdicts_register` is the only way a verdict enters it; a direct write is denied.
2. Register only verdicts meant to be tracked, each with a kill criterion carrying a number and a date, and only after the red-team pass.
3. Register once per probe. A second run appends a second copy, so confirm the probe has not been registered (read the ledger) before calling it, and ask the operator first.
4. `verdicts.json` and `scorecard.json` must already exist in the probe's records; the tool reads them and fails otherwise.
