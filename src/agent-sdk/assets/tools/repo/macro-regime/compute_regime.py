#!/usr/bin/env python3
"""Turn the raw macro snapshot into a scored, structured regime read.

    python3 src/agent-sdk/assets/tools/repo/macro-regime/compute_regime.py [--date YYYY-MM-DD] [--runway <PROBE_ID>]

Locations come from src/agent-sdk/assets/tools/repo/lib/paths.py. It reads data/market/<DATE>/, the files
fetch_macro.py wrote. It writes data/research/<DATE>/macro/:
  regime.json         every signal, pillar, the composite, quadrant, flags, archetype fit,
                      sector and factor tables, historical analogs, deltas versus the
                      previous run; merged with narrative.json when that file exists beside it
  regime.md           the same as tables, for reading
With --runway <PROBE_ID> it also writes data/probes/runway/<PROBE_ID>/records/macro.json,
the Runway Probe's legacy shape.

Every score is -2..+2 where positive means supportive of risk assets.  Thresholds live in
the RULES below and are mirrored in indicators.md; the code is the source of truth.
Two runs over the same raw directory produce the same file.
"""
from __future__ import annotations

import argparse
import csv
from datetime import date, timedelta
import json
import math
from pathlib import Path
import statistics
import sys

# The series catalog belongs to the macro-data skill; this engine only reads it.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "macro-data"))
from catalog import FRED, SECTORS, YAHOO, fred_page, safe_name, yahoo_page  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import paths  # noqa: E402

D1M, D3M, D6M, D12M = 30, 91, 182, 365


# ----------------------------------------------------------------------------- series

class Series:
    """A dated series.  Dates are ISO strings, ascending; values are floats."""

    def __init__(self, sid: str, points: list[tuple[str, float]], source: str):
        self.id, self.source = sid, source
        self.dates = [d for d, _ in points]
        self.values = [v for _, v in points]

    def __len__(self) -> int:
        return len(self.values)

    @property
    def last_date(self) -> str:
        return self.dates[-1]

    @property
    def last(self) -> float:
        return self.values[-1]

    def at(self, when: str) -> float | None:
        """Value on or before an ISO date."""
        lo, hi = 0, len(self.dates) - 1
        if hi < 0 or self.dates[0] > when:
            return None
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if self.dates[mid] <= when:
                lo = mid
            else:
                hi = mid - 1
        return self.values[lo]

    def ago(self, days: int) -> float | None:
        return self.at((date.fromisoformat(self.last_date) - timedelta(days=days)).isoformat())

    def change(self, days: int) -> float | None:
        prev = self.ago(days)
        return None if prev is None else self.last - prev

    def pct(self, days: int) -> float | None:
        prev = self.ago(days)
        return None if not prev else (self.last / prev - 1) * 100

    def window(self, days: int) -> list[float]:
        start = (date.fromisoformat(self.last_date) - timedelta(days=days)).isoformat()
        return [v for d, v in zip(self.dates, self.values) if d >= start]

    def percentile(self, years: int) -> float | None:
        w = self.window(int(365.25 * years))
        if len(w) < 20:
            return None
        return round(100 * sum(1 for v in w if v <= self.last) / len(w), 1)

    def sma(self, n: int, offset: int = 0) -> float | None:
        end = len(self.values) - offset
        if end < n:
            return None
        return sum(self.values[end - n:end]) / n

    def max_over(self, days: int) -> float:
        return max(self.window(days))

    def min_over(self, days: int) -> float:
        return min(self.window(days))

    def months_ago(self, k: int) -> float | None:
        """Value dated exactly k calendar months before the last point.  Counting rows
        would be wrong: FRED leaves unpublished months blank (Oct 2025, the shutdown)."""
        return dict(zip(self.dates, self.values)).get(add_months(self.last_date[:7], -k) + self.last_date[7:])

    def monthly_yoy(self, lag: int = 12) -> float | None:
        prev = self.months_ago(lag)
        return None if not prev else (self.last / prev - 1) * 100

    def monthly_ann(self, months: int) -> float | None:
        prev = self.months_ago(months)
        return None if not prev else ((self.last / prev) ** (12 / months) - 1) * 100

    def monthly_mean(self, n: int, lag: int = 0) -> float | None:
        """Mean of the n calendar months ending `lag` months before the last point."""
        vals = [self.months_ago(lag + i) for i in range(n)]
        return None if any(v is None for v in vals) else sum(vals) / n

    def snapshot(self) -> dict:
        out = {"value": r(self.last), "as_of": self.last_date, "source": self.source,
               "chg_1m": r(self.change(D1M)), "chg_3m": r(self.change(D3M)), "chg_12m": r(self.change(D12M)),
               "pctile_5y": self.percentile(5), "pctile_20y": self.percentile(20)}
        return out


def r(x: float | None, n: int = 2) -> float | None:
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(x, n)


def load(raw: Path) -> dict[str, Series]:
    """Read the raw directory.  Points dated after the fetch day (scheduled rates such as
    IORB) are dropped so as_of never runs ahead of the snapshot."""
    out: dict[str, Series] = {}
    log = raw / "_fetch_log.json"
    cutoff = json.loads(log.read_text())["fetched_at"][:10] if log.exists() else "9999-12-31"
    for sid, *_ in FRED:
        p = raw / "fred" / f"{sid}.csv"
        if not p.exists():
            continue
        pts = []
        with p.open() as f:
            rows = csv.reader(f)
            next(rows, None)
            for row in rows:
                if len(row) >= 2 and row[1] not in ("", ".") and row[0] <= cutoff:
                    try:
                        pts.append((row[0], float(row[1])))
                    except ValueError:
                        pass
        if pts:
            out[sid] = Series(sid, pts, fred_page(sid))
    for sym, *_ in YAHOO + [("^GSPC_1mo",)]:
        p = raw / "yahoo" / f"{safe_name(sym)}.json"
        if not p.exists():
            continue
        rec = json.loads(p.read_text())
        # Keep the last value per date (Yahoo can repeat the live bar).
        by_date = {d: v for d, v in zip(rec["dates"], rec["adjclose"]) if v is not None and d <= cutoff}
        pts = sorted(by_date.items())
        if pts:
            out[sym] = Series(sym, pts, yahoo_page(sym.replace("_1mo", "")))
    return out


def ratio(a: Series, b: Series, sid: str) -> Series:
    bd = dict(zip(b.dates, b.values))
    pts = [(d, v / bd[d]) for d, v in zip(a.dates, a.values) if d in bd and bd[d]]
    return Series(sid, pts, f"{a.source} / {b.source}")


def spread(a: Series, b: Series, sid: str) -> Series:
    """a minus b, on a's dates, with b taken on or before each date."""
    pts = []
    for d, v in zip(a.dates, a.values):
        w = b.at(d)
        if w is not None:
            pts.append((d, v - w))
    return Series(sid, pts, f"{a.source} minus {b.source}")


def returns(s: Series) -> dict[str, float]:
    out, prev = {}, None
    for d, v in zip(s.dates, s.values):
        if prev:
            out[d] = v / prev - 1
        prev = v
    return out


def corr(a: Series, b: Series, n: int = 60) -> float | None:
    ra, rb = returns(a), returns(b)
    common = sorted(set(ra) & set(rb))[-n:]
    if len(common) < n // 2:
        return None
    x, y = [ra[d] for d in common], [rb[d] for d in common]
    try:
        return statistics.correlation(x, y)
    except statistics.StatisticsError:
        return None


# ----------------------------------------------------------------------------- signals

class Missing(Exception):
    pass


def band(x: float, cuts: list[tuple[float, int]], above: int) -> int:
    """Return the score of the first cut x is below; `above` if x clears them all."""
    for limit, score in cuts:
        if x < limit:
            return score
    return above


def need(S: dict[str, Series], *ids: str) -> list[Series]:
    got = [S.get(i) for i in ids]
    miss = [i for i, s in zip(ids, got) if s is None or len(s) == 0]
    if miss:
        raise Missing(", ".join(miss))
    return got  # type: ignore[return-value]


def bp(x: float) -> float:
    return x * 100


# Each rule: (id, pillar, name, fn).  fn(S, D) -> (score, read, value dict, series ids)
RULES = []


def rule(sid: str, pillar: str, name: str, text: str):
    def deco(fn):
        RULES.append((sid, pillar, name, text, fn))
        return fn
    return deco


# --- rates and duration

@rule("R_10Y_LEVEL", "rates", "10-year yield level",
      "<3.5 +1; 3.5-4.5 0; 4.5-5.0 -1; >=5.0 -2")
def _(S, D):
    (s,) = need(S, "DGS10")
    sc = band(s.last, [(3.5, 1), (4.5, 0), (5.0, -1)], -2)
    return sc, f"10y at {s.last:.2f}% ({s.percentile(20)} pctile of 20y)", {"pct": s.last}, ["DGS10"]


@rule("R_10Y_1M", "rates", "10-year one-month change",
      "bp: <=-25 +2; -25..-10 +1; -10..+10 0; +10..+30 -1; >+30 -2")
def _(S, D):
    (s,) = need(S, "DGS10")
    c = bp(s.change(D1M) or 0)
    sc = band(c, [(-25, 2), (-10, 1), (10, 0), (30, -1)], -2)
    return sc, f"10y {c:+.0f}bp in a month, {bp(s.change(D3M) or 0):+.0f}bp in three", {"chg_1m_bp": c, "chg_3m_bp": bp(s.change(D3M) or 0)}, ["DGS10"]


@rule("R_REAL10", "rates", "10-year real yield",
      "<0 +2; 0-1 +1; 1-2 0; 2-2.5 -1; >=2.5 -2")
def _(S, D):
    (s,) = need(S, "DFII10")
    sc = band(s.last, [(0, 2), (1, 1), (2, 0), (2.5, -1)], -2)
    return sc, f"real 10y {s.last:.2f}% ({bp(s.change(D3M) or 0):+.0f}bp 3m); highest discount rate on long-duration cash flows since 2007 when above 2.5", {"pct": s.last, "chg_3m_bp": bp(s.change(D3M) or 0)}, ["DFII10"]


