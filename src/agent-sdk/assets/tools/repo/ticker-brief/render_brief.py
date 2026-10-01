#!/usr/bin/env python3
"""Render ticker briefs from their two files, so the title, header and layout never vary.

    python3 src/agent-sdk/assets/tools/repo/ticker-brief/render_brief.py META [AMZN ...] [--date YYYY-MM-DD] [--check | --verify]

Inputs, per ticker, under data/research/<DATE>/tickers/:
  <TICKER>.json            the mechanical context (ticker_context.py); every number comes from here
  <TICKER>.judgment.json   the agent's judgment (schema ticker-judgment/1, below); only prose and the verdict

Outputs:
  data/reports/<DATE>-<ticker>.md                 one brief per ticker
  data/reports/<DATE>-<t1>-<t2>-....md            a joint brief when more than one ticker is given, in the order given
  data/reports/INDEX.md                           one line per brief, replaced in place on a rerun

Same inputs, same bytes: nothing here reads the clock, the network or the environment beyond paths.py.
--check validates the judgment files and writes nothing. --verify re-renders in memory and fails if the
files on disk differ (a hand edit after rendering).

ticker-judgment/1:
  {"schema": "ticker-judgment/1", "ticker": "META", "as_of": "2026-09-30",
   "verdict": "Add" | "Accumulate on weakness" | "Hold" | "Trim" | "Avoid",
   "horizon": "1-3 months",                     # <n>[-<m>] weeks|months|years
   "answer": "2 to 4 sentences, one paragraph",
   "departure": null | "why the verdict differs from the mechanical lean",
   "why": {"macro_fit": "...", "theme_price": "...", "allowlist": "... post 2102... ...", "record": "..."},
   "changes": [{"date": "YYYY-MM-DD", "tell": "..."}, ...],   # 2 or 3, dated on or after as_of
   "gaps": ["judged or missing inputs, optional"]}
"""
from __future__ import annotations

import argparse
from datetime import date as Date
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import paths  # noqa: E402

