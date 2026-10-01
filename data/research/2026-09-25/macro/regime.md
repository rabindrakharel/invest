# Macro regime, 2026-09-24

**Lean risk-off** (composite -4.8 on -100..+100; composite alone reads Neutral / mixed, flags lowered it 1 notch(es)) · quadrant **Goldilocks** (low conviction) · duration **hostile** · coverage 54/54 signals

Since 2026-09-24: composite -4.8 → -4.8; pillars moved: none by 5+

## Stress flags

- **LONG_END_TANTRUM** (macro): 30y at or above 5.25% (or +25bp in a month) with elevated bond vol: 2023 and 1994-style duration stress
- **HIKING_CYCLE** (macro): The Fed has raised its target within six months and the 2y prices more: 1994, 2004, 2015 and 2022 all began this way
- **OIL_SHOCK** (macro): Oil up 25%+ in three months: 1973, 1979, 1990, 2008 and 2022 all featured one

## Pillars

| Pillar | Weight | Score (-100..100) | Signals | Weakest | Strongest |
|---|---:|---:|---:|---|---|
| Rates and duration | 18 | -75.0 | 10/10 | R_10Y_1M, R_10Y_LEVEL, R_CURVE_SHAPE, R_FED_PATH, R_LONG_END, R_MOVE, R_REAL10, R_STOCK_BOND_CORR, R_TERM_PREMIUM | - |
| Credit | 18 | +8.3 | 6/6 | C_CCC_GAP | C_HYG_IEF_TREND, C_HY_LEVEL |
| Liquidity and dollar | 14 | +14.3 | 7/7 | - | L_NFCI, L_STLFSI |
| Growth and labour | 15 | +16.7 | 9/9 | G_CURVE_RESTEEPEN | G_CLAIMS, G_GDPNOW, G_SAHM, G_UNRATE |
| Inflation and oil | 10 | +0.0 | 5/5 | I_OIL | I_CORE_3M, I_CPI_TREND |
| Volatility | 10 | +33.3 | 3/3 | - | V_TERM, V_VIX |
| Equity internals | 10 | +0.0 | 7/7 | E_BREADTH_RSP, E_SMALL_CAPS | E_DRAWDOWN, E_TREND |
| Housing and MBS | 5 | -14.3 | 7/7 | H_ITB_REL, H_MORTGAGE_RATE | - |

## Signals