@rule("R_LONG_END", "rates", "30-year yield and its momentum",
      ">=5.25 or +25bp in 1m -2; >=4.75 or +15bp -1; <4.25 and falling +1; else 0")
def _(S, D):
    (s,) = need(S, "DGS30")
    c = bp(s.change(D1M) or 0)
    if s.last >= 5.25 or c >= 25:
        sc = -2
    elif s.last >= 4.75 or c >= 15:
        sc = -1
    elif s.last < 4.25 and c < 0:
        sc = 1
    else:
        sc = 0
    return sc, f"30y {s.last:.2f}% ({c:+.0f}bp 1m); long-end supply and term premium set the equity discount rate", {"pct": s.last, "chg_1m_bp": c}, ["DGS30"]


@rule("R_TERM_PREMIUM", "rates", "10-year term premium",
      "3m change bp: >+40 -2; +15..+40 -1; -15..+15 0; <-15 +1")
def _(S, D):
    (s,) = need(S, "THREEFYTP10")
    c = bp(s.change(D3M) or 0)
    sc = band(c, [(-15, 1), (15, 0), (40, -1)], -2)
    return sc, f"term premium {s.last:.2f}% ({c:+.0f}bp 3m): investors demanding pay for duration risk (fiscal, inflation uncertainty)", {"pct": s.last, "chg_3m_bp": c}, ["THREEFYTP10"]


@rule("R_CURVE_SHAPE", "rates", "Curve move (2y vs 10y over 1m)",
      "bear steepening or bear flattening -1; bull flattening +1; bull steepening 0 (easing, but often recession onset); moves under 5bp 0")
def _(S, D):
    two, ten = need(S, "DGS2", "DGS10")
    d2, d10 = bp(two.change(D1M) or 0), bp(ten.change(D1M) or 0)
    if abs(d2) < 5 and abs(d10) < 5:
        kind, sc = "unchanged", 0
    else:
        bear = (d2 + d10) > 0
        steep = d10 > d2
        kind = ("bear" if bear else "bull") + (" steepening" if steep else " flattening")
        sc = {"bear steepening": -1, "bear flattening": -1, "bull flattening": 1, "bull steepening": 0}[kind]
    s = ten.last - two.last
    return sc, f"{kind}: 2y {d2:+.0f}bp, 10y {d10:+.0f}bp; 2s10s {bp(s):+.0f}bp", {"kind": kind, "d2_bp": d2, "d10_bp": d10, "2s10s_bp": bp(s)}, ["DGS2", "DGS10"]


@rule("R_MOVE", "rates", "MOVE index (Treasury implied vol)",
      "<80 +1; 80-100 0; 100-120 -1; >=120 -2; one notch lower if +20 in 1m (floor -2)")
def _(S, D):
    (s,) = need(S, "^MOVE")
    sc = band(s.last, [(80, 1), (100, 0), (120, -1)], -2)
    c = s.change(D1M) or 0
    if c >= 20:
        sc = max(-2, sc - 1)
    return sc, f"MOVE {s.last:.0f} ({c:+.0f} 1m); bond vol drives MBS convexity hedging, dealer balance sheets and equity multiples", {"level": s.last, "chg_1m": c}, ["^MOVE"]


@rule("R_STOCK_BOND_CORR", "rates", "Stock-bond correlation (60d SPY vs TLT)",
      ">+0.3 -1 (bonds do not hedge: inflation/term-premium regime, 1970s and 2022 style); <-0.2 +1 (bonds hedge); else 0")
def _(S, D):
    spy, tlt = need(S, "SPY", "TLT")
    c = corr(spy, tlt, 60)
    if c is None:
        raise Missing("SPY/TLT overlap")
    sc = -1 if c > 0.3 else (1 if c < -0.2 else 0)
    return sc, f"60-day correlation {c:+.2f}", {"corr_60d": c}, ["SPY", "TLT"]


@rule("R_FED_PATH", "rates", "Priced Fed path (2-year minus effective fed funds)",
      "bp: >=+50 -2 (a hiking cycle priced); +15..+50 -1; -50..+15 0; <-50 +1 (cuts priced; check growth before cheering)")
def _(S, D):
    two, ff = need(S, "DGS2", "DFF")
    g = bp(two.last - ff.at(two.last_date))
    sc = band(g, [(-50, 1), (15, 0), (50, -1)], -2)
    c = bp(spread(two, ff, "2Y-FF").change(D1M) or 0)
    tgt = S.get("DFEDTARU")
    hiked = bp(tgt.change(D6M) or 0) if tgt else None
    return sc, f"2y {two.last:.2f}% vs fed funds {ff.last:.2f}%: {g:+.0f}bp ({c:+.0f}bp 1m); the 2y is the market's two-year Fed forecast", {"bp": g, "chg_1m_bp": c, "target_chg_6m_bp": hiked}, ["DGS2", "DFF"]


@rule("R_REAL_POLICY", "rates", "Real policy rate (fed funds minus core PCE y/y)",
      ">2.0 -1 (restrictive); 0-2 0; <0 +1 (accommodative)")
def _(S, D):
    ff, pce = need(S, "DFF", "PCEPILFE")
    infl = pce.monthly_yoy()
    real = ff.last - infl
    sc = -1 if real > 2 else (1 if real < 0 else 0)
    return sc, f"fed funds {ff.last:.2f}% less core PCE {infl:.2f}% = {real:+.2f}%", {"real_policy_pct": real, "core_pce_yoy": infl}, ["DFF", "PCEPILFE"]


# --- credit

@rule("C_HY_LEVEL", "credit", "High-yield OAS level",
      "<3.0 +1; 3.0-4.0 0; 4.0-5.5 -1; >=5.5 -2 (tight spreads are benign but leave no cushion)")
def _(S, D):
    (s,) = need(S, "BAMLH0A0HYM2")
    sc = band(s.last, [(3.0, 1), (4.0, 0), (5.5, -1)], -2)
    return sc, f"HY OAS {bp(s.last):.0f}bp ({s.percentile(20)} pctile of 20y)", {"bp": bp(s.last), "pctile_20y": s.percentile(20)}, ["BAMLH0A0HYM2"]


@rule("C_HY_CHANGE", "credit", "High-yield OAS momentum",
      "1m bp: <-25 +1; -25..+25 0; +25..+75 -1; >=+75 -2; 3m >= +100 forces -2")
def _(S, D):
    (s,) = need(S, "BAMLH0A0HYM2")
    c1, c3 = bp(s.change(D1M) or 0), bp(s.change(D3M) or 0)
    sc = band(c1, [(-25, 1), (25, 0), (75, -1)], -2)
    if c3 >= 100:
        sc = -2
    return sc, f"HY OAS {c1:+.0f}bp 1m, {c3:+.0f}bp 3m", {"chg_1m_bp": c1, "chg_3m_bp": c3}, ["BAMLH0A0HYM2"]


@rule("C_IG_CHANGE", "credit", "Investment-grade OAS momentum",
      "1m bp: <-10 +1; -10..+15 0; +15..+30 -1; >=+30 -2")
def _(S, D):
    (s,) = need(S, "BAMLC0A0CM")
    c1 = bp(s.change(D1M) or 0)
    sc = band(c1, [(-10, 1), (15, 0), (30, -1)], -2)
    return sc, f"IG OAS {bp(s.last):.0f}bp ({c1:+.0f}bp 1m)", {"bp": bp(s.last), "chg_1m_bp": c1}, ["BAMLC0A0CM"]


@rule("C_CCC_GAP", "credit", "CCC minus HY OAS (the weak tail)",
      "gap percentile over 5y: >=85 -1 (weakest borrowers cracking under high rates while the index looks calm); <=30 +1; else 0")
def _(S, D):
    ccc, hy = need(S, "BAMLH0A3HYC", "BAMLH0A0HYM2")
    g = spread(ccc, hy, "CCC_HY_GAP")
    p = g.percentile(5)
    sc = -1 if p is not None and p >= 85 else (1 if p is not None and p <= 30 else 0)
    return sc, f"CCC-HY gap {bp(g.last):.0f}bp ({p} pctile 5y, {bp(g.change(D3M) or 0):+.0f}bp 3m)", {"gap_bp": bp(g.last), "pctile_5y": p}, ["BAMLH0A3HYC", "BAMLH0A0HYM2"]


@rule("C_HYG_IEF_TREND", "credit", "HYG / IEF trend (credit risk appetite)",
      "above 50d and 200d +1; below both -1; else 0")
def _(S, D):
    a, b = need(S, "HYG", "IEF")
    rt = ratio(a, b, "HYG/IEF")
    s50, s200 = rt.sma(50), rt.sma(200)
    if s50 is None or s200 is None:
        raise Missing("HYG/IEF history")
    sc = 1 if rt.last > s50 and rt.last > s200 else (-1 if rt.last < s50 and rt.last < s200 else 0)
    return sc, f"HYG/IEF {'above' if rt.last > s200 else 'below'} 200d, {'above' if rt.last > s50 else 'below'} 50d", {"ratio": rt.last, "sma50": s50, "sma200": s200}, ["HYG", "IEF"]


@rule("C_SLOOS", "credit", "Senior loan officers: net % tightening C&I",
      ">=40 -2; 20-40 -1; 0-20 0; <0 +1 (bank credit supply leads defaults by 2-4 quarters)")
def _(S, D):
    (s,) = need(S, "DRTSCILM")
    sc = band(s.last, [(0, 1), (20, 0), (40, -1)], -2)
    return sc, f"net {s.last:+.1f}% of banks tightening ({s.last_date})", {"net_pct": s.last}, ["DRTSCILM"]


# --- volatility

@rule("V_VIX", "vol", "VIX level",
      "<20 +1; 20-25 0; 25-30 -1; >=30 -2 (below 13 is complacency; noted, not scored against)")
def _(S, D):
    s = S.get("^VIX") or S.get("VIXCLS")
    if s is None:
        raise Missing("^VIX, VIXCLS")
    sc = band(s.last, [(20, 1), (25, 0), (30, -1)], -2)
    note = "; complacent" if s.last < 13 else ""
    return sc, f"VIX {s.last:.1f} (1m range {s.min_over(D1M):.1f}-{s.max_over(D1M):.1f}){note}", {"level": s.last}, [s.id]


