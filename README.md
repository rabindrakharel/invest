# invest

Daily research corpus built from a strict 14-account X allowlist, plus a daily briefing.

- **How Claude answers, and which skill owns what:** [`CLAUDE.md`](CLAUDE.md)
- **Business design — outcome, use cases, products, economics, success measures:** [`docs/business.md`](docs/business.md)
- **Technical design — architecture, decisions, and what was rejected:** [`docs/design.md`](docs/design.md)
- **The only sanctioned read path:** [`sql/views.sql`](sql/views.sql)
- **Saved analyses:** [`sql/queries/`](sql/queries/)

## Layout

```
config/          accounts.json and the reference lists (taxonomy, symbols, themes, universe): configuration, not data
data/            every byte of data; the tree and its owners are in data/README.md
docs/            business.md, design.md, agents.md
sql/             views.sql (the only read path) and queries/ (saved analyses, pnpm q)
src/pipeline/    the TypeScript pipeline: capture, normalize, extract, prices, render, duck
src/agent-sdk/   the agent harness: agent profiles, skills, tool registry, Python tools, runtime
.claude/         generated pointers only (pnpm agents:shims); never edited
```

```bash
pnpm install

# once
pnpm task:resolve-accounts   # needs X_BEARER_TOKEN -> fills in config/accounts.json
pnpm task:sync-universe      # listed symbols from nasdaqtrader.com (free, no key)

# the daily chain (GitHub Actions runs this at 16:15 ET)
pnpm task:capture            # metered: ~$0.005 per post read
pnpm task:normalize          # raw -> posts/mentions parquet
pnpm task:extract            # one claude-opus-5 call per session
pnpm task:enrich             # end-of-day closes -> YTD/MTD/YoY
pnpm task:render             # data/rendered/{daily/*.md, tickers/*.md, INDEX.md}

# historical backfill — user timeline, NOT recent search, so it reaches past 7 days
pnpm task:backfill --start 2026-07-07T00:00:00Z --max-posts 16000
                             # metered, one-off; --max-posts is a real spend cap

pnpm task:backfill --accounts h1,h2 --start ...   # resume only the handles a 402 or the cap cut off

# analysis without an API key: one subagent per account, inside a Claude Code session
pnpm task:session-dump [--from YYYY-MM-DD --to YYYY-MM-DD]
                             # corpus -> data/corpus/_session/<handle>.posts.jsonl (+ SPEC.md, WINDOW.json); keeps out/
                             # ...run one subagent per bundle, writing data/corpus/_session/out/<handle>.json
pnpm task:session-ingest --check   # validate citations, write nothing; hand rejections back to the subagent
pnpm task:session-ingest     # -> picks/pick_tags + data/corpus/analysis/accounts/ stamped with WINDOW.json dates
pnpm q corpus-coverage       # first/last day per account against the window you paid for
pnpm q retail-interest --symbols "VST,AVGO"   # corpus attention per symbol: accounts, posts, engagement, stances

# any time
pnpm rebuild --from 2026-09-08   # re-derives posts/mentions/markdown only
pnpm repl                        # DuckDB with every view pre-created
pnpm q account-lead-lag          # saved analyses
pnpm q first-mention --symbol NVDA
pnpm q account-convergence       # names more than one account took a position on
pnpm q account-repertoire        # what each account actually does

# The Claude Code chain (skills in src/agent-sdk/assets/skills/). Each SKILL.md explains the problem it
# solves step by step; run them in this order.
/fetch "from 2026-07-07 to 2026-09-06"   # X API backfill -> normalize -> bundles -> one subagent per
                                        # account in this session (no Anthropic key) -> ingest -> render
/corpus-probe "high return, medium-to-low risk, 1 to 3 years"
                                        # mandate-driven Core/Watch/Satellite read -> data/probes/corpus/
/runway-probe                           # rank those names by twelve signals: earnings, prospect, competition,
                                        # insiders, 13F flow, retail crowding, upside, risk:reward, chart, macro
                                        # fit, narrative harmony, catalysts -> data/probes/runway/<window_end>/probe.html
                                        # plus the scorecard per name in <window_end>-runway-evidence.md
```

### Two capture paths, and why

`task:capture` is the daily incremental one: `search/recent`, one cursor, ~7-day reach.
`task:backfill` walks each account's **user timeline**, which has no 7-day wall, and is the
only affordable way to acquire history recent search has already dropped. Both write the
same `data/corpus/raw/` layout, so nothing downstream can tell them apart. Backfill is not
incremental — re-running it re-reads and re-pays — which is why it takes an explicit
`--max-posts` cap and writes its manifest even when the run dies mid-sweep.

### Two extraction lanes, one contract

`task:extract` sends one trading session to the Anthropic API. The session lane slices by
**author** instead and runs inside an interactive Claude Code session, so it needs no API
key and no per-call billing — the trade is that it answers "how does this commentator
operate" rather than "what happened today". Both land in the same `picks` layer, tagged by
`prompt_version` (`v1` vs `v1-acct`) so they never overwrite each other. The lane swaps the
model call, **not** the validation: `task:session-ingest` re-checks every citation against
the corpus and additionally requires each quote to appear verbatim in the exact post it
cites.

Two facts govern the design: X API reads cost ~$0.005 each, and recent search only
reaches back 7 days. So captured data is expensive and unrepurchasable, while everything
derived from it is free to recompute. `data/corpus/raw/` is append-only; the rest is rebuilt.

Private by design — X's developer terms restrict redistribution of post content.
Nothing here is investment advice.

## Web chat

```bash
pnpm web                 # http://127.0.0.1:4317  (--port N, --open)
```

Chat with an orchestrator in the browser. Ask a research question and the desk dispatches its specialists,
shows each one's progress, stops to ask you (checkboxes for choices, approve/deny for anything that costs
money or needs a permission), and answers with a designed HTML page inline. A live map above the chat shows
the orchestrator and every subagent it has running, and the **Logs** tab shows the verbose log of any session or
past run, per agent. It is loopback-only and every
API call needs the token printed by that launch. The **Research** tab browses what is already on disk: the
latest outlook as a desk dashboard, a dossier per ticker (briefs, runway scores, verdicts, the reports that
mention it), the verdict ledger, and every report and probe page. See [`docs/agents.md`](docs/agents.md#the-web-chat).

## Agents

The agent harness (`src/agent-sdk`, configured under `src/agent-sdk/assets/`) runs an orchestrator that
dispatches one-shot subagents, each granted the skills and tool families it owns. Every pipeline
entry point, scraper and scorer is registered as a typed tool in
[`scripts.yaml`](src/agent-sdk/assets/config/scripts.yaml). See [`docs/agents.md`](docs/agents.md).

```bash
pnpm agents:check                     # validate graph, profiles, skills, tool families, composed prompts
pnpm agents:shims                     # regenerate the .claude/ pointers (skills, /chief, native subagents)
pnpm agents:list                      # orchestrators, subagents, skills, tool families
pnpm agents "Risk on or off?"         # launch the default orchestrator (runs a Claude session)
pnpm agents --agent corpus-lead "Refresh the corpus and re-tier"      # metered: asks before any X API spend
pnpm agents --agent macro-analyst "Score the regime for 2026-09-30"   # one agent alone
```
