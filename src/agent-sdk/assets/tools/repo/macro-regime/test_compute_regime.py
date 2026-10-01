"""Tests for the regime engine over a synthetic raw directory.

    cd src/agent-sdk/assets/tools/repo/macro-regime && python3 -m unittest test_compute_regime -v
"""
from datetime import date, timedelta
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import compute_regime as cr

TODAY = date(2026, 9, 24)


def days(n: int, start: float, end: float) -> list[tuple[str, float]]:
    """n daily points ending TODAY, moving linearly from start to end."""
    return [((TODAY - timedelta(days=n - 1 - i)).isoformat(), start + (end - start) * i / (n - 1)) for i in range(n)]


def months(n: int, start: float, end: float) -> list[tuple[str, float]]:
    out, y, m = [], TODAY.year, TODAY.month
    for i in range(n):
        k = n - 1 - i
        mm = (m - 1 - k) % 12 + 1
        yy = y + (m - 1 - k) // 12
        out.append((f"{yy:04d}-{mm:02d}-01", start + (end - start) * i / (n - 1)))
    return out


def write_raw(root: Path, fred: dict, yahoo: dict) -> None:
    (root / "fred").mkdir(parents=True)
    (root / "yahoo").mkdir(parents=True)
    for sid, pts in fred.items():
        (root / "fred" / f"{sid}.csv").write_text("observation_date," + sid + "\n" + "\n".join(f"{d},{v}" for d, v in pts) + "\n")
    for sym, pts in yahoo.items():
        rec = {"symbol": sym, "dates": [d for d, _ in pts], "close": [v for _, v in pts], "adjclose": [v for _, v in pts]}
        (root / "yahoo" / f"{cr.safe_name(sym)}.json").write_text(json.dumps(rec))
    (root / "_fetch_log.json").write_text(json.dumps({"fetched_at": TODAY.isoformat() + "T20:00:00+00:00", "rows": []}))


class SeriesTest(unittest.TestCase):
    def test_at_change_percentile(self):
        s = cr.Series("X", days(400, 1.0, 5.0), "src")
        self.assertAlmostEqual(s.last, 5.0)
        self.assertAlmostEqual(s.change(30), 5.0 - s.ago(30))
        self.assertEqual(s.percentile(1), 100.0)
        self.assertIsNone(s.at("1999-01-01"))

    def test_monthly_transforms(self):
        s = cr.Series("CPI", months(24, 100, 123), "src")
        self.assertAlmostEqual(s.monthly_yoy(), (123 / s.values[-13] - 1) * 100)
        self.assertGreater(s.monthly_ann(3), 0)

    def test_monthly_gap_counts_calendar_months(self):
        # FRED leaves Oct 2025 CPI blank; a row count would reach back 13 months.
        pts = [(d, v) for d, v in months(24, 100, 123) if d != "2025-10-01"]
        s = cr.Series("CPI", pts, "src")
        self.assertAlmostEqual(s.months_ago(12), dict(pts)["2025-09-01"])
        self.assertAlmostEqual(s.monthly_yoy(), (123 / dict(pts)["2025-09-01"] - 1) * 100)

    def test_band(self):
        cuts = [(3.5, 1), (4.5, 0), (5.0, -1)]
        self.assertEqual(cr.band(3.0, cuts, -2), 1)
        self.assertEqual(cr.band(4.9, cuts, -2), -1)
        self.assertEqual(cr.band(5.0, cuts, -2), -2)