| Pillar | Signal | Score | Read | As of |
|---|---|---:|---|---|
| rates | 10-year yield level | -2 | 10y at 5.11% (99.7 pctile of 20y) | 2026-09-23 |
| rates | 10-year one-month change | -2 | 10y +41bp in a month, +70bp in three | 2026-09-23 |
| rates | 10-year real yield | -2 | real 10y 2.76% (+53bp 3m); highest discount rate on long-duration cash flows since 2007 when above 2.5 | 2026-09-23 |
| rates | 30-year yield and its momentum | -2 | 30y 5.40% (+17bp 1m); long-end supply and term premium set the equity discount rate | 2026-09-23 |
| rates | 10-year term premium | -1 | term premium 0.96% (+21bp 3m): investors demanding pay for duration risk (fiscal, inflation uncertainty) | 2026-09-18 |
| rates | Curve move (2y vs 10y over 1m) | -1 | bear flattening: 2y +61bp, 10y +41bp; 2s10s +26bp | 2026-09-23 |
| rates | MOVE index (Treasury implied vol) | -2 | MOVE 105 (+33 1m); bond vol drives MBS convexity hedging, dealer balance sheets and equity multiples | 2026-09-24 |
| rates | Stock-bond correlation (60d SPY vs TLT) | -1 | 60-day correlation +0.48 | 2026-09-24 |
| rates | Priced Fed path (2-year minus effective fed funds) | -2 | 2y 4.85% vs fed funds 3.88%: +97bp (+36bp 1m); the 2y is the market's two-year Fed forecast | 2026-09-23 |
| rates | Real policy rate (fed funds minus core PCE y/y) | +0 | fed funds 3.88% less core PCE 3.34% = +0.54% | 2026-09-23 |
| credit | High-yield OAS level | +1 | HY OAS 273bp (16.6 pctile of 20y) | 2026-09-23 |
| credit | High-yield OAS momentum | +0 | HY OAS +4bp 1m, -3bp 3m | 2026-09-23 |
| credit | Investment-grade OAS momentum | +0 | IG OAS 77bp (-4bp 1m) | 2026-09-23 |
| credit | CCC minus HY OAS (the weak tail) | -1 | CCC-HY gap 820bp (100.0 pctile 5y, +132bp 3m) | 2026-09-23 |
| credit | HYG / IEF trend (credit risk appetite) | +1 | HYG/IEF above 200d, above 50d | 2026-09-24 |
| credit | Senior loan officers: net % tightening C&I | +0 | net +0.0% of banks tightening (2026-07-01) | 2026-07-01 |
| vol | VIX level | +1 | VIX 15.7 (1m range 14.3-17.8) | 2026-09-24 |
| vol | VIX term structure (VIX / VIX3M) | +1 | VIX/VIX3M 0.85 | 2026-09-24 |
| vol | Vol of VIX | +0 | VVIX 91 | 2026-09-24 |
| liquidity | Net Fed liquidity (balance sheet - TGA - RRP) | +0 | net liquidity $5,770bn (-42bn 13w) | 2026-09-24 |
| liquidity | Funding pressure (SOFR minus IORB, 5-day avg) | +0 | SOFR-IORB -4.2bp | 2026-09-25 |
| liquidity | Dollar 3-month change (DXY, else broad index) | +0 | DXY 101.2 (-0.2% 3m, +2.0% 1m) | 2026-09-25 |
| liquidity | Chicago Fed financial conditions | +1 | NFCI -0.56 (-0.05 3m) | 2026-09-18 |
| liquidity | St. Louis Fed financial stress | +1 | STLFSI -0.91 | 2026-09-18 |
| liquidity | M2 growth y/y | +0 | M2 +5.7% y/y | 2026-08-01 |
| liquidity | Yen carry unwind (USD/JPY 1m change) | +0 | USD/JPY 158.1 (-0.7% 1m) | 2026-09-25 |
| growth | Initial claims, 4-week average vs 52-week low | +1 | claims 4wk avg 202k, +2% off the 52w low | 2026-09-19 |
| growth | Sahm rule (real time) | +1 | Sahm -0.07 (2026-08-01) | 2026-08-01 |
| growth | Atlanta Fed GDPNow | +1 | GDPNow 5.1% for the quarter starting 2026-07-01 | 2026-07-01 |
| growth | Chicago Fed activity index, 3-month average | +0 | CFNAI 3m avg +0.01 | 2026-08-01 |
| growth | Copper / gold ratio, 3-month change | +0 | copper/gold +4.6% 3m (21.4 pctile 10y) | 2026-09-25 |
| growth | Cyclicals vs defensives (XLY/XLP and XLI/XLU, 3m) | +0 | XLY/XLP -0.4%, XLI/XLU +6.3% over 3m | 2026-09-24 |
| growth | Unemployment rate, 3-month change | +1 | unemployment 4.1% (-0.2pp 3m) | 2026-08-01 |
| growth | Re-steepening after inversion (10y-3m) | -1 | 10y-3m +94bp; 24m low -97bp | 2026-09-24 |
| growth | Smoothed recession probability (Chauvet-Piger) | +0 | recession probability 0.8% (2026-07-01) | 2026-07-01 |
| inflation | Core CPI, 3-month annualised | +1 | core CPI 2.0% 3m annualised vs 2.4% y/y (2026-08-01) | 2026-08-01 |
| inflation | Headline CPI momentum (3m annualised vs y/y) | +1 | CPI 0.2% 3m ann vs 3.4% y/y | 2026-08-01 |
| inflation | 10-year breakeven inflation | +0 | 10y breakeven 2.33% | 2026-09-24 |
| inflation | 5y5y forward inflation (anchoring) | +0 | 5y5y 2.33% | 2026-09-24 |
| inflation | Oil shock gauge (WTI 3m change and level) | -2 | WTI $93.0 (+34.4% 3m, +13.1% 1m) | 2026-09-25 |
| housing | 30-year mortgage rate | -1 | 30y mortgage 7.03% (+54bp 3m) | 2026-09-24 |
| housing | Mortgage rate minus 10-year (MBS spread proxy) | +0 | mortgage-10y 192bp (61.6 pctile 20y; pre-2022 norm about 170bp) | 2026-09-24 |
| housing | Building permits, 3m average y/y | +0 | permits 1,403k SAAR (+1.5% y/y) | 2026-08-01 |
| housing | Months supply of new homes | +0 | new-home supply 8.5 months | 2026-08-01 |
| housing | Case-Shiller national y/y | +0 | home prices +1.5% y/y (2026-06-01) | 2026-06-01 |
| housing | Homebuilders vs S&P 500, 3m | -1 | ITB vs SPY -18.4% 3m | 2026-09-24 |
| housing | Agency MBS vs Treasuries (MBB / IEF, 3m) | +0 | MBB vs IEF +0.11% 3m | 2026-09-24 |
| internals | S&P 500 trend (50d, 200d) | +1 | SPY +7.4% vs 200d; 50d above 200d | 2026-09-24 |
| internals | Equal weight vs cap weight (RSP / SPY, 3m) | -1 | RSP vs SPY -4.8% 3m | 2026-09-24 |
| internals | Sectors above their 200-day (of 11) | +0 | 5 of 11 sectors above 200d | 2026-09-24 |
| internals | High beta vs low vol (SPHB / SPLV, 3m) | +0 | SPHB vs SPLV +2.9% 3m | 2026-09-24 |
| internals | Small vs large (IWM / SPY, 3m) | -1 | IWM vs SPY -9.8% 3m | 2026-09-24 |
| internals | S&P 500 drawdown from 52-week high | +1 | SPY -1.1% from 52w high | 2026-09-24 |
| internals | Regional banks vs S&P 500 (KRE / SPY, 3m) | +0 | KRE vs SPY -8.9% 3m | 2026-09-24 |

