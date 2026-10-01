---
name: session-trace
description: Inspect the CURRENT Claude Code session only - subagents.py (how the orchestrator and subagents coordinated, with the exact instruction sent to each subagent), trace.py (full call tree with message/request ids, tool_use ids, tool results and input/cache/output tokens), cache.py (which prefix segments P1, A1, Q1... were read from or written to the prompt cache on every call), message.py (interactive viewer of the exact Messages API request and response of every call). Use when the user asks how this session ran, how subagents were coordinated, what was cached, token usage, or what was sent to and returned by the model.
---

# Session trace tools (current session only)

Four tools live in `${CLAUDE_SKILL_DIR}`. They are also on PATH as `cc-subagents`, `cc-trace`, `cc-cache`
and `cc-message`. Each reads only the session named by `$CLAUDE_CODE_SESSION_ID`, and they share
`cclib.py`. Never point them at another session, and don't read the raw transcript JSONL yourself.

| Tool | What it shows | You run it with |
|---|---|---|
| `subagents.py` | ① a swimlane sequence diagram USER · ORCH · A1… (spawn ─▶, ack ┄▶, ⚑ notification ◀─, answers) ② an activity timeline (API calls ▮, subagent runs ━) ③ a card per subagent: spawn point, run time, token bar, tool chips, steps ①②③, return path, the **exact instruction sent** and the report returned | `python3 "${CLAUDE_SKILL_DIR}/subagents.py" --no-color` (`--full` for whole reports) |
| `trace.py` | Full tree with guide lines: API calls (id, requestId, stop_reason, prompt bar `▕█▓▒▏ prompt → out`), tool_use + id + input, ◀ RESULT, nested ◎ SUBAGENTs, ⚑ notifications. The interactive viewer adds a live inspector pane | `python3 "${CLAUDE_SKILL_DIR}/trace.py" --print --no-color` (`--full` for complete inputs/results) |
| `cache.py` | Hit-rate gauge and billed cost; per call a stacked bar (█ READ · ▓ WRITE · ▒ NEW, length ∝ prompt size) plus the P/A/Q segments in each region; a prefix-map ribbon per agent | `python3 "${CLAUDE_SKILL_DIR}/cache.py" --no-color` (`--legend` lists segment contents, `--compact` gives bars only) |
| `message.py` | Folded viewer of each exact request (model, system blocks, messages ✚ NEW, content blocks → syntax-highlighted JSON) and response | interactive only for the user; you can use `--print` to list calls |

## Steps

1. Pick the tool(s) that match the question. If it's unclear which one fits, use `subagents.py` for
   "how did it coordinate", `cache.py` for caching, `trace.py` for ids and tokens, and `message.py`
   for "what exactly was sent".
2. Run it. If the output is long, save it to the scratchpad and show the relevant part **verbatim** in
   a code block, then add a few lines of interpretation.
3. Interactive views need a real terminal. Tell the user to run them in a separate terminal:

   ```
   CLAUDE_CODE_SESSION_ID=<this session's id> cc-message     # or cc-trace
   ```

   You can find the session id by running `echo $CLAUDE_CODE_SESSION_ID` with Bash.
   Both viewers: `>` unfold · `<` fold · `x` fold all · `i` inspector pane · `J`/`K` scroll it · `d` full-screen
   detail · `/` search · `r` reload · `?` help · `q` quit. Mouse: click ▸ or double-click to toggle, wheel to scroll.

## Caveats to state when relevant

- `message.py` rebuilds requests from the transcript. Model, system prompt, messages and injected
  reminders are verbatim. **Tool definitions and sampling params are not recorded**, so the tool says
  so instead of guessing.
- In `cache.py`, totals per call are exact API usage. The A/Q split of each segment is derived (≈),
  using the previous call's output tokens.
