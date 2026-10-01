# Macro regime, 2026-09-29

**Lean risk-off** (composite -7.8 on -100..+100; composite alone reads Neutral / mixed, flags lowered it 1 notch(es)) · quadrant **Goldilocks** (low conviction) · duration **hostile** · coverage 54/54 signals

Since 2026-09-24: composite -4.8 → -7.8; pillars moved: credit -17, growth +6, internals -7

## Stress flags

- **LONG_END_TANTRUM** (macro): 30y at or above 5.25% (or +25bp in a month) with elevated bond vol: 2023 and 1994-style duration stress
- **HIKING_CYCLE** (macro): The Fed has raised its target within six months and the 2y prices more: 1994, 2004, 2015 and 2022 all began this way
- **OIL_SHOCK** (macro): Oil up 25%+ in three months: 1973, 1979, 1990, 2008 and 2022 all featured one

## Pillars

| Pillar | Weight | Score (-100..100) | Signals | Weakest | Strongest |
|---|---:|---:|---:|---|---|
| Rates and duration | 18 | -75.0 | 10/10 | R_10Y_1M, R_10Y_LEVEL, R_CURVE_SHAPE, R_FED_PATH, R_LONG_END, R_MOVE, R_REAL10, R_STOCK_BOND_CORR, R_TERM_PREMIUM | - |
| Credit | 18 | -8.3 | 6/6 | C_CCC_GAP, C_HY_CHANGE | C_HYG_IEF_TREND |
| Liquidity and dollar | 14 | +14.3 | 7/7 | - | L_NFCI, L_STLFSI |
| Growth and labour | 15 | +22.2 | 9/9 | G_CURVE_RESTEEPEN | G_CLAIMS, G_COPPER_GOLD, G_GDPNOW, G_SAHM, G_UNRATE |
| Inflation and oil | 10 | +0.0 | 5/5 | I_OIL | I_CORE_3M, I_CPI_TREND |
| Volatility | 10 | +33.3 | 3/3 | - | V_TERM, V_VIX |
| Equity internals | 10 | -7.1 | 7/7 | E_BREADTH_RSP, E_SECTOR_BREADTH, E_SMALL_CAPS | E_DRAWDOWN, E_TREND |
| Housing and MBS | 5 | -14.3 | 7/7 | H_ITB_REL, H_MORTGAGE_RATE | - |

## Signals

