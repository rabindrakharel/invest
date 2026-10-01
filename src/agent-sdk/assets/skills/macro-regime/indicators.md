# Indicators: what each measures, how to read it, what it moves

The scoring thresholds are in `src/agent-sdk/assets/tools/repo/macro-regime/compute_regime.py` (the `@rule` blocks). `regime.md`
prints the exact rule beside every score. This file explains **why** each one matters,
the traps, and **which stocks it moves**. Scores run from -2 to +2, and positive means
supportive of risk assets.

The regime has three layers. Read them in this order:

1. **The discount rate:** rates, duration, the long end, MOVE, term premium, the Fed path.
2. **The risk premium:** credit, volatility, liquidity, the dollar, funding.
3. **The cash flows:** growth, labour, inflation, oil, housing.

The fourth layer, equity internals, is what the market thinks of all three.

---

## A. Rates and duration (weight 18)

### 10-year yield: level (`R_10Y_LEVEL`) and speed (`R_10Y_1M`)
The global discount rate and the mortgage anchor. **Speed matters more than level.** A
50bp rise over three months is a regime event at any level. The same 50bp over a year is
digestible when growth is doing the lifting. The level still matters through the equity
risk premium: when the S&P 500 earnings yield (1 / forward P/E) is below the 10-year, stocks
offer no premium over bonds. That happened in 2000 and 2007 and is back in 2025-26.
- **Trap.** Yields rising on growth (real yield and breakeven both up, credit calm)
  is a different animal from yields rising on term premium or inflation fear. Split the move
  with `R_REAL10`, `I_BREAKEVEN` and `R_TERM_PREMIUM` before reading it.
- **Moves.** Up hurts long-duration growth, REITs, utilities, homebuilders, small
  caps with floating debt, and gold (historically). Up helps banks' asset yields, life
  insurers, brokers with cash sweeps and value against growth.

### 10-year real yield, TIPS (`R_REAL10`)
The purest discount-rate signal for long-duration equities. Real yields above about 2.5%
were last sustained in 2007. Every 100bp rise in the real yield compresses the fair
multiple of a stock whose cash flows lie 15 or more years out by roughly a third. A stock
at 50x sales has duration near 1/(r-g), which can exceed 50 years.
- **Moves.** Unprofitable tech, biotech, clean energy, space, early AI infrastructure,
  high-multiple software, and gold (inverse, until central-bank buying broke the link in
  2022-25).

