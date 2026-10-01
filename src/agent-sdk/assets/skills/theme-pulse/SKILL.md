---
name: theme-pulse
description: Read the benchmarks (SPY, QQQ, RSP, IWM, MDY) and about 30 thematic baskets from config/themes.json - Magnificent 7 vs the equal-weight S&P, semis, memory, semicap, AI networking/optics, AI power/grid, neoclouds/data centers, cloud software, AI applications, internet security (CRWD, PANW, ZS...), internet platforms, fintech, large biotech, SMID biotech, GLP-1/obesity, gene editing, AI health/diagnostics, psychedelics, space, quantum, nuclear, crypto equities, defense, homebuilders, banks, energy, gold/metals, consumer. For each it scores relative strength against its benchmark and SPY, trend, breadth, drawdown, dispersion, leaders and laggards, and a direction label (accelerating, steady leader, fading, improving, lagging). It then adds the live narrative per theme from the news and the X corpus. Use for "which themes are leading", "is the AI trade fading", "mag 7 vs the rest", "how are biotech themes doing", or as the thematic input to /market-outlook.
argument-hint: "[--date YYYY-MM-DD, default today] [--themes id,id to focus]"
---

# Theme pulse

This skill has one concern: **where money is moving between themes, and whether the story
behind each theme is strengthening or weakening.** It does not decide the macro regime
(`/macro-regime`) or read the X accounts (`/x-sentiment`). It joins them only as labelled
context.

## Inputs

| Input | From |
|---|---|
| Baskets and benchmarks | `config/themes.json`, the only definition. Add or change a theme there. |
| Prices | `src/agent-sdk/assets/tools/repo/theme-pulse/fetch_theme_prices.py` (Yahoo, via the macro-data client) |
| Macro fit per theme (optional) | `data/research/<DATE>/macro/regime.json` archetypes |
| Narrative per theme (optional) | `data/research/<DATE>/macro/news.json` `themes`, and `/x-sentiment` output |

## Process

1. **Prices** go into the day's shared market directory, `data/market/<DATE>/yahoo/`.
   Symbols `/macro-data` already fetched are skipped; the rest take about 3 minutes.
   ```bash
   python3 src/agent-sdk/assets/tools/repo/theme-pulse/fetch_theme_prices.py --date <DATE>
   ```
2. **Score** (deterministic). This writes `data/research/<DATE>/themes/`, and adds macro fit
   when that day's `regime.json` exists.
   ```bash
   python3 src/agent-sdk/assets/tools/repo/theme-pulse/compute_themes.py --date <DATE>
   ```
3. **Read `themes.md` and write `theme-narrative.json`.** Cover every theme ranked in the
   top 8 or bottom 5, and every theme the user named. For each:
   - `price_read`: its direction label, trend, breadth, and what the leaders and laggards
     say, for example "leadership narrowing to two names" or "broad participation".
   - `narrative`: the live story and its counter-narrative, with sources from `news.json`
     themes, earnings or guidance facts. Mark it accelerating, stable or fading.
   - `harmony`: does price agree with the narrative? "Story accelerating while price is
     fading" is the most important row on the page, because it means distribution.
   - `macro_fit`: the archetype fit from the regime, and whether the theme fights it.
   - `sub_theme_notes` for biotech (large vs SMID vs GLP-1 vs gene editing vs AI health)
     and semis (compute vs memory vs equipment vs networking), where the spread inside the
     group is the signal.

   Shape: `{"as_of", "themes": [{"id", "price_read", "narrative", "counter", "direction",
   "harmony": "agree|price-leads|story-leads|diverge", "macro_fit", "sources": []}]}`.

## How to read the numbers

| Field | Meaning | Rule of thumb |
|---|---|---|
| `rel_benchmark` 1m / 3m | Basket minus its benchmark (sub-themes against their parent: memory against SMH, cybersecurity against IGV) | +5pp over 3m is leadership |
| `direction` | Compares the 1m relative pace with the 3m pace | `accelerating` and `improving` are where new money is going; `fading` is where it is leaving |
| `trend` | Basket against its 50d and 200d | `uptrend` needs no story; `below 200d, basing` needs a catalyst |
| Breadth | Members above their 50d and 200d | A leader with breadth below 50% is narrowing, the late-stage sign |
| `dispersion_3m_pp` | Spread of member returns | High dispersion means stock-picking, not a theme trade |
| `dd_52w_pct` | Basket drawdown from its high | Below -20% is a bear market inside the theme |
| `price_score` | -2..+2 from relative strength, breadth and trend | Feeds `/market-outlook` |
| Concentration | Mag 7 minus RSP | Rising concentration makes the index hostage to one theme |

## Rules

- The basket is equal-weight on purpose: it measures the theme, not its largest member.
  The optional ETF check shows the cap-weighted version beside it.
- A member missing a price file is listed under `missing_symbols`. The basket uses the
  members it has. Name any theme with fewer than 60% of its members priced.
- Never describe a theme as "working" from the corpus or news alone. Price is the
  arbiter; the narrative explains it.

## Report contract

When invoked through CLAUDE.md's "How to answer" protocol, this skill fills these parts of the standard report. For intent `themes`: **Answer** names the leading, fading and turning themes. **Why** gives each theme's direction, relative strength, breadth and leaders, cited to `themes.json`, plus the narrative harmony from `theme-narrative.json`. Add the ranked theme table (top 8 and bottom 5, plus any theme the operator named).