class RulesTest(unittest.TestCase):
    def run_one(self, rid, S):
        fn = next(f for i, *_, f in cr.RULES if i == rid)
        return fn(S, None)

    def test_ten_year_jump_is_risk_off(self):
        S = {"DGS10": cr.Series("DGS10", days(120, 4.2, 5.2), "src")}
        self.assertEqual(self.run_one("R_10Y_LEVEL", S)[0], -2)
        self.assertEqual(self.run_one("R_10Y_1M", S)[0], -1)  # +25bp in the last 30 days

    def test_curve_kinds(self):
        S = {"DGS2": cr.Series("DGS2", days(60, 4.0, 4.6), "s"), "DGS10": cr.Series("DGS10", days(60, 4.5, 4.8), "s")}
        sc, read, val, _ = self.run_one("R_CURVE_SHAPE", S)
        self.assertEqual(val["kind"], "bear flattening")
        self.assertEqual(sc, -1)

    def test_vix_backwardation_flags_and_lowers_label(self):
        S = {"^VIX": cr.Series("^VIX", days(60, 20, 32), "s"), "^VIX3M": cr.Series("^VIX3M", days(60, 22, 28), "s")}
        sc = self.run_one("V_TERM", S)[0]
        self.assertEqual(sc, -2)
        flags = cr.stress_flags({"V_TERM": {"score": sc}})
        self.assertEqual([f["id"] for f in flags], ["VIX_BACKWARDATION"])
        self.assertEqual(cr.apply_flags("Neutral / mixed", flags), ("Lean risk-off", 1))

    def test_two_macro_flags_lower_one_notch(self):
        flags = cr.stress_flags({"I_OIL": {"score": -2}, "G_SAHM": {"score": -2}})
        self.assertEqual(cr.apply_flags("Lean risk-on", flags), ("Neutral / mixed", 1))
        self.assertEqual(cr.apply_flags("Risk-off", flags + flags), ("Risk-off", 1))

    def test_missing_input(self):
        rows = cr.run_rules({})
        self.assertTrue(all(r["status"] == "missing" for r in rows))


class RegimeTest(unittest.TestCase):
    def test_composite_and_quadrant(self):
        sig = [{"pillar": p, "score": 1, "id": p} for p in cr.PILLAR_WEIGHTS]
        pillars = cr.score_pillars(sig)
        self.assertEqual(cr.composite(pillars), 50.0)
        self.assertEqual(cr.label_for(50.0), "Risk-on")
        pillars["growth"]["mean"], pillars["inflation"]["mean"] = -1, -1
        self.assertEqual(cr.quadrant(pillars)["name"], "Stagflation")

    def test_archetype_negative_weight(self):
        fit = cr.archetype_fit({"I_OIL": {"score": -2}, "L_DOLLAR": {"score": 0}, "G_COPPER_GOLD": {"score": 0}, "G_GDPNOW": {"score": 0}})
        self.assertGreater(fit["energy"]["fit"], 0)  # an oil shock is a tailwind for producers
        self.assertEqual(fit["energy"]["runway_macro_fit_pts"], int(round((fit["energy"]["fit"] + 2) * 2)))

    def test_end_to_end_is_deterministic(self):
        with tempfile.TemporaryDirectory() as t:
            raw = Path(t) / "market" / "2026-09-24"
            fred = {"DGS10": days(900, 4.0, 5.1), "DGS2": days(900, 3.8, 4.7), "DGS30": days(900, 4.5, 5.4),
                    "DFII10": days(900, 1.8, 2.7), "BAMLH0A0HYM2": days(900, 3.5, 2.8),
                    "UNRATE": months(30, 4.3, 4.1), "CPILFESL": months(30, 300, 320), "IORB": days(10, 3.9, 3.9) + [("2026-09-30", 3.9)]}
            spy = days(400, 500, 700)
            write_raw(raw, fred, {"SPY": spy, "TLT": days(400, 90, 80), "^VIX": days(400, 18, 16)})
            out = Path(t) / "research" / "2026-09-24" / "macro"
            cmd = [sys.executable, str(Path(cr.__file__)), "--raw", str(raw), "--out", str(out)]
            subprocess.run(cmd, check=True, capture_output=True)
            a = (out / "regime.json").read_text()
            subprocess.run(cmd, check=True, capture_output=True)
            self.assertEqual(a, (out / "regime.json").read_text())
            doc = json.loads(a)
            self.assertEqual(doc["schema"], "macro-regime/1")
            self.assertLessEqual(doc["series"].get("DGS10", {}).get("as_of", ""), "2026-09-24")
            self.assertIn("R_10Y_LEVEL", {s["id"] for s in doc["signals"] if s["score"] is not None})


if __name__ == "__main__":
    unittest.main()
