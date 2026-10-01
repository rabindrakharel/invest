# Playbook: from macro regime to stocks

Use this in step 5 of `SKILL.md` to turn the scored regime into positioning. The engine
applies the quadrant table and the overlays mechanically (`tilts` in `regime.json`). This
file is the reasoning behind them, plus the transmission map the engine cannot apply for
you.

## 1. The four quadrants

| | Inflation falling | Inflation rising |
|---|---|---|
| **Growth rising** | **Goldilocks.** Tech, communication, discretionary, growth, momentum, high beta, semis, small caps if credit is calm. Duration neutral to long. Eras: 1995-97, 2013-14, 2017, 2023-24. | **Reflation / overheating.** Energy, materials, industrials, financials, value, small caps, EM, commodities. Short duration. Eras: 2003-06, 2021, early 1970s. |
| **Growth falling** | **Disinflationary slowdown.** Long Treasuries, utilities, staples, health care, quality, min vol, secular growers with net cash. Underweight cyclicals, energy, banks, high yield. Eras: 2001-02, 2008 H2, 2019, 2020 Q1. | **Stagflation.** Energy, gold and miners, staples, health care, quality, low vol, T-bills. Underweight long-duration growth, discretionary, small caps, REITs, long bonds. Eras: 1973-74, 1979-80, 2022. |

Quadrant drift matters more than the quadrant itself. The biggest equity moves happen at the
**transitions**:
- Goldilocks to reflation: rotation from growth to value, a steeper curve (2021, 2016 H2).
- Reflation to stagflation: the worst transition for 60/40 (1973, 2022).
- Stagflation to disinflationary slowdown: bonds rally first, then quality growth (1982,
  late 2022 to 2023).
- Slowdown to Goldilocks: small caps and cyclicals lead off the bottom (1991, 2003, 2009,
  2020).

## 2. Overlays (they override the quadrant)

| Condition | Engine trigger | Do |
|---|---|---|
| Oil shock | `OIL_SHOCK` | Producers over consumers: XLE, E&Ps, services, tankers. Cut airlines, cruise, truckers, chemicals, low-end discretionary. |
| Hostile duration | duration regime `hostile` | Short duration: T-bills and floating-rate cash. Cut long-duration growth, REITs, utilities, long Treasuries. Prefer companies whose *current* FCF yield clears the hurdle. |
| Strong dollar | `L_DOLLAR` at -1 or below | Cut EM, commodities, US multinationals with large foreign sales. |
| Credit tail straining | `C_HY_CHANGE` or `C_CCC_GAP` at -1 or below | Own balance sheets: quality over levered small caps; avoid CCC credit, BDCs, private-credit-dependent names. |
| Housing freeze | mortgage rate above 7% and builders lagging | Cut builders, housing-linked retail, title and mortgage originators. |
| Bonds not hedging | `R_STOCK_BOND_CORR` at -1 | Hedge with cash, T-bills, gold and options, not Treasuries. Lower gross exposure. |
| Hiking cycle | `HIKING_CYCLE` | First-year-of-hikes playbook: prefer earnings momentum with pricing power; cut unprofitable growth and IPO/SPAC-era names; banks only if deposits are sticky. |
| Carry unwind | `CARRY_UNWIND` | Reduce crowded momentum and levered longs immediately; this deleveraging is fast and mechanical. |
| Long-end tantrum | `LONG_END_TANTRUM` | Treat any equity rally as suspect until the MOVE falls. Watch the next auction and the refunding statement. |

## 3. Transmission map: macro driver to stocks