@rule("V_TERM", "vol", "VIX term structure (VIX / VIX3M)",
      "<0.90 +1 (contango, calm); 0.90-1.00 0; >=1.00 -2 (backwardation: acute stress now)")
def _(S, D):
    a, b = need(S, "^VIX", "^VIX3M")
    rt = a.last / b.last
    sc = band(rt, [(0.9, 1), (1.0, 0)], -2)
    return sc, f"VIX/VIX3M {rt:.2f}", {"ratio": rt}, ["^VIX", "^VIX3M"]


@rule("V_VVIX", "vol", "Vol of VIX",
      ">=115 -1 (demand for crash protection); else 0")
def _(S, D):
    (s,) = need(S, "^VVIX")
    sc = -1 if s.last >= 115 else 0
    return sc, f"VVIX {s.last:.0f}", {"level": s.last}, ["^VVIX"]


# --- liquidity and dollar

def net_liquidity(S) -> Series:
    walcl, tga, rrp = need(S, "WALCL", "WTREGEN", "RRPONTSYD")
    pts = []
    for d, v in zip(walcl.dates, walcl.values):
        t, q = tga.at(d), rrp.at(d)
        if t is not None and q is not None:
            pts.append((d, v / 1000 - t / 1000 - q))  # billions
    return Series("NET_LIQ", pts, "WALCL - WTREGEN - RRPONTSYD (FRED)")


@rule("L_NET_LIQ", "liquidity", "Net Fed liquidity (balance sheet - TGA - RRP)",
      "13-week change $bn: >+150 +1; -150..+150 0; <-150 -1; <-300 -2")
def _(S, D):
    n = net_liquidity(S)
    c = n.change(D3M) or 0
    sc = band(c, [(-300, -2), (-150, -1), (150, 0)], 1)
    return sc, f"net liquidity ${n.last:,.0f}bn ({c:+,.0f}bn 13w)", {"bn": n.last, "chg_13w_bn": c}, ["WALCL", "WTREGEN", "RRPONTSYD"]


@rule("L_FUNDING", "liquidity", "Funding pressure (SOFR minus IORB, 5-day avg)",
      "bp: >=+10 -2; +3..+10 -1; else 0 (repo above the Fed's floor rate means reserves are getting scarce: Sept 2019)")
def _(S, D):
    sofr, iorb = need(S, "SOFR", "IORB")
    g = spread(sofr, iorb, "SOFR-IORB")
    avg = bp(sum(g.values[-5:]) / min(5, len(g)))
    sc = -2 if avg >= 10 else (-1 if avg >= 3 else 0)
    return sc, f"SOFR-IORB {avg:+.1f}bp", {"bp_5d": avg}, ["SOFR", "IORB"]


@rule("L_DOLLAR", "liquidity", "Dollar 3-month change (DXY, else broad index)",
      "%: >=+5 -2; +2..+5 -1; -2..+2 0; <-2 +1 (a falling dollar loosens global financial conditions)")
def _(S, D):
    s = S.get("DX-Y.NYB") or S.get("DTWEXBGS")
    if s is None:
        raise Missing("DX-Y.NYB, DTWEXBGS")
    c = s.pct(D3M) or 0
    sc = band(c, [(-2, 1), (2, 0), (5, -1)], -2)
    return sc, f"{'DXY' if s.id == 'DX-Y.NYB' else 'broad dollar'} {s.last:.1f} ({c:+.1f}% 3m, {s.pct(D1M) or 0:+.1f}% 1m)", {"level": s.last, "chg_3m_pct": c}, [s.id]


@rule("L_NFCI", "liquidity", "Chicago Fed financial conditions",
      "<-0.3 +1 (loose); -0.3..0 0; 0..0.5 -1; >=0.5 -2")
def _(S, D):
    (s,) = need(S, "NFCI")
    sc = band(s.last, [(-0.3, 1), (0, 0), (0.5, -1)], -2)
    return sc, f"NFCI {s.last:+.2f} ({s.change(D3M) or 0:+.2f} 3m)", {"level": s.last}, ["NFCI"]


@rule("L_STLFSI", "liquidity", "St. Louis Fed financial stress",
      "<-0.5 +1; -0.5..0.5 0; 0.5..1.5 -1; >=1.5 -2")
def _(S, D):
    (s,) = need(S, "STLFSI4")
    sc = band(s.last, [(-0.5, 1), (0.5, 0), (1.5, -1)], -2)
    return sc, f"STLFSI {s.last:+.2f}", {"level": s.last}, ["STLFSI4"]


@rule("L_M2", "liquidity", "M2 growth y/y",
      "%: <0 -1; 0-6 0; >=6 +1")
def _(S, D):
    (s,) = need(S, "M2SL")
    y = s.monthly_yoy()
    sc = -1 if y < 0 else (1 if y >= 6 else 0)
    return sc, f"M2 {y:+.1f}% y/y", {"yoy_pct": y}, ["M2SL"]


@rule("L_YEN_CARRY", "liquidity", "Yen carry unwind (USD/JPY 1m change)",
      "%: <=-5 -2; -5..-3 -1; else 0 (a fast yen rally forces deleveraging of funded risk: Aug 2024)")
def _(S, D):
    (s,) = need(S, "JPY=X")
    c = s.pct(D1M) or 0
    sc = -2 if c <= -5 else (-1 if c <= -3 else 0)
    return sc, f"USD/JPY {s.last:.1f} ({c:+.1f}% 1m)", {"level": s.last, "chg_1m_pct": c}, ["JPY=X"]


# --- growth

@rule("G_CLAIMS", "growth", "Initial claims, 4-week average vs 52-week low",
      "rise from low %: <5 +1; 5-12 0; 12-20 -1; >=20 -2")
def _(S, D):
    (s,) = need(S, "ICSA")
    ma4 = sum(s.values[-4:]) / 4
    lo = min(sum(s.values[i - 4:i]) / 4 for i in range(max(4, len(s) - 52), len(s) + 1))
    rise = (ma4 / lo - 1) * 100
    sc = band(rise, [(5, 1), (12, 0), (20, -1)], -2)
    return sc, f"claims 4wk avg {ma4/1000:.0f}k, {rise:+.0f}% off the 52w low", {"ma4": ma4, "rise_pct": rise}, ["ICSA"]


@rule("G_SAHM", "growth", "Sahm rule (real time)",
      "<=0.1 +1; 0.1-0.3 0; 0.3-0.5 -1; >=0.5 -2 (triggered)")
def _(S, D):
    (s,) = need(S, "SAHMREALTIME")
    sc = band(s.last, [(0.1001, 1), (0.3, 0), (0.5, -1)], -2)
    return sc, f"Sahm {s.last:.2f} ({s.last_date})", {"level": s.last}, ["SAHMREALTIME"]


@rule("G_GDPNOW", "growth", "Atlanta Fed GDPNow",
      "%: <0 -2; 0-1 -1; 1-2.5 0; >=2.5 +1")
def _(S, D):
    (s,) = need(S, "GDPNOW")
    sc = band(s.last, [(0, -2), (1, -1), (2.5, 0)], 1)
    return sc, f"GDPNow {s.last:.1f}% for the quarter starting {s.last_date}", {"pct": s.last}, ["GDPNOW"]


@rule("G_CFNAI", "growth", "Chicago Fed activity index, 3-month average",
      "<=-0.7 -2 (recession signal); -0.7..-0.35 -1; -0.35..0.2 0; >0.2 +1")
def _(S, D):
    (s,) = need(S, "CFNAI")
    m3 = s.monthly_mean(3)
    sc = band(m3, [(-0.7, -2), (-0.35, -1), (0.2001, 0)], 1)
    return sc, f"CFNAI 3m avg {m3:+.2f}", {"ma3": m3}, ["CFNAI"]


@rule("G_COPPER_GOLD", "growth", "Copper / gold ratio, 3-month change",
      "%: >=+5 +1; -5..+5 0; <=-5 -1 (the market's own growth-versus-fear gauge)")
def _(S, D):
    cu, au = need(S, "HG=F", "GC=F")
    rt = ratio(cu, au, "CU/AU")
    c = rt.pct(D3M) or 0
    sc = 1 if c >= 5 else (-1 if c <= -5 else 0)
    return sc, f"copper/gold {c:+.1f}% 3m ({rt.percentile(10)} pctile 10y)", {"chg_3m_pct": c}, ["HG=F", "GC=F"]


@rule("G_CYC_DEF", "growth", "Cyclicals vs defensives (XLY/XLP and XLI/XLU, 3m)",
      "both up +1; both down -1; mixed 0")
def _(S, D):
    y, p, i, u = need(S, "XLY", "XLP", "XLI", "XLU")
    a = ratio(y, p, "XLY/XLP").pct(D3M) or 0
    b = ratio(i, u, "XLI/XLU").pct(D3M) or 0
    sc = 1 if a > 0 and b > 0 else (-1 if a < 0 and b < 0 else 0)
    return sc, f"XLY/XLP {a:+.1f}%, XLI/XLU {b:+.1f}% over 3m", {"xly_xlp_3m": a, "xli_xlu_3m": b}, ["XLY", "XLP", "XLI", "XLU"]


@rule("G_UNRATE", "growth", "Unemployment rate, 3-month change",
      "pp: >=+0.3 -1; <=-0.2 +1; else 0")
def _(S, D):
    (s,) = need(S, "UNRATE")
    c = s.last - s.months_ago(3)
    sc = -1 if c >= 0.3 else (1 if c <= -0.2 else 0)
    return sc, f"unemployment {s.last:.1f}% ({c:+.1f}pp 3m)", {"pct": s.last, "chg_3m_pp": c}, ["UNRATE"]


@rule("G_CURVE_RESTEEPEN", "growth", "Re-steepening after inversion (10y-3m)",
      "-1 when 10y-3m was below -0.5 within 24 months and is now above 0: historically the window when recessions start; else 0")
def _(S, D):
    (s,) = need(S, "T10Y3M")
    lo = min(s.window(730))
    sc = -1 if lo < -0.5 and s.last > 0 else 0
    return sc, f"10y-3m {bp(s.last):+.0f}bp; 24m low {bp(lo):+.0f}bp", {"now_bp": bp(s.last), "low_24m_bp": bp(lo)}, ["T10Y3M"]


