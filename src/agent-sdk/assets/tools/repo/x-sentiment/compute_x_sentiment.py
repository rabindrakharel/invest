#!/usr/bin/env python3
"""Score attention, tone, stance and crowding in the X corpus, per symbol and per theme.

    python3 src/agent-sdk/assets/tools/repo/x-sentiment/compute_x_sentiment.py [--date YYYY-MM-DD] [--recent 7] [--prior 28]

It writes data/research/<DATE>/sentiment/ (the location comes from src/agent-sdk/assets/tools/repo/lib/paths.py).
It uses tone.json from that directory when present.

Reads the corpus only through the saved queries (the sanctioned read path):
  pnpm q x-sentiment-posts --days <recent+prior> --json
  pnpm q x-sentiment-stances --json
Maps posts to themes with config/themes.json (member cashtags, then keywords in the text).

Per symbol and per theme:
  attention  posts, distinct accounts and likes in the recent window vs the prior window;
             velocity = recent daily rate / prior daily rate
  tone       mean post polarity in [-1, 1]: from tone.json (an LLM pass, see tone-brief.md)
             when it covers the post, else from the fixed lexicon below
  stance     formal picks (v1-acct): longs, shorts, average conviction, net long share
  labels     heating, cooling, crowded, contested, neglected (rules in SKILL.md)
  evidence   the most-liked recent posts, by post_id, so every read is citable

Writes x-sentiment.json and x-sentiment.md.  Deterministic for a given corpus and tone file.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, timedelta
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[6]
sys.path.insert(0, str(ROOT / "src" / "agent-sdk" / "assets" / "tools" / "repo" / "lib"))
import paths  # noqa: E402

# A deliberately small, finance-specific lexicon.  It is a fallback; the LLM tone pass
# (tone-brief.md) is the better read and overrides it per post.
BULL = ["bullish", "long ", "buying", "bought", "adding", "added", "accumulat", "breakout", "breaking out", "beat",
        "raised guidance", "raises guidance", "guide up", "undervalued", "cheap", "upside", "higher high", "all time high",
        "ath", "rip", "squeeze", "moon", "strong buy", "upgrade", "outperform", "conviction", "winner", "inflection",
        "blowout", "record revenue", "lfg", "send it", "loading"]
BEAR = ["bearish", "short ", "shorting", "selling", "sold", "trimmed", "trimming", "exit", "breakdown", "breaking down",
        "miss", "cut guidance", "guide down", "overvalued", "expensive", "downside", "lower low", "bubble", "dump",
        "puts", "downgrade", "underperform", "red flag", "dilution", "offering", "fraud", "top is in", "rug", "capitulat",
        "avoid", "warning", "crash"]
WORD = re.compile(r"[a-z$][a-z0-9$\-']*")


def lexicon_tone(text: str) -> float:
    t = " " + text.lower() + " "
    b = sum(t.count(w) for w in BULL)
    s = sum(t.count(w) for w in BEAR)
    return 0.0 if b + s == 0 else (b - s) / (b + s)


def q(name: str, **params) -> list[dict]:
    cmd = ["pnpm", "-s", "q", name]
    for k, v in params.items():
        cmd += [f"--{k}", str(v)]
    cmd.append("--json")
    out = subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return json.loads(out) if out.strip().startswith("[") else []


def r(x, n=2):
    return None if x is None else round(x, n)


def aggregate(posts: list[dict], recent_start: str, recent_days: int, prior_days: int, tone: dict, base: float = 1.0) -> dict:
    rec = [p for p in posts if p["trading_day"] >= recent_start]
    pri = [p for p in posts if p["trading_day"] < recent_start]
    rate_r = len(rec) / recent_days
    rate_p = len(pri) / prior_days
    tones = [tone.get(p["post_id"], p["_lex"]) for p in rec] or [0.0]
    tones_all = [tone.get(p["post_id"], p["_lex"]) for p in posts] or [0.0]
    # Prefer focused posts: a watchlist naming 30 tickers is not evidence about any one of them.
    top = sorted(rec, key=lambda p: (len(p["_syms"]) > 4, -p["likes"]))[:3]
    return {
        "posts_recent": len(rec), "posts_prior": len(pri),
        "accounts_recent": len({p["author_username"] for p in rec}), "accounts_total": len({p["author_username"] for p in posts}),
        "likes_recent": sum(p["likes"] for p in rec),
        "velocity": r(rate_r / rate_p) if rate_p else (None if not rec else 9.99),
        # Relative to the whole corpus's own velocity: capture density varies week to week.
        "velocity_rel": r(rate_r / rate_p / base) if rate_p and base else (None if not rec else 9.99),
        "tone_recent": r(sum(tones) / len(tones)), "tone_window": r(sum(tones_all) / len(tones_all)),
        "bull_share_recent": r(sum(1 for t in tones if t > 0.2) / len(tones)),
        "bear_share_recent": r(sum(1 for t in tones if t < -0.2) / len(tones)),
        "tone_source": "llm" if any(p["post_id"] in tone for p in rec) else "lexicon",
        "evidence": [{"post_id": p["post_id"], "author": p["author_username"], "day": p["trading_day"], "likes": p["likes"],
                      "text": " ".join(p["text"].split())[:220]} for p in top],
    }


def labels(a: dict, stance: dict | None, active_accounts: int) -> list[str]:
    out = []
    v = a["velocity_rel"]
    if v is not None and v >= 1.5 and a["posts_recent"] >= 5:
        out.append("heating")
    if v is not None and v <= 0.6 and a["posts_prior"] >= 8:
        out.append("cooling")
    breadth = a["accounts_recent"] / active_accounts if active_accounts else 0
    net = stance.get("net_long") if stance else None
    if breadth >= 0.4 and (a["bull_share_recent"] or 0) >= 0.5 and (net is None or net >= 0.6):
        out.append("crowded")
    if stance and stance["shorts"] and stance["shorts"] >= 0.25 * (stance["longs"] + stance["shorts"]):
        out.append("contested")
    elif (a["bull_share_recent"] or 0) >= 0.3 and (a["bear_share_recent"] or 0) >= 0.3:
        out.append("contested")
    if a["posts_recent"] + a["posts_prior"] < 3:
        out.append("neglected")
    return out


def stance_of(rows: list[dict]) -> dict | None:
    if not rows:
        return None
    longs = sum(x["longs"] for x in rows)
    shorts = sum(x["shorts"] for x in rows)
    conv = [x["avg_conviction"] for x in rows if x["avg_conviction"] is not None]
    return {"accounts": max(x["accounts"] for x in rows), "longs": longs, "shorts": shorts,
            "net_long": r((longs - shorts) / (longs + shorts)) if longs + shorts else None,
            "avg_conviction": r(sum(conv) / len(conv)) if conv else None,
            "stances": " ".join(x["stances"] for x in rows)[:400]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=paths.today())
    ap.add_argument("--out", type=Path, help="override data/research/<DATE>/sentiment (tests only)")
    ap.add_argument("--recent", type=int, default=7)
    ap.add_argument("--prior", type=int, default=28)
    ap.add_argument("--themes", type=Path, default=ROOT / "config" / "themes.json")
    ap.add_argument("--tone", type=Path, help="override <out>/tone.json, the LLM pass: {post_id: polarity}")
    ap.add_argument("--min-posts", type=int, default=4, help="symbols below this in the window are left out of the symbol table")
    args = ap.parse_args()
    args.today = args.date
    args.out = args.out or paths.research(args.date, "sentiment")
    args.tone = args.tone or args.out / "tone.json"

    cfg = json.loads(args.themes.read_text())
    posts = q("x-sentiment-posts", days=args.recent + args.prior)
    stance_rows = {x["symbol"]: x for x in q("x-sentiment-stances")}
    tone = {}
    if args.tone and args.tone.exists():
        tone = {k: float(v["tone"] if isinstance(v, dict) else v) for k, v in json.loads(args.tone.read_text()).items()}
    if not posts:
        raise SystemExit("no posts in the window: run /fetch first")

    last = posts[0]["corpus_last_day"]
    recent_start = (date.fromisoformat(last) - timedelta(days=args.recent - 1)).isoformat()
    for p in posts:
        p["_lex"] = lexicon_tone(p["text"] or "")
        p["_syms"] = [s for s in (p["symbols"] or "").split(",") if s]
    n_rec = sum(1 for p in posts if p["trading_day"] >= recent_start)
    base = (n_rec / args.recent) / ((len(posts) - n_rec) / args.prior) if len(posts) > n_rec else 1.0
    active = len({p["author_username"] for p in posts if p["trading_day"] >= recent_start})

    by_sym = defaultdict(list)
    for p in posts:
        for s in p["_syms"]:
            by_sym[s].append(p)
    symbols = []
    for s, ps in by_sym.items():
        if len(ps) < args.min_posts:
            continue
        a = aggregate(ps, recent_start, args.recent, args.prior, tone, base)
        st = stance_of([stance_rows[s]]) if s in stance_rows else None
        symbols.append({"symbol": s, **a, "stance": st, "labels": labels(a, st, active)})
    symbols.sort(key=lambda x: (-x["posts_recent"], -x["accounts_recent"]))

    themes = []
    for t in cfg["themes"]:
        members = set(t["members"])
        kw = re.compile(r"\b(" + "|".join(re.escape(k.lower()) for k in t.get("keywords", [])) + r")\b") if t.get("keywords") else None
        ps = [p for p in posts if members & set(p["_syms"]) or (kw and kw.search((p["text"] or "").lower()))]
        a = aggregate(ps, recent_start, args.recent, args.prior, tone, base) if ps else None
        st = stance_of([stance_rows[m] for m in t["members"] if m in stance_rows])
        hot = sorted([x for x in symbols if x["symbol"] in members], key=lambda x: -x["posts_recent"])[:4]
        row = {"id": t["id"], "name": t["name"], "group": t["group"], "archetype": t["archetype"],
               "matched_posts": len(ps), "stance": st, "hot_members": [f"{x['symbol']} ({x['posts_recent']})" for x in hot]}
        if a:
            row.update(a)
            row["labels"] = labels(a, st, active)
        else:
            row["labels"] = ["neglected"]
        themes.append(row)
    themes.sort(key=lambda x: -(x.get("posts_recent") or 0))

    stale = (date.fromisoformat(args.today) - date.fromisoformat(last)).days
    doc = {"schema": "x-sentiment/1", "as_of": args.today, "corpus_last_day": last, "corpus_stale_days": stale,
           "windows": {"recent": [recent_start, last], "prior_days": args.prior},
           "posts_in_window": len(posts), "corpus_velocity": r(base), "active_accounts_recent": active,
           "tone_method": f"llm for {sum(1 for p in posts if p['post_id'] in tone)} posts, lexicon for the rest",
           "warnings": ([f"corpus ends {last}, {stale} days before {args.today}: run /fetch to refresh"] if stale > 3 else []),
           "themes": themes, "symbols": symbols}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "x-sentiment.json").write_text(json.dumps(doc, indent=1))
    (args.out / "x-sentiment.md").write_text(render(doc))
    print(f"{len(posts)} posts, {len(symbols)} symbols, {len(themes)} themes; corpus ends {last} ({stale}d stale)")


def f(x, spec="+.2f"):
    return "n/a" if x is None else format(x, spec)


def render(doc: dict) -> str:
    L = [f"# X sentiment, {doc['as_of']}\n",
         f"Corpus through **{doc['corpus_last_day']}** ({doc['corpus_stale_days']} days stale) · corpus velocity {doc['corpus_velocity']}x (velocities below are relative to it) · recent window {doc['windows']['recent'][0]} to {doc['windows']['recent'][1]} vs the prior {doc['windows']['prior_days']} days · {doc['posts_in_window']} posts · {doc['active_accounts_recent']} active accounts · tone: {doc['tone_method']}\n"]
    for w in doc["warnings"]:
        L.append(f"> {w}\n")
    L.append("## Themes\n\n| Theme | Posts 7d | Prior | Velocity vs corpus | Accounts 7d | Tone 7d | Bull / bear | Picks L/S (conv) | Labels | Hot members |\n|---|---:|---:|---:|---:|---:|---|---|---|---|")
    for t in doc["themes"]:
        st = t.get("stance") or {}
        L.append(f"| {t['name']} | {t.get('posts_recent', 0)} | {t.get('posts_prior', 0)} | {f(t.get('velocity_rel'), '.2f')} | {t.get('accounts_recent', 0)} | {f(t.get('tone_recent'))} | {f(t.get('bull_share_recent'), '.0%')} / {f(t.get('bear_share_recent'), '.0%')} | {st.get('longs', 0)}/{st.get('shorts', 0)} ({f(st.get('avg_conviction'), '.2f')}) | {', '.join(t['labels']) or '-'} | {', '.join(t['hot_members'])} |")
    L.append("\n## Symbols (by recent posts)\n\n| Symbol | Posts 7d | Prior | Velocity vs corpus | Accounts 7d | Tone 7d | Picks L/S (conv) | Labels | Top post |\n|---|---:|---:|---:|---:|---:|---|---|---|")
    for s in doc["symbols"][:40]:
        st = s.get("stance") or {}
        ev = s["evidence"][0] if s["evidence"] else None
        L.append(f"| {s['symbol']} | {s['posts_recent']} | {s['posts_prior']} | {f(s['velocity_rel'], '.2f')} | {s['accounts_recent']} | {f(s['tone_recent'])} | {st.get('longs', 0)}/{st.get('shorts', 0)} ({f(st.get('avg_conviction'), '.2f')}) | {', '.join(s['labels']) or '-'} | {('@' + ev['author'] + ' ' + ev['post_id']) if ev else ''} |")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    main()
