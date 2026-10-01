# agent-sdk user guide

How to run, extend and validate the invest agents. The architecture, the roster and the rules the
runtime enforces are in [`docs/agents.md`](../../../../docs/agents.md).

## Running

```bash
pnpm agents "Risk on or off?"                          # default orchestrator (chief), headless SDK run
pnpm agents --agent corpus-lead "Refresh the corpus"   # another orchestrator; metered steps ask first
pnpm agents --agent macro-analyst "Score 2026-09-30"   # one subagent alone, no roster
pnpm web                                               # the browser chat (see below)
pnpm agents:list | agents:check | agents:shims
```

Or from Claude Code: `/invest-agents [--agent <name>] [request]` runs the same launcher, and
`/<agent>` (for example `/chief`, `/macro-analyst`) runs that agent's profile in the current session.
With no `ANTHROPIC_API_KEY` the SDK uses the Claude Code login. `CLAUDE_MODEL` pins every agent's
model, `CLAUDE_MAX_TURNS` and `CLAUDE_MAX_BUDGET_USD` cap a run, `AGENT_HANDOFF=ask|auto|off` governs
orchestrator-to-orchestrator handoffs, and `AGENT_RUNS_DIR` moves the run workspaces (`data/runs/`).

## The web chat

`pnpm web [--port N] [--open]` serves http://127.0.0.1:4317 (override with `AGENT_WEB_PORT`). Pick an orchestrator,
ask a question, and watch the specialists work in the collapsible activity panel. Anything that needs you appears as a
card: tick checkboxes or type your own answer for a question, and approve or deny a permission or a metered spend (the
X API). The finished answer arrives as a designed page inline; Open and Download save it as a standalone HTML file.
Stop interrupts the current turn, New chat starts a fresh run. Each conversation is a normal run under `data/runs/`.

To change how pages look, edit `assets/tools/present/artifact.css` and the `present` guide (agents read it); to
change the chat, edit `assets/web/`. The server never sends a raw SDK message to the page: `src/web/events.ts` is
the one place that translates.

## Creating an agent

1. Add a declaration to `assets/config/agent_catalog.yaml`, infrastructure only: `name`, `agentProfile`
   (always `assets/agents/<name>.yml`), `handoffs` (an orchestrator's roster; empty for a
   subagent), `requiredOutputs`, `orchestrator`, and a typed `sdk` block (`model`, `effort`, `maxTurns`,
   `permissionMode`, `background`, `mcpServers`, ...). Skills and tools do not go here.
2. Add the profile `assets/agents/<name>.yml`, holding exactly: `description` (the one-line
   selection description; it lives only here), `persona`, `goal`, `success_criteria` (list), `input`
   (list), `output` (list of `{filename, key_sections, required}`), `context_ledger`, `hitl`,
   `skills` and `tools` (lists of `{name, disclosure}`). A field may not contain a markdown heading:
   structure is renderer-owned.
3. `disclosure: mandatory` inlines a skill's whole workflow (or a tool family's guide) into the prompt.
   `progressive` shows one line and loads the body on demand (`load_skill`, `load_guide`).
4. Put an agent that runs a skill which fans out its own workers on an orchestrator; a subagent cannot
   dispatch. An orchestrator is never on a roster; every subagent is on at least one.
5. `pnpm agents:shims`, then `pnpm agents:check`.

## Creating a skill

A skill is `assets/skills/<skill>/SKILL.md` with its briefs and templates beside it (content, never code). Its scripts live in `assets/tools/repo/<skill>/`, and shared helpers in `assets/tools/repo/lib/`. The
frontmatter `name` equals the folder and `description` says when to use it. A skill is shared, not
agent property: an agent couples to it only through its profile's `skills` list, and every skill must
be granted by at least one profile (`pnpm agents:check` fails on an orphan). Skills never elaborate
tool invocation; that belongs to the tool guides.

## Tool families

`assets/config/tools.yaml` declares the families a profile may grant, each with a guide under
`assets/tools/<family>/guide.md` whose frontmatter `description` is the line every prompt shows. A
`gated` family's tools are denied until the agent loads its guide. The always-on baseline (Read, Glob,
Grep, the run-context and guide tools, the human question tool) is never listed in a profile.

## Script tools

`assets/config/scripts.yaml` registers the calling main function of every pipeline step, scraper and scorer
once: `name`, `family`, `description`, the fixed `run` argv, `metered`, and typed `params` (string, number,
boolean, string_list, enum, each with an optional `pattern`). Each becomes `mcp__invest__<name>`, run with no
shell from the repository root. To add one: add the entry, name its family (declare a new family in
`tools.yaml` with `scripts: true` and a guide), grant the family in a profile, run `pnpm agents:shims` and
`pnpm agents:check`. Mark anything that costs money `metered: true`: an interactive run asks the operator per
call and a headless run denies it. The code a script runs is not part of the harness and can live anywhere.

## Generated pointers (`.claude/`)

`.claude/` keeps no agent content, only pointers generated from the profiles by `pnpm agents:shims`:

- `.claude/skills/<skill>/SKILL.md`: the operator's slash-command for each skill, pointing at `assets/skills`.
- `.claude/skills/<agent>/SKILL.md`: `/<agent>` for every agent, orchestrators and subagents alike, named
  exactly after it. It links the profile and the run contract below; an orchestrator's names its roster.
- `.claude/agents/<subagent>.md`: a native Claude Code subagent with the profile inlined as its
  instructions. One per graph subagent and never one per orchestrator, so an orchestrator run in a
  session can dispatch its whole roster, several of one type at once.
- `.claude/commands/invest-agents.md`: the launcher bridge, the one hand-written file here.

## Run a profile in session

1. Know what is current: `python3 src/agent-sdk/assets/tools/repo/state/state.py --intent <intent>`, and run
   only what it lists. Ask the operator before any metered step.
2. Read the profile yaml end to end; adopt its `persona`, work toward its `goal`, and treat
   `success_criteria`, `input` and `hitl` as binding.
3. Read `assets/skills/<name>/SKILL.md` for every `mandatory` skill before starting, and the
   `progressive` ones when the task reaches them.
4. Read a tool family's `guide.md` under `assets/tools/` before first use.
5. Deliver every `required: true` output inline in the final reply, one section per `filename` shaped by
   its `key_sections`. A session has no run workspace and no `publish_output`; a data file a skill
   assigns to the agent is written under `data/` as that skill says.
6. An orchestrator profile dispatches in session too: each row is an `Agent` call with `subagent_type` a
   `.claude/agents/` subagent, `name` the work item and `run_in_background: false`. Independent rows go
   out as several calls in ONE message, each with a disjoint write set. The session has no dispatch
   registry, so write ownership is the orchestrator's own discipline: never put two rows that edit one
   file in the same wave.

## Validation

`pnpm agents:check` validates the whole harness: the graph (one level of dispatch, real rosters,
reachable subagents), every profile against its schema, every skill (name matches folder, non-empty
body, granted by at least one profile, and no executable under `assets/skills` or `assets/agents`), every tool family (guide with a description), one profile per
`assets/agents/<name>.yml` (and nothing else in `assets/agents/`), every composed prompt, and every generated
pointer (exactly the graph's agents and skills, byte-for-byte current). `pnpm test` runs the vitest
suite, and `python3 src/agent-sdk/assets/tools/repo/wiring/check_wiring.py` checks the documented commands,
flags, saved queries and data paths.