@rule("G_RECPROB", "growth", "Smoothed recession probability (Chauvet-Piger)",
      "%: >=30 -2; 10-30 -1; else 0")
def _(S, D):
    (s,) = need(S, "RECPROUSM156N")
    sc = -2 if s.last >= 30 else (-1 if s.last >= 10 else 0)
    return sc, f"recession probability {s.last:.1f}% ({s.last_date})", {"pct": s.last}, ["RECPROUSM156N"]


# --- inflation (scored as risk to multiples: rising inflation is negative)

@rule("I_CORE_3M", "inflation", "Core CPI, 3-month annualised",
      "%: <2.5 +1; 2.5-3.5 0; 3.5-4.5 -1; >=4.5 -2")
def _(S, D):
    (s,) = need(S, "CPILFESL")
    a3 = s.monthly_ann(3)
    sc = band(a3, [(2.5, 1), (3.5, 0), (4.5, -1)], -2)
    return sc, f"core CPI {a3:.1f}% 3m annualised vs {s.monthly_yoy():.1f}% y/y ({s.last_date})", {"ann_3m": a3, "yoy": s.monthly_yoy()}, ["CPILFESL"]


@rule("I_CPI_TREND", "inflation", "Headline CPI momentum (3m annualised vs y/y)",
      "3m minus y/y pp: >=+0.5 -1 (accelerating); <=-0.5 +1 (decelerating); else 0")
def _(S, D):
    (s,) = need(S, "CPIAUCSL")
    a3, y = s.monthly_ann(3), s.monthly_yoy()
    d = a3 - y
    sc = -1 if d >= 0.5 else (1 if d <= -0.5 else 0)
    return sc, f"CPI {a3:.1f}% 3m ann vs {y:.1f}% y/y", {"ann_3m": a3, "yoy": y}, ["CPIAUCSL"]


@rule("I_BREAKEVEN", "inflation", "10-year breakeven inflation",
      "%: <1.8 -1 (deflation scare); 1.8-2.6 0; 2.6-3.0 -1; >=3.0 -2")
def _(S, D):
    (s,) = need(S, "T10YIE")
    sc = band(s.last, [(1.8, -1), (2.6, 0), (3.0, -1)], -2)
    return sc, f"10y breakeven {s.last:.2f}%", {"pct": s.last}, ["T10YIE"]


@rule("I_5Y5Y", "inflation", "5y5y forward inflation (anchoring)",
      "%: >=2.8 -1 (expectations de-anchoring); else 0")
def _(S, D):
    (s,) = need(S, "T5YIFR")
    sc = -1 if s.last >= 2.8 else 0
    return sc, f"5y5y {s.last:.2f}%", {"pct": s.last}, ["T5YIFR"]


@rule("I_OIL", "inflation", "Oil shock gauge (WTI 3m change and level)",
      "3m %: >=+25 -2; +10..+25 -1; -30..+10 0; <=-30 -1 (demand shock); level >=100 one notch lower")
def _(S, D):
    s = S.get("CL=F") or S.get("DCOILWTICO")
    if s is None:
        raise Missing("CL=F, DCOILWTICO")
    c = s.pct(D3M) or 0
    sc = -2 if c >= 25 else (-1 if c >= 10 else (-1 if c <= -30 else 0))
    if s.last >= 100:
        sc = max(-2, sc - 1)
    return sc, f"WTI ${s.last:.1f} ({c:+.1f}% 3m, {s.pct(D1M) or 0:+.1f}% 1m)", {"usd": s.last, "chg_3m_pct": c}, [s.id]


# --- housing and MBS

@rule("H_MORTGAGE_RATE", "housing", "30-year mortgage rate",
      "%: <6 +1; 6-7 0; 7-7.5 -1; >=7.5 -2")
def _(S, D):
    (s,) = need(S, "MORTGAGE30US")
    sc = band(s.last, [(6, 1), (7, 0), (7.5, -1)], -2)
    return sc, f"30y mortgage {s.last:.2f}% ({bp(s.change(D3M) or 0):+.0f}bp 3m)", {"pct": s.last}, ["MORTGAGE30US"]


@rule("H_MORTGAGE_SPREAD", "housing", "Mortgage rate minus 10-year (MBS spread proxy)",
      "bp: <170 +1; 170-250 0; 250-300 -1; >=300 -2 (wide = MBS buyers absent, rate vol high, Fed running off MBS)")
def _(S, D):
    m, t = need(S, "MORTGAGE30US", "DGS10")
    g = spread(m, t, "MTG-10Y")
    v = bp(g.last)
    sc = band(v, [(170, 1), (250, 0), (300, -1)], -2)
    return sc, f"mortgage-10y {v:.0f}bp ({g.percentile(20)} pctile 20y; pre-2022 norm about 170bp)", {"bp": v}, ["MORTGAGE30US", "DGS10"]


@rule("H_PERMITS", "housing", "Building permits, 3m average y/y",
      "%: <=-10 -1; >=+5 +1; else 0 (permits lead starts, employment and builder margins)")
def _(S, D):
    (s,) = need(S, "PERMIT")
    now, ya = s.monthly_mean(3), s.monthly_mean(3, lag=12)
    y = (now / ya - 1) * 100
    sc = -1 if y <= -10 else (1 if y >= 5 else 0)
    return sc, f"permits {now:,.0f}k SAAR ({y:+.1f}% y/y)", {"k_saar": now, "yoy_pct": y}, ["PERMIT"]


@rule("H_SUPPLY", "housing", "Months supply of new homes",
      ">=9 -1 (builder inventory glut, margin pressure); <6 +1; else 0")
def _(S, D):
    (s,) = need(S, "MSACSR")
    sc = -1 if s.last >= 9 else (1 if s.last < 6 else 0)
    return sc, f"new-home supply {s.last:.1f} months", {"months": s.last}, ["MSACSR"]


@rule("H_HOME_PRICES", "housing", "Case-Shiller national y/y",
      "%: <0 -1 (collateral values falling: bank, MBS and consumer-wealth channel); >=0 0")
def _(S, D):
    (s,) = need(S, "CSUSHPINSA")
    y = s.monthly_yoy()
    sc = -1 if y < 0 else 0
    return sc, f"home prices {y:+.1f}% y/y ({s.last_date})", {"yoy_pct": y}, ["CSUSHPINSA"]


@rule("H_ITB_REL", "housing", "Homebuilders vs S&P 500, 3m",
      "pp: >=+5 +1; <=-5 -1; else 0")
def _(S, D):
    a, b = need(S, "ITB", "SPY")
    c = ratio(a, b, "ITB/SPY").pct(D3M) or 0
    sc = 1 if c >= 5 else (-1 if c <= -5 else 0)
    return sc, f"ITB vs SPY {c:+.1f}% 3m", {"rel_3m_pct": c}, ["ITB", "SPY"]


@rule("H_MBS_REL", "housing", "Agency MBS vs Treasuries (MBB / IEF, 3m)",
      "%: >=+1 +1; <=-1 -1; else 0 (MBS underperforming = spread widening, convexity selling)")
def _(S, D):
    a, b = need(S, "MBB", "IEF")
    c = ratio(a, b, "MBB/IEF").pct(D3M) or 0
    sc = 1 if c >= 1 else (-1 if c <= -1 else 0)
    return sc, f"MBB vs IEF {c:+.2f}% 3m", {"rel_3m_pct": c}, ["MBB", "IEF"]


# --- equity internals

@rule("E_TREND", "internals", "S&P 500 trend (50d, 200d)",
      "above 200d with 50>200 +1; above 200d, 50<200 0; below 200d -1; below with 50<200 and 200d falling -2")
def _(S, D):
    (s,) = need(S, "SPY")
    s50, s200, s200p = s.sma(50), s.sma(200), s.sma(200, offset=20)
    if s.last > s200:
        sc = 1 if s50 > s200 else 0
    else:
        sc = -2 if s50 < s200 and s200 < s200p else -1
    return sc, f"SPY {100*(s.last/s200-1):+.1f}% vs 200d; 50d {'above' if s50 > s200 else 'below'} 200d", {"vs_200d_pct": 100 * (s.last / s200 - 1)}, ["SPY"]


@rule("E_BREADTH_RSP", "internals", "Equal weight vs cap weight (RSP / SPY, 3m)",
      "%: >=+2 +1; <=-3 -1 (narrow, mega-cap-led market); else 0")
def _(S, D):
    a, b = need(S, "RSP", "SPY")
    c = ratio(a, b, "RSP/SPY").pct(D3M) or 0
    sc = 1 if c >= 2 else (-1 if c <= -3 else 0)
    return sc, f"RSP vs SPY {c:+.1f}% 3m", {"rel_3m_pct": c}, ["RSP", "SPY"]


@rule("E_SECTOR_BREADTH", "internals", "Sectors above their 200-day (of 11)",
      ">=8 +1; 5-7 0; 3-4 -1; <=2 -2")
def _(S, D):
    ok = [s for s in SECTORS if s in S and S[s].sma(200)]
    if len(ok) < 8:
        raise Missing("sector ETFs")
    above = [s for s in ok if S[s].last > S[s].sma(200)]
    n = round(len(above) * 11 / len(ok))
    sc = band(n, [(3, -2), (5, -1), (8, 0)], 1)
    return sc, f"{len(above)} of {len(ok)} sectors above 200d", {"above": len(above), "of": len(ok), "names": above}, ok


@rule("E_HIGH_BETA", "internals", "High beta vs low vol (SPHB / SPLV, 3m)",
      "%: >=+5 +1; <=-5 -1; else 0")
def _(S, D):
    a, b = need(S, "SPHB", "SPLV")
    c = ratio(a, b, "SPHB/SPLV").pct(D3M) or 0
    sc = 1 if c >= 5 else (-1 if c <= -5 else 0)
    return sc, f"SPHB vs SPLV {c:+.1f}% 3m", {"rel_3m_pct": c}, ["SPHB", "SPLV"]


@rule("E_SMALL_CAPS", "internals", "Small vs large (IWM / SPY, 3m)",
      "%: >=+3 +1; <=-5 -1; else 0")