| Pillar | Signal | Score | Read | As of |
|---|---|---:|---|---|
| rates | 10-year yield level | -2 | 10y at 5.26% (100.0 pctile of 20y) | 2026-09-29 |
| rates | 10-year one-month change | -2 | 10y +53bp in a month, +82bp in three | 2026-09-29 |
| rates | 10-year real yield | -2 | real 10y 2.91% (+71bp 3m); highest discount rate on long-duration cash flows since 2007 when above 2.5 | 2026-09-29 |
| rates | 30-year yield and its momentum | -2 | 30y 5.59% (+37bp 1m); long-end supply and term premium set the equity discount rate | 2026-09-29 |
| rates | 10-year term premium | -1 | term premium 1.02% (+34bp 3m): investors demanding pay for duration risk (fiscal, inflation uncertainty) | 2026-09-25 |
| rates | Curve move (2y vs 10y over 1m) | -1 | bear flattening: 2y +55bp, 10y +53bp; 2s10s +37bp | 2026-09-29 |
| rates | MOVE index (Treasury implied vol) | -2 | MOVE 110 (+35 1m); bond vol drives MBS convexity hedging, dealer balance sheets and equity multiples | 2026-09-30 |
| rates | Stock-bond correlation (60d SPY vs TLT) | -1 | 60-day correlation +0.50 | 2026-09-29 |
| rates | Priced Fed path (2-year minus effective fed funds) | -2 | 2y 4.89% vs fed funds 3.88%: +101bp (+30bp 1m); the 2y is the market's two-year Fed forecast | 2026-09-29 |
| rates | Real policy rate (fed funds minus core PCE y/y) | +0 | fed funds 3.88% less core PCE 3.01% = +0.87% | 2026-09-29 |
| credit | High-yield OAS level | +0 | HY OAS 308bp (53.9 pctile of 20y) | 2026-09-29 |
| credit | High-yield OAS momentum | -1 | HY OAS +48bp 1m, +33bp 3m | 2026-09-29 |
| credit | Investment-grade OAS momentum | +0 | IG OAS 84bp (+5bp 1m) | 2026-09-29 |
| credit | CCC minus HY OAS (the weak tail) | -1 | CCC-HY gap 849bp (100.0 pctile 5y, +154bp 3m) | 2026-09-29 |
| credit | HYG / IEF trend (credit risk appetite) | +1 | HYG/IEF above 200d, above 50d | 2026-09-29 |
| credit | Senior loan officers: net % tightening C&I | +0 | net +0.0% of banks tightening (2026-07-01) | 2026-07-01 |
| vol | VIX level | +1 | VIX 16.3 (1m range 14.2-17.8) | 2026-09-30 |
| vol | VIX term structure (VIX / VIX3M) | +1 | VIX/VIX3M 0.89 | 2026-09-30 |
| vol | Vol of VIX | +0 | VVIX 89 | 2026-09-30 |
| liquidity | Net Fed liquidity (balance sheet - TGA - RRP) | +0 | net liquidity $5,770bn (-42bn 13w) | 2026-09-30 |
| liquidity | Funding pressure (SOFR minus IORB, 5-day avg) | +0 | SOFR-IORB -1.4bp | 2026-10-01 |
| liquidity | Dollar 3-month change (DXY, else broad index) | +0 | DXY 101.5 (+0.1% 3m, +2.1% 1m) | 2026-09-30 |
| liquidity | Chicago Fed financial conditions | +1 | NFCI -0.55 (-0.03 3m) | 2026-09-25 |
| liquidity | St. Louis Fed financial stress | +1 | STLFSI -0.81 | 2026-09-25 |
| liquidity | M2 growth y/y | +0 | M2 +5.7% y/y | 2026-08-01 |
| liquidity | Yen carry unwind (USD/JPY 1m change) | +0 | USD/JPY 157.9 (-1.2% 1m) | 2026-10-01 |
| growth | Initial claims, 4-week average vs 52-week low | +1 | claims 4wk avg 202k, +2% off the 52w low | 2026-09-19 |
| growth | Sahm rule (real time) | +1 | Sahm -0.07 (2026-08-01) | 2026-08-01 |
| growth | Atlanta Fed GDPNow | +1 | GDPNow 3.7% for the quarter starting 2026-07-01 | 2026-07-01 |
| growth | Chicago Fed activity index, 3-month average | +0 | CFNAI 3m avg +0.01 | 2026-08-01 |
| growth | Copper / gold ratio, 3-month change | +1 | copper/gold +5.5% 3m (22.7 pctile 10y) | 2026-09-30 |
| growth | Cyclicals vs defensives (XLY/XLP and XLI/XLU, 3m) | +0 | XLY/XLP -6.0%, XLI/XLU +3.8% over 3m | 2026-09-29 |
| growth | Unemployment rate, 3-month change | +1 | unemployment 4.1% (-0.2pp 3m) | 2026-08-01 |
| growth | Re-steepening after inversion (10y-3m) | -1 | 10y-3m +109bp; 24m low -97bp | 2026-09-30 |
| growth | Smoothed recession probability (Chauvet-Piger) | +0 | recession probability 0.8% (2026-07-01) | 2026-07-01 |
| inflation | Core CPI, 3-month annualised | +1 | core CPI 2.0% 3m annualised vs 2.4% y/y (2026-08-01) | 2026-08-01 |
| inflation | Headline CPI momentum (3m annualised vs y/y) | +1 | CPI 0.2% 3m ann vs 3.4% y/y | 2026-08-01 |
| inflation | 10-year breakeven inflation | +0 | 10y breakeven 2.36% | 2026-09-30 |
| inflation | 5y5y forward inflation (anchoring) | +0 | 5y5y 2.36% | 2026-09-30 |
| inflation | Oil shock gauge (WTI 3m change and level) | -2 | WTI $90.3 (+31.7% 3m, +5.3% 1m) | 2026-09-30 |
| housing | 30-year mortgage rate | -1 | 30y mortgage 7.03% (+54bp 3m) | 2026-09-24 |
| housing | Mortgage rate minus 10-year (MBS spread proxy) | +0 | mortgage-10y 185bp (56.4 pctile 20y; pre-2022 norm about 170bp) | 2026-09-29 |
| housing | Building permits, 3m average y/y | +0 | permits 1,403k SAAR (+1.5% y/y) | 2026-08-01 |
| housing | Months supply of new homes | +0 | new-home supply 8.5 months | 2026-08-01 |
| housing | Case-Shiller national y/y | +0 | home prices +1.9% y/y (2026-07-01) | 2026-07-01 |
| housing | Homebuilders vs S&P 500, 3m | -1 | ITB vs SPY -16.8% 3m | 2026-09-29 |
| housing | Agency MBS vs Treasuries (MBB / IEF, 3m) | +0 | MBB vs IEF +0.19% 3m | 2026-09-29 |
| internals | S&P 500 trend (50d, 200d) | +1 | SPY +6.8% vs 200d; 50d above 200d | 2026-09-29 |
| internals | Equal weight vs cap weight (RSP / SPY, 3m) | -1 | RSP vs SPY -3.7% 3m | 2026-09-29 |
| internals | Sectors above their 200-day (of 11) | -1 | 4 of 11 sectors above 200d | 2026-09-29 |
| internals | High beta vs low vol (SPHB / SPLV, 3m) | +0 | SPHB vs SPLV +2.2% 3m | 2026-09-29 |
| internals | Small vs large (IWM / SPY, 3m) | -1 | IWM vs SPY -9.2% 3m | 2026-09-29 |
| internals | S&P 500 drawdown from 52-week high | +1 | SPY -1.5% from 52w high | 2026-09-29 |
| internals | Regional banks vs S&P 500 (KRE / SPY, 3m) | +0 | KRE vs SPY -8.5% 3m | 2026-09-29 |

