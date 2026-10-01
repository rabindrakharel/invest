# Scorecard: twelve signals, 100 points, four gates

Fill one row per ticker before writing. Points are integers. Where a signal is "not
found", score 0 and mark it; do not spread the missing points over the others.

## Gates (pass or fail; they set the tier)

| Gate | Passes when |
|---|---|
| Upside | average consensus target is at least 20% above the close, or at least 25% on the lower of two aggregators when they disagree by more than ten points |
| Flow | the latest 13F cycle shows net share adds, or holders increasing exceed holders decreasing, or named funds add with no large named exit |
| Insider | an open-market insider buy in 90 days, or no insider selling cluster above roughly $50M or 1% of float |
| Delivery | the last print beat on revenue and the guide was held or raised (no guidance as a matter of policy is neutral), and 90-day consensus revisions are flat or up |

## A. Fundamentals, 30 points

**Earnings, 0 to 15.** Collect: last print revenue and EPS versus consensus; guidance
versus consensus; direction of consensus EPS revisions over 30 and 90 days; free cash
flow versus net income; stock-based compensation as a share of revenue if it exceeds
10%. Rules: post-earnings drift persists for roughly 60 trading days in the direction of
the surprise, so a beat-and-raise with rising revisions is worth the most; a beat with
falling revisions is a sell-the-news setup; a miss with rising revisions is rare and
worth a look. Cash conversion below 70% with rising receivables is an earnings-quality
flag and caps this score at 6.

| Points | Pattern |
|---|---|
| 13 to 15 | beat on both, guide raised, revisions up 90d |
| 9 to 12 | beat, guide held, revisions flat or up |
| 5 to 8 | mixed print, revisions flat |
| 1 to 4 | miss or guide cut, revisions down |
| 0 | no print in the window, or not found |

**Prospect, 0 to 8.** State the twelve-month case in one sentence: the driver, the
number it has to hit, and the probability the analyst assigns. Score by how much of the
case is already in reported numbers versus still a story: 7 to 8 when the driver is
visible in the last two prints, 4 to 6 when it is in guidance or backlog, 1 to 3 when it
is a launch or approval still ahead, 0 when the case cannot be stated.

**Competition, 0 to 7.** Collect: share trend against the two nearest competitors, gross
margin trend over four quarters, pricing power evidence, the substitution threat, and
relative valuation against peers on forward P/E or EV/sales. Rules: a widening gross
margin with stable share is the cleanest moat evidence; a narrowing margin with growing
share is buying share; a narrowing margin with falling share is losing. 6 to 7 for
widening moat at or below peer multiples; 3 to 5 for stable; 0 to 2 for losing share or
a named substitute already taking customers.

## B. Flows and positioning, 30 points

**Insider activity, 0 to 10.** Collect open-market Form 4 buys and sells for 90 days
with names, roles, dollars, and each buyer's history. Exclude exercises, vests, tax
sales, 10b5-1 sales (note them, weight them low). Rules: cluster buying by three or
more insiders within a month is the strongest documented insider signal; CEO and CFO
buys outweigh directors; a first buy after years of selling, or a largest-ever buy,
outweighs a routine one; buys after a drawdown of 30% or more outperform buys near
highs; sales are weak evidence individually and strong when clustered or when the CEO
sells more than a year of salary in one month.

| Points | Pattern |
|---|---|
| 9 to 10 | cluster of 3+ including CEO or CFO, or a first-in-years CEO buy, after a drawdown |
| 6 to 8 | single officer buy above $1M, or multi-director cluster |
| 3 to 5 | small buys only, or buys offset by comparable sells |
| 1 to 2 | no buys, routine 10b5-1 sells only |
| 0 | clustered open-market selling, or CEO sale above $50M, with no buys |

**Institutional flow, 0 to 10.** Collect the latest 13F net share change, holders up
versus down, new versus exited holders, named adds and exits, and short interest with
days to cover. Rules: 13F data is filed 45 days after quarter end, so read it as "were
they adding before the last print", not "are they adding now"; new-holder count matters
more than dollar totals; a concentrated hedge-fund add with an index-fund cut is a
positive read, the reverse is negative; short interest above 20% of float makes moves
violent in both directions and is a risk flag, not a buy signal, unless the delivery
gate also passes.

| Points | Pattern |
|---|---|
| 9 to 10 | net adds above 10% of shares held, new holders exceed exits, named smart money adding |
| 6 to 8 | net adds, or holders up exceed holders down |
| 3 to 5 | mixed, or not cleanly measurable |
| 1 to 2 | net cuts by count |
| 0 | net cuts with named exits, or short interest above 30% with a failing delivery gate |

**Retail interest, 0 to 10, contrarian.** From `pnpm q retail-interest`: accounts
mentioning, posts, days, posts in the last 14 days, likes and impressions, formal
stances with conviction. Rules: crowding is a headwind when price is near its high and
a capitulation watch when price is near its low; a name every account is long at high
conviction has already been bought by their audiences; a name with fundamentals and
almost no corpus attention is where the audience has not arrived. Score high for quiet
with fundamentals, low for loud near highs.