def _(S, D):
    a, b = need(S, "IWM", "SPY")
    c = ratio(a, b, "IWM/SPY").pct(D3M) or 0
    sc = 1 if c >= 3 else (-1 if c <= -5 else 0)
    return sc, f"IWM vs SPY {c:+.1f}% 3m", {"rel_3m_pct": c}, ["IWM", "SPY"]


@rule("E_DRAWDOWN", "internals", "S&P 500 drawdown from 52-week high",
      "%: >-5 +1; -5..-10 0; -10..-20 -1; <=-20 -2")
def _(S, D):
    (s,) = need(S, "SPY")
    dd = (s.last / s.max_over(D12M) - 1) * 100
    sc = band(dd, [(-20, -2), (-10, -1), (-5, 0)], 1)
    return sc, f"SPY {dd:.1f}% from 52w high", {"dd_pct": dd}, ["SPY"]


@rule("E_BANKS", "internals", "Regional banks vs S&P 500 (KRE / SPY, 3m)",
      "%: <=-10 -1 (bank stress: 2023 style); >=+5 +1; else 0")
def _(S, D):
    a, b = need(S, "KRE", "SPY")
    c = ratio(a, b, "KRE/SPY").pct(D3M) or 0
    sc = -1 if c <= -10 else (1 if c >= 5 else 0)
    return sc, f"KRE vs SPY {c:+.1f}% 3m", {"rel_3m_pct": c}, ["KRE", "SPY"]


PILLAR_WEIGHTS = {
    "rates": 18, "credit": 18, "liquidity": 14, "growth": 15,
    "inflation": 10, "vol": 10, "internals": 10, "housing": 5,
}
PILLAR_NAMES = {
    "rates": "Rates and duration", "credit": "Credit", "liquidity": "Liquidity and dollar",
    "growth": "Growth and labour", "inflation": "Inflation and oil", "vol": "Volatility",
    "internals": "Equity internals", "housing": "Housing and MBS",
}


def run_rules(S: dict[str, Series]) -> list[dict]:
    out = []
    for sid, pillar, name, text, fn in RULES:
        row = {"id": sid, "pillar": pillar, "name": name, "rule": text}
        try:
            sc, read, val, used = fn(S, None)
            row.update(status="ok", score=int(sc), read=read,
                       value={k: (r(v, 3) if isinstance(v, float) else v) for k, v in val.items()},
                       as_of=max(S[u].last_date for u in used if u in S),
                       sources=sorted({S[u].source for u in used if u in S}))
        except Missing as e:
            row.update(status="missing", score=None, read=f"missing: {e}")
        except (ZeroDivisionError, TypeError, ValueError, IndexError) as e:
            row.update(status="error", score=None, read=f"error: {type(e).__name__}: {e}")
        out.append(row)
    return out


# ----------------------------------------------------------------------------- regime

def label_for(x: float) -> str:
    if x >= 35:
        return "Risk-on"
    if x >= 10:
        return "Lean risk-on"
    if x > -10:
        return "Neutral / mixed"
    if x > -35:
        return "Lean risk-off"
    return "Risk-off"


def score_pillars(signals: list[dict]) -> dict:
    out = {}
    for p, w in PILLAR_WEIGHTS.items():
        sc = [s["score"] for s in signals if s["pillar"] == p and s["score"] is not None]
        n = sum(1 for s in signals if s["pillar"] == p)
        mean = sum(sc) / len(sc) if sc else None
        out[p] = {"name": PILLAR_NAMES[p], "weight": w, "mean": r(mean), "score_100": r(None if mean is None else mean * 50, 1),
                  "signals_ok": len(sc), "signals_total": n,
                  "worst": sorted([s["id"] for s in signals if s["pillar"] == p and s["score"] is not None and s["score"] <= -1]),
                  "best": sorted([s["id"] for s in signals if s["pillar"] == p and s["score"] is not None and s["score"] >= 1])}
    return out


def composite(pillars: dict) -> float:
    have = {p: v for p, v in pillars.items() if v["mean"] is not None}
    wsum = sum(v["weight"] for v in have.values())
    return round(sum(v["weight"] * v["mean"] for v in have.values()) / wsum * 50, 1) if wsum else 0.0


# Market-stress flags mean the plumbing is under strain now; macro-stress flags mean the
# backdrop has turned hostile but prices may not have noticed yet.
MARKET_FLAGS = {"VIX_BACKWARDATION", "CREDIT_BREAK", "SYSTEMIC_STRESS", "CARRY_UNWIND", "FUNDING_SQUEEZE"}
LADDER = ["Risk-off", "Lean risk-off", "Neutral / mixed", "Lean risk-on", "Risk-on"]


def apply_flags(label: str, flags: list[dict]) -> tuple[str, int]:
    """Each market-stress flag lowers the label one notch; two or more macro-stress flags lower it one."""
    market = sum(1 for f in flags if f["kind"] == "market")
    macro = sum(1 for f in flags if f["kind"] == "macro")
    notches = market + (1 if macro >= 2 else 0)
    return LADDER[max(0, LADDER.index(label) - notches)], notches


def stress_flags(sig: dict[str, dict]) -> list[dict]:
    flags = []

    def f(cond, fid, text):
        if cond:
            kind = "market" if fid in MARKET_FLAGS else "macro"
            flags.append({"id": fid, "kind": kind, "text": text})
    sc = lambda i: sig.get(i, {}).get("score")  # noqa: E731
    f(sc("V_TERM") == -2, "VIX_BACKWARDATION", "VIX above VIX3M: the market is paying up for protection now, not later")
    f(sc("C_HY_CHANGE") == -2, "CREDIT_BREAK", "High-yield spreads widening fast: equity drawdowns follow credit, rarely lead it")
    f(sc("L_STLFSI") == -2, "SYSTEMIC_STRESS", "Financial stress index above 1.5")
    f(sc("L_YEN_CARRY") == -2, "CARRY_UNWIND", "Yen up 5%+ in a month: funded positions are being forced out")
    f(sc("L_FUNDING") == -2, "FUNDING_SQUEEZE", "Repo trading well above IORB: reserve scarcity")
    f(sc("G_SAHM") == -2, "SAHM_TRIGGERED", "Sahm rule triggered: recession has usually begun by this point")
    f(sc("R_LONG_END") == -2 and sc("R_MOVE") is not None and sc("R_MOVE") <= -1,
      "LONG_END_TANTRUM", "30y at or above 5.25% (or +25bp in a month) with elevated bond vol: 2023 and 1994-style duration stress")
    f(sc("R_FED_PATH") == -2 and (sig.get("R_FED_PATH", {}).get("value", {}).get("target_chg_6m_bp") or 0) > 0,
      "HIKING_CYCLE", "The Fed has raised its target within six months and the 2y prices more: 1994, 2004, 2015 and 2022 all began this way")
    f(sc("I_OIL") == -2, "OIL_SHOCK", "Oil up 25%+ in three months: 1973, 1979, 1990, 2008 and 2022 all featured one")
    return flags


def quadrant(pillars: dict) -> dict:
    g = pillars["growth"]["mean"]
    i = pillars["inflation"]["mean"]
    if g is None or i is None:
        return {"name": "unknown"}
    infl_pressure = -i  # the inflation pillar is scored as risk; invert to direction
    name = {(True, False): "Goldilocks", (True, True): "Reflation / overheating",
            (False, True): "Stagflation", (False, False): "Disinflationary slowdown"}[(g >= 0, infl_pressure > 0)]
    weak = abs(g) < 0.25 or abs(infl_pressure) < 0.25
    return {"name": name, "growth": r(g), "inflation_pressure": r(infl_pressure),
            "conviction": "low" if weak else "normal",
            "note": "one axis is within +/-0.25 of zero, so the quadrant is a lean, not a call" if weak else ""}


QUADRANT_TILTS = {
    "Goldilocks": {"overweight": ["XLK", "XLC", "XLY", "growth", "momentum", "high beta", "semis"],
                   "underweight": ["XLU", "XLP", "XLE", "min vol", "gold"], "duration": "neutral to long"},
    "Reflation / overheating": {"overweight": ["XLE", "XLB", "XLI", "XLF", "value", "small caps", "EM", "commodities"],
                                "underweight": ["long-duration growth", "XLU", "XLRE", "long Treasuries"], "duration": "short"},
    "Stagflation": {"overweight": ["XLE", "gold and miners", "XLP", "XLV", "quality", "min vol", "short-duration cash yield"],
                    "underweight": ["long-duration growth", "XLY", "small caps", "XLRE", "long Treasuries", "high yield"], "duration": "short"},
    "Disinflationary slowdown": {"overweight": ["long Treasuries", "XLU", "XLP", "XLV", "quality", "min vol", "secular growers with net cash"],
                                 "underweight": ["XLE", "XLB", "XLF", "small caps", "high yield", "deep cyclicals"], "duration": "long"},
}


def tilts(q: dict, sig: dict[str, dict], flags: list[dict], duration: str) -> dict:
    """Quadrant playbook, then overlays from flags and single signals.  Overlays win."""
    base = QUADRANT_TILTS.get(q["name"], {"overweight": [], "underweight": [], "duration": "n/a"})
    ow, uw, notes = list(base["overweight"]), list(base["underweight"]), []
    dur = base["duration"]
    sc = lambda i: sig.get(i, {}).get("score")  # noqa: E731
    ids = {f["id"] for f in flags}

    def move(add_ow=(), add_uw=(), note=""):
        for x in add_ow:
            if x in uw:
                uw.remove(x)
            if x not in ow:
                ow.append(x)
        for x in add_uw:
            if x in ow:
                ow.remove(x)
            if x not in uw:
                uw.append(x)
        notes.append(note)

    if "OIL_SHOCK" in ids:
        move(["XLE"], ["airlines and transports", "chemicals", "XLY"], "oil shock: producers over consumers of energy")
    if duration == "hostile":
        dur = "short"
        move(["short-duration cash yield"], ["long-duration growth", "XLRE", "XLU", "long Treasuries"],
             "hostile duration: rising real and long yields de-rate distant cash flows first")
    if sc("L_DOLLAR") is not None and sc("L_DOLLAR") <= -1:
        move([], ["EM", "US multinationals with foreign sales"], "strong dollar")
    if (sc("C_HY_CHANGE") or 0) <= -1 or (sc("C_CCC_GAP") or 0) <= -1:
        move(["quality"], ["levered small caps", "CCC credit"], "credit tail under strain: own balance sheets")
    if (sc("H_MORTGAGE_RATE") or 0) <= -1 and (sc("H_ITB_REL") or 0) <= -1:
        move([], ["homebuilders", "housing-linked retail"], "mortgage rate above 7% and builders lagging")
    if (sc("R_STOCK_BOND_CORR") or 0) <= -1:
        move(["gold"], [], "stocks and bonds falling together: Treasuries are not a hedge; use cash, T-bills, gold or options")
    return {"quadrant": q["name"], "overweight": ow, "underweight": uw, "duration": dur, "overlays": [n for n in notes if n]}