## Archetype fit (positive = tailwind; runway points 0-8)

| Archetype | Fit | Stance | Runway pts | Against | For |
|---|---:|---|---:|---|---|
| long_duration_growth | -1.4 | headwind | 1 | R_REAL10, R_10Y_1M, R_LONG_END | - |
| quality_megacap | +0.1 | neutral | 4 | R_10Y_1M, R_REAL10 | E_TREND, G_GDPNOW, V_VIX |
| cash_flow_value | +0.2 | neutral | 4 | R_10Y_LEVEL, E_BREADTH_RSP | G_CLAIMS, G_GDPNOW, V_VIX |
| small_caps | -0.4 | neutral | 3 | R_10Y_1M, C_HY_CHANGE, E_SMALL_CAPS | L_NFCI, G_CLAIMS |
| banks | -0.1 | neutral | 4 | C_HY_CHANGE, C_CCC_GAP | G_CLAIMS |
| homebuilders_reits | -0.7 | headwind | 3 | R_10Y_1M, H_MORTGAGE_RATE, H_ITB_REL | - |
| energy | +1.1 | tailwind | 6 | - | I_OIL, G_COPPER_GOLD, G_GDPNOW |
| materials_industrials | +0.5 | neutral | 5 | - | G_COPPER_GOLD, G_GDPNOW |
| defensives | -1.0 | headwind | 2 | R_10Y_1M, G_GDPNOW, G_CLAIMS | I_CORE_3M |
| em_international | -0.4 | neutral | 3 | R_REAL10, C_HY_CHANGE | G_COPPER_GOLD |
| gold_hard_assets | -0.1 | neutral | 4 | R_REAL10, V_VIX | R_TERM_PREMIUM |
| crypto_high_beta | -0.2 | neutral | 4 | R_REAL10 | V_VIX |

## Quadrant playbook: Goldilocks

- Overweight: XLK, XLC, growth, momentum, high beta, semis, XLE, short-duration cash yield, quality, gold
- Underweight: XLU, XLP, min vol, airlines and transports, chemicals, XLY, long-duration growth, XLRE, long Treasuries, levered small caps, CCC credit, homebuilders, housing-linked retail
- Duration: short
- Overlay: oil shock: producers over consumers of energy
- Overlay: hostile duration: rising real and long yields de-rate distant cash flows first
- Overlay: credit tail under strain: own balance sheets
- Overlay: mortgage rate above 7% and builders lagging
- Overlay: stocks and bonds falling together: Treasuries are not a hedge; use cash, T-bills, gold or options

## Sectors (sorted by 3m)

