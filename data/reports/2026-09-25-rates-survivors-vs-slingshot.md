# High-rate survivors vs falling-yield slingshots, 2026-09-25
As of: macro 2026-09-25 run (series through the 2026-09-24 close) · theme prices 2026-09-24 · X corpus through 2026-09-25 · news 2026-09-24 (1d, not refreshed)
Regime: Lean risk-off (composite -4.8, unchanged) · duration hostile · risk budget 60% gross, long-duration cap 15%

## Answer
**What survives high rates** is anything that earns its cash today and doesn't need to borrow or issue stock to grow. That covers the self-funded mega caps (META, NVDA, GOOGL), cash-flow value (UNH, energy, 15x-earnings compounders), businesses that *earn* on high rates (exchanges, cash-sweep brokers, P&C insurers) and T-bills.

**What slingshots when yields fall** is whatever fell hardest for the discount rate alone. Split it into two tiers:
- **Tier 1: rate-crushed but self-funded.** Homebuilders, semicap equipment, AI power, data-center REITs, large biotech, cloud software, gold. These rebound *and* survive if the fall is delayed.
- **Tier 2: highest torque but reliant on financing.** Neoclouds, nuclear SMRs, space, quantum, crypto. These move the most, but some fund themselves by issuing stock into the weakness and won't make it.

For a medium-low-risk book, keep the core in the survivors. Hold the slingshot as a sleeve inside the 15% long-duration cap, mostly tier 1, and buy it on confirmation (10y below 4.75% with HY spreads stable), not in anticipation. The 1994 lesson: a Fed hiking into strength gives a choppy year, then a strong one *after* the Fed signals a stop.

### Survives high rates (own now)
| Bucket | Names | Why it survives | Evidence |
|---|---|---|---|
| Self-funded mega caps | META, NVDA, GOOGL, MSFT | Net cash, earnings growth outruns the multiple compression | quality_megacap fit +0.2; Mag 7 accelerating, +14.9pp vs SPY 3m, 71% breadth |
| Cash-flow value | UNH, CSCO, CAT, UBER, AKAM | Current FCF yield clears the hurdle, not value years out | cash_flow_value fit +0.4 (highest after energy); UNH 17.6x, FCF 1.67× NI; UBER 15.6x on $10.1B FCF |
| Energy | XOM, CVX, COP, EOG | Oil shock hedge; also a hedge *against* rates staying up | energy fit +0.9, the only tailwind; WTI $93, +34% 3m |
| Earns on high rates | CME, SCHW, P&C insurers | Float and cash earn 4–5% | playbook: Fed hiking and MOVE-up tailwinds |
| Recurring security spend | CRWD, PANW, NET, FTNT | Mission-critical, FCF-positive | internet security accelerating, 100% breadth (Accumulate: insider selling) |
| Cash | T-bills | Stocks and bonds fall together (60d correlation +0.48) | R_STOCK_BOND_CORR -1: Treasuries are not the hedge |

**Looks safe but isn't:** utilities and staples (defensives fit -1.0; they trade as bond proxies), and banks. Banks earn more on rates, but the CCC-HY gap is 820bp (5-year high), their securities books carry unrealised losses, and the basket shows 0% breadth.