| Driver moves | Tailwind | Headwind | Mechanism |
|---|---|---|---|
| **Real yields up** | Banks (asset yields), life insurers, brokers with cash sweep (SCHW), value | Unprofitable tech, biotech (XBI), clean energy, space (RKLB, ASTS), high-multiple SaaS, REITs, gold (historically) | Discount rate on distant cash flows; duration ≈ 1/(r-g) |
| **Long end up (term premium, bear steepening)** | Life insurers, P&C float reinvestment | Homebuilders, REITs, utilities, regional banks (AOCI), small caps, mREITs | Supply and fiscal risk priced into every long-dated asset |
| **Fed hiking / 2y up** | Money-market and cash earners, exchanges, insurers | Small caps (floating debt), levered buyouts, BDC borrowers, IPO pipelines, crypto | Short-rate cost of carry and credit availability |
| **Curve steepening from low rates (bull)** | Banks after the cut cycle starts, small caps | Defensives relative | Net interest margin, credit recovery |
| **MOVE up** | Exchanges (CME), market makers | mREITs (AGNC, NLY), homebuilders, levered risk parity, long-duration growth | Convexity hedging, dealer balance sheets |
| **Mortgage spread widening** | None in equities | Builders, mREITs, mortgage originators (RKT), title | MBS demand gap; the Fed and banks absent |
| **Housing turnover up** | Brokers (Z, COMP), title (FNF), home improvement (HD, LOW), furnishings (RH, W), building products (BLDR, MAS) | Rental REITs relative | Existing-home sales drive the ancillary spend |
| **Oil up** | E&Ps (FANG, OXY, EOG), services (SLB, HAL), tankers, Canada and Norway, defense | Airlines (DAL, UAL), cruise, truckers, chemicals, autos, low-income retail, India and oil-importing EM | Input cost and consumer tax; headline CPI and expectations |
| **Natural gas up** | Gas producers (EQT, CTRA), LNG exporters (LNG) | Utilities with fuel pass-through lag, fertilizer, chemicals | Power and feedstock costs |
| **Dollar up** | Importers and retailers sourcing abroad, domestic small caps (partly) | Multinationals (large tech about 50% foreign revenue), EM, commodities, gold | Translation, global dollar funding |
| **Dollar down with US yields up ("sell America")** | Gold, non-US equities, commodities | Long Treasuries, US duration assets | Foreign demand for US assets failing: a fiscal-credibility signal |
| **Credit spreads widen** | Quality, net cash, staples | Levered small caps, private-credit managers (APO, BX, ARES, OWL), BDCs, regional banks, HY issuers | Refinancing cost and access |
| **Liquidity up (QE, TGA drawdown, weak dollar)** | Crypto (BTC, COIN, MSTR), unprofitable tech, meme names, high beta | Relative: defensives | Excess reserves chase risk in order of risk |
| **Wage inflation** | Staffing, payroll processors (ADP, PAYX, float income) | Restaurants, retail, hospitals, labor-intensive services | Margin squeeze |
| **Goods inflation / tariffs** | Pricing-power brands, domestic producers behind the tariff wall, steel (NUE, STLD) | Low-margin retailers, importers, autos | Cost pass-through capacity |
| **Growth up (PMI above 55, claims low)** | Industrials, materials, transports, semis, discretionary, banks, small caps | Utilities, staples relative | Operating leverage |
| **Recession** | Treasuries, staples, health care, utilities, gold, quality | Cyclicals, small caps, HY, banks, discretionary, commodities | Earnings, then credit |
| **VIX spike** | Exchanges, brokers, volatility sellers after the peak | High beta, momentum, levered ETFs, crowded longs | De-grossing |
| **AI capex cycle** | Semis (NVDA, AVGO, TSM, MU), networking and optics (ANET, CIEN, COHR, CRDO), power and grid (CEG, VST, GEV, ETN, PWR), data centers (EQIX, DLR), neoclouds (CRWV, NBIS) | Rates, through hyperscaler debt issuance; software seat models if AI disintermediates; utilities' customers via power prices | Capex is the revenue of the supply chain; the financing competes for capital |
| **Fiscal expansion / deficits** | Defense (LMT, NOC, RTX), infrastructure, gold | Long Treasuries, duration, the dollar (eventually) | Term premium and supply |
| **Geopolitical supply shock** | Energy, defense, shipping, gold, domestic producers | Airlines, EM importers, global supply-chain names | Risk premium and input costs |

## 4. Stock shape to regime fit (for Runway Probe `macro_fit_pts`)

Map each ticker to one archetype. Use two when it straddles, weighted by revenue. Then
take `runway_macro_fit_pts` from `regime.json`. Adjust by at most ±1 point for
name-specific exposure the archetype misses (a builder with a captive mortgage arm; a
multinational that hedges FX; a miner with no debt). Write the reason in the record's
judgment block.

| Archetype | Typical shape | Examples |
|---|---|---|
| `long_duration_growth` | Pre-profit or early-profit; value sits years out | RKLB, ASTS, TEM, XBI names, early AI infra |
| `quality_megacap` | Net cash, self-funded growth, multiple is the rate exposure | MSFT, GOOGL, META, NVDA, AAPL |
| `cash_flow_value` | Mature FCF, dividend and buyback | BRK.B, CAT, JNJ, XOM, CSCO |
| `small_caps` | Domestic, floating debt | IWM constituents |
| `banks` | NIM earners, AFS books | KRE, JPM, BNY |
| `homebuilders_reits` | Mortgage-rate driven | DHI, LEN, EQIX, DLR |
| `energy` | Commodity price takers | XLE, FANG, OXY |
| `materials_industrials` | Global cyclicals | CAT, DE, FCX |
| `defensives` | Inelastic demand | XLP, XLU, XLV |
| `em_international` | Dollar-sensitive | EEM, BABA, BIDU |
| `gold_hard_assets` | Real-yield and fear driven | GLD, GDX |
| `crypto_high_beta` | Liquidity driven | BTC, COIN, MSTR, IREN, CIFR |

## 5. The hedge-fund checklist (med/long horizon, med-low risk)

1. **What is the discount rate doing, and why?** Is it growth, inflation, term premium
   or the Fed? Only growth-driven rises are benign.
2. **Is credit confirming the equity tape?** If not, trust credit.
3. **Is there a stress flag?** Market-stress flags mean cut gross now. Macro-stress flags
   mean tilt, hedge and wait for price confirmation.
4. **Which quadrant, and which way is it drifting?** Position for the transition, not the
   quadrant you are in.
5. **What is the equity risk premium?** Forward earnings yield minus the 10-year real
   yield. Below about 2% means the index is priced for perfection. Leadership must then
   come from earnings, not multiples.
6. **Where is consensus?** The sell-side target range, positioning, themes from the news
   brief. The trade is the gap between the regime read and the consensus narrative.
7. **What would change the call?** Name two observable tells and their dates from the
   events list. A call without a falsifier is a mood.
8. **Size for the regime.** In Lean risk-off or worse, or with a hostile duration regime,
   cap long-duration exposure. Pair every new long-duration name with a proven-compounder
   or cash-flow name. Keep dry powder for the transition trade.
