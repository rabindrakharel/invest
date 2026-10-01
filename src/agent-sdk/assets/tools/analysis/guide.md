---
description: "Deterministic scorers and routers: the state router, macro regime, themes, sentiment, outlook, ticker context, corpus signal mining and the runway scorecard. Same inputs, same output; judgment files are written separately."
---

# Analysis

1. Every tool here is deterministic: same inputs, same output. Judgment goes in the separate, named files (`narrative.json`, `theme-narrative.json`, `sentiment-read.json`, `judgment.json`), and a departure from the mechanical result is labelled with its reason.
2. Start with `state_router` for the intent, and run only what it lists. A skill owns its files: read another skill's output and never recompute its numbers; if an input looks wrong, fix it in the owning skill and rerun.
3. Order matters: `macro_fetch` then `macro_regime_compute`; `theme_prices_fetch` then `themes_compute`; `sentiment_compute` reads the corpus through saved queries; `outlook_build` joins the three; `scorecard_build` reads a probe's records.
4. Outputs are dated (`data/research/<DATE>/<part>/`). A rerun the same day replaces that day's file.
5. A scorer that reports incomplete judgment blocks is not finished: write the missing judgment, then rerun it.