# archetype -> (description, [(signal id, weight)], examples).  A negative weight means the
# archetype benefits from what the signal scores as risk-off.
ARCHETYPES = {
    "long_duration_growth": ("Pre-profit or early-profit growth; value sits years out (spec tech, biotech, space, early AI infra)",
                             [("R_REAL10", 2), ("R_10Y_1M", 1.5), ("R_LONG_END", 1), ("L_NET_LIQ", 1), ("C_HY_CHANGE", 1), ("E_HIGH_BETA", 1), ("R_MOVE", 1)],
                             ["ARKK", "XBI", "RKLB", "ASTS"]),
    "quality_megacap": ("Cash-rich platforms with self-funded growth; rate-sensitive through the multiple only",
                        [("E_TREND", 1.5), ("R_10Y_1M", 1), ("V_VIX", 1), ("G_GDPNOW", 1), ("R_REAL10", 0.5), ("C_HY_LEVEL", 0.5)],
                        ["MSFT", "GOOGL", "META", "NVDA"]),
    "cash_flow_value": ("Mature free-cash-flow compounders priced on yield; tolerate a rate plateau",
                        [("G_GDPNOW", 1), ("G_CLAIMS", 1), ("C_HY_LEVEL", 1), ("R_10Y_LEVEL", 0.5), ("V_VIX", 0.5), ("E_BREADTH_RSP", 0.5)],
                        ["BRK.B", "CAT", "JNJ", "XOM"]),
    "small_caps": ("Domestic, floating-rate borrowers; first hurt by rising yields and wider spreads",
                   [("R_10Y_1M", 1.5), ("C_HY_CHANGE", 1.5), ("C_HY_LEVEL", 1), ("R_REAL_POLICY", 1), ("G_CLAIMS", 1), ("E_SMALL_CAPS", 1), ("L_NFCI", 1)],
                   ["IWM"]),
    "banks": ("Net-interest-margin earners; like a steep curve, fear credit losses and deposit flight",
              [("C_HY_CHANGE", 1), ("C_SLOOS", 1), ("E_BANKS", 1), ("G_CLAIMS", 1), ("L_FUNDING", 0.5), ("H_HOME_PRICES", 0.5), ("C_CCC_GAP", 0.5)],
              ["KRE", "XLF", "JPM"]),
    "homebuilders_reits": ("Rate-driven real assets; mortgage rate and MBS spread are the whole story at the margin",
                           [("H_MORTGAGE_RATE", 2), ("H_MORTGAGE_SPREAD", 1.5), ("R_10Y_1M", 1.5), ("H_PERMITS", 1), ("H_SUPPLY", 1), ("H_ITB_REL", 0.5)],
                           ["ITB", "XLRE", "DHI"]),
    "energy": ("Oil and gas producers and services; paid by oil up, a weaker dollar and global growth",
               [("I_OIL", -1.5), ("L_DOLLAR", 1), ("G_COPPER_GOLD", 1), ("G_GDPNOW", 0.5)],
               ["XLE", "FANG"]),
    "materials_industrials": ("Global cyclicals; copper, capex and a softer dollar",
                              [("G_COPPER_GOLD", 1.5), ("G_CYC_DEF", 1), ("L_DOLLAR", 1), ("G_GDPNOW", 1), ("G_CFNAI", 1)],
                              ["XLB", "XLI"]),
    "defensives": ("Staples, utilities, health care; win relatively when growth scares and yields fall",
                   [("R_10Y_1M", 1), ("G_GDPNOW", -1), ("G_CLAIMS", -1), ("E_TREND", -0.5), ("I_CORE_3M", 0.5)],
                   ["XLP", "XLU", "XLV"]),
    "em_international": ("Non-US equities; the dollar and global liquidity dominate",
                         [("L_DOLLAR", 2), ("G_COPPER_GOLD", 1), ("C_HY_CHANGE", 1), ("R_REAL10", 1)],
                         ["EEM", "EFA"]),
    "gold_hard_assets": ("Gold and miners; like falling real yields, a weak dollar, fiscal and geopolitical fear",
                         [("R_REAL10", 0.5), ("L_DOLLAR", 1), ("I_BREAKEVEN", -1), ("V_VIX", -0.5), ("R_TERM_PREMIUM", -1)],
                         ["GLD", "GDX"]),
    "crypto_high_beta": ("Bitcoin and levered beta; the purest liquidity trade",
                         [("L_NET_LIQ", 2), ("L_DOLLAR", 1), ("E_HIGH_BETA", 1), ("R_REAL10", 1), ("V_VIX", 1)],
                         ["BTC", "COIN", "MSTR"]),
}


def archetype_fit(sig: dict[str, dict]) -> dict:
    out = {}
    for name, (desc, weights, examples) in ARCHETYPES.items():
        num = den = 0.0
        drivers = []
        for sid, w in weights:
            s = sig.get(sid, {}).get("score")
            if s is None:
                continue
            num += w * s
            den += abs(w)
            drivers.append({"signal": sid, "weight": w, "score": s, "contribution": r(w * s)})
        fit = max(-2.0, min(2.0, num / den)) if den else None
        drivers.sort(key=lambda d: d["contribution"])
        out[name] = {"description": desc, "examples": examples, "fit": r(fit),
                     "stance": None if fit is None else ("tailwind" if fit >= 0.5 else "headwind" if fit <= -0.5 else "neutral"),
                     "runway_macro_fit_pts": None if fit is None else int(round((fit + 2) * 2)),
                     "headwinds": [d["signal"] for d in drivers if d["contribution"] < 0][:3],
                     "tailwinds": [d["signal"] for d in reversed(drivers) if d["contribution"] > 0][:3],
                     "drivers": drivers}
    return out


def perf_table(S: dict[str, Series], group: set[str]) -> list[dict]:
    spy = S.get("SPY")
    rows = []
    for sym, name, g in YAHOO:
        if g not in group or sym not in S:
            continue
        s = S[sym]
        s200 = s.sma(200)
        row = {"symbol": sym, "name": name, "as_of": s.last_date,
               "ret_1m": r(s.pct(D1M), 1), "ret_3m": r(s.pct(D3M), 1), "ret_6m": r(s.pct(D6M), 1), "ret_12m": r(s.pct(D12M), 1),
               "above_200d": None if s200 is None else s.last > s200}
        if spy and sym != "SPY":
            row["rel_1m"] = r((s.pct(D1M) or 0) - (spy.pct(D1M) or 0), 1)
            row["rel_3m"] = r((s.pct(D3M) or 0) - (spy.pct(D3M) or 0), 1)
        rows.append(row)
    rows.sort(key=lambda x: -(x["ret_3m"] or -999))
    return rows


# ----------------------------------------------------------------------------- analogs

ERAS = [
    ("1946-01", "1965-12", "Post-war boom: financial repression, industrial build-out, low inflation"),
    ("1966-01", "1972-12", "Go-go years and Nifty Fifty; inflation starts to build, guns and butter"),
    ("1973-01", "1974-12", "Oil embargo, end of Bretton Woods, 1973-74 bear market"),
    ("1975-01", "1979-09", "Stagflation: negative real rates, commodities and hard assets win"),
    ("1979-10", "1982-07", "Volcker shock: double-digit rates, double-dip recession"),
    ("1982-08", "1989-12", "Disinflationary boom; 1987 crash; LBO era"),
    ("1990-01", "1991-12", "S&L crisis, Gulf War oil spike, recession"),
    ("1992-01", "1994-12", "Jobless recovery; 1994 bond massacre"),
    ("1995-01", "1999-12", "Productivity boom and dot-com mania"),
    ("2000-01", "2002-12", "Dot-com bust, 9/11, accounting scandals"),
    ("2003-01", "2006-12", "Credit and housing boom, commodity super-cycle"),
    ("2007-01", "2009-06", "Global financial crisis"),
    ("2009-07", "2015-12", "QE and ZIRP recovery; taper tantrum 2013"),
    ("2016-01", "2019-12", "Late-cycle expansion, QT and 2018 tightening scare, 2019 repo spike"),
    ("2020-01", "2021-12", "COVID shock and money printing: fiscal plus QE, meme and SPAC mania"),
    ("2022-01", "2023-12", "Inflation shock, fastest hiking cycle since 1980, 2023 regional bank stress"),
    ("2024-01", "2099-12", "AI capex boom, higher for longer, fiscal dominance debate"),
]


def era(month: str) -> str:
    for a, b, text in ERAS:
        if a <= month <= b:
            return text
    return ""


def monthly(s: Series) -> dict[str, float]:
    """Last observation in each calendar month (daily or monthly input)."""
    out: dict[str, float] = {}
    for d, v in zip(s.dates, s.values):
        out[d[:7]] = v
    return out


def add_months(m: str, n: int) -> str:
    y, mo = int(m[:4]), int(m[5:7]) - 1 + n
    return f"{y + mo // 12:04d}-{mo % 12 + 1:02d}"


ANALOG_FEATURES = ["10y level", "10y 12m change", "CPI y/y", "CPI y/y 12m change", "unemployment 12m change",
                   "real fed funds", "10y minus 3m", "Baa minus 10y", "oil y/y (log)"]


