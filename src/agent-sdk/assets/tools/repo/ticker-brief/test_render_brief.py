"""Tests for the ticker-brief template: validation, deterministic rendering, the index, and the guard.

    cd src/agent-sdk/assets/tools/repo/ticker-brief && python3 -m unittest test_render_brief -v
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

DATA = Path(tempfile.mkdtemp(prefix="invest-brief-")) / "data"  # named like the real tree, which the citations use
DATA.mkdir()
os.environ["INVEST_DATA_DIR"] = str(DATA)  # before paths.py is imported

import brief_guard as guard  # noqa: E402
import render_brief as rb  # noqa: E402

HERE = Path(__file__).resolve().parent
DAY = "2026-09-30"
POST = "2102909099054944558"


def context(ticker="META", themes=(("mag7", "Magnificent 7", "Accumulate", 0.96),), evidence=True):
    return {
        "schema": "ticker-context/1", "ticker": ticker, "as_of": DAY,
        "inputs": {"themes": DAY, "outlook": "2026-09-24", "regime": DAY, "x_sentiment": "2026-09-24", "corpus_last_day": "2026-09-25", "corpus_stale_days": 5},
        "macro": {"as_of": DAY, "call": "Lean risk-off: a hostile discount rate", "label": "Lean risk-off", "composite": -7.8, "duration": "hostile"},
        "regime": {"as_of": "2026-09-24", "call": "Lean risk-off", "gross_exposure_pct": 60, "long_duration_cap_pct": 15},
        "archetype": "quality_megacap" if themes else None,
        "macro_fit": {"fit": 0.09, "stance": "neutral", "runway_macro_fit_pts": 5, "headwinds": ["R_10Y_1M"], "tailwinds": ["E_TREND"]} if themes else None,
        "themes": [{"id": i, "name": n, "archetype": "quality_megacap", "direction": "accelerating", "rel_spy_3m": 8.9, "trend": "uptrend",
                    "breadth_50d": 71.0, "stance": s, "stance_score": sc, "flags": []} for i, n, s, sc in themes],
        "price": {"close": 738.79, "as_of": "2026-09-29", "ret_1m": 27.9, "ret_3m": 31.3, "ret_12m": -0.3, "above_50d": True, "above_200d": True,
                  "dd_52w_pct": -5.0, "source": f"https://finance.yahoo.com/quote/{ticker}"},
        "sentiment": {"symbol": ticker, "posts_recent": 65, "accounts_recent": 7, "velocity_rel": 2.51, "tone_recent": 0.15,
                      "stance": {"longs": 5, "shorts": 1}, "evidence": [{"post_id": POST, "author": "acct", "day": "2026-09-24", "likes": 10, "text": "a post"}] if evidence else []},
        "runway_score": {"probe": "2026-09-24", "tier": "no_runway", "total": 37, "gates_failed": ["upside"]},
        "verdicts": [], "gaps": [],
    }


def judgment(ticker="META", **over):
    doc = {"schema": rb.SCHEMA, "ticker": ticker, "as_of": DAY, "verdict": "Accumulate on weakness", "horizon": "1-3 months",
           "answer": "Add on a pullback toward the 50-day average. The basket leads and the fit is neutral.", "departure": None,
           "why": {"macro_fit": "Neutral fit.", "theme_price": "Leads its basket.", "allowlist": f"Heating, see post {POST}.", "record": "No runway."},
           "changes": [{"date": "2026-10-29", "tell": "Q3 results."}, {"date": "2026-10-07", "tell": "The 10-year auction."}], "gaps": []}
    doc.update(over)
    return doc


def seed(ticker="META", ctx=None, j=None):
    folder = DATA / "research" / DAY / "tickers"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{ticker}.json").write_text(json.dumps(ctx or context(ticker)))
    if j is not None:
        (folder / f"{ticker}.judgment.json").write_text(json.dumps(j))


class Validate(unittest.TestCase):
    def test_a_good_judgment_has_no_errors(self):
        self.assertEqual(rb.validate(judgment(), context()), [])

    def test_enums_formats_and_counts(self):
        errors = "\n".join(rb.validate(judgment(verdict="Buy", horizon="1–3m", changes=[{"date": "soon", "tell": "x"}], extra=1), context()))
        for fragment in ("verdict must be one of", "horizon must read like", "changes must list 2 or 3", "unknown keys ['extra']"):
            self.assertIn(fragment, errors)

    def test_a_departure_from_the_mechanical_lean_needs_a_reason(self):
        self.assertIn("departure is required", "\n".join(rb.validate(judgment(verdict="Hold"), context())))
        self.assertEqual(rb.validate(judgment(verdict="Hold", departure="The stance is a week old and the stock ran past the scored price."), context()), [])

    def test_add_in_a_risk_off_regime_needs_a_reason(self):
        ctx = context(themes=(("cyber", "Cybersecurity", "Overweight", 1.2),))
        self.assertIn("the regime is risk-off", "\n".join(rb.validate(judgment(verdict="Add"), ctx)))

    def test_no_basket_means_no_lean(self):
        self.assertEqual(rb.lean(context(themes=())), (None, "no theme basket with an outlook stance"))
        self.assertEqual(rb.validate(judgment(verdict="Avoid"), context(themes=())), [])

    def test_the_allowlist_cites_a_post_id_when_the_context_has_posts(self):
        bad = judgment(why={**judgment()["why"], "allowlist": "Heating."})
        self.assertIn("must cite a post_id", "\n".join(rb.validate(bad, context())))
        self.assertEqual(rb.validate(bad, context(evidence=False)), [])

    def test_prose_is_one_plain_paragraph_and_never_repeats_the_verdict(self):
        errors = "\n".join(rb.validate(judgment(answer="Accumulate on weakness: buy dips.\n\n## More"), context()))
        self.assertIn("one paragraph", errors)
        self.assertIn("must not open with the verdict", "\n".join(rb.validate(judgment(answer="Accumulate on weakness because it leads."), context())))
        self.assertIn("plain prose only", "\n".join(rb.validate(judgment(why={**judgment()["why"], "record": "- a list"}), context())))

    def test_ticker_date_and_stale_tells_are_checked(self):
        errors = "\n".join(rb.validate(judgment(ticker="AMZN", as_of="2026-09-29", changes=[{"date": "2026-09-01", "tell": "x"}, {"date": "2026-10-01", "tell": "y"}]), context()))
        for fragment in ("ticker must be 'META'", "as_of must be '2026-09-30'", "is before the brief's date"):
            self.assertIn(fragment, errors)


class Render(unittest.TestCase):
    def test_same_inputs_same_bytes_and_a_fixed_shape(self):
        ctx, j = context(), judgment()
        first, second = rb.render_one(ctx, j), rb.render_one(json.loads(json.dumps(ctx)), json.loads(json.dumps(j)))
        self.assertEqual(first, second)
        lines = first.split("\n")
        self.assertEqual(lines[0], "# META ticker brief, 2026-09-30")
        self.assertTrue(lines[1].startswith("As of: macro 2026-09-30 · themes 2026-09-30 · outlook 2026-09-24 (6d stale) · prices 2026-09-29 (1d stale) · X corpus through 2026-09-25 (5d stale)"))
        self.assertTrue(lines[2].startswith("Regime: Lean risk-off: a hostile discount rate (composite -7.8, duration hostile) · risk budget 60% gross"))
        headings = [line for line in lines if line.startswith("#")]
        self.assertEqual(headings, ["# META ticker brief, 2026-09-30", "## Answer", "## Why", "### Evidence (`data/research/2026-09-30/tickers/META.json`)", "## What would change it", "## Gaps and stale inputs"])
        self.assertIn("**Accumulate on weakness, 1-3 months.** Add on a pullback", first)
        # Tells are sorted by date, whatever order the judgment gave them.
        self.assertLess(first.index("2026-10-07"), first.index("2026-10-29"))

    def test_a_departure_is_labelled_with_the_lean_it_departs_from(self):
        text = rb.render_one(context(), judgment(verdict="Hold", departure="Stale stance."))
        self.assertIn("> Departs from the mechanical lean (Accumulate on weakness; Magnificent 7: Accumulate): Stale stance.", text)

    def test_the_cli_renders_checks_verifies_and_upserts_the_index(self):
        seed("META", j=judgment())
        seed("AMZN", context("AMZN"), judgment("AMZN"))
        script = [sys.executable, str(HERE / "render_brief.py"), "META", "AMZN", "--date", DAY]
        env = {**os.environ, "INVEST_DATA_DIR": str(DATA)}
        self.assertEqual(subprocess.run(script, env=env, capture_output=True).returncode, 0)
        reports = DATA / "reports"
        self.assertEqual(sorted(p.name for p in reports.iterdir()), ["2026-09-30-amzn.md", "2026-09-30-meta-amzn.md", "2026-09-30-meta.md", "INDEX.md"])
        self.assertTrue((reports / "2026-09-30-meta-amzn.md").read_text().startswith("# Ticker briefs: META, AMZN, 2026-09-30\n"))
        index_once = (reports / "INDEX.md").read_text()
        self.assertEqual(subprocess.run(script, env=env, capture_output=True).returncode, 0)
        self.assertEqual((reports / "INDEX.md").read_text(), index_once, "a rerun replaces its index lines in place")
        self.assertEqual(index_once.count("](2026-09-30-meta.md)"), 1)
        self.assertEqual(subprocess.run(script + ["--verify"], env=env, capture_output=True).returncode, 0)
        (reports / "2026-09-30-meta.md").write_text((reports / "2026-09-30-meta.md").read_text() + "hand edit\n")
        self.assertEqual(subprocess.run(script + ["--verify"], env=env, capture_output=True).returncode, 1)
        seed("META", j=judgment(verdict="Buy"))
        failed = subprocess.run(script + ["--check"], env=env, capture_output=True, text=True)
        self.assertEqual(failed.returncode, 1)
        self.assertIn("META: verdict must be one of", failed.stderr)


class Guard(unittest.TestCase):
    def decide(self, tool, **tool_input):
        out = guard.decide({"hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": tool_input, "cwd": str(DATA.parent)})
        return out["hookSpecificOutput"]["permissionDecisionReason"] if out else None

    def setUp(self):
        seed("META")

    def path(self, rel):
        return str(DATA / rel)

    def test_reports_and_context_have_one_writer(self):
        self.assertIn("is a ticker brief", self.decide("Write", file_path=self.path(f"reports/{DAY}-meta.md"), content="# anything"))
        self.assertIn("is a ticker brief", self.decide("Write", file_path=self.path(f"reports/{DAY}-meta-notes.md"), content="# META ticker brief, 2026-09-30"))
        self.assertIsNone(self.decide("Write", file_path=self.path(f"reports/{DAY}-meta-capex.md"), content="# META capex, 2026-09-30"))
        self.assertIn("mechanical evidence", self.decide("Edit", file_path=self.path(f"research/{DAY}/tickers/META.json"), old_string="a", new_string="b"))

    def test_the_judgment_is_validated_before_it_lands(self):
        self.assertIsNone(self.decide("Write", file_path=self.path(f"research/{DAY}/tickers/META.judgment.json"), content=json.dumps(judgment())))
        self.assertIn("verdict must be one of", self.decide("Write", file_path=self.path(f"research/{DAY}/tickers/META.judgment.json"), content=json.dumps(judgment(verdict="Buy"))))
        self.assertIn("not valid JSON", self.decide("Write", file_path=self.path(f"research/{DAY}/tickers/META.judgment.json"), content="{"))
        self.assertIn("no context for TSLA", self.decide("Write", file_path=self.path(f"research/{DAY}/tickers/TSLA.judgment.json"), content="{}"))
        seed("META", j=judgment())
        self.assertIn("departure is required", self.decide("Edit", file_path=self.path(f"research/{DAY}/tickers/META.judgment.json"),
                                                           old_string='"verdict": "Accumulate on weakness"', new_string='"verdict": "Hold"'))

    def test_shell_writes_are_refused_and_reads_are_not(self):
        self.assertIn("may not write ticker research", self.decide("Bash", command=f"echo x > data/reports/{DAY}-meta.md"))
        self.assertIn("may not write ticker research", self.decide("Bash", command=f"python3 render_brief.py META; cp /tmp/a data/research/{DAY}/tickers/META.json"))
        self.assertIsNone(self.decide("Bash", command=f"grep -n Answer data/reports/{DAY}-meta.md > /tmp/out 2>&1"))
        # An in-place write elsewhere in the command does not make a read of a brief into a write.
        self.assertIsNone(self.decide("Bash", command=f"python3 - <<'EOF'\nopen(p,'w').write(s)\nEOF\ngrep -n Evidence data/reports/{DAY}-meta.md"))
        self.assertIn("may not write ticker research", self.decide("Bash", command=f"sed -i 's/Hold/Add/' data/reports/{DAY}-meta.md"))
        self.assertIsNone(self.decide("Bash", command=f"python3 src/agent-sdk/assets/tools/repo/ticker-brief/render_brief.py META --date {DAY}"))

    def test_index_lines_for_briefs_come_only_from_the_renderer(self):
        self.assertIn("never by hand", self.decide("Edit", file_path=self.path("reports/INDEX.md"), old_string="x", new_string="- d [META ticker brief](f.md) — Add"))
        self.assertIsNone(self.decide("Edit", file_path=self.path("reports/INDEX.md"), old_string="x", new_string="- d [Macro regime](f.md) — risk-off"))

    def test_the_cli_speaks_the_hook_protocol(self):
        event = {"hook_event_name": "PreToolUse", "tool_name": "Write", "cwd": str(DATA.parent), "tool_input": {"file_path": self.path(f"reports/{DAY}-meta.md"), "content": "x"}}
        out = subprocess.run([sys.executable, str(HERE / "brief_guard.py")], input=json.dumps(event), capture_output=True, text=True, env={**os.environ, "INVEST_DATA_DIR": str(DATA)})
        self.assertEqual(out.returncode, 0)
        self.assertEqual(json.loads(out.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")
        quiet = subprocess.run([sys.executable, str(HERE / "brief_guard.py")], input=json.dumps({**event, "tool_name": "Read"}), capture_output=True, text=True)
        self.assertEqual((quiet.returncode, quiet.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