| Points | Pattern |
|---|---|
| 8 to 10 | one or two accounts, few posts, delivery gate passes |
| 5 to 7 | moderate attention, or loud but after a drawdown above 40% |
| 2 to 4 | loud, several accounts long, price mid-range |
| 0 to 1 | loudest names in the corpus, multiple high-conviction longs, price within 15% of its high |

## C. Price and chart, 25 points

**Current price and upside, 0 to 10.** Close with date; 52-week high and low; upside to
average, high and low targets. Score: 9 to 10 above 50%; 7 to 8 for 35 to 50%; 5 to 6
for 20 to 35%; 2 to 4 for 10 to 20%; 0 to 1 below 10% or negative.

**Risk : reward, 0 to 10.** Reward is average target minus close. Risk is close minus
the downside anchor, where the anchor is the highest of: the low consensus target, the
52-week low, and the nearest well-defined support (a prior base or the 200-day line if
price is above it). An anchor less than 5% below the close is rejected and the next one
down is used; with none left, R : R is not meaningful. R : R is reward divided by risk. Score: 9 to 10 at 3 : 1 or better;
6 to 8 for 2 to 3; 3 to 5 for 1.5 to 2; 0 to 2 below 1.5. When the anchor is more than
40% below the close, note that the reward is being bought with a very deep stop.

**Daily chart, 0 to 5.** Collect from Finviz or StockAnalysis: distance from the 50-day
and 200-day moving averages, whether the 50 is above the 200, 1-month and 3-month
performance against the S&P 500 and the sector ETF, the reaction to the last print, and
whether price is in a base (range under 15% for 6 weeks or more), a breakout, or a
breakdown. Rules: trend persists over 3 to 12 months; the 200-day line is the most
widely watched reference and the first reclaim after a long time below it is meaningful;
a gap up on the print that holds for five sessions confirms the print; a gap that fills
denies it; relative strength against the sector over 3 months separates the name from
its group.

| Points | Pattern |
|---|---|
| 5 | above both averages, 50 above 200, outperforming sector 3m, held the print gap |
| 3 to 4 | reclaiming the 200 after a base, or above the 200 with weak relative strength |
| 1 to 2 | below the 200 in a base, no breakdown |
| 0 | below both averages, 50 below 200, underperforming, print gap filled downward |

## D. Context, 15 points

**Macro climate, 0 to 8.** From the macro brief: rate level and path, curve, credit
spreads, dollar, oil, VIX, factor leadership. Rules: long-duration equities (no earnings,
growth years out) need falling real yields; cash-flow equities tolerate a plateau; a
rising 10-year with widening HY spreads hurts small caps and levered names first;
a strong dollar hurts EM and exporters; oil above $85 favours energy and hurts
consumer; when the hurdle is a 6% single-A corporate yield, an equity needs a visible
free-cash-flow yield or a demonstrated earnings inflection. Score the *fit* between the
name's shape and the regime: 7 to 8 when the regime is a tailwind for this name's
duration and sector; 4 to 6 neutral; 1 to 3 headwind; 0 when the name's thesis needs the
regime to change.

**Narrative harmony, 0 to 7.** From the corpus probe's "lens" section and the macro
brief: the market's live themes in the window (for example AI capex, AI power, GLP-1,
memory scarcity, defence, space), whether each is accelerating or fading, and where the
name sits. Rules: names inside an accelerating theme get multiple expansion on top of
earnings; names inside a fading theme de-rate even on good prints; names outside any
theme move on their own numbers, which is safer but slower; a counter-narrative (the
theme's bear case) that is gaining evidence is a warning for every name in the theme.
6 to 7 inside an accelerating theme with its own earnings support; 3 to 5 outside any
theme or inside a stable one; 0 to 2 inside a theme whose counter-narrative is winning,
or a name that is only a narrative.

**Catalysts.** Not scored. Listed: earnings date and confirmation status, regulatory
decisions, votes, launches, index events, lock-up expiries. A binary event inside three
months excludes a name from the mandate's core fit regardless of score.

## Reading the total

| Total | Read |
|---|---|
| 75 and above | strong on every group; size it |
| 60 to 74 | good; one group is weak, name it |
| 45 to 59 | mixed; only in a sleeve, if any gate structure allows |
| below 45 | no runway on the numbers |

The gates override the total. Record both.

## Forward-quality extension

Read [forward-research.md](forward-research.md) for the eight required forward metrics,
normalized `forward` record fields, optional API cache commands, missing-data rules
and verified insider-conviction inputs. This extension is required for every ticker; its verified-coverage requirement
overrides the legacy insider table when coverage is unknown. The script counts
unique named buyers across 90 days; a claimed 30-day cluster requires a separate
filing-date review. Confirmed plan sales are excluded from discretionary-sale counts,
but remain visible in total sales and the conservative insider gate.

keep its metrics and coverage separate from the legacy total. Older records without
these fields remain readable but do not establish forward quality or insider coverage.