SCHEMA = "ticker-judgment/1"
VERDICTS = ("Add", "Accumulate on weakness", "Hold", "Trim", "Avoid")
# The outlook's theme stance maps to the verdict a name in that basket leans to before judgment.
LEAN = {"Overweight": "Add", "Accumulate": "Accumulate on weakness", "Neutral": "Hold", "Underweight": "Trim", "Avoid": "Avoid"}
WHY = (("macro_fit", "Macro fit"), ("theme_price", "Theme and price"), ("allowlist", "Allowlist"), ("record", "Record"))
TICKER = re.compile(r"^[A-Z][A-Z0-9.]{0,9}$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HORIZON = re.compile(r"^\d+(?:-\d+)? (?:weeks|months|years)$")
POST_ID = re.compile(r"\b\d{15,20}\b")
LIMITS = {"answer": 900, "departure": 500, "why": 900, "tell": 300, "gap": 300}


# ---------------------------------------------------------------- files
def context_path(ticker: str, day: str) -> Path:
    return paths.research(day, "tickers") / f"{ticker}.json"


def judgment_path(ticker: str, day: str) -> Path:
    return paths.research(day, "tickers") / f"{ticker}.judgment.json"


def report_name(tickers: list[str], day: str) -> str:
    return f"{day}-{'-'.join(t.lower() for t in tickers)}.md"


def shown(path: Path) -> str:
    """A path as the reports cite it: under the data directory's own name, wherever it lives, so the bytes never
    depend on the machine (INVEST_DATA_DIR moves the tree, not the citation)."""
    try:
        return (Path(paths.DATA.name) / path.relative_to(paths.DATA)).as_posix()
    except ValueError:
        return path.as_posix()


def load(path: Path) -> dict:
    return json.loads(path.read_text())


# ---------------------------------------------------------------- the mechanical lean
def lean(ctx: dict) -> tuple[str | None, str]:
    """The verdict the theme stances imply, and where it came from. The basket with the highest stance score decides."""
    themes = [t for t in ctx.get("themes") or [] if t.get("stance") in LEAN]
    if not themes:
        return None, "no theme basket with an outlook stance"
    best = max(themes, key=lambda t: (t.get("stance_score") is not None, t.get("stance_score") or 0))
    return LEAN[best["stance"]], f"{best['name']}: {best['stance']}"


def risk_off(ctx: dict) -> bool:
    label = ((ctx.get("macro") or {}).get("label") or (ctx.get("regime") or {}).get("call") or "").lower()
    return "risk-off" in label


# ---------------------------------------------------------------- validation
def one_paragraph(value: object, field: str, limit: int, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{field}: a non-empty string is required")
    elif "\n" in value.strip():
        errors.append(f"{field}: one paragraph, no line breaks (the template owns the layout)")
    elif value.lstrip().startswith(("#", "|", ">", "-", "*")):
        errors.append(f"{field}: plain prose only, no markdown headings, tables, quotes or lists")
    elif len(value) > limit:
        errors.append(f"{field}: {len(value)} characters; the limit is {limit}")


def validate(judgment: object, ctx: dict) -> list[str]:
    """Every rule a judgment must meet before it can be rendered. An empty list means it renders."""
    errors: list[str] = []
    if not isinstance(judgment, dict):
        return ["the judgment must be a JSON object"]
    allowed = {"schema", "ticker", "as_of", "verdict", "horizon", "answer", "departure", "why", "changes", "gaps"}
    extra = sorted(set(judgment) - allowed)
    if extra:
        errors.append(f"unknown keys {extra}; allowed: {sorted(allowed)}")
    if judgment.get("schema") != SCHEMA:
        errors.append(f"schema must be {SCHEMA!r}")
    if judgment.get("ticker") != ctx["ticker"]:
        errors.append(f"ticker must be {ctx['ticker']!r}, the context's ticker")
    if judgment.get("as_of") != ctx["as_of"]:
        errors.append(f"as_of must be {ctx['as_of']!r}, the context's date")
    verdict = judgment.get("verdict")
    if verdict not in VERDICTS:
        errors.append(f"verdict must be one of {list(VERDICTS)}")
    if not isinstance(judgment.get("horizon"), str) or not HORIZON.match(judgment["horizon"]):
        errors.append("horizon must read like '6 months' or '1-3 years' (ASCII hyphen; weeks, months or years)")
    one_paragraph(judgment.get("answer"), "answer", LIMITS["answer"], errors)
    answer = judgment.get("answer")
    if isinstance(answer, str) and verdict in VERDICTS and re.match(rf"\W*{re.escape(verdict)}\b", answer, re.I):
        errors.append("answer must not open with the verdict: the template prints '**<verdict>, <horizon>.**' before it; start with the action or the reason")

    implied, source = lean(ctx)
    departs = []
    if implied and verdict in VERDICTS and verdict != implied:
        departs.append(f"the theme stance implies {implied!r} ({source})")
    if verdict == "Add" and risk_off(ctx):
        departs.append("the regime is risk-off")
    departure = judgment.get("departure")
    if departs and not departure:
        errors.append(f"departure is required: the verdict {verdict!r} departs from the mechanical result because {' and '.join(departs)}; give the reason")
    if departure is not None:
        one_paragraph(departure, "departure", LIMITS["departure"], errors)

    why = judgment.get("why")
    if not isinstance(why, dict) or sorted(why) != sorted(k for k, _ in WHY):
        errors.append(f"why must have exactly the keys {[k for k, _ in WHY]}")
    else:
        for key, _ in WHY:
            one_paragraph(why[key], f"why.{key}", LIMITS["why"], errors)
        evidence = [p["post_id"] for p in ((ctx.get("sentiment") or {}).get("evidence") or [])]
        if evidence and isinstance(why.get("allowlist"), str) and not POST_ID.search(why["allowlist"]):
            errors.append(f"why.allowlist must cite a post_id from the context, e.g. {evidence[0]}")

    changes = judgment.get("changes")
    if not isinstance(changes, list) or not 2 <= len(changes) <= 3:
        errors.append("changes must list 2 or 3 dated tells")
    else:
        for n, change in enumerate(changes):
            if not isinstance(change, dict) or sorted(change) != ["date", "tell"]:
                errors.append(f"changes[{n}] must be {{date, tell}}")
                continue
            if not isinstance(change["date"], str) or not DAY.match(change["date"]):
                errors.append(f"changes[{n}].date must be YYYY-MM-DD (take it from the events calendar)")
            elif change["date"] < ctx["as_of"]:
                errors.append(f"changes[{n}].date {change['date']} is before the brief's date {ctx['as_of']}")
            one_paragraph(change["tell"], f"changes[{n}].tell", LIMITS["tell"], errors)

    gaps = judgment.get("gaps", [])
    if not isinstance(gaps, list):
        errors.append("gaps must be a list of strings")
    else:
        for n, gap in enumerate(gaps):
            one_paragraph(gap, f"gaps[{n}]", LIMITS["gap"], errors)
    return errors


# ---------------------------------------------------------------- formatting
def pct(value: object) -> str:
    return f"{value:+.1f}%" if isinstance(value, (int, float)) else "not found"


def signed(value: object, digits: int = 2) -> str:
    return f"{value:+.{digits}f}" if isinstance(value, (int, float)) else "not found"


def days_between(earlier: str | None, later: str) -> int | None:
    if not earlier or not DAY.match(earlier):
        return None
    return (Date.fromisoformat(later) - Date.fromisoformat(earlier)).days


def dated(label: str, day: str | None, as_of: str) -> str:
    if not day:
        return f"{label} not found"
    lag = days_between(day, as_of)
    return f"{label} {day}" + (f" ({lag}d stale)" if lag and lag > 0 else "")


def cell(text: object) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def first_sentence(text: str) -> str:
    match = re.match(r"(.+?[.!?])(\s|$)", text.strip())
    return (match.group(1) if match else text.strip()).rstrip(".")


def as_of_line(ctx: dict) -> str:
    d, inputs = ctx["as_of"], ctx.get("inputs") or {}
    probe = (ctx.get("runway_score") or {}).get("probe")
    return " · ".join([
        dated("macro", (ctx.get("macro") or {}).get("as_of") or inputs.get("regime"), d),
        dated("themes", inputs.get("themes"), d),
        dated("outlook", inputs.get("outlook"), d),
        dated("prices", (ctx.get("price") or {}).get("as_of"), d),
        dated("X corpus through", inputs.get("corpus_last_day"), d),
        f"runway probe {probe}" if probe else "runway probe none",
    ])


def regime_line(ctx: dict) -> str:
    macro, budget = ctx.get("macro") or {}, ctx.get("regime") or {}
    call = macro.get("call") or budget.get("call") or "not found"
    detail = ", ".join(x for x in (f"composite {macro['composite']}" if "composite" in macro else "", f"duration {macro['duration']}" if macro.get("duration") else "") if x)
    budget_text = (f"risk budget {budget['gross_exposure_pct']}% gross, long-duration cap {budget['long_duration_cap_pct']}% (outlook {budget.get('as_of') or (ctx.get('inputs') or {}).get('outlook')})"
                   if budget else "risk budget not found")
    return f"Regime: {call}" + (f" ({detail})" if detail else "") + f" · {budget_text}"


def stale_gaps(ctx: dict) -> list[str]:
    d, inputs, out = ctx["as_of"], ctx.get("inputs") or {}, []
    for label, day in (("outlook (risk budget and theme stances)", inputs.get("outlook")), ("X sentiment", inputs.get("x_sentiment")),
                       ("X corpus", inputs.get("corpus_last_day")), ("themes", inputs.get("themes"))):
        lag = days_between(day, d)
        if day is None:
            out.append(f"{label}: not found")
        elif lag and lag > 0:
            out.append(f"{label} from {day}, {lag}d before this brief")
    return out


# ---------------------------------------------------------------- rendering
def render_one(ctx: dict, j: dict) -> str:
    T, d = ctx["ticker"], ctx["as_of"]
    implied, source = lean(ctx)
    lines = [f"# {T} ticker brief, {d}", f"As of: {as_of_line(ctx)}", regime_line(ctx), "",
             "## Answer", f"**{j['verdict']}, {j['horizon']}.** {j['answer'].strip()}", ""]
    if j.get("departure"):
        lines += [f"> Departs from the mechanical lean ({implied or 'none'}; {source}): {j['departure'].strip()}", ""]
    lines += ["## Why"] + [f"- **{label}.** {j['why'][key].strip()}" for key, label in WHY] + [""]

    fit, price, s, score = ctx.get("macro_fit") or {}, ctx.get("price") or {}, ctx.get("sentiment") or {}, ctx.get("runway_score")
    stance = s.get("stance") or {}
    rows = [
        ("Mechanical lean", f"{implied} ({source})" if implied else source),
        ("Archetype and fit", f"{ctx.get('archetype')}: {signed(fit.get('fit'))} ({fit.get('stance')})" if fit else "not in a basket: no archetype fit"),
        ("Tailwinds / headwinds", f"{', '.join(fit.get('tailwinds') or []) or 'none'} / {', '.join(fit.get('headwinds') or []) or 'none'}" if fit else "not found"),
        ("Close", f"${price['close']:.2f} on {price['as_of']} ([source]({price['source']}))" if price.get("close") is not None else "not found"),
        ("Return 1m / 3m / 12m", f"{pct(price.get('ret_1m'))} / {pct(price.get('ret_3m'))} / {pct(price.get('ret_12m'))}" if price else "not found"),
        ("From 52-week high", pct(price.get("dd_52w_pct")) if price else "not found"),
        ("Trend", f"{'above' if price.get('above_50d') else 'below'} 50d · {'above' if price.get('above_200d') else 'below'} 200d" if price else "not found"),
        ("Allowlist", (f"{s.get('posts_recent', 0)} posts from {s.get('accounts_recent', 0)} accounts, velocity {s.get('velocity_rel')}x the corpus pace, "
                       f"tone {signed(s.get('tone_recent'))}, {stance.get('longs', 0)} long / {stance.get('shorts', 0)} short") if s else "no allowlist posts in the window"),
        ("Runway", (f"probe {score['probe']}: {score.get('tier')}, {score.get('total')}/100, gates failed: {', '.join(score.get('gates_failed') or []) or 'none'}") if score else "never scored"),
    ]
    for v in ctx.get("verdicts") or []:
        kill = v.get("kill") or {}
        rows.append(("Registered verdict", f"probe {v.get('probe')}: {v.get('tier')}, ${v.get('close')} on {v.get('price_as_of')}, size {v.get('size')}; kill: {kill.get('observation', 'none')} (by {kill.get('by', 'n/a')})"))
    if not ctx.get("verdicts"):
        rows.append(("Registered verdict", "none"))
    lines += [f"### Evidence (`{shown(context_path(T, d))}`)", "", "| Measure | Value |", "|---|---|"]
    lines += [f"| {cell(k)} | {cell(v)} |" for k, v in rows] + [""]
    if ctx.get("themes"):
        lines += ["| Theme | Stance | Direction | vs SPY 3m | Trend | Breadth 50d |", "|---|---|---|---|---|---|"]
        lines += [f"| {cell(t['name'])} | {t.get('stance') or 'none'} | {t.get('direction') or 'not found'} | {pct(t.get('rel_spy_3m'))} | {t.get('trend') or 'not found'} | "
                  f"{(str(round(t['breadth_50d'])) + '%') if isinstance(t.get('breadth_50d'), (int, float)) else 'not found'} |" for t in ctx["themes"]] + [""]
    for post in (s.get("evidence") or [])[:3]:
        lines.append(f"- post {post['post_id']} · @{post['author']} · {post['day']} · {post.get('likes', 0)} likes: \"{' '.join(post['text'].split())}\"")
    if s.get("evidence"):
        lines.append("")

    lines += ["## What would change it"] + [f"- **{c['date']}:** {c['tell'].strip()}" for c in sorted(j["changes"], key=lambda c: (c["date"], c["tell"]))] + [""]
    gaps = stale_gaps(ctx) + list(ctx.get("gaps") or []) + [g.strip() for g in j.get("gaps") or []]
    lines += ["## Gaps and stale inputs"] + [f"- {g}" for g in dict.fromkeys(gaps)] + (["- none"] if not gaps else [])
    return "\n".join(lines).rstrip() + "\n"


def joined(values: list[object]) -> str | None:
    unique = list(dict.fromkeys(str(v) for v in values if v is not None and v != ""))
    return " / ".join(unique) if unique else None


def render_joint(pairs: list[tuple[dict, dict]], day: str) -> str:
    tickers = [ctx["ticker"] for ctx, _ in pairs]
    first = pairs[0][0]
    # The header is the first context's, unless the inputs differ across names: then each differing date is listed.
    merged = {**first, "inputs": {k: joined([(c.get("inputs") or {}).get(k) for c, _ in pairs]) for k in (first.get("inputs") or {})},
              "price": {"as_of": joined([(c.get("price") or {}).get("as_of") for c, _ in pairs])}, "runway_score": None}
    probes = joined([(c.get("runway_score") or {}).get("probe") for c, _ in pairs])
    header = as_of_line(merged).replace("runway probe none", f"runway probe {probes}" if probes else "runway probe none")
    lines = [f"# Ticker briefs: {', '.join(tickers)}, {day}", f"As of: {header}", regime_line(first), "",
             "## Answer", "| Ticker | Verdict | Horizon | Mechanical lean | Runway | Brief |", "|---|---|---|---|---|---|"]
    for ctx, j in pairs:
        score = ctx.get("runway_score")
        runway = f"{score.get('tier')} {score.get('total')}" if score else "never scored"
        lines.append(f"| {ctx['ticker']} | {j['verdict']} | {j['horizon']} | {lean(ctx)[0] or 'none'} | {runway} | [brief]({report_name([ctx['ticker']], day)}) |")
    lines += ["", "## Why"] + [f"- **{ctx['ticker']}: {j['verdict']}, {j['horizon']}.** {j['answer'].strip()}" for ctx, j in pairs] + [""]
    changes = sorted((c["date"], ctx["ticker"], c["tell"].strip()) for ctx, j in pairs for c in j["changes"])
    lines += ["## What would change it"] + [f"- **{d} · {t}:** {tell}" for d, t, tell in changes] + [""]
    gaps: list[str] = []
    for ctx, j in pairs:
        gaps += stale_gaps(ctx)
    gaps = list(dict.fromkeys(gaps))
    for ctx, j in pairs:
        gaps += [f"{ctx['ticker']}: {g}" for g in list(ctx.get("gaps") or []) + [g.strip() for g in j.get("gaps") or []]]
    lines += ["## Gaps and stale inputs"] + [f"- {g}" for g in dict.fromkeys(gaps)] + (["- none"] if not gaps else [])
    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------- the index
def index_line(title: str, name: str, day: str, answer: str) -> str:
    return f"- {day} [{title}]({name}) — {answer}"


def upsert_index(text: str, entries: list[str]) -> str:
    """Replaces the line that links the same file, or appends. Lines are matched on their link target only."""
    lines = text.rstrip("\n").split("\n") if text.strip() else ["# Reports", ""]
    for entry in entries:
        target = re.search(r"\]\(([^)]+)\)", entry).group(1)
        hit = next((n for n, line in enumerate(lines) if re.search(rf"\]\({re.escape(target)}\)", line)), None)
        if hit is None:
            lines.append(entry)
        else:
            lines[hit] = entry
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- CLI
def build(tickers: list[str], day: str) -> tuple[dict[str, str], list[str], list[str]]:
    """Returns ({report file name: content}, index entries, errors) without writing anything."""
    errors: list[str] = []
    pairs: list[tuple[dict, dict]] = []
    for T in tickers:
        cp, jp = context_path(T, day), judgment_path(T, day)
        if not cp.exists():
            errors.append(f"{T}: no context at {shown(cp)}; run ticker_context.py {T} --date {day} first")
            continue
        if not jp.exists():
            errors.append(f"{T}: no judgment at {shown(jp)}; write it (schema {SCHEMA}) first")
            continue
        ctx = load(cp)
        try:
            j = load(jp)
        except json.JSONDecodeError as exc:
            errors.append(f"{T}: the judgment is not valid JSON ({exc})")
            continue
        errors += [f"{T}: {e}" for e in validate(j, ctx)]
        pairs.append((ctx, j))
    if errors:
        return {}, [], errors
    files, entries = {}, []
    for ctx, j in pairs:
        name = report_name([ctx["ticker"]], day)
        files[name] = render_one(ctx, j)
        entries.append(index_line(f"{ctx['ticker']} ticker brief", name, day, f"{j['verdict']}, {j['horizon']}: {first_sentence(j['answer'])}"))
    if len(pairs) > 1:
        name = report_name(tickers, day)
        files[name] = render_joint(pairs, day)
        entries.append(index_line(f"Ticker briefs: {', '.join(tickers)}", name, day, "; ".join(f"{c['ticker']} {j['verdict']} ({j['horizon']})" for c, j in pairs)))
    return files, entries, []


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("tickers", nargs="+")
    ap.add_argument("--date", default=paths.today())
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="validate the judgment files only")
    mode.add_argument("--verify", action="store_true", help="fail if the rendered files on disk differ from a fresh render")
    args = ap.parse_args()
    tickers = list(dict.fromkeys(t.upper().lstrip("$") for t in args.tickers))
    bad = [t for t in tickers if not TICKER.match(t)]
    if bad or not DAY.match(args.date):
        print(f"not a ticker: {bad}" if bad else f"not a date: {args.date}", file=sys.stderr)
        return 2
    files, entries, errors = build(tickers, args.date)
    if errors:
        print("The judgment does not meet the template; fix these and rerun:\n" + "\n".join(f"- {e}" for e in errors), file=sys.stderr)
        return 1
    out = paths.reports()
    if args.check:
        print(f"ok: {', '.join(tickers)} judgments are valid for {args.date}")
        return 0
    if args.verify:
        drift = [name for name, body in files.items() if not (out / name).exists() or (out / name).read_text() != body]
        if drift:
            print(f"differs from a fresh render: {', '.join(drift)}; rerun render_brief.py instead of editing", file=sys.stderr)
            return 1
        print(f"ok: {', '.join(files)} match a fresh render")
        return 0
    out.mkdir(parents=True, exist_ok=True)
    for name, body in files.items():
        (out / name).write_text(body)
    index = out / "INDEX.md"
    index.write_text(upsert_index(index.read_text() if index.exists() else "", entries))
    for name in files:
        print(shown(out / name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