## Archetype fit (positive = tailwind; runway points 0-8)

| Archetype | Fit | Stance | Runway pts | Against | For |
|---|---:|---|---:|---|---|
| long_duration_growth | -1.3 | headwind | 1 | R_REAL10, R_10Y_1M, R_LONG_END | - |
| quality_megacap | +0.2 | neutral | 4 | R_10Y_1M, R_REAL10 | E_TREND, G_GDPNOW, V_VIX |
| cash_flow_value | +0.4 | neutral | 5 | R_10Y_LEVEL, E_BREADTH_RSP | C_HY_LEVEL, G_CLAIMS, G_GDPNOW |
| small_caps | -0.1 | neutral | 4 | R_10Y_1M, E_SMALL_CAPS | L_NFCI, G_CLAIMS, C_HY_LEVEL |
| banks | +0.1 | neutral | 4 | C_CCC_GAP | G_CLAIMS |
| homebuilders_reits | -0.7 | headwind | 3 | R_10Y_1M, H_MORTGAGE_RATE, H_ITB_REL | - |
| energy | +0.9 | tailwind | 6 | - | I_OIL, G_GDPNOW |
| materials_industrials | +0.2 | neutral | 4 | - | G_GDPNOW |
| defensives | -1.0 | headwind | 2 | R_10Y_1M, G_GDPNOW, G_CLAIMS | I_CORE_3M |
| em_international | -0.4 | neutral | 3 | R_REAL10 | - |
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
| XLE | Energy | +1.5 | +16.4 | +42.5 | +11.7 | yes |
| XLV | Health care | -2.7 | +9.6 | +26.6 | +4.8 | yes |
| XLC | Communication services | +1.0 | +8.3 | -1.7 | +3.6 | yes |
| XLK | Technology | +7.3 | +5.6 | +40.5 | +0.9 | yes |
| XLF | Financials | -6.2 | +2.4 | +3.3 | -2.4 | yes |
| XLP | Consumer staples | -4.9 | -2.0 | +6.9 | -6.8 | no |
| XLY | Consumer discretionary | -6.3 | -2.5 | -7.2 | -7.2 | no |
| XLB | Materials | -6.9 | -3.7 | +13.7 | -8.5 | no |
| XLRE | Real estate | -7.4 | -5.8 | +3.7 | -10.5 | no |
| XLI | Industrials | -5.1 | -8.1 | +12.2 | -12.8 | no |
| XLU | Utilities | -8.5 | -13.5 | -6.1 | -18.3 | no |

## Factors and styles (sorted by 3m)

| Symbol | Name | 1m | 3m | 12m | vs SPY 3m | >200d |
|---|---|---:|---:|---:|---:|---|
| IGV | Software | +5.2 | +26.4 | -7.0 | +21.7 | yes |
| GDX | Gold miners | -12.5 | +22.0 | +28.6 | +17.3 | yes |
| ARKK | Speculative growth | +6.2 | +19.8 | +9.9 | +15.1 | yes |
| QUAL | Quality factor | -0.5 | +4.6 | +16.9 | -0.2 | yes |
| USMV | Minimum volatility | -2.9 | +3.9 | +5.9 | -0.9 | yes |
| XBI | Biotech | -7.7 | +2.9 | +60.8 | -1.8 | yes |
| VLUE | Value factor | +0.1 | -1.6 | +65.2 | -6.3 | yes |
| SPHB | High beta | +2.4 | -1.8 | +38.7 | -6.5 | yes |
| SPLV | Low volatility | -5.8 | -4.5 | +0.3 | -9.3 | no |
| KRE | Regional banks | -4.0 | -4.6 | +13.6 | -9.3 | yes |
| SMH | Semiconductors | +8.0 | -5.7 | +87.6 | -10.4 | yes |
| MTUM | Momentum factor | +5.2 | -6.3 | +25.3 | -11.0 | yes |
| ITB | Homebuilders | -9.3 | -14.6 | -16.4 | -19.3 | no |

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

