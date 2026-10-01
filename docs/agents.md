# invest: agent harness

> The runtime that lets one orchestrator dispatch specialist subagents, each granted the
> skills and tools it owns. Ported from the pmo project's `coding-agent` (Claude Agent SDK,
> TypeScript), trimmed to its generic core. How Claude answers is in [`/CLAUDE.md`](../CLAUDE.md).
> Written 2026-09-30.

## Shape

Laid out like the pmo `coding-agent` package, folded into one folder. Everything has one home;
`.claude/` holds generated pointers only.

```
src/agent-sdk/
├── README.md
├── assets/
│   ├── config/    runtime.yaml, agent-sdk-config.yaml, agent_catalog.yaml (the graph), tools.yaml (tool families)
│   ├── agents/    <agent>.yml: one profile per agent (persona, goal, criteria, outputs, HITL, grants)
│   ├── skills/    <skill>/SKILL.md with its scripts, briefs and templates (moved from .claude/skills)
│   └── tools/     catalog.ts; script/ (registry.ts, tool.ts: the script-tool runtime); context/ guide/ hitl/ mcp/ (tool.ts + guide.md); shell/ files/ web/ (guides);
│                  repo/ the Python tools: state.py, paths.py, check_wiring.py (moved from .claude/tools)
├── src/           the runtime: agents, catalog, config, domain, handoffs, hooks, orchestrator, prompt, ...
└── test/          vitest
.claude/           GENERATED, never edited: skills/<skill>/SKILL.md (slash-commands),
                   skills/<orchestrator>/SKILL.md (/chief, /corpus-lead, /runway-lead),
                   agents/<subagent>.md (native Claude Code subagents for the Agent tool)
data/runs/<run-id>/   one workspace per run (gitignored)
```

`pnpm agents:shims` regenerates `.claude/`; `pnpm agents:check` fails if a pointer is stale.

## Tools: every entry point is registered once

The code stays where it is (the TypeScript pipeline in `src/pipeline`, the Python tools in
`assets/tools/repo`). What the agents see is `assets/config/scripts.yaml`: the calling main function of
each pipeline step, scraper and scorer, with typed parameters. Each entry becomes one in-process MCP tool,
`mcp__invest__<name>`, run from the repository root with no shell (an argv array, values may not start
with `-` or break their pattern), returning the command, its exit status and its output. A tool is
reachable only through a family a profile grants:

| Family | Tools | Held by |
|---|---|---|
| `x-api` (gated, every tool metered) | x_resolve_accounts, x_capture, x_backfill, x_delta, corpus_extract_api | corpus-lead |
| `corpus-ingest` | corpus_normalize, corpus_session_dump, corpus_session_ingest, corpus_render, corpus_rebuild, prices_enrich | corpus-lead, extractor |
| `corpus-query` | corpus_query (saved DuckDB queries, the only corpus read path) | analysts, leads, extractor, evidence-reader |
| `market-data` | macro_fetch, theme_prices_fetch, finviz_snapshots_fetch, forward_inputs_fetch, universe_sync | macro-analyst, theme-analyst, researcher, runway-lead |
| `analysis` | state_router, macro_regime_compute, themes_compute, sentiment_compute, outlook_build, ticker_context, corpus_signals_mine, scorecard_build | the analysts and leads |
| `ledger` (gated) | verdicts_register (append-only) | runway-lead |

`pnpm agents:check` fails if an entry names a `pnpm` task that package.json lacks or a script file that does
not exist, so a rename cannot leave a dead tool. A session has no `mcp__invest__*` tools, so each subagent
shim lists the same tools as commands to run through Bash.

## The web chat

`pnpm web` serves a local site (`src/agent-sdk/src/web/`, UI in `assets/web/`) for chatting with an
orchestrator. It is the same harness as `pnpm agents`, with three seams swapped for the browser:

- **The human.** `Prompter` is the interface everything that asks depends on (the question tool, the permission
  bridge, the metered-spend gate). `TerminalPrompter` is the TTY; `WebPrompter` turns each question into a card:
  checkboxes for a multi-select, radios for a single choice, a free-text escape hatch, and a distinct style for
  permission and spend requests. Answers are validated against the options that were offered; an answer that does
  not match leaves the card open.
- **The output.** Orchestrators hold the `present` family: `mcp__present__show_html` takes an HTML fragment styled
  by a fixed design system (KPI cards, tables, badges, bars, callouts, inline-SVG charts, light and dark) and shows
  it inline. In any run it is also saved to `<run>/artifacts/`. The page renders in a sandboxed frame loaded from its
  own endpoint with a CSP that allows no network, no forms and no same-origin access, and the fragment is sanitised
  first, so markup copied from a fetched page cannot reach the operator's session.
