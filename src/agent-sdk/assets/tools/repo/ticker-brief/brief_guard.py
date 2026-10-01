#!/usr/bin/env python3
"""PreToolUse guard: ticker research is written only through its scripts and its template.

Reads one hook event as JSON on stdin ({tool_name, tool_input, cwd}) and, when the call would bypass
the template, prints a PreToolUse deny decision as JSON. Otherwise it prints nothing (no opinion). The
same script serves both hosts:
  - Claude Code: .claude/settings.json runs it as a PreToolUse command hook.
  - The agent harness: src/agent-sdk/src/hooks/policy.ts (enforceTickerTemplate) pipes the event to it.

Rules (paths under data/):
  research/<D>/tickers/<T>.json             mechanical: only ticker_context.py writes it
  research/<D>/tickers/<T>.judgment.json    the agent writes it, but a Write or Edit is checked against
                                            ticker-judgment/1 (render_brief.validate) before it lands
  reports/<D>-<t>[-<t>...].md               a ticker brief: only render_brief.py writes it. A report is a
                                            ticker brief when every slug token is a ticker with a context
                                            file for that date, or its title is a ticker-brief title
  reports/INDEX.md                          a hand-written line for a ticker brief is refused
  Bash                                      a shell write (redirect, tee, cp/mv, in-place edit) to any of
                                            the above is refused; running the owning scripts is not a write
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import render_brief as rb  # noqa: E402
from render_brief import paths  # noqa: E402

WRITE_TOOLS = {"Write", "Edit", "MultiEdit"}
CONTEXT = re.compile(r"^research/(\d{4}-\d{2}-\d{2})/tickers/([A-Z][A-Z0-9.]{0,9})\.json$")
JUDGMENT = re.compile(r"^research/(\d{4}-\d{2}-\d{2})/tickers/([A-Z][A-Z0-9.]{0,9})\.judgment\.json$")
REPORT = re.compile(r"^reports/(\d{4}-\d{2}-\d{2})-([a-z0-9.-]+)\.md$")
TITLE = re.compile(r"^#\s+(?:[A-Z][A-Z0-9.]{0,9}\b.*ticker brief|Ticker briefs:)", re.I)
INDEX_BRIEF = re.compile(r"\[(?:[A-Z][A-Z0-9.]{0,9}\b[^\]]*ticker brief|Ticker briefs:[^\]]*)\]", re.I)
SHELL_PATH = re.compile(r"(?:data/)?(?:research/\d{4}-\d{2}-\d{2}/tickers/[A-Za-z0-9.]+\.(?:judgment\.)?json|reports/[\w.-]+\.md)")
# Where a shell command writes: redirect and tee targets, the destination of cp/mv, and anything an in-place
# editor or a Python write touches.
REDIRECT = re.compile(r"(?:(?<![<>&\d])>>?|\btee(?:\s+-a)?)\s*([^\s;|&<>]+)")
COPY = re.compile(r"\b(?:cp|mv|install|rsync)\b[^;|&]*?\s([^\s;|&]+)\s*(?:$|[;|&])")
IN_PLACE = re.compile(r"\bsed\s+-[a-z]*i|\bdd\b|\bperl\s+-[a-z]*i|write_text|\bopen\([^)]*['\"][wa]|\btruncate\b")
HOW = ("Ticker research has a fixed template: run ticker_context.py <T> --date <D>, write your judgment with the "
       "Write tool to the research/<D>/tickers/<T>.judgment.json file under the data directory (schema ticker-judgment/1, "
       "see render_brief.py), then run render_brief.py <T> [<T> ...] --date <D>. It writes the report, the joint report and "
       "the INDEX line.")
DATA_PREFIX = re.compile(rf"^{re.escape(paths.DATA.name)}/")


def shown(rel: str) -> str:
    return rb.shown(paths.DATA / rel)


def deny(reason: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}


def data_relative(path: str, cwd: str) -> str | None:
    full = (Path(cwd) / path).resolve() if not Path(path).is_absolute() else Path(path).resolve()
    try:
        return full.relative_to(paths.DATA.resolve()).as_posix()
    except ValueError:
        return None


def is_ticker_report(rel: str, content: str | None) -> bool:
    match = REPORT.match(rel)
    if not match:
        return False
    day, slug = match.groups()
    tokens = slug.split("-")
    if all(rb.TICKER.match(t.upper()) and rb.context_path(t.upper(), day).exists() for t in tokens):
        return True
    return bool(content and TITLE.match(content.lstrip().split("\n", 1)[0]))


def after_edit(rel: str, tool: str, args: dict) -> str | None:
    """The file's content once the Write or Edit lands, or None when it cannot be known."""
    if tool == "Write":
        return args.get("content")
    current_path = paths.DATA / rel
    text = current_path.read_text() if current_path.exists() else ""
    edits = args.get("edits") if tool == "MultiEdit" else [args]
    for edit in edits or []:
        old, new = edit.get("old_string", ""), edit.get("new_string", "")
        if old not in text:
            return None
        text = text.replace(old, new) if edit.get("replace_all") else text.replace(old, new, 1)
    return text