| Symbol | Name | 1m | 3m | 12m | vs SPY 3m | >200d |
|---|---|---:|---:|---:|---:|---|
| XLE | Energy | -1.2 | +16.6 | +40.2 | +14.0 | yes |
| XLV | Health care | +0.1 | +8.0 | +27.7 | +5.4 | yes |
| XLC | Communication services | -1.0 | +4.4 | -4.8 | +1.8 | no |
| XLK | Technology | +4.9 | +2.2 | +39.5 | -0.4 | yes |
| XLF | Financials | -6.7 | +1.1 | +1.4 | -1.5 | yes |
| XLP | Consumer staples | -3.6 | -0.8 | +7.7 | -3.4 | no |
| XLB | Materials | -7.2 | -3.0 | +12.1 | -5.5 | no |
| XLRE | Real estate | -6.3 | -5.3 | +2.0 | -7.9 | no |
| XLY | Consumer discretionary | -6.7 | -6.7 | -8.6 | -9.3 | no |
| XLI | Industrials | -4.3 | -8.4 | +11.8 | -11.0 | no |
| XLU | Utilities | -6.4 | -11.8 | -6.2 | -14.4 | no |

## Factors and styles (sorted by 3m)

| Symbol | Name | 1m | 3m | 12m | vs SPY 3m | >200d |
|---|---|---:|---:|---:|---:|---|
| GDX | Gold miners | -10.6 | +18.1 | +18.5 | +15.5 | no |
| IGV | Software | -3.9 | +16.1 | -9.3 | +13.5 | yes |
| ARKK | Speculative growth | +5.7 | +10.7 | +3.8 | +8.1 | yes |
| QUAL | Quality factor | +0.0 | +2.0 | +16.5 | -0.6 | yes |
| USMV | Minimum volatility | -3.6 | +1.7 | +4.8 | -0.9 | yes |
| VLUE | Value factor | -0.9 | -0.1 | +62.1 | -2.7 | yes |
| XBI | Biotech | -3.4 | -0.9 | +58.4 | -3.5 | yes |
| SPHB | High beta | +3.9 | -2.3 | +39.3 | -4.9 | yes |
| SPLV | Low volatility | -5.0 | -4.4 | -0.3 | -7.0 | no |
| KRE | Regional banks | -5.5 | -6.2 | +12.5 | -8.8 | yes |
| MTUM | Momentum factor | +6.0 | -7.4 | +24.8 | -10.0 | yes |
| SMH | Semiconductors | +9.7 | -7.5 | +88.7 | -10.1 | yes |
| ITB | Homebuilders | -7.6 | -14.7 | -16.7 | -17.3 | no |

## Historical analogs (nearest months to 2026-08)

z-scored Euclidean distance over 9 monthly features since 1954-07; excludes the last 36 months; picks are at least 18 months apart; equity returns from the OECD US share price index (price only, monthly average).

| Month | Distance | Era | S&P next 6m | next 12m | max DD 12m | 10y chg 12m |
|---|---:|---|---:|---:|---:|---:|
| 2005-11 | 0.6 | Credit and housing boom, commodity super-cycle | +10.0% | +16.7% | +0.0% | +0.06 |
| 2018-10 | 0.86 | Late-cycle expansion, QT and 2018 tightening scare, 2019 repo spike | +3.1% | +3.3% | -7.4% | -1.44 |
| 1996-11 | 0.93 | Productivity boom and dot-com mania | +11.5% | +26.6% | +0.0% | -0.32 |
| 1967-07 | 1.13 | Go-go years and Nifty Fifty; inflation starts to build, guns and butter | +3.0% | +9.2% | -4.3% | +0.34 |
| 2007-09 | 1.18 | Global financial crisis | -10.2% | -19.0% | -19.0% | -0.83 |
| 1957-11 | 1.19 | Post-war boom: financial repression, industrial build-out, low inflation | +5.4% | +27.5% | +0.0% | +0.02 |

Median next-12m +12.9%, positive in 83% of analogs, worst 12m drawdown -19.0%.

## Judgment (main agent, labelled)

**Call: Lean risk-off: a hostile discount rate with the first crack in credit**

