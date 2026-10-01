# SPCX: what has changed since the 2026-09-30 brief, 2026-09-30
As of: macro 2026-09-30 · themes 2026-09-30 · prices 2026-09-29 (1d stale) · X corpus through 2026-09-25 (5d stale) · X sentiment 2026-09-24 (6d stale) · outlook 2026-09-24 (6d stale) · macro news 2026-09-24 (6d stale) · runway probe 2026-09-24
Regime: Lean risk-off, composite -7.8, duration hostile (data/research/2026-09-30/macro/regime.json); risk budget 60% gross, long-duration cap 15% (outlook 2026-09-24)

## Answer
**Nothing has changed. The brief stands: Avoid, 6 months, watch only until after the 24 October lock-up.** The brief (data/reports/2026-09-30-spcx.md) was rendered at 21:23 today, and no input it reads has been refreshed since then.

## Why
- **Inputs predate the brief.** macro/regime.json and narrative.json are from 21:00, themes.json and theme-narrative.json from 21:03, tickers/SPCX.json from 21:17 and SPCX.judgment.json from 21:18. The brief was written after all of them, at 21:23.
- **Rebuilt context is identical.** I reran `ticker_context.py SPCX --date 2026-09-30`, the only step the state router listed. It pulls together prices, the X corpus, sentiment, the runway record and the verdict ledger, and it reproduced SPCX.json exactly (sorted-key diff empty). The close is still $149.24 (2026-09-29), returns +5.5% over 1 month and -12.7% over 3 months, 29.4% below the 52-week high, above the 50-day but below the 200-day average. On X: 21 posts from 4 accounts, 1 long and 1 short. Runway: one_leg_missing, 55/100, insider gate failed. The registered watch verdict ($148.03, kill below $135 by 2026-11-15) is still open.
- **The rendered brief matches.** `render_brief.py --verify SPCX` reports that 2026-09-30-spcx.md matches a fresh render, so the file has not been edited by hand.
- **Unchanged upstream.** The state router (2026-09-30) shows the X corpus at 2026-09-25, x-sentiment, market-outlook and macro-news at 2026-09-24, and the runway probe at 2026-09-24. None was refreshed after the brief.

## What would change it
- **New data.** A fresh price bar (2026-09-30 close or later) or a new X capture would change the trend, return and allowlist rows. The corpus capture is metered: `pnpm agents --agent corpus-lead`.
- **Refreshed outlook.** A market-outlook rebuild would replace the 2026-09-24 risk budget and theme stances.
- **2026-10-24 lock-up tranche.** Holding above $135 with the insider gate cleared upgrades SPCX to Accumulate on weakness. A close below $135 after the lock-up fires the kill.
- **2026-11-15.** The registered verdict's kill deadline.

## Gaps and stale inputs
- X corpus 5 days stale (2026-09-25); X sentiment, outlook and macro news 6 days stale (2026-09-24). The brief's gaps are all still there.
- Prices end 2026-09-29, so today's session is not in the record.
- SPCX is still not in any theme basket, so its macro fit is still mapped by judgment.

Nothing here is investment advice.
