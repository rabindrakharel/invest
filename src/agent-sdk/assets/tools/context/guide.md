---
description: "Run context tools: read the shared run ledger, publish your required output files, record your outcome, and wait for a detached agent. Everything is per-run under the run folder."
---

# Run context tools

## Guardrails

1. Pass your own runtime agent name; never write another agent's output or outcome. A write addressed to another agent is denied, not redirected: re-dispatch that agent to finish its own close-out.
2. Every `agent` argument is an agent TYPE name (the `subagent_type` you dispatched, for example `macro-analyst`). The opaque agentId from an `Agent` launch acknowledgement is rejected.
3. Dispatch a task you must gate on with `run_in_background: false`: the Agent call then returns the subagent's final message and there is nothing to wait for. `wait_for_outcome` is the exception path for work you deliberately detached, and it is short on purpose.
4. The ledger and the output plane are keyed per dispatch: each delegated attempt owns `{RUN_ROOT}/<agent>/<ordinal>/output/` and its own ledger section. Never name an ordinal; the runtime resolves it.
5. `tools.jsonl` is an append-only, metadata-only log written by hooks. Never put artifact content in it.

## Tools

| Tool | Args | Effect |
|---|---|---|
| `read_context` | none | returns the markdown ledger |
| `publish_output` | your `agent`, output-relative `path`, complete `content` | writes the file into your own `output/` directory |
| `record_outcome` | your `agent`, `verdict` (completed, needs_retry, blocked), non-empty `summary` | upserts your ledger section |
| `wait_for_outcome` | delegated agent TYPE, optional `timeout_seconds` | exception path for a detached agent |

The stop gate blocks an agent from finishing until every required output exists in its `output/` directory, so publish each one, then record the outcome.
