#!/usr/bin/env python3
"""Render the fresh runway evidence and fixed-template HTML artifact."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
DATA = ROOT / "data/probes/runway/2026-09-17/records"
SRC = ROOT / "data/cache/2026-09-17-runway"
snapshots = {x["ticker"]: x for x in json.loads((SRC / "finviz-snapshots.json").read_text())}
score = json.loads((DATA / "scorecard.json").read_text())
rows = score["rows"]


def n(value, suffix=""):
    if value in (None, "", "-"):
        return "n/f"
    return f"{value}{suffix}"


def metric(ticker, key):
    return snapshots[ticker]["metrics"].get(key)


def pct(value):
    return "n/f" if value is None else f"{value:+.1f}%"


def money(value):
    return "n/f" if value is None else f"${value:,.2f}"


def report_evidence():
    lines = [
        "# Runway Probe evidence — 17 September 2026", "",
        "This file combines the persisted Finviz snapshots, the two verified UBER Form 4 filings, current macro primary sources, and the 17 corpus-tier candidates. Finviz fields are secondary-source screening inputs. TTM ROIC and operating margin are explicitly proxies, not forward values.", "",
        "## Outcome", "",
        "No name passes all four strict runway gates. Current share-based 13F flow was not established for any name. Full 90-day Form 4 coverage was not established, even for UBER, where two purchases were individually verified. Only ADBE and ORCL have a fresh beat-and-guide scorecard in this X window.", "",
        "## Macro", "",
        "- The Federal Reserve raised the target range 25 bp to 3.75–4.00% on 16 September 2026.",
        "- FRED on 16 September: 2-year Treasury 4.74%, 10-year 5.01%, 10-year real yield 2.68%, high-yield OAS 2.70%, VIX 17.71.",
        "- The curve was +27 bp from 2s to 10s. The combination of positive real yields and expensive oil raises the cash-generation hurdle for long-duration growth.", "",
        "## Current screening snapshot", "",
        "| Ticker | Price | Avg PT | Upside | Fwd P/E | PEG | P/FCF | ROIC TTM | Op margin TTM | EPS next Y | Inst trans proxy | Insider trans proxy | Short float | SMA50 / SMA200 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    by_t = {r["ticker"]: r for r in rows}
    for t in score["manifest"]["tickers"]:
        r = by_t[t]
        lines.append(f"| {t} | {money(r['close'])} | {money(r['pt_avg'])} | {pct(r['upside_pct'])} | {n(metric(t,'Forward P/E'))} | {n(metric(t,'PEG'))} | {n(metric(t,'P/FCF'))} | {n(metric(t,'ROIC'))} | {n(metric(t,'Oper. Margin'))} | {n(metric(t,'EPS next Y'))} | {n(metric(t,'Inst Trans'))} | {n(metric(t,'Insider Trans'))} | {n(metric(t,'Short Float'))} | {n(metric(t,'SMA50'))} / {n(metric(t,'SMA200'))} |")
    lines += ["", "## Strict gates and forward-quality coverage", "",
              "| Ticker | Legacy score | R:R | Failed gates | Forward checkpoints passed / covered |",
              "|---|---:|---:|---|---:|"]
    for r in rows:
        fq = r["forward_quality"]
        lines.append(f"| {r['ticker']} | {r['total']} | {n(None if r['risk_reward'] is None else round(r['risk_reward'],1))} | {', '.join(r['gates_failed'])} | {fq['passed']} / {fq['covered']} of 6 possible |")
    lines += [
        "", "## Verified insider evidence", "",
        "- UBER CEO Dara Khosrowshahi bought 141,000 shares on 10 September at a weighted average $70.9642, about $10.01M. Transaction code P. SEC Form 4 accession 0001184237-26-000008.",
        "- UBER President and COO Andrew Macdonald bought 70,000 shares on 4 September across two executions, about $5.31M. Transaction code P. SEC Form 4 accession 0002071761-26-000011.",
        "- These are two independent officer purchases. The overlay treats them as high-conviction corroboration. The mechanical insider gate remains false because every issuer Form 4 in the trailing 90 days was not fully transaction-coded for buys and sells.",
        "", "## Forward-quality read", "",
        "- NVDA is the only name with two covered automatic checkpoints: analyst support and PEG. Its stored forecasts imply FY revenue of $411.49B followed by $682.87B and EPS of $9.31 followed by $15.68. Forward operating-margin expansion, FCF-margin expansion, FCF growth, forward ROIC, ROIC-WACC spread and revision breadth remain unverified.",
        "- NBIS forecasts show revenue of $3.34B followed by $12.06B, but EPS remains negative and the FY26 FCF estimate stored from StockAnalysis is deeply negative. It is an emerging inflection case, not proven compounding.",
        "- TEM forecasts show revenue of $1.60B followed by $1.97B and EPS moving from -$0.26 toward break-even. The stock is already about 16% above the current average target and fails the upside gate.",
        "- Finviz proxy metrics place ORCL, MU, TSM, CRDO and SNDK at low PEGs, but the method does not promote these proxies into verified forward-quality checkpoints without period-aligned estimates.",
        "", "## Provisional research queue", "",
        "1. NVDA: strongest combination of consensus upside, low forward PEG, current margins and corpus convergence. Missing flow, insider-coverage, delivery and six forward fields prevent a high-conviction runway label.",
        "2. ORCL: fresh beat and above-consensus guide, 61% target gap, 13.7x forward P/E and 0.51 PEG proxy. Its price remains below the 200-day average and P/FCF was unavailable.",
        "3. UBER: 43% target gap, 16.0x forward P/E, 14.3x P/FCF and two verified officer buys totaling about $15.3M. Delivery, full insider coverage and institutional flow remain open.",
        "4. TSM: profitable AI infrastructure exposure with 26% target upside, 19.6x forward P/E and 31.2% TTM ROIC. It lacks a fresh scorecard and clean flow evidence in this run.",
        "5. MU, SNDK and CRDO: large target gaps and low PEG proxies, but current risk-to-reward anchors are below 2:1 and the social corpus is crowded in the same memory/interconnect trade.",
        "", "## Files and provenance", "",
        "- Raw X capture: `data/raw/ingest_dt=2026-09-17/`", "- Normalized posts and mentions: `data/posts/ingest_dt=2026-09-17/`, `data/mentions/ingest_dt=2026-09-17/`",
        "- Account evidence: `data/probes/runs/2026-09-17/`", "- Raw outside-source cache: `data/cache/2026-09-17-runway/`",
        "- Per-ticker records and deterministic scoring: `data/probes/runway/2026-09-17/records/`", "",
        "Nothing here is investment advice.",
    ]
    out = ROOT / "data/probes/runway/2026-09-17/evidence.md"
    out.write_text("\n".join(lines) + "\n")
    return out


def report_html():
    template = (ROOT / "src/agent-sdk/assets/skills/runway-probe/template.html").read_text()
    head = template.split('<div class="page">', 1)[0]
    by_t = {r["ticker"]: r for r in rows}
    appx = []
    for t in score["manifest"]["tickers"]:
        r = by_t[t]
        label = (DATA / f"{t}.json")
        rec = json.loads(label.read_text())
        consensus = rec["consensus"]["label"]["value"] or "n/f"
        si = rec["institutions"]["short_pct_float"]["value"]
        insiders = "2 verified officer buys; coverage incomplete" if t == "UBER" else "90d coverage incomplete"
        appx.append(f'<tr><td class="tk">{t}</td><td><span class="pill {r["probe_tier"] if r["probe_tier"] != "satellite" else "sat"}">{r["probe_tier"]}</span></td><td class="num">{money(r["close"])}</td><td class="num">{money(r["pt_avg"])}</td><td class="num">{pct(r["upside_pct"])}</td><td>{consensus} · {r["total"]}</td><td>13F n/f · SI {n(si, "%")}</td><td>{insiders}</td><td>Issuer-confirmed date n/f</td></tr>')
    body = f'''<div class="page">
  <div class="eyebrow">Invest corpus · follow-up to the September Corpus Probe · prices at 17 Sep 2026 close</div>
  <h1 style="margin-top:10px">September Runway Probe</h1>
  <p class="lede">None of the 17 candidates clears all four strict gates with current verified data. NVDA leads the research queue, ORCL has the cleanest fresh delivery, and UBER has the strongest verified insider conviction signal.</p>
  <div class="meta"><span><b>Mandate</b> high return, medium-to-low risk, 1 to 3 years</span><span><b>Names probed</b> 17</span><span><b>Signals</b> fundamentals · flows and positioning · price and chart · forward quality · context</span><span><b>13F vintage</b> not established; flow gate fails</span></div>
  <div class="tiers">
    <div class="tier core"><div class="eyebrow">Runway · all four gates</div><div class="names">None</div><small>No candidate has verified upside, delivery, institutional flow and complete insider coverage together.</small></div>
    <div class="tier watch"><div class="eyebrow">One leg missing</div><div class="names">None</div><small>Every candidate is missing at least two strict gates or lacks enough data to establish them.</small></div>
    <div class="tier sat"><div class="eyebrow">No verified runway</div><div class="names">ADBE · ORCL · UBER · DERM · BDSX · CIEN · NVDA · META · MU · TSM · NBIS · ASTS · TEM · RKLB · CRDO · SNDK · PLTR</div><small>Use the research queue below. Do not convert target gaps into conviction while flow and delivery evidence is missing.</small></div>
  </div>
  <h2>How the signals were read</h2>
  <ul>
    <li><b>Fundamentals.</b> The last print against consensus, guide direction, revisions, cash conversion, competitive trend, and the eight forward-quality metrics.</li>
    <li><b>Flows and positioning.</b> Open-market Form 4 purchases and sales in 90 days, latest 13F share changes, short interest and corpus crowding.</li>
    <li><b>Price and chart.</b> Close against targets, risk to the nearest anchor, and position against the 50-day and 200-day averages.</li>
    <li><b>Context.</b> The 16 September hike, a <span class="num">5.01%</span> ten-year yield, <span class="num">2.68%</span> ten-year real yield, credit, oil and the live AI and memory themes.</li>
  </ul>
  <div class="callout"><b>Reading rule.</b> Upside alone is not runway. Missing data fails a gate rather than receiving an optimistic assumption. Finviz ROIC and operating margin are trailing proxies; they are not mislabeled as forward values.</div>
  <h2>Runway: none pass</h2>
  <div class="tablewrap"><table><thead><tr><th>#</th><th>Name</th><th>Upside · R:R</th><th>Consensus · score</th><th>Institutional flow</th><th>Insiders, 90d</th><th>What can break it</th></tr></thead><tbody><tr><td colspan="7">No candidate passes all four gates with verified current data.</td></tr></tbody></table></div>
  <p class="src">The strict result reflects evidence quality. It is not a claim that all 17 stocks will underperform.</p>
  <h2>One leg missing</h2>
  <dl class="acct"><dt>None</dt><dd>No name is only one gate short. ORCL is closest on delivery and upside, but both institutional flow and complete insider coverage remain unverified.</dd></dl>
  <h2>No runway on the numbers</h2>
  <ul>
    <li><b>At or above consensus.</b> <span class="t">TEM</span> is about <span class="num">16%</span> above the average target.</li>
    <li><b>Modest upside.</b> <span class="t">ADBE · META · PLTR · BDSX</span> show less than <span class="num">20%</span> upside to the current average target.</li>
    <li><b>Delivery missing.</b> Every name except <span class="t">ADBE · ORCL</span> lacks a fresh consensus-comparison scorecard in this X window.</li>
    <li><b>Flow unverified.</b> All 17 lack a clean current share-based 13F record. Finviz institutional-transaction percentages remain visible in the evidence but do not pass the gate.</li>
    <li><b>Insider coverage incomplete.</b> The two UBER purchases are verified from SEC Form 4s, but the full issuer-level 90-day filing set was not completely transaction-coded. Every other name also remains incomplete.</li>
  </ul>
  <h2>Fit to the mandate</h2>
  <p><b>Research queue.</b> <span class="t">NVDA</span> leads on <span class="num">52%</span> proxy upside, a <span class="num">13.97x</span> forward P/E, <span class="num">0.22</span> PEG and strong current profitability. <span class="t">ORCL</span> combines a fresh beat with <span class="num">61%</span> upside and a <span class="num">0.51</span> PEG proxy. <span class="t">UBER</span> combines <span class="num">43%</span> upside, <span class="num">14.31x</span> P/FCF and two verified officer purchases totaling about <span class="num">$15.3M</span>. These are priorities for missing-data completion, not buy labels.</p>
  <p><b>Satellite queue.</b> <span class="t">TSM</span> is the best proven-profitable AI infrastructure complement. <span class="t">MU · SNDK · CRDO</span> have strong growth proxies but weak sub-2:1 risk-to-reward anchors and high theme crowding. <span class="t">NBIS · ASTS · RKLB · TEM</span> remain emerging inflection cases with negative operating economics or event risk.</p>
  <p><b>Forward quality.</b> NVDA passes two of two covered automatic checkpoints, with four of six unverified. TEM covers analyst support only and fails it. NBIS has period-aligned revenue and EPS forecasts, but no checkpoint can pass while EPS and cash generation remain negative. Sparse coverage is never normalized into a high score.</p>
  <h2>All 17 names</h2>
  <div class="tablewrap"><table class="appx"><thead><tr><th>Name</th><th>Probe tier</th><th>Price 17 Sep</th><th>Avg PT</th><th>Upside</th><th>Consensus · score</th><th>Institutional flow · short interest</th><th>Insiders, 90d</th><th>Next dated event</th></tr></thead><tbody>{''.join(appx)}</tbody></table></div>
  <p class="src">Targets, recommendation scores and chart fields are current Finviz screening data. "n/f" means not found or not established. UBER purchases come from original SEC Form 4 filings.</p>
  <h2>What this probe cannot tell you</h2>
  <div class="callout warn">The 13F gate is unavailable rather than negative. Complete 90-day Form 4 coverage is unavailable rather than proof of no activity. Forward operating-margin expansion, FCF-margin expansion, FCF growth, forward ROIC, ROIC-WACC spread and EPS revision breadth remain missing for most names. Chart reads use aggregator moving-average distances. Targets were not checked against broker notes.</div>
  <p>Three things would sharpen the next probe: connect a licensed estimates feed for period-aligned FY1 and FY2 inputs; parse every issuer Form 4 and the latest 13F cycle into share-based flows; and refresh delivery evidence from issuer filings after each earnings report.</p>
  <div class="foot">Sources are Finviz snapshots fetched 17 September 2026, StockAnalysis forecast pages for NVDA, NBIS and TEM, SEC Form 4 filings for UBER, Federal Reserve and FRED macro data, and the account analyses in data/corpus/analysis/accounts. The full scorecard is in data/probes/runway/2026-09-17/evidence.md. Nothing here is investment advice.</div>
</div>'''
    out = ROOT / "data/probes/runway/2026-09-17/probe.html"
    out.write_text(head.replace("<title>MONTH Runway Probe</title>", "<title>September Runway Probe</title>") + body)
    return out


if __name__ == "__main__":
    print(report_evidence())
    print(report_html())
