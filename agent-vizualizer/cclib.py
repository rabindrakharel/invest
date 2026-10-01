"""Shared helpers for the session-trace tools (subagents.py, cache.py, message.py).

Everything here is scoped to the CURRENT Claude Code session, taken from
$CLAUDE_CODE_SESSION_ID. Standard library only.
"""
import glob
import json
import os
import re
import sys

PROJECTS = os.path.expanduser("~/.claude/projects")


# ---------------------------------------------------------------- small utils

def hhmmss(ts):
    m = re.search(r"T(\d\d:\d\d:\d\d)", ts or "")
    return m.group(1) if m else "--:--:--"


def short(s, n=90):
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def tag(text, name):
    m = re.search(r"<%s>(.*?)</%s>" % (name, name), text or "", re.S)
    return m.group(1).strip() if m else ""


def block_text(content):
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    out = []
    for b in content:
        if not isinstance(b, dict):
            out.append(str(b))
        elif b.get("type") == "text":
            out.append(b.get("text", ""))
        elif b.get("type") == "image":
            out.append("[image]")
        elif b.get("type") == "tool_reference":
            out.append("[tool_reference %s]" % b.get("tool_name"))
        else:
            out.append(json.dumps(b, ensure_ascii=False))
    return "\n".join(out)


def usage_tokens(u):
    u = u or {}
    cc = u.get("cache_creation") or {}
    return {
        "input": u.get("input_tokens") or 0,
        "cache_write": u.get("cache_creation_input_tokens") or 0,
        "cache_read": u.get("cache_read_input_tokens") or 0,
        "output": u.get("output_tokens") or 0,
        "thinking": (u.get("output_tokens_details") or {}).get("thinking_tokens") or 0,
        "cw_1h": cc.get("ephemeral_1h_input_tokens") or 0,
        "cw_5m": cc.get("ephemeral_5m_input_tokens") or 0,
    }


def secs(a, b):
    from datetime import datetime
    try:
        f = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
        return (f(b) - f(a)).total_seconds()
    except (TypeError, ValueError, AttributeError):
        return 0.0


# ---------------------------------------------------------------- session loading

def current_session():
    sid = os.environ.get("CLAUDE_CODE_SESSION_ID")
    if not sid:
        sys.exit("CLAUDE_CODE_SESSION_ID is not set. These tools only show the current Claude Code session.\n"
                 "Inside Claude Code:   ! %s\n"
                 "In another terminal:  CLAUDE_CODE_SESSION_ID=<session id> %s"
                 % (os.path.basename(sys.argv[0]), os.path.basename(sys.argv[0])))
    hits = glob.glob(os.path.join(PROJECTS, "*", sid + ".jsonl"))
    if not hits:
        sys.exit("transcript for session %s not found under %s" % (sid, PROJECTS))
    return sid, hits[0]


def load(path):
    recs = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    recs.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return recs


class Agent:
    def __init__(self, aid, label, path, meta=None):
        self.id = aid
        self.label = label
        self.path = path
        self.meta = meta or {}
        self.recs = load(path)
        self.idx = {r["uuid"]: r for r in self.recs if r.get("uuid")}
        self.wire = {}
        for r in self.recs:
            self.wire.update(r.get("wireToolInputs") or {})
        self.calls = api_calls(self)
        ts = [r.get("timestamp") for r in self.recs if r.get("timestamp")]
        self.start = min(ts) if ts else ""
        self.end = max(ts) if ts else ""


def load_agents():
    """[orchestrator, subagent...] for the current session, subagents in start order."""
    sid, path = current_session()
    agents = [Agent("main", "ORCHESTRATOR", path)]
    subs = []
    for meta_path in glob.glob(os.path.join(path[: -len(".jsonl")], "subagents", "agent-*.meta.json")):
        jsonl = meta_path[: -len(".meta.json")] + ".jsonl"
        if not os.path.exists(jsonl):
            continue
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, json.JSONDecodeError):
            meta = {}
        aid = os.path.basename(meta_path)[len("agent-"):-len(".meta.json")]
        subs.append(Agent(aid, "SUBAGENT %s" % aid, jsonl, meta))
    agents.extend(sorted(subs, key=lambda a: a.start))
    return sid, agents


# ---------------------------------------------------------------- API calls & request reconstruction

class Call:
    pass