def analogs(S: dict[str, Series], top: int = 6, exclude_recent: int = 36, gap: int = 18) -> dict:
    try:
        gs10, tb3, ff, cpi, un, baa, oil, eq = need(S, "GS10", "TB3MS", "FEDFUNDS", "CPIAUCSL", "UNRATE", "BAA", "WTISPLC", "SPASTT01USM661N")
    except Missing as e:
        return {"status": "missing", "read": str(e)}
    G, T, F, C, U, B, O, E = (monthly(x) for x in (gs10, tb3, ff, cpi, un, baa, oil, eq))
    # Use today's daily 10y and 3m so the "now" row is current even before the monthly prints.
    for key, daily in (("DGS10", G), ("DGS3MO", T)):
        if key in S:
            daily.update({S[key].last_date[:7]: S[key].last})

    def feat(m: str) -> list[float] | None:
        p = add_months(m, -12)
        try:
            cy = (C[m] / C[p] - 1) * 100
            cyp = (C[p] / C[add_months(p, -12)] - 1) * 100
            return [G[m], G[m] - G[p], cy, cy - cyp, U[m] - U[p], F[m] - cy, G[m] - T[m], B[m] - G[m], math.log(O[m] / O[p])]
        except (KeyError, ZeroDivisionError, ValueError):
            return None

    months = sorted(set(G) & set(C) & set(U) & set(F) & set(T) & set(B) & set(O))
    rows = {m: v for m in months if (v := feat(m)) is not None}
    if not rows:
        return {"status": "missing", "read": "no overlapping history"}
    now = max(rows)
    cols = list(zip(*rows.values()))
    mu = [statistics.fmean(c) for c in cols]
    sd = [statistics.pstdev(c) or 1 for c in cols]
    z = {m: [(x - a) / b for x, a, b in zip(v, mu, sd)] for m, v in rows.items()}
    cutoff = add_months(now, -exclude_recent)
    dist = sorted((math.dist(z[now], v), m) for m, v in z.items() if m <= cutoff)
    picked: list[tuple[float, str]] = []
    for d, m in dist:
        if all(abs((int(m[:4]) * 12 + int(m[5:])) - (int(p[:4]) * 12 + int(p[5:]))) >= gap for _, p in picked):
            picked.append((d, m))
        if len(picked) == top:
            break

    def fwd(m: str, k: int) -> float | None:
        a, b = E.get(m), E.get(add_months(m, k))
        return None if a is None or b is None else (b / a - 1) * 100

    def maxdd(m: str, k: int = 12) -> float | None:
        a = E.get(m)
        path = [E.get(add_months(m, i)) for i in range(1, k + 1)]
        path = [x for x in path if x is not None]
        return None if a is None or not path else min(0.0, (min(path) / a - 1) * 100)

    out = []
    for d, m in picked:
        g12 = G.get(add_months(m, 12))
        out.append({"month": m, "distance": r(d), "era": era(m),
                    "features": dict(zip(ANALOG_FEATURES, [r(x) for x in rows[m]])),
                    "eq_fwd_6m_pct": r(fwd(m, 6), 1), "eq_fwd_12m_pct": r(fwd(m, 12), 1),
                    "eq_max_dd_12m_pct": r(maxdd(m), 1),
                    "ten_year_chg_12m_pp": r(None if g12 is None else g12 - G[m])})
    f12 = [a["eq_fwd_12m_pct"] for a in out if a["eq_fwd_12m_pct"] is not None]
    return {"status": "ok", "now_month": now, "now_features": dict(zip(ANALOG_FEATURES, [r(x) for x in rows[now]])),
            "method": f"z-scored Euclidean distance over {len(ANALOG_FEATURES)} monthly features since {min(rows)}; "
                      f"excludes the last {exclude_recent} months; picks are at least {gap} months apart; "
                      "equity returns from the OECD US share price index (price only, monthly average)",
            "analogs": out,
            "summary": {"median_fwd_12m_pct": r(statistics.median(f12), 1) if f12 else None,
                        "share_positive_12m": r(sum(1 for x in f12 if x > 0) / len(f12), 2) if f12 else None,
                        "worst_dd_12m_pct": min((a["eq_max_dd_12m_pct"] for a in out if a["eq_max_dd_12m_pct"] is not None), default=None)}}


# ----------------------------------------------------------------------------- outputs

KEY_SERIES = ["DFEDTARL", "DFEDTARU", "DFF", "DGS3MO", "DGS2", "DGS5", "DGS10", "DGS30", "DFII10", "T10Y2Y", "T10Y3M",
              "THREEFYTP10", "T10YIE", "T5YIFR", "^MOVE", "VIXCLS", "^VIX", "^VIX3M", "BAMLC0A0CM", "BAMLH0A0HYM2",
              "BAMLH0A3HYC", "MORTGAGE30US", "DX-Y.NYB", "DTWEXBGS", "JPY=X", "CL=F", "DCOILWTICO", "GC=F", "HG=F",
              "BTC-USD", "NFCI", "STLFSI4", "UNRATE", "ICSA", "GDPNOW", "SPY", "QQQ", "IWM", "UMCSENT", "JTSJOL",
              "A091RC1Q027SBEA", "GFDEBTN", "WSHOMCB", "WRESBAL", "RRPONTSYD", "HOUST", "EXHOSLUSM495S", "HSN1F"]


def previous_run(out_dir: Path) -> dict | None:
    """The newest earlier research/<date>/macro/regime.json (out_dir is research/<date>/macro)."""
    root, mine = out_dir.parent.parent, out_dir.parent.name
    cands = sorted(d for d in root.iterdir() if d.name < mine and (d / "macro" / "regime.json").exists()) if root.exists() else []
    return json.loads((cands[-1] / "macro" / "regime.json").read_text()) if cands else None


def runway_read(arch: dict, regime: dict) -> dict:
    def say(k: str) -> str:
        a = arch.get(k, {})
        if a.get("fit") is None:
            return "not scored: inputs missing"
        return f"{a['stance']} (fit {a['fit']:+.1f}); against: {', '.join(a['headwinds']) or 'none'}; for: {', '.join(a['tailwinds']) or 'none'}"
    return {"long_duration": say("long_duration_growth"), "cash_flow": say("cash_flow_value"), "small_caps": say("small_caps"),
            "regime": f"{regime['label']} ({regime['composite']:+.1f})"}


def write_legacy(runway_dir: Path, snap: dict, regime: dict, arch: dict, narrative: dict | None) -> None:
    def leaf(sid: str, key: str = "value"):
        s = snap.get(sid)
        return None if not s else {"value": s[key], "source": s["source"], "as_of": s["as_of"]}
    out = {}
    lo, hi = snap.get("DFEDTARL"), snap.get("DFEDTARU")
    if lo and hi:
        out["fed_target_pct"] = {"value": f"{lo['value']:.2f}-{hi['value']:.2f}", "source": hi["source"], "as_of": hi["as_of"]}
    for key, sid in [("dgs2_pct", "DGS2"), ("dgs10_pct", "DGS10"), ("dgs30_pct", "DGS30"), ("real10y_pct", "DFII10"),
                     ("t10y2y_pct", "T10Y2Y"), ("ig_oas_pct", "BAMLC0A0CM"), ("hy_oas_pct", "BAMLH0A0HYM2"),
                     ("vix", "VIXCLS"), ("move", "^MOVE"), ("dxy", "DX-Y.NYB"), ("wti", "DCOILWTICO"),
                     ("mortgage30_pct", "MORTGAGE30US"), ("unrate_pct", "UNRATE")]:
        v = leaf(sid)
        if v:
            out[key] = v
    out["themes"] = (narrative or {}).get("themes", [])
    out["events"] = [{"date": e.get("date"), "event": e.get("event")} for e in (narrative or {}).get("events", [])]
    out["regime_read"] = runway_read(arch, regime)
    out["macro_regime"] = {"label": regime["label"], "composite": regime["composite"], "quadrant": regime["quadrant"]["name"],
                           "archetype_fit": {k: v["fit"] for k, v in arch.items()},
                           "runway_macro_fit_pts": {k: v["runway_macro_fit_pts"] for k, v in arch.items()}}
    runway_dir.mkdir(parents=True, exist_ok=True)
    (runway_dir / "macro.json").write_text(json.dumps(out, indent=2))


def fmt(x, spec: str = "+.1f") -> str:
    return "n/a" if x is None else format(x, spec)