### The long end, 30-year (`R_LONG_END`) and term premium (`R_TERM_PREMIUM`)
The 30-year is set by supply (deficits, auction sizes, the Treasury's coupon mix), by
foreign demand (Japan's yields, reserve managers) and by inflation uncertainty. **The term
premium** (Kim-Wright from FRED; the ACM measure from the NY Fed is similar) is the extra
yield demanded for holding duration instead of rolling bills. It rose from about -1% in
2020 to about +1% in 2025-26.
- **Trap.** A long-end selloff while the Fed is cutting (2024) is a fiscal or term-premium
  story, not a growth story. It hurts equities without the earnings offset.
- **Tells.** Auction tails, indirect bidder share, the refunding statement (first
  Wednesday of February, May, August and November), Japanese 10- and 30-year yields, the
  CBO deficit path.
- **Moves.** Homebuilders, REITs, utilities, life insurers (they like it), and banks
  through AOCI losses on securities books (SVB 2023).

### Curve shape (`R_CURVE_SHAPE`) and re-steepening after inversion (`G_CURVE_RESTEEPEN`)
Label the one-month move by which end led:
| Move | What usually drives it | Read |
|---|---|---|
| Bear steepening (long end up more) | Term premium, fiscal, inflation fear | Hostile to duration; banks mixed |
| Bear flattening (front end up more) | Fed hiking or hikes being priced | Late-cycle tightening; hurts small caps and levered companies |
| Bull steepening (front end down more) | Fed cutting, often into weakness | Often the recession-onset move, not a green light |
| Bull flattening (long end down more) | Growth or inflation expectations falling | Good for duration, a warning for cyclicals |

**The re-steepening after a deep inversion** (10y-3m below -50bp within two years, now
positive) is the historically dangerous window. Recessions in 1990, 2001, 2008 and 2020
began around it. The inversion forecasts; the un-inversion is when it arrives.

### MOVE index (`R_MOVE`)
Implied volatility of Treasuries: the VIX of bonds. It matters because **the plumbing runs
on bond volatility**:
- MBS holders are short convexity, so rate volatility widens the mortgage spread
  (`H_MORTGAGE_SPREAD`).
- Dealer balance sheets and risk-parity leverage shrink as the MOVE rises.
- An equity rally with the MOVE rising is rarely durable.

Read it against the VIX. **MOVE rising while the VIX falls** (a MOVE/VIX ratio above about
6) is the classic divergence where bonds are pricing a risk equities are not. Levels: below
80 calm; 100-120 stressed; above 150 crisis (2008, March 2020, March 2023). Yahoo labels
`^MOVE` with the wrong long name ("Northern Trust iBoxx..."). The series itself was
checked against the 2020 and 2023 peaks and is the ICE BofA MOVE.

### Stock-bond correlation (`R_STOCK_BOND_CORR`)
The 60-day correlation of SPY and TLT daily returns. **Negative means bonds hedge equities**
(2000-2020, a growth-shock regime). **Positive means inflation or the discount rate drives
both** (1966-1997, 2022-23, and whenever the term premium leads). When it is positive,
cut gross exposure rather than relying on bonds. Hedge with cash, T-bills, gold or options.

### Priced Fed path (`R_FED_PATH`) and real policy rate (`R_REAL_POLICY`)
The 2-year yield is the market's forecast of the average policy rate over two years. The
2-year minus effective fed funds gives the direction and size of what is priced: +50bp or
more means a hiking cycle is priced. Pair it with the dot plot and FedWatch from the news
brief. The real policy rate (fed funds minus core PCE) tells you whether policy actually
bites. Above +2% has historically been restrictive enough to slow credit; negative is
accommodation.
- **Flag `HIKING_CYCLE`.** The target was raised within six months and the 2-year prices
  more. The first year of a hiking cycle has historically been choppy for the index, with
  a rotation from long to short duration (1994, 2004, 2015, 2022). How deep the damage
  goes depends on inflation. In 1994 and 2004 there was no bear market; in 2022 there was
  one, because the Fed was far behind.

## B. Credit (weight 18)

Credit is senior to equity. **When credit and equity disagree, credit is usually right,
and earlier.**

- **HY OAS level (`C_HY_LEVEL`).** Below 300bp is benign but leaves no cushion. Spreads
  this tight mean investors are paid little for default risk, so the asymmetry is to
  wider. Recessions take HY OAS above 700bp; 2008 went to about 2,000bp.
- **HY momentum (`C_HY_CHANGE`).** A widening of 75bp or more in a month (or 100bp in three)
  is the break signal (flag `CREDIT_BREAK`). Equity drawdowns rarely finish before spreads peak.
- **IG momentum (`C_IG_CHANGE`).** Watch this when hyperscalers and utilities are big
  issuers. IG supply competes with Treasuries for duration buyers.
- **The weak tail (`C_CCC_GAP`).** CCC spreads minus HY spreads. A widening gap while the
  index is calm means the weakest borrowers are failing under high rates: floating-rate
  issuers, private-credit refinancings, liability management. This preceded 2007 and 2015.
- **HYG/IEF trend (`C_HYG_IEF_TREND`).** The market-priced version. It updates daily
  when the FRED spreads lag.
- **SLOOS (`C_SLOOS`).** Quarterly. Bank tightening leads defaults and capex by two to four
  quarters.
- **Moves.** Small caps, levered buyout-backed names, BDCs and private-credit managers,
  regional banks, high-yield-dependent sectors (energy E&Ps, telecom, cable), SPAC-era
  names with converts.

## C. Volatility (weight 10)

- **VIX (`V_VIX`).** Below 20 is supportive. Below 13 is complacent: noted, not scored
  against, because low vol can persist for years. Above 30 is stress. Near VIX spikes the
  signal is contrarian: forward 12-month returns after VIX above 35 have been strong,
  *unless* credit is still widening.
- **Term structure (`V_TERM`).** VIX above VIX3M (backwardation) is the most reliable
  real-time stress gauge. It means protection is wanted *now*. It fires the `VIX_BACKWARDATION`
  flag.
- **VVIX (`V_VVIX`).** Demand for crash convexity. Above about 115, dealers are short
  gamma.
- **Moves.** Exchanges (CME, CBOE), market makers and brokers benefit; high beta,
  momentum and levered ETFs suffer.

## D. Liquidity and the dollar (weight 14)

- **Net liquidity (`L_NET_LIQ`)** = Fed balance sheet - Treasury General Account -
  reverse repo. A rough gauge of reserves available to the system. A TGA rebuild after a
  debt-ceiling deal, or QT with an empty RRP, drains it. It correlates best with
  speculative assets (crypto, unprofitable tech) and worst with cash-flow value.
- **Funding (`L_FUNDING`).** SOFR above IORB means repo is paying more than the Fed pays on
  reserves, so reserves are scarce (September 2019). It forces the Fed to stop QT or buy
  bills. `FUNDING_SQUEEZE` is a market-stress flag.
- **Dollar (`L_DOLLAR`).** A rising dollar tightens global conditions: EM debt, commodity
  prices, and US multinationals' translated earnings (large tech earns about half abroad).
  A falling dollar together with rising US yields ("sell America", April 2025) is a
  different signal: foreign demand for US assets is failing. That is a fiscal-credibility
  read, bad for duration and good for gold.
- **NFCI and STLFSI (`L_NFCI`, `L_STLFSI`).** Composite financial conditions. Negative
  is loose. Loose conditions during a hiking cycle mean the Fed has more work to do, a
  hawkish read.
- **M2 (`L_M2`).** Slow-moving. Growth above 6% fed 2020-21. Contraction in 2023 was the
  first since the 1930s and did not cause the recession many expected. Use it as context.
- **Yen carry (`L_YEN_CARRY`).** When the BoJ tightens while the Fed holds or hikes,
  yen-funded positions unwind in sudden bursts (August 2024). USD/JPY down 5% in a month
  fires `CARRY_UNWIND`.
- **Moves.** Crypto, high beta, unprofitable growth and EM are the most sensitive.

## E. Growth and labour (weight 15)

- **Initial claims (`G_CLAIMS`).** The best high-frequency recession gauge. A 20% rise in
  the 4-week average from its cycle low has preceded most recessions.
- **Sahm rule (`G_SAHM`).** The 3-month average unemployment rate is 0.5pp above its
  12-month low. By the time it triggers, recession has usually begun. The trigger is
  confirmation, not early warning. 2024 was a near-false positive driven by labour supply.
- **GDPNow (`G_GDPNOW`).** A nowcast of the current quarter. It swings a lot early in
  the quarter. Use it for direction, not the decimal.
- **CFNAI (`G_CFNAI`).** An 85-indicator composite. A 3-month average below -0.7 has
  marked recessions.
- **Copper/gold (`G_COPPER_GOLD`).** The market's growth-versus-fear ratio. It tracks the
  10-year closely. When the two diverge (gold bid on fiscal or geopolitical fear while
  copper is also bid), read both stories.
- **Cyclicals versus defensives (`G_CYC_DEF`).** XLY/XLP and XLI/XLU. The equity
  market's own growth vote.
- **Unemployment momentum (`G_UNRATE`), recession probability (`G_RECPROB`).**
- **Moves.** Industrials, materials, discretionary, transports, semis (cyclical demand),
  banks and small caps are the most growth-sensitive. Staples, utilities and health care
  are the least.

## F. Inflation and oil (weight 10; scored as risk to multiples)

- **Core CPI 3-month annualised (`I_CORE_3M`) and headline momentum (`I_CPI_TREND`).** The
  3-month annualised rate leads the y/y rate by about six months. The Fed targets PCE, which
  runs about 0.3-0.5pp below CPI. Monthly transforms count calendar months, because FRED
  leaves unpublished months blank (October 2025).
- **Breakevens (`I_BREAKEVEN`) and 5y5y (`I_5Y5Y`).** The market's inflation expectations.
  A 5y5y above about 2.8% means the Fed's credibility is slipping, which is the
  1970s risk. Breakevens *falling* below 1.8% signal a deflation scare (2008, 2020).
- **Oil (`I_OIL`).** A +25% move in three months fires `OIL_SHOCK`. Oil is both a
  tax on consumers and an input to headline CPI and expectations. If core inflation is
  already sticky, the Fed cannot look through it (1973, 1979, 2022). If core is soft, the
  shock is a growth tax and the curve bull-flattens later.
- **Moves.** See the oil row of the transmission map in `playbook.md`.

## G. Housing and MBS (weight 5; the most rate-sensitive sector, and the first to crack)

- **Mortgage rate (`H_MORTGAGE_RATE`).** Above 7% freezes existing-home turnover
  (lock-in: most outstanding mortgages carry rates below 5%). Builders take share by
  buying down rates, at the cost of gross margin.
- **Mortgage spread (`H_MORTGAGE_SPREAD`).** The 30-year mortgage rate minus the 10-year.
  About 170bp before 2022, as high as about 300bp in 2023. It widens when:
  - the Fed runs off MBS and banks are not buying (their AFS books are underwater);
  - rate volatility (MOVE) raises the cost of the prepayment option;
  - servicers hedge negative convexity.

  **GSE purchases or Fed MBS reinvestment are the policy lever that narrows it.** A wide
  spread plus a falling MOVE is the setup for mortgage REITs and builders; a widening
  spread with a rising MOVE is the setup to avoid them.
- **MBS versus Treasuries (`H_MBS_REL`).** The market-priced version of the spread.
- **Permits (`H_PERMITS`), months supply (`H_SUPPLY`), home prices (`H_HOME_PRICES`).**
  Permits lead starts, construction jobs and builder orders. New-home supply above 9 months
  means builders will cut prices. National prices falling y/y hits bank collateral, the
  wealth effect and MBS credit.
- **Builders versus the market (`H_ITB_REL`).** Homebuilders historically peak one to two
  years before the index (2005 against 2007) and bottom well before the economy (late
  2008, late 2022).
- **Moves.**
  - Builders: DHI, LEN, PHM, TOL, KBH, NVR.
  - Building products: BLDR, MAS, TREX, OC.
  - Home improvement: HD, LOW.
  - Furnishings: RH, W, WSM.
  - Title and mortgage: FNF, RKT, UWMC.
  - Brokers: Z, COMP.
  - Mortgage REITs: AGNC, NLY. They like a wide, stable spread and fear widening
    together with a rising MOVE.
  - Regional banks, through AFS losses and mortgage credit.

## H. Equity internals (weight 10)

Price is the final vote, so these tell you whether the market agrees with the macro.
- Trend (`E_TREND`), drawdown (`E_DRAWDOWN`), equal-weight versus cap-weight
  (`E_BREADTH_RSP`), sectors above their 200-day (`E_SECTOR_BREADTH`), high beta versus
  low vol (`E_HIGH_BETA`), small versus large (`E_SMALL_CAPS`), regional banks
  (`E_BANKS`).
- **Narrow leadership** (cap-weight beating equal-weight, few sectors above their 200-day)
  can last years (1998-99, 2023-24). It makes the index fragile to one theme.
- **The divergence line.** When macro pillars lean risk-off while the tape is strong,
  the engine prints a divergence. Size for the macro to win eventually, but do not short
  the tape on macro alone: tops need a catalyst and usually a credit or liquidity break.

---

## Reading the composite

- **Composite** is the pillar-weighted mean on -100..+100. From +35 is Risk-on; +10 to
  +35 Lean risk-on; -10 to +10 Neutral / mixed; -35 to -10 Lean risk-off; -35 and below
  Risk-off.
- **Flags lower the label.** Each market-stress flag (VIX backwardation, credit break,
  systemic stress, carry unwind, funding squeeze) lowers it one notch. Two or more
  macro-stress flags (long-end tantrum, hiking cycle, oil shock, Sahm) lower it one notch.
- **Quadrant.** The growth pillar mean against inflation pressure (the inverted inflation
  pillar). When either axis is within ±0.25 of zero, the quadrant is a lean. Trust the
  overlays over the quadrant then.
- **Duration regime.** Hostile when the rates pillar mean is -0.75 or lower, or the real
  10-year is at 2.5% or above. Supportive at +0.5 or higher.
- **Archetype fit.** A weighted mean of the specific signals that drive each stock
  archetype. Some weights are negative: energy *likes* an oil shock, defensives *like* a
  growth scare. `runway_macro_fit_pts = round((fit + 2) * 2)` maps straight onto the Runway
  Probe's 0-8 macro-climate score.
- **Analogs.** The nearest historical months on nine z-scored monthly features. They are
  a prompt for which era in `history.md` to reread, not a forecast. Always read the
  analogs' eras. Two analogs from different eras at similar distance mean the regime is
  ambiguous.
