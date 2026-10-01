# Red-team brief (one subagent, the top Runway names)

Paste this brief and the list of tickers with their verdict lines.

---

You are the adversary. For each ticker below, the probe has reached a Runway verdict
with a scenario tree. Your job is to break it using only the evidence already gathered:
the record at `data/probes/runway/<PROBE_ID>/records/<TICKER>.json`, `macro.json`,
`retail.json`, and the corpus analyses in `data/corpus/analysis/accounts/`. You may fetch one
additional page per ticker if a specific fact needs checking; record the URL.

For each ticker return exactly:

1. **The strongest single fact against the verdict**, quoted from the record with its
   source, in one sentence.
2. **The bear scenario the probe under-weighted**, with the probability you would
   assign and why, in two sentences.
3. **The kill criterion's weakness**: is the stated observation measurable by the
   stated date? If not, propose one that is.
4. **What you would need to see** to accept the verdict, in one sentence.

No prose beyond that. Do not soften. A red team that agrees is a wasted call.