def render_md(doc: dict) -> str:
    reg, L = doc["regime"], []
    L.append(f"# Macro regime, {doc['as_of']}\n")
    L.append(f"**{reg['label']}** (composite {reg['composite']:+.1f} on -100..+100; composite alone reads {reg['mechanical_label']}, flags lowered it {reg['flag_notches']} notch(es)) · "
             f"quadrant **{reg['quadrant']['name']}** ({reg['quadrant']['conviction']} conviction) · "
             f"duration **{reg['duration_regime']}** · coverage {reg['coverage']}\n")
    if reg.get("divergence"):
        L.append(f"> {reg['divergence']}\n")
    if doc.get("delta"):
        d = doc["delta"]
        L.append(f"Since {d['prev_as_of']}: composite {d['composite_prev']:+.1f} → {reg['composite']:+.1f}; "
                 f"pillars moved: {', '.join(f'{k} {v:+.0f}' for k, v in d['pillars'].items() if abs(v) >= 5) or 'none by 5+'}\n")
    if reg["flags"]:
        L.append("## Stress flags\n")
        L += [f"- **{f['id']}** ({f['kind']}): {f['text']}" for f in reg["flags"]]
        L.append("")
    L.append("## Pillars\n\n| Pillar | Weight | Score (-100..100) | Signals | Weakest | Strongest |\n|---|---:|---:|---:|---|---|")
    for p in doc["pillars"].values():
        L.append(f"| {p['name']} | {p['weight']} | {fmt(p['score_100'])} | {p['signals_ok']}/{p['signals_total']} | {', '.join(p['worst']) or '-'} | {', '.join(p['best']) or '-'} |")
    L.append("\n## Signals\n\n| Pillar | Signal | Score | Read | As of |\n|---|---|---:|---|---|")
    for s in doc["signals"]:
        L.append(f"| {s['pillar']} | {s['name']} | {'' if s['score'] is None else format(s['score'], '+d')} | {s['read']} | {s.get('as_of', '')} |")
    L.append("\n## Archetype fit (positive = tailwind; runway points 0-8)\n\n| Archetype | Fit | Stance | Runway pts | Against | For |\n|---|---:|---|---:|---|---|")
    for k, a in doc["archetypes"].items():
        L.append(f"| {k} | {fmt(a['fit'])} | {a['stance']} | {a['runway_macro_fit_pts']} | {', '.join(a['headwinds']) or '-'} | {', '.join(a['tailwinds']) or '-'} |")
    t = doc["tilts"]
    L.append(f"\n## Quadrant playbook: {reg['quadrant']['name']}\n\n- Overweight: {', '.join(t['overweight'])}\n- Underweight: {', '.join(t['underweight'])}\n- Duration: {t['duration']}\n" + "".join(f"- Overlay: {o}\n" for o in t["overlays"]))
    for title, key in (("Sectors", "sectors"), ("Factors and styles", "factors")):
        L.append(f"## {title} (sorted by 3m)\n\n| Symbol | Name | 1m | 3m | 12m | vs SPY 3m | >200d |\n|---|---|---:|---:|---:|---:|---|")
        for x in doc["performance"][key]:
            L.append(f"| {x['symbol']} | {x['name']} | {fmt(x['ret_1m'])} | {fmt(x['ret_3m'])} | {fmt(x['ret_12m'])} | {fmt(x.get('rel_3m'))} | {'yes' if x['above_200d'] else 'no'} |")
        L.append("")
    a = doc["analogs"]
    if a.get("status") == "ok":
        L.append(f"## Historical analogs (nearest months to {a['now_month']})\n\n{a['method']}.\n\n| Month | Distance | Era | S&P next 6m | next 12m | max DD 12m | 10y chg 12m |\n|---|---:|---|---:|---:|---:|---:|")
        for x in a["analogs"]:
            L.append(f"| {x['month']} | {x['distance']} | {x['era']} | {fmt(x['eq_fwd_6m_pct'])}% | {fmt(x['eq_fwd_12m_pct'])}% | {fmt(x['eq_max_dd_12m_pct'])}% | {fmt(x['ten_year_chg_12m_pp'], '+.2f')} |")
        s = a["summary"]
        L.append(f"\nMedian next-12m {fmt(s['median_fwd_12m_pct'])}%, positive in {fmt(s['share_positive_12m'], '.0%')} of analogs, worst 12m drawdown {fmt(s['worst_dd_12m_pct'])}%.\n")
    n = doc.get("narrative")
    if n:
        j = n.get("judgment", {})
        L.append("## Judgment (main agent, labelled)\n")
        if j.get("regime_call"):
            L.append(f"**Call: {j['regime_call']}**{'' if j.get('agrees_with_composite', True) else ' (overrides the composite: ' + j.get('override_reason', '') + ')'}\n")
        if j.get("summary"):
            L.append(j["summary"] + "\n")
        for title, key in (("Positioning", "positioning"), ("What changes the call", "what_changes_my_mind")):
            if j.get(key):
                L.append(f"**{title}**\n")
                L += [f"- {x}" for x in j[key]]
                L.append("")
        if n.get("themes"):
            L.append("## Live themes\n\n| Theme | Direction | Counter | Evidence |\n|---|---|---|---|")
            L += [f"| {t['theme']} | {t.get('direction', '')} | {t.get('counter', '')} | {t.get('evidence', '')} |" for t in n["themes"]]
            L.append("")
        if n.get("events"):
            L.append("## Dated events\n\n| Date | Event | Why it matters |\n|---|---|---|")
            L += [f"| {e['date']} | {e['event']} | {e.get('why_it_matters', '')} |" for e in n["events"]]
            L.append("")
        if n.get("risks"):
            L.append("## Risk map\n\n| Risk | Probability | Impact | Tell |\n|---|---|---|---|")
            L += [f"| {x['risk']} | {x.get('probability', '')} | {x.get('impact', '')} | {x.get('tell', '')} |" for x in n["risks"]]
            L.append("")
    if doc["missing"]:
        L.append("## Missing inputs\n")
        L += [f"- {m}" for m in doc["missing"]]
    return "\n".join(L) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=paths.today())
    ap.add_argument("--runway", help="Runway Probe id (<window_end>[-label]): also write its records/macro.json")
    ap.add_argument("--raw", type=Path, help="override data/market/<DATE> (tests only)")
    ap.add_argument("--out", type=Path, help="override data/research/<DATE>/macro (tests only)")
    ap.add_argument("--runway-dir", type=Path, help="override the runway records directory (tests only)")
    ap.add_argument("--force", action="store_true", help="allow --runway to overwrite a probe's existing macro.json from another date")
    args = ap.parse_args()
    args.raw = args.raw or paths.market(args.date)
    args.out = args.out or paths.research(args.date, "macro")
    args.narrative = args.out / "narrative.json"
    if args.runway and not args.runway_dir:
        args.runway_dir = paths.runway_records(args.runway)
    if args.runway_dir and (args.runway_dir / "macro.json").exists() and not args.force \
            and not (args.runway or args.runway_dir.parent.name).startswith(args.date):
        # A probe was scored on the macro file it has; rewriting it with another day's
        # regime silently changes a registered record.
        raise SystemExit(f"refusing to overwrite {args.runway_dir / 'macro.json'} with the {args.date} regime; "
                         "use a probe id dated the same day, or --force")

    S = load(args.raw)
    signals = run_rules(S)
    sig = {s["id"]: s for s in signals}
    pillars = score_pillars(signals)
    comp = composite(pillars)
    flags = stress_flags(sig)
    mech = label_for(comp)
    label, notches = apply_flags(mech, flags)
    q = quadrant(pillars)
    rates_mean = pillars["rates"]["mean"] or 0
    real = sig.get("R_REAL10", {}).get("score")
    duration = "hostile" if rates_mean <= -0.75 or real == -2 else ("supportive" if rates_mean >= 0.5 else "neutral")
    macro_p = [pillars[p]["mean"] for p in ("rates", "credit", "liquidity", "growth", "inflation") if pillars[p]["mean"] is not None]
    macro_mean = sum(macro_p) / len(macro_p) if macro_p else 0
    tape = pillars["internals"]["mean"] or 0
    divergence = ""
    if macro_mean <= -0.3 and tape >= 0.5:
        divergence = "Divergence: macro pillars lean risk-off while the tape is strong. Price is ignoring the macro; either the macro turns or price catches down. Size for the second."
    elif macro_mean >= 0.3 and tape <= -0.5:
        divergence = "Divergence: macro pillars are supportive while the tape is weak. Often a positioning flush inside a benign backdrop."
    ok = sum(1 for s in signals if s["score"] is not None)
    arch = archetype_fit(sig)
    as_of = max((S[k].last_date for k in ("DGS10", "SPY", "BAMLH0A0HYM2") if k in S), default=date.today().isoformat())
    narrative = json.loads(args.narrative.read_text()) if args.narrative and args.narrative.exists() else None

    regime = {"label": label, "mechanical_label": mech, "composite": comp, "quadrant": q, "duration_regime": duration,
              "flags": flags, "flag_notches": notches, "divergence": divergence, "coverage": f"{ok}/{len(signals)} signals",
              "macro_pillars_mean": r(macro_mean), "tape_mean": r(tape)}
    if narrative and narrative.get("judgment", {}).get("regime_call"):
        regime["judgment_call"] = narrative["judgment"]["regime_call"]

    doc = {
        "schema": "macro-regime/1",
        "as_of": as_of,
        "raw_dir": str(args.raw.resolve().relative_to(paths.REPO)) if args.raw.resolve().is_relative_to(paths.REPO) else str(args.raw),
        "regime": regime,
        "pillars": pillars,
        "signals": signals,
        "archetypes": arch,
        "tilts": tilts(q, sig, flags, duration),
        "runway_read": runway_read(arch, regime),
        "series": {k: S[k].snapshot() for k in KEY_SERIES if k in S},
        "derived": {},
        "performance": {"indexes": perf_table(S, {"index", "bonds", "commodity", "crypto", "fx", "international"}),
                        "sectors": perf_table(S, {"sector"}),
                        "factors": perf_table(S, {"factor", "industry"})},
        "analogs": analogs(S),
        "missing": [f"{s['id']}: {s['read']}" for s in signals if s["score"] is None],
    }
    for sid, fn in (("NET_LIQ_BN", lambda: net_liquidity(S)),
                    ("MORTGAGE_SPREAD", lambda: spread(*need(S, "MORTGAGE30US", "DGS10"), "MTG-10Y")),
                    ("CCC_HY_GAP", lambda: spread(*need(S, "BAMLH0A3HYC", "BAMLH0A0HYM2"), "CCC-HY")),
                    ("COPPER_GOLD", lambda: ratio(*need(S, "HG=F", "GC=F"), "CU/AU"))):
        try:
            doc["derived"][sid] = fn().snapshot()
        except Missing:
            pass
    prev = previous_run(args.out)
    if prev:
        doc["delta"] = {"prev_as_of": prev["as_of"], "composite_prev": prev["regime"]["composite"],
                        "label_prev": prev["regime"]["label"],
                        "pillars": {k: r((v["score_100"] or 0) - (prev["pillars"].get(k, {}).get("score_100") or 0), 1) for k, v in pillars.items()},
                        "signals_changed": [{"id": s["id"], "from": prev_s.get("score"), "to": s["score"]}
                                            for s in signals for prev_s in [next((x for x in prev["signals"] if x["id"] == s["id"]), {})]
                                            if prev_s and prev_s.get("score") != s["score"]]}
    if narrative:
        doc["narrative"] = narrative

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "regime.json").write_text(json.dumps(doc, indent=1))
    (args.out / "regime.md").write_text(render_md(doc))
    if args.runway_dir:
        write_legacy(args.runway_dir, doc["series"], regime, arch, narrative)
    print(f"{regime['label']}  composite {comp:+.1f}  quadrant {q['name']}  duration {duration}  coverage {regime['coverage']}")
    for f in flags:
        print(f"  FLAG {f['id']}")
    for m in doc["missing"]:
        print(f"  missing {m}")


if __name__ == "__main__":
    main()