### Slingshot when yields fall
| Tier | Theme | Names (drawdown from 52w high) | Why the torque | Survival risk |
|---|---|---|---|---|
| **1** | Homebuilders | DHI -19%, PHM -17%, TOL -18%, LEN -38% | The mortgage rate (7.03%) *is* their demand; ITB -18% vs SPY 3m | Low: net-cash builders |
| **1** | Semicap equipment | AMAT -34%, KLAC -38%, LRCX -29% | Profitable; de-rated with duration while AI demand is intact | Low |
| **1** | AI power and grid | VST -34%, CEG -35%, VRT -35%, GEV -19% | Capex financing cost eases; the theme is already "improving" | Low-medium |
| **1** | Data-center REITs | EQIX -7%, DLR -10% | Pure discount-rate assets | Low |
| **1** | Cloud and AI software | NOW -27%, DDOG -11%, PATH -35% | Long-dated cash flows re-rate | Low (FCF-positive) |
| **1** | Biotech | XBI, VRTX, REGN, INSM -43% | Classic real-yield victims; LogicalThesis long XBI (0.65) on forced selling | Low for large caps, higher for SMID |
| **1** | Gold and miners | NEM -10%, AEM -23% | Falling real yields are gold's main driver | Low |
| **1** | Small caps | IWM (-9.8% vs SPY 3m) | Floating-rate debt reprices lower | Medium: the CCC tail |
| **2** | Neoclouds | CRWV -37%, ORCL -55%, APLD -46%, NBIS -15% | Most rate-levered AI trade | **High:** debt-funded capex. deerpointmacro is short ORCL on financing (2103126077384061181) |
| **2** | Nuclear SMRs | OKLO -78%, SMR -84%, LEU -66% | Pre-revenue, pure duration | **High:** equity raises |
| **2** | Space | RKLB -51%, ASTS -54%, LUNR -66% | long_duration_growth fit -1.3 flips | **High:** RKLB $1.94B ATM; CEO trust sold $286M |
| **2** | Quantum | IONQ -45%, RGTI -71%, QBTS -61% | Beta about 3.4 | **High:** burn; IONQ kill = any raise |
| **2** | Crypto and fintech | COIN -49%, MSTR -55%, SOFI -48% | Liquidity-driven, first to move on easing | Medium-high |

## Why
- **The regime punishes duration, not earnings.**
  - Rates pillar: -75. The 10y is 5.11% (99.7th percentile of 20 years), the real 10y 2.76% (highest since 2007), the 30y 5.40%, MOVE 105.
  - Credit (+8), growth (+17) and vol (+33) are fine.
  - So the market is marking down *distant* cash flows, not current profits. That splits the two lists cleanly: long_duration_growth fit -1.3 vs cash_flow_value +0.4 and energy +0.9 (`data/research/2026-09-25/macro/regime.md`).
- **Why the slingshot is real:** the 1994 analog (the Fed hiking into strength, with a long-end rout). The S&P went sideways at -1.5% in 1994, then +34% in 1995 once the Fed stopped. The long-yield top usually comes at or slightly before the end of the hiking cycle (`src/agent-sdk/assets/skills/macro-regime/history.md` §8). The 2023 term-premium episode reversed on the 1 Nov 2023 refunding statement, and stocks and bonds ripped into year-end (§16).
- **Why split the slingshot into tiers:** in a hiking cycle the playbook cuts unprofitable growth first, and those names fund themselves by issuing equity into weakness. RKLB's ATM, ORCL's credit selloff and the neocloud financing are today's examples. Tier 1 names can wait out a delayed pivot; tier 2 names may have to raise money before it arrives.
- **The kind of fall matters as much as the fall.** If yields fall on cooling inflation, an Iran de-escalation or smaller refunding coupons, you get a broadening rally in which both tiers run (1995, Nov 2023). If yields fall on a growth scare with HY spreads widening, only Treasuries, staples and health care work, and tier 2 falls further (2007). The CCC-HY gap is already at 820bp, the widest in 5 years, so this second path is live.

## What would change it
- **2026-10-07/08, 10y and 30y auctions:** strong demand is the first release valve. Tails with MOVE above 120 mean the long end still has further to run, so stay in survivors.
- **2026-10-14 CPI and 2026-10-28 FOMC:** core at or below 0.3% m/m and a pause signal is the 1995 trigger. Start tier 1.
- **2026-11-04, Treasury refunding:** smaller coupon sizes were exactly what ended the 2023 term-premium spike. With the 10y below 4.75% and HY OAS still near 275bp, add tier 2 in small size. If yields fall while HY widens past 350bp, don't buy the slingshot.

## Gaps and stale inputs
- Macro series end at the 2026-09-24 close, so nothing new printed overnight. The news is from 2026-09-24 and was not refreshed.
- Theme prices are from 2026-09-24. Drawdowns are distance from the 52-week high, not a valuation measure.
- Tier assignments and "survival risk" are judgment from each name's financing needs, not a scored signal.
- Not investment advice.
