#!/usr/bin/env python3
"""trace.py: the full call tree of the CURRENT Claude Code session.

Every API call (message id, request id, model, input / cache-write / cache-read / output / thinking
tokens, drawn as a prompt bar), every tool_use with its tool_use id and input, its tool_result,
subagents nested under the Agent call that spawned them, and task notifications coming back.

    trace.py                 interactive viewer: tree + live inspector pane, mouse support
    trace.py --print         print the tree        (--full: include complete inputs/results)
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from cclib import block_text, hhmmss, load_agents, short, tag, usage_tokens  # noqa: E402
from tui import TNode, print_tree, run  # noqa: E402
from ui import human, term_width, token_bar  # noqa: E402

KEYS = ("input", "cache_write", "cache_read", "output", "thinking")


def add_tok(dst, t):
    for k in KEYS:
        dst[k] += t[k]


def build_agent(agent, by_tool, names, scale):
    """Children + token totals for one transcript (recursing into subagents)."""
    out, totals = [], {k: 0 for k in KEYS}
    api, tools = {}, {}
    first_user = True
    for r in agent.recs:
        typ, ts = r.get("type"), hhmmss(r.get("timestamp"))
        if typ == "assistant":
            msg = r.get("message") or {}
            mid = msg.get("id") or r.get("uuid")
            if mid not in api:
                node = TNode("API %s" % mid, "api", children=[], expanded=True)
                node.meta = (ts, mid, r.get("requestId", "?"), msg.get("model", "?"))
                api[mid] = [node, None, None]
                out.append(node)
            node = api[mid][0]
            api[mid][1], api[mid][2] = msg.get("usage"), msg.get("stop_reason")
            for b in msg.get("content") or []:
                bt = b.get("type")
                if bt == "text" and b.get("text", "").strip():
                    node._children.append(TNode("text: " + short(b["text"], 100), "text", detail=b["text"]))
                elif bt == "thinking":
                    th = b.get("thinking", "")
                    node._children.append(TNode("thinking: " + (short(th, 100) if th.strip() else "(not returned · signature only)"),
                                                "thinking", detail=th or "(thinking text not returned; signature %d chars)" % len(b.get("signature") or "")))
                elif bt in ("tool_use", "server_tool_use"):
                    inp = json.dumps(b.get("input"), ensure_ascii=False)
                    t = TNode("%s  %s  %s" % (b.get("name"), b.get("id"), short(inp, 70)), "tool", children=[], expanded=True,
                              spans=[(b.get("name") or "?", "blue", True), ("  %s  " % b.get("id"), "dim", False), (short(inp, 70), "grey", False)],
                              detail=json.dumps({"tool": b.get("name"), "tool_use_id": b.get("id"), "input": b.get("input")}, indent=2, ensure_ascii=False))
                    tools[b.get("id")] = t
                    node._children.append(t)
                    child = by_tool.get(b.get("id"))
                    if child:
                        sub_children, sub_tot = build_agent(child, by_tool, names, scale)
                        a = TNode("SUBAGENT %s %s \"%s\"" % (names[child.id], child.id, child.meta.get("description", "")), "agent",
                                  children=sub_children, expanded=True,
                                  spans=[("SUBAGENT %s " % names[child.id], "pink", True), (child.id + " ", "dim", False),
                                         ("\"%s\" " % child.meta.get("description", ""), "white", True),
                                         ("[%s]" % child.meta.get("agentType", "?"), "violet", False)],
                                  right=[("%d calls " % len(child.calls), "grey", False), ("Σ ", "faint", False),
                                         (human(sub_tot["cache_read"] + sub_tot["cache_write"] + sub_tot["input"]), "green", False),
                                         (" → ", "faint", False), (human(sub_tot["output"]), "cyan", False)],
                                  detail=json.dumps({"agentId": child.id, "spawned_by_tool_use_id": b.get("id"),
                                                     "transcript": child.path, "meta": child.meta, "totals": sub_tot}, indent=2))
                        t._children.append(a)
                        add_tok(totals, sub_tot)
        elif typ == "user":
            content = (r.get("message") or {}).get("content")
            if isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
                for b in content:
                    if not (isinstance(b, dict) and b.get("type") == "tool_result"):
                        continue
                    tid, text = b.get("tool_use_id"), block_text(b.get("content"))
                    det = text
                    if isinstance(r.get("toolUseResult"), dict):
                        det += "\n\n── toolUseResult (structured) ──\n" + json.dumps(r["toolUseResult"], indent=2, ensure_ascii=False)
                    res = TNode("RESULT %s  %s" % (tid, short(text, 80)), "result",
                                spans=[("RESULT" + (" ERROR" if b.get("is_error") else ""), "red" if b.get("is_error") else "teal", True),
                                       ("  %s  " % tid, "dim", False), (short(text, 80), "grey", False)], detail=det)
                    parent = tools.get(tid)
                    if parent:
                        parent._children.insert(0, res)
                        res.parent = parent
                    else:
                        out.append(res)
            else:
                text = block_text(content)
                if r.get("turnOrigin") == "task_notification" or "<task-notification>" in text:
                    node = TNode("TASK_NOTIFICATION %s %s" % (tag(text, "task-id"), tag(text, "status")), "notify", detail=text,
                                 spans=[("%s  " % ts, "dim", False), ("TASK NOTIFICATION ", "yellow", True),
                                        ("%s " % names.get(tag(text, "task-id"), tag(text, "task-id")), "pink", True),
                                        ("%s  " % tag(text, "status"), "green", False), ("tool_use_id=%s" % tag(text, "tool-use-id"), "dim", False)])
                elif agent.id != "main" and first_user:
                    node = TNode("PROMPT from orchestrator: " + short(text), "user", detail=text,
                                 spans=[("%s  " % ts, "dim", False), ("PROMPT ", "green", True), ("from orchestrator  ", "dim", False), (short(text, 90), "white", False)])
                elif agent.id == "main" and r.get("turnOrigin") != "human":
                    node = TNode("SYSTEM " + short(text), "system", detail=text,
                                 spans=[("%s  " % ts, "dim", False), ("SYSTEM ", "orange", True), ("(%s)  " % (r.get("turnOrigin") or "injected"), "dim", False), (short(text, 90), "grey", False)])
                else:
                    node = TNode("USER " + short(text), "user", detail=text,
                                 spans=[("%s  " % ts, "dim", False), ("USER ", "green", True), (short(text, 100), "white", True)])
                out.append(node)
                first_user = False

    for node, usage, stop in api.values():
        t = usage_tokens(usage)
        add_tok(totals, t)
        ts, mid, rid, model = node.meta
        node.label = "%s API %s %s" % (ts, mid, model)
        node.spans = [("%s  " % ts, "dim", False), ("API ", "cyan", True), (mid, "cyan", False), ("  %s" % (stop or ""), "dim", False)]
        node.right = token_bar(t, scale)
        node._detail = json.dumps({"message.id": mid, "requestId": rid, "model": model, "stop_reason": stop,
                                   "tokens": {k: t[k] for k in KEYS}, "usage": usage}, indent=2)
    return out, totals


def build_session():
    sid, agents = load_agents()
    names = {a.id: "A%d" % i for i, a in enumerate(agents[1:], 1)}
    by_tool = {a.meta.get("toolUseId"): a for a in agents[1:] if a.meta.get("toolUseId")}
    scale = max([c.prompt_total for a in agents for c in a.calls] or [1])
    children, tot = build_agent(agents[0], by_tool, names, scale)
    orch = {k: sum(c.tok[k] for c in agents[0].calls) for k in KEYS}
    prompt = tot["input"] + tot["cache_write"] + tot["cache_read"]
    root = TNode("SESSION %s" % sid, "session", children=children, expanded=True,
                 spans=[("SESSION ", "violet", True), (sid, "white", True)],
                 right=[("%d agents " % len(agents), "pink", False), ("Σ ", "faint", False), (human(prompt), "green", False),
                        (" → ", "faint", False), (human(tot["output"]), "cyan", False)],
                 detail=json.dumps({"session": sid, "transcript": agents[0].path, "orchestrator_only": orch,
                                    "including_subagents": tot}, indent=2))
    calls = sum(len(a.calls) for a in agents)
    chips = [("%d API calls" % calls, "cyan"), ("%d subagents" % (len(agents) - 1), "pink"),
             ("prompt %s" % human(prompt), "green"), ("out %s" % human(tot["output"]), "cyan"),
             ("cache hit %.1f%%" % (100 * tot["cache_read"] / max(1, prompt)), "yellow")]
    return sid, root, chips


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--print", action="store_true", help="print the tree instead of the interactive viewer")
    ap.add_argument("--full", action="store_true", help="with --print: include full tool inputs, results and prompts")
    ap.add_argument("--no-color", action="store_true", help="with --print: disable colors")
    args = ap.parse_args()
    sid, root, chips = build_session()

    if args.print or not (sys.stdin.isatty() and sys.stdout.isatty()):
        if args.full:
            stack = [root]
            while stack:
                n = stack.pop()
                if n.kind in ("text", "thinking", "tool", "result", "user", "notify", "system"):
                    n._body = n.detail()
                    n.expanded = True
                stack.extend(n.children())
        w = term_width(150)
        print_tree([root], w, color=sys.stdout.isatty() and not args.no_color)
        return

    holder = {"chips": chips}

    def reload():
        _, r, holder["chips"] = build_session()
        return [r]
    run("cc-trace · %s" % sid[:8], [root], chips=lambda: holder["chips"], inspector=True, reload=reload)


if __name__ == "__main__":
    main()