The discount rate is still the story and it got worse since 2026-09-24: 10y 5.26% (R_10Y_LEVEL, 100th pctile of 20y, 2026-09-29), +53bp in a month (R_10Y_1M), real 10y 2.91% (R_REAL10, +71bp 3m), 30y 5.59% (R_LONG_END), term premium 1.02% (R_TERM_PREMIUM, 2026-09-25) and MOVE 110 (R_MOVE, +35 1m, 2026-09-30). The move is mostly real yield plus a priced Fed: the 2y sits 101bp over fed funds (R_FED_PATH) while breakevens are flat at 2.36% (I_BREAKEVEN), so this is a policy and term-premium repricing, not an inflation scare. The new information this week is credit: HY OAS widened 48bp in a month to 308bp (C_HY_CHANGE, C_HY_LEVEL dropped to 0), and the CCC-HY gap is 849bp at its 5-year high (C_CCC_GAP); that drove the composite from -4.8 to -7.8 (delta, credit pillar -17). Equity vol has not followed (VIX 16.3, VIX/VIX3M 0.89, V_VIX, V_TERM, 2026-09-30) and NFCI is loose (-0.55, L_NFCI, 2026-09-25). Growth is solid (claims 202k 4wk avg G_CLAIMS 2026-09-19; unemployment 4.1% G_UNRATE 2026-08-01), but the tape is narrow: RSP -3.7pp and IWM -9.2pp vs SPY over 3m, 4 of 11 sectors above 200d (E_BREADTH_RSP, E_SMALL_CAPS, E_SECTOR_BREADTH). Stocks and bonds are falling together (R_STOCK_BOND_CORR +0.50), so Treasuries do not hedge. The call stays Lean risk-off: hold quality cash-flow and energy, keep long-duration and rate-sensitive exposure small, and treat the index's strength (SPY -1.5% from high, E_DRAWDOWN) as earnings-carried, not multiple-supported.

**Positioning**

- Risk budget: 60% gross (Lean risk-off), unchanged from 2026-09-24; the rest in T-bills, not long Treasuries, because R_STOCK_BOND_CORR is +0.50
- long_duration_growth is a headwind (fit -1.4, runway 1/8): cap pre-profit and speculative growth (e.g. space, biotech platforms such as RKLB, ABCL) at a small sleeve; do not average down while R_REAL10 is rising
- quality_megacap is neutral (fit +0.1, runway 4/8): free-cash-flow mega caps (e.g. META, AMZN) remain the place to hold equity beta, sized for multiple compression risk from R_10Y_1M
- energy is the only tailwind archetype (fit +1.1, runway 6/8): the oil-shock hedge
- Avoid homebuilders_reits (fit -0.7), banks (see override) and levered small caps until MOVE and the HY spread both turn down
- Hedge with index puts rather than duration: VIX 16.3 in contango (V_VIX, V_TERM) is cheap against MOVE 110

**What changes the call**

- Upgrade to Neutral: 10y back below 4.75% with MOVE under 90 (R_10Y_LEVEL, R_MOVE). Tells: 10y auction 2026-10-07, 30y auction 2026-10-08, Treasury refunding statement 2026-11-04 (dates from the 2026-09-24 news.json)
- Downgrade to Risk-off and cut gross to 40%: HY OAS a further +27bp to a +75bp 1m move (CREDIT_BREAK), VIX above VIX3M (V_TERM), or USD/JPY -5% in a month (L_YEN_CARRY; BoJ 2026-10-30)
- The hiking path: September payrolls 2026-10-02 and September CPI 2026-10-14 decide the 2026-10-28 FOMC; a cooling print that pulls R_FED_PATH under +60bp removes the HIKING_CYCLE pressure

## Live themes

| Theme | Direction | Counter | Evidence |
|---|---|---|---|
| not collected | stable |  | news.json for 2026-09-30 was not collected; /macro-news was not run in this dispatch |

## Dated events

| Date | Event | Why it matters |
|---|---|---|
| 2026-10-02 | September payrolls (carried from 2026-09-24 news.json; today's news not collected) | hot print cements an October hike |
| 2026-10-07 | 10-year auction (30-year on 2026-10-08) (carried forward) | a tail is the long-end tantrum signal |
| 2026-10-14 | September CPI (carried forward) | energy pass-through to core |
| 2026-10-28 | FOMC decision (carried forward) | second hike of the cycle or a pause |
| 2026-10-30 | BoJ decision (carried forward) | yen carry unwind risk |
| 2026-11-04 | Treasury quarterly refunding (carried forward) | coupon sizes decide the long end |

## Risk map

| Risk | Probability | Impact | Tell |
|---|---|---|---|
| credit tail spreads into the index (CCC to HY to IG) | medium | Risk-off; small caps, banks, high beta hit first | C_HY_CHANGE reaching +75bp 1m; C_IG_CHANGE turning negative |
| long-end tantrum extends (30y toward 6%) | medium | multiple compression in long-duration growth and mega caps | auction tails 2026-10-07/08; R_MOVE above 120 |
| oil shock reverses on a ceasefire | low | energy tilt loses its support; rates relief | I_OIL WTI 3m change back under +25% |

