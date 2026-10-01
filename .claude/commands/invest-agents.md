---
argument-hint: "[--agent <name>] [request]"
description: "Run the invest agent-sdk launcher: an orchestrator dispatching specialist subagents headless"
---

Treat `$ARGUMENTS` as launcher input and parse at most one optional `--agent <name>` selector. If no
request remains after removing that selector, ask the user one free-form question, "What should the
invest agents do?", and wait for a non-empty answer while retaining the selector. Then run
`pnpm agents` from the repository root, passing the selector (if any) and the complete request as one
safely quoted argument.

A run that reaches a metered step (the X API behind /fetch) stops to ask the operator in the terminal;
in this non-interactive bridge it is denied and reported as blocked, so launch `pnpm agents ...`
directly when the run must pause for operator decisions.

Agents, profiles, skills, tools and output contracts are resolved from the validated catalogs under
`src/agent-sdk/assets`; this command is only a thin bridge.
