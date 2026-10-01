---
description: "Market data scrapers: FRED and Yahoo macro series, theme basket prices, Finviz snapshots and provider estimates, written to the dated market and cache areas. Network only; free except the provider API."
---

# Market data

1. Scrapers write `data/market/<DATE>/` and `data/cache/<DATE>-<topic>/`, both gitignored and re-downloadable. A date is never overwritten by a later one; a rerun the same day replaces that day's files.
2. Run a scraper only when `state_router` says its product is stale. `macro_fetch` is about 35 MB a day; do not rerun a fresh one.
3. Data only, no interpretation: the regime and theme scores are the `analysis` tools.
4. A failing source is a finding: read the fetch log, report the failed series, and add a new failure pattern to the owning skill's source-behaviour table. Finviz is the working substitute for insider tables when others return 403.
5. `universe_sync` refreshes `config/universe.txt` (listed US symbols) from nasdaqtrader.com; free, no key.
6. `forward_inputs_fetch` needs provider credentials from the environment, which are never printed and never read by an agent.
7. Every price and series value is cited with its as-of date; a model never produces a price fact.
