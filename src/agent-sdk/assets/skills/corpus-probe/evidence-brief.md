# Evidence brief (one subagent per account)

Paste this brief, then the account handle, the window, and the candidate ticker list.

---

You are reading everything one market commentator posted over a window, as a research
analyst collecting **evidence**, not opinions. Read `data/corpus/_session/<handle>.posts.jsonl`
(one JSON object per line: `post_id, created_at, trading_day, post_type, text`; retweets
already excluded). Also read `data/corpus/analysis/accounts/<handle>.json` so you know which
names are already formal picks and do not repeat that work.

Use the grep pre-filters first, then read the whole file once, linearly. It is the only
way to catch a scorecard posted as a bare list of numbers.

Return **only** the following, in this order, as markdown. Every item carries a
`post_id` and `trading_day`. Copy numbers exactly as written; never round, never convert.

## Regime facts
Rates, credit, oil, Fed, payrolls, positioning surveys, index-level calls. One line each:
`YYYY-MM-DD post_id - fact as posted`.

## Earnings scorecards
One block per ticker: reported vs expected for every metric the post gives, guidance
changes, and the account's one-line reaction if any.

## Analyst relays
Broker, action (initiate / upgrade / downgrade / target change), target, one-line reason.

## Insider activity
Ticker, who, amount, date of trade, and whatever the post says about context (first buy in
N days, largest ever, after an X% drop, N insiders in the cluster). Never add the reason
for the drawdown unless the post states it.

## Stance on candidate names
For each ticker on the candidate list that this account discusses: the stance in one
sentence, the post_id that best shows it, and whether the stance changed during the
window.

## Names not on the candidate list that deserve a look
Ticker, why, post_id. Cap at ten.

## Reliability observations
Concrete behaviours only: publishes losses, runs margin, hides sells behind a paywall,
attributes drawdowns to manipulation, gives no stops, relays sell-side without a view, and
so on. Each with one post_id as an example.

## Coverage
First and last `trading_day` in the file and the post count. Say plainly if the bundle
covers less than the window.
