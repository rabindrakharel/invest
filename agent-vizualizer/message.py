#!/usr/bin/env python3
"""message.py: every Messages API round trip of the CURRENT Claude Code session, exactly.

Everything starts folded. '>' unfolds one level, '<' folds it again; leaves unfold into the exact
JSON (syntax-highlighted). Messages added since the previous request are marked ✚ NEW.

    agent ▸ call ▸ ⇡ REQUEST  ▸ model · system[…] · tools · messages[…] ▸ message ▸ content block → JSON
                 ▸ ⇣ RESPONSE ▸ content blocks · usage · entire response JSON

Requests are rebuilt from the transcript: system prompt (prompt_snapshot), messages, content
blocks, injected <system-reminder> text and tool inputs as echoed on the wire are verbatim.
Tool definitions and sampling parameters are not stored in transcripts → shown as "not recorded".

    message.py           interactive (mouse: click ▸ to unfold, wheel to scroll; 'i' inspector)
    message.py --print   list agents and calls
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from cclib import block_text, build_request, hhmmss, load_agents, short  # noqa: E402
from tui import TNode, print_tree, run  # noqa: E402
from ui import human, term_width, token_bar  # noqa: E402

BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"
SRC_COLOR = {"tool_result": "teal", "user prompt": "green", "task-notification": "yellow",
             "prompt from orchestrator": "green", "injected (meta)": "orange"}


def dumps(x):
    return json.dumps(x, indent=2, ensure_ascii=False)


def preview(b):
    t = b.get("type")
    if t == "text":
        return short(b.get("text", ""), 90)
    if t == "thinking":
        th = b.get("thinking") or ""
        return (short(th, 60) if th.strip() else "(text not returned)") + " · signature %d chars" % len(b.get("signature") or "")
    if t in ("tool_use", "server_tool_use"):
        return "%s %s %s" % (b.get("name"), b.get("id"), short(json.dumps(b.get("input"), ensure_ascii=False), 60))
    if t == "tool_result":
        return "%s%s %s" % (b.get("tool_use_id"), " ERROR" if b.get("is_error") else "", short(block_text(b.get("content")), 70))
    return short(json.dumps(b, ensure_ascii=False), 90)


def block_node(path, b, src=None):
    t = b.get("type", "?")
    size = len(json.dumps(b, ensure_ascii=False))
    spans = [(path + "  ", "dim", False), (t, "blue" if t in ("tool_use", "tool_result") else "white", True)]
    if src:
        col = "orange" if src.startswith("injected") else "cyan" if src.startswith("response") else SRC_COLOR.get(src, "grey")
        spans.append(("  ⟨%s⟩" % src, col, False))
    spans.append(("  " + preview(b), "grey", False))
    return TNode("%s %s %s %s" % (path, t, src or "", preview(b)), "block", spans=spans, json=True,
                 body=lambda b=b: dumps(b), right=[("%s chars" % human(size), "faint", False)])


def request_nodes(call, prev_len):
    req = build_request(call)
    msgs, srcs, system = req["messages"], req["sources"], req["system"]

    def system_nodes():
        out = []
        for i, s in enumerate(system or []):
            if s == BOUNDARY:
                out.append(TNode("system[%d] %s" % (i, BOUNDARY), "note",
                                 spans=[("system[%d]  " % i, "dim", False), (BOUNDARY, "orange", True),
                                        ("  static, cache-shareable prompt above · session-specific below", "dim", False)]))
            else:
                out.append(TNode("system[%d] %s" % (i, short(s, 90)), "block", body=s,
                                 spans=[("system[%d]  " % i, "dim", False), (short(s, 90), "grey", False)],
                                 right=[("%s chars" % human(len(s)), "faint", False)]))
        return out

    def message_nodes():
        out = []
        for i, (m, src) in enumerate(zip(msgs, srcs)):
            new = i >= prev_len
            kinds = sorted(set(src), key=src.index)
            spans = [("[%d] " % i, "dim", False), (m["role"], "yellow" if m["role"] == "user" else "green", True),
                     ("  %d block%s" % (len(m["content"]), "" if len(m["content"]) == 1 else "s"), "grey", False)]
            if new:
                spans.append(("  ✚ NEW", "yellow", True))
            spans.append(("  " + short(", ".join(kinds), 70), "dim", False))
            out.append(TNode("[%d] %s %s %s" % (i, m["role"], "NEW" if new else "", ", ".join(kinds)),
                             "new" if new else ("umsg" if m["role"] == "user" else "amsg"), spans=spans,
                             loader=lambda m=m, src=src, i=i: [block_node("messages[%d].content[%d]" % (i, j), b, s)
                                                               for j, (b, s) in enumerate(zip(m["content"], src))]))
        return out

    tools_body = ("Tool definitions (name, description, input_schema of every tool) are sent with each request,\n"
                  "but Claude Code does not write them to the transcript, so they cannot be shown exactly.\n")
    if req["deferred_tools"]:
        tools_body += "\nDeferred-tool definitions recorded in this transcript (loaded later via ToolSearch):\n" + dumps(req["deferred_tools"])
    new_note = "all new" if prev_len == 0 else "✚ messages[%d:] new since previous request" % prev_len
    return [
        TNode('"model": "%s"' % call.model, "field", spans=[('"model": ', "violet", False), ('"%s"' % call.model, "green", False)]),
        TNode('"system": [%d]' % len(system or []), "field", loader=system_nodes,
              spans=[('"system": ', "violet", False), ("[%d blocks]" % len(system or []), "white", False),
                     ("" if system else "  no prompt_snapshot recorded", "orange", False)]),
        TNode('"tools": not recorded', "note", body=tools_body, json=False,
              spans=[('"tools": ', "violet", False), ("not recorded in transcript", "orange", False)]),
        TNode('"messages": [%d]' % len(msgs), "field", loader=message_nodes,
              spans=[('"messages": ', "violet", False), ("[%d]" % len(msgs), "white", True), ("  %s" % new_note, "yellow", False)]),
        TNode("entire request as JSON", "json", json=True, spans=[("{…} ", "white", True), ("entire request as JSON  (model + system + messages)", "grey", False)],
              body=lambda: dumps({"model": call.model, "system": system, "messages": msgs})),
    ]


def response_nodes(call):
    out = [block_node("content[%d]" % j, b) for j, b in enumerate(call.content)]
    t = call.tok
    out.append(TNode('"usage"', "field", json=True, body=dumps(call.usage),
                     spans=[('"usage": ', "violet", False), ("in %s · cache_write %s · cache_read %s · out %s · thinking %s" % tuple(
                         format(t[k], ",") for k in ("input", "cache_write", "cache_read", "output", "thinking")), "grey", False)]))
    out.append(TNode("entire response as JSON", "json", json=True, body=lambda: dumps(call.response),
                     spans=[("{…} ", "white", True), ("entire response as JSON", "grey", False)]))
    return out


def build_roots():
    sid, agents = load_agents()
    scale = max([c.prompt_total for ag in agents for c in ag.calls] or [1])
    roots = []
    for ai, ag in enumerate(agents):
        calls, prev_len = [], 0
        for call in ag.calls:
            n_msgs = len(build_request(call)["messages"])
            r = call.response
            req = TNode("REQUEST %s" % call.request_id, "req", loader=lambda call=call, pl=prev_len: request_nodes(call, pl),
                        spans=[("⇡ REQUEST ", "blue", True), ("POST /v1/messages  ", "white", False), ("requestId %s" % call.request_id, "dim", False)],
                        right=[("%d msgs " % n_msgs, "grey", False), ("+%d" % (n_msgs - prev_len), "yellow", True)])
            resp = TNode("RESPONSE %s" % r.get("id"), "resp", loader=lambda call=call: response_nodes(call),
                         spans=[("⇣ RESPONSE ", "green", True), ("%s  " % r.get("id"), "dim", False),
                                ("stop_reason=%s" % r.get("stop_reason"), "white", False)],
                         right=[("%d block%s" % (len(call.content), "" if len(call.content) == 1 else "s"), "grey", False)])
            calls.append(TNode("#%d %s %s" % (call.n, hhmmss(call.ts), call.mid), "call", children=[req, resp],
                               spans=[("#%-3d " % call.n, "white", True), ("%s  " % hhmmss(call.ts), "dim", False),
                                      (call.mid, "cyan", False), ("  %s" % r.get("stop_reason"), "dim", False)],
                               right=token_bar(call.tok, scale)))
            prev_len = n_msgs
        tot_out = sum(c.tok["output"] for c in ag.calls)
        title = "ORCHESTRATOR" if ag.id == "main" else "SUBAGENT A%d %s" % (ai, ag.id)
        roots.append(TNode(title, "agent", children=calls,
                           spans=[(title, "pink" if ag.id != "main" else "violet", True),
                                  ("" if ag.id == "main" else "  \"%s\"" % ag.meta.get("description", ""), "white", False)],
                           right=[("%d calls · out %s" % (len(ag.calls), human(tot_out)), "grey", False)]))
    chips = [("%d agents" % len(agents), "pink"), ("%d round trips" % sum(len(a.calls) for a in agents), "cyan"),
             ("'>' unfold · '<' fold", "yellow")]
    return sid, roots, chips


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--print", action="store_true", help="print agents and calls instead of the viewer")
    ap.add_argument("--no-color", action="store_true")
    args = ap.parse_args()
    sid, roots, chips = build_roots()
    if args.print or not (sys.stdin.isatty() and sys.stdout.isatty()):
        print_tree(roots, term_width(150), color=sys.stdout.isatty() and not args.no_color, expand_depth=1)
        return
    holder = {"chips": chips}

    def reload():
        _, r, holder["chips"] = build_roots()
        return r
    run("cc-message · %s" % sid[:8], roots, chips=lambda: holder["chips"], inspector=False, reload=reload)


if __name__ == "__main__":
    main()