- **The stream.** `ChatSession` keeps one SDK session open across messages (follow-ups keep the run's context,
  ledger and dispatch registry), and `EventTranslator` turns SDK messages into small UI events (assistant text, tool
  calls, subagent lanes opening and closing, artifacts, questions, results) sent over Server-Sent Events with replay,
  so a reload resumes the conversation.

The **Research** tab (`#/research`) is a read-only view of what the skills already wrote under `data/`, served by
`src/web/research.ts` and drawn by `assets/web/research.js`. It computes nothing; every value comes from a file:

- **Desk**: the newest `research/<DATE>/outlook/outlook.json` (regime, risk budget, what would change it, the read,
  theme stances, events, risks).
- **Ticker dossier** (`#/research/ticker/<T>`): the `research/*/tickers/<T>.json` briefs, the runway records and
  scorecard rows from every `probes/runway/<ID>/records/`, the ledger verdicts, and the reports that mention it.
- **Ledger** (`#/research/ledger`): `ledger/verdicts.jsonl` as registered (prices are at registration, not current).
- **Documents** (`#/research/doc/<path>`): reports and research `.md` rendered safely, and probe `.html` pages in a
  sandboxed frame. Only `reports/`, `research/<DATE>/<part>/`, `probes/corpus/` and `probes/runway/<ID>/` `.md` or
  `.html` paths are readable, checked by pattern and again after resolution.

Every research view has an "Ask the desk" button that switches to the chat and sends the question, and the index
refreshes when a chat turn ends, so a report the desk just saved shows up. `GET /api/research*` is the whole API;
anything else under it is refused.

The server can run shell commands and spend money for the operator, so it is locked down like a local admin tool:
loopback only; a Host allowlist (DNS rebinding); a same-origin check on every write (CSRF from another site); a
per-launch token on every API call; request bodies capped at 256 KB; at most 20 live conversations.

## The roster

Skills that fan out their own workers mid-procedure (`/fetch`, `/corpus-probe`, `/runway-probe`)
cannot run inside a subagent, because a subagent cannot dispatch. They belong to an orchestrator;
the workers they launch are leaf subagents.

| Agent | Kind | Owns | Dispatches |
|---|---|---|---|
| `chief` (default) | orchestrator | intents macro, themes, sentiment, outlook, ticker, record; the report and `data/reports` | news-scout, macro-analyst, theme-analyst, sentiment-analyst, tone-grader, ticker-analyst, record-keeper |
| `corpus-lead` | orchestrator | `/fetch`, `/corpus-probe`; the only path to the metered X API | macro-analyst, news-scout, extractor, evidence-reader |
| `runway-lead` | orchestrator | `/runway-probe`; verdict registration | macro-analyst, news-scout, theme-analyst, sentiment-analyst, tone-grader, researcher, red-team |
| `macro-analyst` | subagent | `/macro-data`, `/macro-regime` | |
| `news-scout` | subagent | `/macro-news` collection (web) | |
| `theme-analyst` | subagent | `/theme-pulse` | |
| `sentiment-analyst` | subagent | `/x-sentiment` | |
| `tone-grader` | subagent | the `/x-sentiment` tone pass | |
| `ticker-analyst` | subagent | `/ticker-brief` | |
| `record-keeper` | subagent | the ledger against current prices | |
| `extractor` | subagent | one account's extraction (`/fetch` step 6), one dispatch per bundle | |
| `evidence-reader` | subagent | one account's deep read (`/corpus-probe` step 2) | |
| `researcher` | subagent | one group of at most eight tickers (`/runway-probe` step 3) | |
| `red-team` | subagent | the bear case on the top names (`/runway-probe` step 4c) | |

Separation of concern by construction: the paid X API only on `corpus-lead`, the ledger only on `runway-lead`, web access only on `news-scout` and `researcher`; `Write` and
`Edit` only where a skill assigns a judgment or data file; `Bash` for the scripts; the ledger is read
only by `record-keeper`; no subagent holds the `Agent` tool. Intents `corpus` and `runway` are run
with `pnpm agents --agent corpus-lead|runway-lead`: `chief` tells the operator so and answers only from
existing products.

Four entities, one home each: **agent** (catalog row + profile), **skill** (`src/agent-sdk/assets/skills`),
**tool family** (`tools.yaml` + guide), **hook** (`src/agent-sdk/hooks`). An agent reaches a skill or a
tool only through its profile's grant, `{name, disclosure}`: `mandatory` inlines the body into the
prompt, `progressive` shows one line and loads the body on demand (`load_skill`, `load_guide`).

## Rules the runtime enforces

