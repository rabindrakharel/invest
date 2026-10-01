# Agent Visualizer

Terminal tools for looking inside a Claude Code session: how the orchestrator and its subagents
coordinated, the full call tree, prompt-cache usage, and the exact API requests and responses.

Copied from the `session-trace` skill (`~/.claude/skills/session-trace/`). Standard library only,
no install needed.

## Requirements

- Python 3.8+ (tested on 3.10)
- Session transcripts under `~/.claude/projects/` (Claude Code writes these automatically)

## 1. Find the session ID

Every tool reads one session, named by the `CLAUDE_CODE_SESSION_ID` environment variable.

**From inside Claude Code**, the variable is already set. Run a tool with the `!` prefix:

```
! python3 ~/projects/invest/agent-vizualizer/subagents.py
```

**From a separate terminal**, look up the ID. It is the filename of the session's transcript:

```bash
ls -t ~/.claude/projects/*/*.jsonl | head -5     # most recently active sessions first
```

For example, `~/.claude/projects/-home-rabin/deee006d-b302-48fd-8068-bb6a074ba000.jsonl`
gives the ID `deee006d-b302-48fd-8068-bb6a074ba000`.

## 2. Run a tool

```bash
cd ~/projects/invest/agent-vizualizer
export CLAUDE_CODE_SESSION_ID=<session-id>

python3 subagents.py        # how agents coordinated
python3 trace.py            # call tree (interactive)
python3 cache.py            # prompt-cache usage
python3 message.py          # exact requests/responses (interactive)
```

Or set the variable for a single run:

```bash
CLAUDE_CODE_SESSION_ID=<session-id> python3 cache.py
```

## The tools

| Tool | Answers | Options |
|---|---|---|
| `subagents.py` | *How did the orchestrator and subagents coordinate?* Swimlane diagram (USER · ORCH · A1…), an activity timeline, and one card per subagent with the exact instruction it got and the report it returned. | `--full` show complete reports · `--no-color` |
| `trace.py` | *What happened, call by call?* Every API call (message ID, request ID, tokens), every tool call with its input and result, subagents nested under the call that spawned them. | *(no flag)* interactive viewer · `--print` print the tree · `--full` complete inputs/results · `--no-color` |
| `cache.py` | *What was cached?* Hit-rate gauge, billed cost, and a per-call bar: █ read from cache · ▓ written to cache · ▒ new. | `--legend` list what each segment contains · `--compact` bars only · `--no-color` |
| `message.py` | *What exactly was sent to the model?* Folded viewer of each request (model, system prompt, messages, new content marked ✚ NEW) and its response. | *(no flag)* interactive viewer · `--print` list agents and calls · `--no-color` |

`cclib.py`, `ui.py` and `tui.py` are shared helpers. Keep them in the same folder as the tools.

### Reading `cache.py`

Each request re-sends the whole conversation, so prompts grow as a prefix:

```
request 1 = P1      request 2 = P1 A1 Q1      request 3 = P1 A1 Q1 A2 Q2   …
```

- **P**: the first request's full prompt (system prompt + tool definitions + first input)
- **A*i***: what call *i* returned
- **Q*i***: new input after A*i* (tool results, user messages, notifications)

Per-call totals are exact API usage. The A/Q split within a segment is estimated (≈).

## Interactive viewer keys (`trace.py`, `message.py`)

These need a real terminal, not a pipe.

| Key | Action |
|---|---|
| `>` / `<` | unfold / fold |
| `x` | fold all |
| `i` | toggle inspector pane |
| `J` / `K` | scroll inspector |
| `d` | full-screen detail |
| `/` | search |
| `r` | reload (picks up new activity in a live session) |
| `?` | help |
| `q` | quit |

Mouse: click ▸ or double-click to toggle, wheel to scroll.

## Saving output

```bash
python3 subagents.py --no-color > subagents.txt
python3 trace.py --print --full --no-color > trace.txt
```

## Limitations

- `message.py` rebuilds requests from the transcript. Model, system prompt, messages and injected
  reminders are exact, but **tool definitions and sampling parameters aren't recorded**, so they
  show as "not recorded".
- One session per run. Errors like `transcript for session … not found` mean the ID is wrong or the
  transcript was deleted.
- These are copies. Changes to `~/.claude/skills/session-trace/` won't show up here.