def check_write(tool: str, args: dict, cwd: str) -> dict | None:
    rel = data_relative(str(args.get("file_path") or ""), cwd) if args.get("file_path") else None
    if rel is None:
        return None
    if CONTEXT.match(rel):
        return deny(f"`{shown(rel)}` is mechanical evidence: only ticker_context.py writes it, so every number in the brief traces to a script. {HOW}")
    judged = JUDGMENT.match(rel)
    if judged:
        day, ticker = judged.groups()
        ctx_path = rb.context_path(ticker, day)
        if not ctx_path.exists():
            return deny(f"There is no context for {ticker} on {day} yet. Run ticker_context.py {ticker} --date {day} first; the judgment is checked against it.")
        content = after_edit(rel, tool, args)
        if content is None:
            return deny("This edit does not apply cleanly to the judgment file; rewrite the whole file with Write so it can be checked.")
        try:
            doc = json.loads(content)
        except json.JSONDecodeError as exc:
            return deny(f"The judgment is not valid JSON ({exc}).")
        errors = rb.validate(doc, rb.load(ctx_path))
        if errors:
            return deny("The judgment does not meet ticker-judgment/1; fix every point and write it again:\n" + "\n".join(f"- {e}" for e in errors))
        return None
    if rel == "reports/INDEX.md" and tool != "Write":
        added = "\n".join(e.get("new_string", "") for e in (args.get("edits") if tool == "MultiEdit" else [args]) or [])
        if INDEX_BRIEF.search(added):
            return deny(f"Ticker-brief lines in reports/INDEX.md are written by render_brief.py, never by hand. {HOW}")
        return None
    if rel == "reports/INDEX.md":
        before = (paths.reports() / "INDEX.md").read_text() if (paths.reports() / "INDEX.md").exists() else ""
        new_lines = set((args.get("content") or "").split("\n")) - set(before.split("\n"))
        if any(INDEX_BRIEF.search(line) for line in new_lines):
            return deny(f"Ticker-brief lines in reports/INDEX.md are written by render_brief.py, never by hand. {HOW}")
        return None
    if REPORT.match(rel):
        content = after_edit(rel, tool, args) if tool == "Write" else None
        if is_ticker_report(rel, content):
            return deny(f"`{shown(rel)}` is a ticker brief: render_brief.py renders it from the context and your judgment, so its title, header and sections never vary. Edit the judgment instead. {HOW}")
    return None


def shell_targets(command: str) -> list[str]:
    targets = REDIRECT.findall(command) + COPY.findall(command)
    # An in-place editor writes what its own statement names, not every path elsewhere in the command line.
    for statement in re.split(r"&&|\|\||[;|\n]", command):
        if IN_PLACE.search(statement):
            targets += [m.group(0) for m in SHELL_PATH.finditer(statement)]
    return targets


def check_shell(command: str) -> dict | None:
    # No exemption for a command that also runs an owning script: those scripts write from inside Python, so a
    # shell write target next to them is still a hand write.
    if not SHELL_PATH.search(command):
        return None
    for target in shell_targets(command):
        match = SHELL_PATH.search(target)
        if not match:
            continue
        rel = DATA_PREFIX.sub("", match.group(0))
        if CONTEXT.match(rel) or JUDGMENT.match(rel) or is_ticker_report(rel, None) or (rel == "reports/INDEX.md" and INDEX_BRIEF.search(command)):
            return deny(f"A shell command may not write ticker research (`{shown(rel)}`). {HOW} Write the judgment with the Write tool so it is checked.")
    return None


def decide(event: dict) -> dict | None:
    if event.get("hook_event_name", "PreToolUse") != "PreToolUse":
        return None
    tool, args, cwd = event.get("tool_name", ""), event.get("tool_input") or {}, event.get("cwd") or str(paths.REPO)
    if tool in WRITE_TOOLS:
        return check_write(tool, args, cwd)
    if tool == "Bash":
        return check_shell(str(args.get("command") or ""))
    return None


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0
    decision = decide(event)
    if decision:
        print(json.dumps(decision))
    return 0


if __name__ == "__main__":
    sys.exit(main())