def api_calls(agent):
    """One Call per API response (message.id); transcript splits a response across records."""
    calls, by_id = [], {}
    for r in agent.recs:
        if r.get("type") != "assistant":
            continue
        msg = r.get("message") or {}
        mid = msg.get("id") or r.get("uuid")
        c = by_id.get(mid)
        if c is None:
            c = Call()
            c.mid, c.request_id, c.model = mid, r.get("requestId"), msg.get("model")
            c.ts, c.first, c.content, c.records = r.get("timestamp"), r, [], []
            by_id[mid] = c
            calls.append(c)
        c.records.append(r)
        c.last, c.msg = r, msg
        c.content.extend(msg.get("content") or [])
    for n, c in enumerate(calls, 1):
        c.n = n
        c.usage = c.msg.get("usage") or {}
        c.tok = usage_tokens(c.usage)
        c.prompt_total = c.tok["input"] + c.tok["cache_write"] + c.tok["cache_read"]
        c.response = dict(c.msg)
        c.response["content"] = c.content
        c.agent = agent
    return calls


def chain(agent, uuid):
    out, seen = [], set()
    while uuid and uuid in agent.idx and uuid not in seen:
        seen.add(uuid)
        r = agent.idx[uuid]
        out.append(r)
        uuid = r.get("parentUuid")
    return out[::-1]


def user_source(r):
    content = (r.get("message") or {}).get("content")
    if isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
        return "tool_result"
    if r.get("turnOrigin") == "task_notification":
        return "task-notification"
    if r.get("isMeta"):
        return "injected (meta)"
    if r.get("turnOrigin") == "human":
        return "user prompt"
    return "user" if r.get("agentId") is None else "prompt from orchestrator"


def build_request(call):
    """Rebuild the Messages API request for `call` from the transcript parent chain.

    Returns dict(system, messages, sources, records, deferred_tools). `sources[i][j]` names where
    messages[i].content[j] came from. Tool definitions are not recorded in transcripts.
    """
    if hasattr(call, "request"):
        return call.request
    agent = call.agent
    recs = chain(agent, call.first.get("parentUuid"))
    system, deferred = None, []
    msgs, srcs = [], []

    def push(role, blocks, src):
        if msgs and msgs[-1]["role"] == role:
            msgs[-1]["content"].extend(blocks)
            srcs[-1].extend([src] * len(blocks))
        else:
            msgs.append({"role": role, "content": list(blocks)})
            srcs.append([src] * len(blocks))

    for r in recs:
        t = r.get("type")
        if t == "assistant":
            m = r.get("message") or {}
            blocks = []
            for b in m.get("content") or []:
                if b.get("type") == "tool_use" and b.get("id") in agent.wire:
                    b = dict(b, input=agent.wire[b["id"]])  # input exactly as echoed on the wire
                blocks.append(b)
            push("assistant", blocks, "response %s" % m.get("id", ""))
        elif t == "user":
            content = (r.get("message") or {}).get("content")
            blocks = [{"type": "text", "text": content}] if isinstance(content, str) else list(content or [])
            push("user", blocks, user_source(r))
        elif t == "attachment":
            a = r.get("attachment") or {}
            if a.get("type") == "prompt_snapshot":
                system = a.get("systemPrompt")
            elif a.get("type") == "deferred_tools_record":
                deferred = a.get("entries") or deferred
            for x in r.get("rendered") or []:
                push("user", [{"type": "text", "text": x.get("content", "")}], "injected: %s" % a.get("type", "?"))
    call.request = {"system": system, "messages": msgs, "sources": srcs, "records": recs, "deferred_tools": deferred}
    return call.request


def describe_records(recs, agent):
    """Short human description of input records (used for Q segments)."""
    out = []
    for r in recs:
        t = r.get("type")
        if t == "user":
            content = (r.get("message") or {}).get("content")
            src = user_source(r)
            if src == "tool_result":
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        out.append("tool_result %s" % b.get("tool_use_id"))
            elif src == "task-notification":
                out.append("task-notification %s" % tag(block_text(content), "task-id"))
            else:
                out.append("%s: \"%s\"" % (src, short(block_text(content), 40)))
        elif t == "attachment" and r.get("rendered"):
            out.append("injected %s" % (r.get("attachment") or {}).get("type"))
    return out


def describe_response(call):
    out = []
    for b in call.content:
        bt = b.get("type")
        if bt == "text" and b.get("text", "").strip():
            out.append("text \"%s\"" % short(b["text"], 30))
        elif bt == "thinking":
            out.append("thinking")
        elif bt == "tool_use":
            out.append("tool_use %s %s" % (b.get("name"), b.get("id")))
    return out
