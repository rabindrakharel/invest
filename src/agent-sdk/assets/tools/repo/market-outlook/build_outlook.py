#!/usr/bin/env python3
"""Join the macro regime, theme pulse and X sentiment into one structured outlook.

    python3 src/agent-sdk/assets/tools/repo/market-outlook/build_outlook.py [--date YYYY-MM-DD] [--verify]

Reads data/research/<DATE>/ (locations from src/agent-sdk/assets/tools/repo/lib/paths.py). The first three are
required; the judgment files are optional and labelled:
  macro/regime.json              /macro-regime (mechanical, with the narrative when merged)
  themes/themes.json             /theme-pulse
  sentiment/x-sentiment.json     /x-sentiment
  themes/theme-narrative.json, sentiment/sentiment-read.json, outlook/judgment.json

Writes data/research/<DATE>/outlook/outlook.json and outlook.md.  The theme stance is mechanical:
  score = 0.45 * price_score + 0.35 * macro_fit + 0.20 * sentiment_adj   (each -2..+2)
  >= 1.0 Overweight · 0.4..1.0 Accumulate · -0.4..0.4 Neutral · -1.0..-0.4 Underweight · <= -1.0 Avoid
sentiment_adj: heating with price >= 0 +1; improving and neglected +0.5; crowded and fading
or lagging -1.5; cooling with price <= 0 -0.5; otherwise 0.

--verify writes nothing. It fails unless outlook.md and outlook.json on disk are exactly a fresh render
and the judgment (summary, top calls, risks, what changes the call) is embedded: the daily brief's
fixed format, which the harness checks before an agent that built the outlook may stop.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import paths  # noqa: E402

EXPOSURE = {"Risk-on": 100, "Lean risk-on": 90, "Neutral / mixed": 75, "Lean risk-off": 60, "Risk-off": 40}
LONG_DURATION_CAP = {"supportive": 35, "neutral": 25, "hostile": 15}


def read(p: Path) -> dict | None:
    return json.loads(p.read_text()) if p.exists() else None


def sentiment_adj(price: int, direction: str, labels: list[str]) -> float:
    if "crowded" in labels and (direction.startswith("fading") or direction.startswith("lagging")):
        return -1.5
    if "heating" in labels and price >= 0:
        return 1.0
    if "neglected" in labels and direction == "improving":
        return 0.5
    if "cooling" in labels and price <= 0:
        return -0.5
    return 0.0


def stance(score: float) -> str:
    if score >= 1.0:
        return "Overweight"
    if score >= 0.4:
        return "Accumulate"
    if score > -0.4:
        return "Neutral"
    if score > -1.0:
        return "Underweight"
    return "Avoid"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=paths.today())
    ap.add_argument("--verify", action="store_true", help="write nothing; fail unless the files on disk are a fresh render with the judgment embedded")
    args = ap.parse_args()
    P = lambda part: paths.research(args.date, part)  # noqa: E731
    regime = read(P("macro") / "regime.json")
    themes = read(P("themes") / "themes.json")
    xs = read(P("sentiment") / "x-sentiment.json")
    if not (regime and themes and xs):
        raise SystemExit("need regime.json, themes.json and x-sentiment.json for the date: run the three skills first")
    tnarr = {t["id"]: t for t in (read(P("themes") / "theme-narrative.json") or {}).get("themes", [])}
    sread = read(P("sentiment") / "sentiment-read.json") or {}
    sread_t = {t["id"]: t for t in sread.get("themes", [])}
    judgment = read(P("outlook") / "judgment.json")

    reg = regime["regime"]
    narrative = regime.get("narrative", {})
    call = narrative.get("judgment", {}).get("regime_call") or reg["label"]
    base_label = next((k for k in EXPOSURE if call.startswith(k)), reg["label"] if reg["label"] in EXPOSURE else "Neutral / mixed")
    xs_t = {t["id"]: t for t in xs["themes"]}

    rows = []
    for t in themes["themes"]:
        if t.get("status") != "ok":
            continue
        s = xs_t.get(t["id"], {})
        labels = s.get("labels", [])
        price = t["price_score"]
        macro = t.get("macro_fit")
        if macro is None:
            macro = (regime["archetypes"].get(t["archetype"]) or {}).get("fit") or 0.0
        adj = sentiment_adj(price, t["direction"], labels)
        score = round(0.45 * price + 0.35 * macro + 0.20 * adj, 2)
        flags = []
        if price >= 1 and macro <= -1:
            flags.append("price fights macro: leadership that needs the regime to change; size small, trail stops")
        if ("heating" in labels or "crowded" in labels) and price <= -1:
            flags.append("crowd against tape: the allowlist is louder than the price action")
        if "crowded" in labels and t["direction"].startswith("fading"):
            flags.append("distribution risk: crowded and fading")
        if t["direction"] == "improving" and "heating" not in labels and "crowded" not in labels:
            flags.append("quiet improvement: price turning before the crowd")
        if (t.get("breadth_above_50d_pct") or 0) < 40 and price >= 1:
            flags.append("narrow leadership: breadth under 40%")
        rows.append({
            "id": t["id"], "name": t["name"], "group": t["group"], "archetype": t["archetype"],
            "stance": stance(score), "score": score,
            "inputs": {"price_score": price, "macro_fit": macro, "sentiment_adj": adj},
            "price": {"direction": t["direction"], "trend": t["trend"], "rel_spy_1m": t["rel_spy"].get("1m"),
                      "rel_spy_3m": t["rel_spy"].get("3m"), "breadth_50d": t.get("breadth_above_50d_pct"),
                      "dd_52w": t.get("dd_52w_pct"), "leaders_1m": t.get("leaders_1m"), "laggards_1m": t.get("laggards_1m")},
            "sentiment": {"labels": labels, "posts_recent": s.get("posts_recent"), "velocity_rel": s.get("velocity_rel"),
                          "tone": s.get("tone_recent"), "stance": s.get("stance"), "hot_members": s.get("hot_members"),
                          "read": (sread_t.get(t["id"]) or {}).get("read")},
            "narrative": tnarr.get(t["id"]),
            "flags": flags,
        })
    rows.sort(key=lambda x: -x["score"])

    doc = {
        "schema": "market-outlook/1", "as_of": args.date,
        "inputs": {"regime_as_of": regime["as_of"], "themes_as_of": themes["as_of"],
                   "corpus_last_day": xs["corpus_last_day"], "corpus_stale_days": xs["corpus_stale_days"],
                   "judgment_files": {"macro_narrative": bool(narrative), "theme_narrative": bool(tnarr),
                                      "sentiment_read": bool(sread), "outlook_judgment": bool(judgment)}},
        "regime": {"mechanical": reg["label"], "composite": reg["composite"], "call": call,
                   "quadrant": reg["quadrant"]["name"], "duration": reg["duration_regime"],
                   "flags": [f["id"] for f in reg["flags"]], "divergence": reg.get("divergence")},
        "risk_budget": {"gross_exposure_pct": EXPOSURE[base_label],
                        "long_duration_cap_pct": LONG_DURATION_CAP.get(reg["duration_regime"], 25),
                        "basis": f"mandate medium-low risk; regime call '{call}'; duration {reg['duration_regime']}",
                        "hedges": regime["tilts"].get("overlays", [])},
        "tilts": regime["tilts"],
        "archetypes": {k: {"fit": v["fit"], "stance": v["stance"], "runway_macro_fit_pts": v["runway_macro_fit_pts"]}
                       for k, v in regime["archetypes"].items()},
        "benchmarks": themes["benchmarks"], "concentration": themes.get("concentration"),
        "themes": rows,
        "watchlist": [{"theme": x["name"], "flag": f} for x in rows for f in x["flags"]],
        "hot_symbols": [{"symbol": s["symbol"], "posts_recent": s["posts_recent"], "velocity_rel": s["velocity_rel"],
                         "tone": s["tone_recent"], "labels": s["labels"], "stance": s.get("stance")} for s in xs["symbols"][:20]],
        "events": narrative.get("events", []), "risks": narrative.get("risks", []),
        "judgment": judgment,
    }
    out = P("outlook")
    files = {"outlook.json": json.dumps(doc, indent=1), "outlook.md": render(doc)}
    if args.verify:
        verify(out, files, judgment)
        return
    out.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (out / name).write_text(text)
    print(f"outlook {args.date}: {call}, gross {doc['risk_budget']['gross_exposure_pct']}%, "
          f"{sum(1 for x in rows if x['stance'] == 'Overweight')} overweight / {sum(1 for x in rows if x['stance'] == 'Avoid')} avoid themes")


JUDGMENT_PARTS = (("summary", "The read"), ("top_calls", "Top calls"), ("risks", "Risks"), ("what_changes", "What changes the call"))


def verify(out: Path, files: dict[str, str], judgment: dict | None) -> None:
    problems = []
    if not judgment:
        problems.append(f"{out / 'judgment.json'} is missing: write it (summary, top_calls, risks, what_changes), then rerun build_outlook.py")
    else:
        problems += [f"judgment.json has no {key} (the '{title}' part of the outlook)" for key, title in JUDGMENT_PARTS if not judgment.get(key)]
    for name, text in files.items():
        path = out / name
        if not path.exists():
            problems.append(f"{path} is missing: run build_outlook.py")
        elif path.read_text() != text:
            problems.append(f"{path} is not a fresh render (hand-edited, or an input or judgment.json changed after it ran): rerun build_outlook.py")
    if problems:
        raise SystemExit("outlook format check failed:\n" + "\n".join(f"- {p}" for p in problems))
    print(f"outlook {out.parent.name}: verified, the files are a fresh render with the judgment embedded")


def f(x, spec="+.1f"):
    return "n/a" if x is None else format(x, spec)


def render(d: dict) -> str:
    g, L = d["regime"], []
    L.append(f"# Market outlook, {d['as_of']}\n")
    L.append(f"**{g['call']}** (composite {g['composite']:+.1f}, mechanical {g['mechanical']}) · quadrant {g['quadrant']} · duration {g['duration']} · flags: {', '.join(g['flags']) or 'none'}\n")
    rb = d["risk_budget"]
    L.append(f"Risk budget: gross **{rb['gross_exposure_pct']}%**, long-duration growth capped at **{rb['long_duration_cap_pct']}%** of the book ({rb['basis']}).\n")
    i = d["inputs"]
    L.append(f"Inputs: regime {i['regime_as_of']}, prices {i['themes_as_of']}, X corpus through {i['corpus_last_day']} ({i['corpus_stale_days']}d stale).\n")
    j = d.get("judgment")
    if j:
        L.append("## The read\n")
        L.append((j.get("summary") or "") + "\n")
        for title, key in (("Top calls", "top_calls"), ("Risks", "risks"), ("What changes the call", "what_changes")):
            if j.get(key):
                L.append(f"**{title}**\n")
                L += [f"- {x}" for x in j[key]]
                L.append("")
    L.append("## Theme stances\n\n| Stance | Score | Theme | Price (dir · vs SPY 3m · breadth) | Macro fit | X (labels · posts · tone) | Flags |\n|---|---:|---|---|---:|---|---|")
    for x in d["themes"]:
        p, s = x["price"], x["sentiment"]
        L.append(f"| **{x['stance']}** | {x['score']:+.2f} | {x['name']} | {p['direction']} · {f(p['rel_spy_3m'])} · {f(p['breadth_50d'], '.0f')}% | {f(x['inputs']['macro_fit'])} | {', '.join(s['labels']) or '-'} · {s['posts_recent'] or 0} · {f(s['tone'], '+.2f')} | {'; '.join(x['flags']) or '-'} |")
    L.append("\n## Archetype fit\n\n| Archetype | Fit | Stance | Runway pts |\n|---|---:|---|---:|")
    for k, v in d["archetypes"].items():
        L.append(f"| {k} | {f(v['fit'])} | {v['stance']} | {v['runway_macro_fit_pts']} |")
    t = d["tilts"]
    L.append(f"\n## Tilts\n\n- Overweight: {', '.join(t['overweight'])}\n- Underweight: {', '.join(t['underweight'])}\n- Duration: {t['duration']}")
    L += [f"- Overlay: {o}" for o in t.get("overlays", [])]
    if d["events"]:
        L.append("\n## Dated events\n\n| Date | Event | Why |\n|---|---|---|")
        L += [f"| {e['date']} | {e['event']} | {e.get('why_it_matters', '')} |" for e in d["events"]]
    L.append("\n## Allowlist attention (top 20 symbols)\n\n| Symbol | Posts 7d | Velocity vs corpus | Tone | Labels | Picks L/S |\n|---|---:|---:|---:|---|---|")
    for s in d["hot_symbols"]:
        st = s.get("stance") or {}
        L.append(f"| {s['symbol']} | {s['posts_recent']} | {f(s['velocity_rel'], '.2f')} | {f(s['tone'], '+.2f')} | {', '.join(s['labels']) or '-'} | {st.get('longs', 0)}/{st.get('shorts', 0)} |")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    main()