- **One level of dispatch.** An orchestrator runs as the main thread and holds the `Agent` tool. A
  subagent never does. No roster names an orchestrator; every subagent is on a roster.
- **Isolated context.** Only an orchestrator's prompt carries the run (request, prior outcomes). A
  subagent's task arrives in its dispatch brief, capped at 16,000 characters.
- **Per-dispatch identity.** Siblings of one type get `<type>/<n>`, their own ledger section,
  `output/` and `tools.jsonl`. A wave is N `Agent` calls in one message with `run_in_background: false`.
- **Disjoint writes.** The first live dispatch to edit a path owns it; siblings are denied it.
- **Completion is a gate.** A stop is blocked until every `requiredOutputs` file exists; a dispatch
  that dies without publishing is reconciled as `abandoned`, with a continuation packet and a 3-attempt cap.
- **Gated families.** `shell` and `files` are denied until the agent loads the guide.
- **The repo's invariants as hooks** (`protectAppendOnly`, `confineToRepository`): no direct write,
  overwrite or removal under `data/corpus/raw|picks|pick_tags|prices` or `data/ledger`; `.env` is never
  read or written; no path resolves outside the repository.
- **Metered steps need a yes.** `task:capture`, `task:backfill`, `task:delta`, `task:resolve-accounts` and
  `task:extract` (X API reads about $0.005 per post, or model calls) are put to the operator by the permission
  bridge and never auto-allowed; a headless run denies them, because nothing can approve.
- **Bounded reads.** An unbounded `Read` of a text file over 12 KB is denied.
- **Circuit breaker.** Repeated identical failing calls stop the agent and tell it to report `blocked`.
- **Steering.** `> note` in the terminal redirects the orchestrator; `>@<agent> note` a live dispatch.

## Ported, changed, dropped

| From pmo `coding-agent` | Here |
|---|---|
| Orchestrator, dispatch registry, ledger, reconcile, continuation, steering, circuit breaker, HITL, renderer, disclosure model, XML and YAML contexts | Ported, same behavior |
| `assets/agents`, `assets/config`, `assets/tools`, `src`, `test` | Same layout under `src/agent-sdk/` |
| `assets/skills` | `src/agent-sdk/assets/skills` (reused, not copied) |
| Tools from 100+ repo scripts as MCP servers | `scripts.yaml`: every pipeline, scraper and scorer entry point as a typed `mcp__invest__*` tool, plus native families (`shell`, `files`, `web`) |
| Healer and fold gate, playbooks, `memory.md` / `feedback.md` | Dropped. CLAUDE.md step 5 (leave the record better) becomes an agent later if wanted |
| RAG routing bootstrap, doc index, catalog-search hooks, brief-only dispatch | Dropped (no doc index here) |
| Managed code-edit lane, Prettier verification | Dropped (agents write data, not product code) |
| Plan-file gate on the discover to executor handoff | Dropped; a handoff needs only a published `handoff-brief.md` |
| Codex and Claude Code shim generation | Claude Code only: skills, orchestrators and subagents (`pnpm agents:shims`); no Codex |
| MCP tool schemas with `.default()` | Changed to `.optional()` with the default applied in the handler: the SDK tool wrapper on zod 4.5 rejects a call that omits a defaulted field |

## Adding an agent

1. A profile in `src/agent-sdk/assets/agents/<name>.yml`: persona, goal, success criteria, the files it must
   publish, the skills it owns and the tool families it needs. One concern per agent.
2. A row in `src/agent-sdk/assets/config/agent_catalog.yaml`; add the name to the orchestrator's `handoffs`.
3. `pnpm agents:shims`, then `pnpm agents:check`. It loads the graph, every profile, every skill and family, and composes
   every prompt, so a missing skill, an unknown family or a graph violation fails here, not mid-run.

## Commands

`pnpm agents:check` · `pnpm agents:list` · `pnpm agents:shims` · `pnpm agents [--agent <name>] [request]`.
`CLAUDE_MODEL` pins every agent's model; `CLAUDE_MAX_TURNS` and `CLAUDE_MAX_BUDGET_USD` cap a run;
`AGENT_HANDOFF=ask|auto|off` governs orchestrator-to-orchestrator session handoffs; `AGENT_RUNS_DIR`
moves the run workspaces. With no `ANTHROPIC_API_KEY` the SDK uses the operator's Claude Code login.

## Status

Harness ported and tested offline (graph validation, prompt composition, option building, hook policy,
ledger reconciliation, metered-spend gate, pointer generation). The roster above is wired and
validated by `pnpm agents:check`. No live session has been run yet; the first one should be
`pnpm agents "Risk on or off?"`, which costs model tokens only.
