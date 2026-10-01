# agent-sdk

The invest agent harness, built on `@anthropic-ai/claude-agent-sdk`. An orchestrator dispatches
one-shot, context-isolated subagents; each subagent is granted the skills and tool families it owns.
Ported from the pmo `coding-agent` and trimmed to its generic core. The design, the roster, the rules
the runtime enforces, and what was dropped are in [`docs/agents.md`](../../docs/agents.md).

```
assets/config/   runtime.yaml, agent-sdk-config.yaml, agent_catalog.yaml (graph), tools.yaml (families),
                 scripts.yaml (the registry of every pipeline, scraper and scorer entry point)
assets/agents/   <agent>.yml: one profile per agent (persona, goal, outputs, skills, tools)
assets/skills/   <skill>/SKILL.md with its scripts, briefs and templates
assets/tools/    catalog.ts, script/ (registry and runner), present/ (inline HTML pages), one folder per family, repo/ (Python tools)
assets/web/      the UI: index.html, app.js (chat and the orchestration map), logs.js (verbose per-agent logs), research.js (read-only research view), ui.js (shared), styles.css; no framework, no build
src/             runtime: agents, catalog, config, domain, handoffs, hooks, orchestrator, prompt, web (the chat server; logs.ts, past runs; research.ts, the read side of data/), ...
test/            vitest
```

`.claude/skills/` and `.claude/agents/` are generated pointers to `assets/` and are never edited.

```bash
pnpm agents:check                     # validate graph, profiles, skills, tool families, prompts, pointers
pnpm agents:shims                     # regenerate .claude/ pointers after changing a skill or profile
pnpm agents:list
pnpm web                              # chat + research on http://127.0.0.1:4317
pnpm agents [--agent <name>] [request]
```
