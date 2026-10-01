# invest: agent visualizer

> Terminal tools that show what happened inside a Claude Code session in this repo: how the
> orchestrator dispatched subagents, every API and tool call, prompt-cache use, and the exact
> requests sent to the model. The tools live in [`agent-vizualizer/`](../agent-vizualizer/),
> copied from the `session-trace` skill. Python standard library only; nothing to install.
> Written 2026-10-01.

## When to use it

| Question | Tool |
|---|---|
| Did `/chief` (or another orchestrator) dispatch the right subagents, with the right instructions? | `subagents.py` |
| Which tool calls ran, with what input, and what came back? Where did the tokens go? | `trace.py` |
| Is the prompt cache working, and what did the session cost? | `cache.py` |
| What exactly did the model see on a given call? | `message.py` |

## Requirements

- Python 3.8+ (`python3 --version`; tested on 3.10)
- Session transcripts in `~/.claude/projects/`. Claude Code writes them automatically; this
  repo's sessions are in `~/.claude/projects/-home-rabin-projects-invest/`.

## Step 1: Pick a session

Every tool reads one session, named by `CLAUDE_CODE_SESSION_ID`.

**The session you're in.** Inside Claude Code the variable is already set. Run any tool with
the `!` prefix and its output lands in the conversation:

```
! python3 agent-vizualizer/subagents.py
```

**An earlier session.** The session ID is the transcript's filename without `.jsonl`. List
this repo's sessions, newest first:

```bash
ls -t ~/.claude/projects/-home-rabin-projects-invest/*.jsonl | head
```

## Step 2: Run a tool

From the repo root:

```bash
export CLAUDE_CODE_SESSION_ID=<session-id>

python3 agent-vizualizer/subagents.py      # coordination: swimlanes, timeline, one card per subagent
python3 agent-vizualizer/trace.py          # call tree (interactive viewer)
python3 agent-vizualizer/cache.py          # prompt-cache hit rate and billed cost
python3 agent-vizualizer/message.py        # exact requests and responses (interactive viewer)
```

Or for one run only:

```bash
CLAUDE_CODE_SESSION_ID=<session-id> python3 agent-vizualizer/cache.py
```

## Options

| Tool | Flag | Effect |
|---|---|---|
| all | `--no-color` | plain text (for files, pipes, or pasting) |
| `subagents.py` | `--full` | complete subagent reports, not the first 14 lines |
| `trace.py` | `--print` | print the tree instead of opening the viewer |
| `trace.py` | `--print --full` | include complete tool inputs, results and prompts |
| `cache.py` | `--legend` | list what every prompt segment contained |
| `cache.py` | `--compact` | bars only |
| `message.py` | `--print` | list agents and calls instead of opening the viewer |

## What the output means

**`subagents.py`** draws three things:
1. A swimlane diagram with one column each for USER, ORCH and every subagent (A1, A2, …).
   Arrows mark a spawn (`─▶`), an acknowledgement (`┄▶`), and a completion notice (`⚑ ◀─`).
2. A timeline of when each agent was busy. `▮` is an API call and `━` is a subagent run.
3. One card per subagent: when it was spawned, run time, tokens, tools used, the **exact
   instruction it received** and the report it returned.

**`cache.py`** treats each request as a growing prefix, because every call re-sends the whole
conversation:

```
call 1 = P1      call 2 = P1 A1 Q1      call 3 = P1 A1 Q1 A2 Q2   …
```

- **P**: the first prompt (system prompt + tool definitions + first input)
- **A*i***: what call *i* returned
- **Q*i***: what came in after it (tool results, user messages, notifications)

Each call's bar splits the prompt into `█` read from cache (billed 0.1×), `▓` written to cache
(1.25×, or 2× for the 1-hour cache) and `▒` new (1×). A high hit rate means the cache is working.

## Interactive viewer keys (`trace.py`, `message.py`)

These need a real terminal. Through `!` or a pipe, use `--print`.

| Key | Action |
|---|---|
| `>` / `<` | unfold / fold |
| `x` | fold all |
| `i` | inspector pane on/off |
| `J` / `K` | scroll the inspector |
| `d` | full-screen detail |
| `/` | search |
| `r` | reload (follows a session that's still running) |
| `?` | help |
| `q` | quit |

Mouse: click `▸` or double-click to toggle; wheel to scroll.

## Saving a report

```bash
python3 agent-vizualizer/subagents.py --full --no-color > /tmp/subagents.txt
python3 agent-vizualizer/trace.py --print --full --no-color > /tmp/trace.txt
```

## Limits and troubleshooting

| Symptom | Cause |
|---|---|
| `CLAUDE_CODE_SESSION_ID is not set` | Export it (Step 1), or run through `!` inside Claude Code. |
| `transcript for session … not found` | Wrong ID, or the transcript was deleted. Check `ls ~/.claude/projects/*/<id>.jsonl`. |
| `message.py` shows tools as "not recorded" | Expected. Transcripts don't store tool definitions or sampling parameters. Everything else is exact. |
| `0 hand-offs out` in `subagents.py` | That session ran no subagents. |

- In `cache.py`, per-call totals are exact API usage. The split between A and Q segments is
  estimated (≈).
- The files are a copy. Updates to `~/.claude/skills/session-trace/` won't reach them; copy
  them again to update.
- `cclib.py`, `ui.py` and `tui.py` are shared helpers. Keep them next to the four tools.
