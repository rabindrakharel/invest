#!/usr/bin/env python3
"""Build the 17 September corpus artifact from the fixed skill template."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
template = (ROOT / "src/agent-sdk/assets/skills/corpus-probe/template.html").read_text()
head = template.split('<div class="page">', 1)[0]
body = r'''<div class="page">
  <div class="eyebrow">Invest corpus · 14-account window · 7 Sep to 17 Sep 2026</div>
  <h1 style="margin-top:10px">September Corpus Probe</h1>
  <p class="lede">The fresh window favors earnings-confirmed software first, leaves verified insider buying and small-cap operating inflections on watch, and caps the loud AI infrastructure calls until current cash economics catch up.</p>
  <div class="meta">
    <span><b>Mandate</b> high return, medium-to-low risk, 1 to 3 years</span>
    <span><b>Posts read</b> 2,039 exact-window originals</span>
    <span><b>Formal picks</b> 92 across 14 accounts</span>
    <span><b>Price layer</b> not used here, so no returns are quoted</span>
  </div>

  <div class="tiers">
    <div class="tier core"><div class="eyebrow">Core · earnings-confirmed</div><div class="names">ADBE · ORCL</div><small>Actual beat-and-guide scorecards. Build only after the outside-data probe confirms price, cash conversion and balance-sheet risk.</small></div>
    <div class="tier watch"><div class="eyebrow">Watch · deep-inside signals</div><div class="names">UBER · DERM · BDSX · CIEN</div><small>Insider or operating evidence is promising, but each still needs filing, valuation or durability work before sizing.</small></div>
    <div class="tier sat"><div class="eyebrow">Satellite · high conviction, high beta</div><div class="names">NVDA · META · MU · TSM · NBIS · ASTS · TEM · RKLB · CRDO · SNDK · PLTR</div><small>Strong convergence or conviction without a complete current print in this window. Cap the sleeve.</small></div>
  </div>

  <h2>The lens the corpus itself supplies</h2>
  <p>StockSavvyShay posted August PPI at <span class="num">5.4%</span> YoY versus <span class="num">5.3%</span> expected on 10 September and CPI at <span class="num">3.4%</span> with <span class="num">2.4%</span> core on 11 September. The corpus then moved from expectations of a hold to reports of a <span class="num">25 bp</span> Fed hike on 16 September. LogicalThesis described a Goldilocks path that requires Iran de-escalation, only a symbolic hike and slower AI capex. deerpointmacro remained skeptical that AI productivity gains were broad and focused on labor, weak borrowers, global rates and oil.</p>
  <div class="callout"><b>Portfolio implication.</b> After a hike and with oil and long rates elevated, require current cash generation or an earnings inflection visible in a reported print. Capacity stories with negative operating economics belong in the satellite sleeve.</div>
  <p>LogicalThesis and deerpointmacro are the counterweight to the AI-heavy name accounts. RealJGBanks also shifted toward capital protection and confirmation, while davevermilion favored energy and commodities as an inflation hedge.</p>

  <h2>How each name was probed</h2>
  <ul>
    <li><b>Theme.</b> Is the driver structural or a flow story?</li>
    <li><b>Sentiment.</b> Where is the name on the hated-to-crowded axis, and does more than one account agree?</li>
    <li><b>Earnings.</b> Is there an actual print with consensus comparisons in the corpus, or only a chart?</li>
    <li><b>Analyst and insider.</b> Any sell-side initiation, target change or Form 4 cluster relayed by an account.</li>
    <li><b>Risk.</b> Balance sheet, binary events, concentration, and how reliable the sponsoring account is.</li>
  </ul>

  <h2>Core: the names that pass all five probes</h2>
  <div class="tablewrap"><table><thead><tr><th>Name</th><th>Theme</th><th>Sentiment</th><th>Earnings evidence</th><th>Analyst / insider</th><th>Risk</th><th>Verdict</th></tr></thead><tbody>
    <tr><td class="tk">ADBE</td><td>AI monetization inside a mature, cash-generative software franchise.</td><td>The corpus treats the print as a reset, not a crowded momentum call.</td><td>StockSavvyShay, 10 Sep: revenue <span class="num">$6.76B</span> vs <span class="num">$6.70B</span>; EPS <span class="num">$6.13</span> vs <span class="num">$6.09</span>; AI-first ARR above <span class="num">$650M</span>, up <span class="num">150%</span> YoY; FY26 guide slightly above consensus.</td><td>None in corpus.</td><td class="risk">medium-low</td><td>Core candidate. Start below full size until the runway probe confirms forward margins and revision breadth.</td></tr>
    <tr><td class="tk">ORCL</td><td>Cloud and AI backlog conversion.</td><td>Positive print, but enthusiasm depends on backlog turning into cash.</td><td>StockSavvyShay, 10 Sep: revenue <span class="num">$19.3B</span> vs <span class="num">$19.1B</span>; EPS <span class="num">$1.92</span> vs <span class="num">$1.74</span>; operating income <span class="num">$8.2B</span> vs <span class="num">$7.8B</span>; RPO <span class="num">$664B</span>; FY27 guide above consensus.</td><td>None in corpus.</td><td class="risk">medium</td><td>Core candidate at smaller size. Require evidence that capex does not overwhelm FCF.</td></tr>
  </tbody></table></div>
  <p class="src">Figures are as posted by StockSavvyShay on 10 September. They have not been checked against filings.</p>

  <h2>Deep-inside signals no account turned into a pick</h2>
  <p>The strongest signals came from transaction and news relays. They are leads for primary-source work, not substitutes for it.</p>
  <ul>
    <li><b><span class="t">UBER</span>.</b> stocktalkweekly reported a <span class="num">$5.3M</span> president and COO purchase on 8 September; StockSavvyShay reported a roughly <span class="num">$10M</span> CEO purchase at <span class="num">$70.96</span> on 10 September. Verify both Form 4s and whether either trade was planned.</li>
    <li><b><span class="t">DERM</span>.</b> LogicalThesis reported script reacceleration, positive EBITDA and improving coverage, then identified competition and a legacy patent cliff. Can Emrosi replace the legacy economics before that cliff?</li>
    <li><b><span class="t">BDSX</span>.</b> LogicalThesis cited <span class="num">25%+</span> growth, <span class="num">82%</span> gross margin and <span class="num">45%</span> insider ownership. Does current cash burn support the claimed operating leverage?</li>
    <li><b><span class="t">CIEN</span>.</b> StockSavvyShay relayed management targets near <span class="num">30%</span> annual revenue growth and <span class="num">20%</span> FCF margin by FY2029. How much execution is already in the price?</li>
  </ul>

  <h2>Contested names, and how to read the disagreement</h2>
  <dl class="acct">
    <dt>NVDA</dt><dd>Three accounts are long while TheLongInvest is neutral after the run. Read: keep as a satellite until current upside and cash yield clear the higher-rate hurdle.</dd>
    <dt>CRWV</dt><dd>MarcosMillaYT stays long; StockSavvyShay highlights a quarterly net-interest burden near <span class="num">$640M</span>. Read: pass for this mandate until financing risk falls.</dd>
    <dt>IREN</dt><dd>StockSavvyShay remains constructive on the business but disclosed an exit to fund other ideas. Read: admiration is not a current holding; wait for execution and a fresh entry signal.</dd>
    <dt>LULU</dt><dd>The convergence table contains neutral and short stances without a fresh operating scorecard. Read: no long candidate from this window.</dd>
  </dl>

  <h2>Satellites: the accounts' loudest calls</h2>
  <p>These have real evidence or strong convergence but a risk the mandate cannot carry at core size. Cap the sleeve.</p>
  <ul>
    <li><b><span class="t">NVDA · MU · TSM · CRDO · SNDK</span></b> share the memory, packaging and interconnect thesis. The corpus is highly concentrated in this same trade and supplies no fresh consensus-comparison print for them.</li>
    <li><b><span class="t">META · PLTR</span></b> are distribution and software-layer convictions. The thesis is strong, but corpus enthusiasm is high and valuation is untested here.</li>
    <li><b><span class="t">NBIS</span></b> has three long accounts and a software-plus-compute story. The relayed 2028 earnings inflection requires heavy capacity funding first.</li>
    <li><b><span class="t">ASTS · RKLB</span></b> have credible commercial catalysts. Manufacturing, launch and funding risk keep both out of Core.</li>
    <li><b><span class="t">TEM</span></b> has two bullish accounts and reported call-spread flow. Options activity is not fundamental confirmation.</li>
    <li><b>Pass pending new evidence.</b> <span class="t">ADUR · ALAB · AMD · AMZN · APLD · ASML · AVGO · BABA · BRZU · BUG · CE · CRM · CRWD · CRWV · FAZ · GEV · GOOGL · HIMS · INTC · KURA · MAGS · MRAM · MRVL · MSFT · NET · ONDS · OSCR · QCOM · RIG · SKHY · SMR · SPY · UNH · VRT · WDC · WGS · XOP</span>. Each is a formal call at conviction <span class="num">0.70</span> or higher, but this short window does not supply all five axes.</li>
  </ul>

  <h2>How much to trust each account</h2>
  <dl class="acct">
    <dt>StockSavvyShay</dt><dd>Best source for explicit holdings, AI operating narratives and scorecards. Discount podcast promotion, thematic concentration and relayed claims.</dd>
    <dt>FeroceResearch</dt><dd>Strong memory and connectivity continuity with explicit MU commitment. Discount paid-research context and an incorrect pre-Fed call.</dd>
    <dt>MarcosMillaYT</dt><dd>Persistent semiconductor ranking and conviction. Discount third-party lists, thin downside work and a ticker-label error.</dd>
    <dt>TradexWhisperer</dt><dd>Detailed memory thesis and clear TSM framing. Discount indicator marketing and image-only evidence.</dd>
    <dt>LogicalThesis</dt><dd>Best small-cap risk discussion and willingness to correct the DERM case. Discount leverage, concentration and subscription promotion.</dd>
    <dt>TheLongInvest</dt><dd>Clear position disclosures and patient entries. Discount retrospective wins and unavailable private-group context.</dd>
    <dt>JaguarAnalytics</dt><dd>Separates tactical from core positions. Discount paywalled detail and research-store promotion.</dd>
    <dt>RealJGBanks</dt><dd>Useful confirmation discipline and capital-protection framing. Discount option-win marketing and paywalled live plans.</dd>
    <dt>davevermilion</dt><dd>Useful inflation and commodity counterweight. Discount missing chart context and tactical leveraged products.</dd>
    <dt>deerpointmacro</dt><dd>Strong rates, credit and productivity counterweight. No company-specific stock work.</dd>
    <dt>stocktalkweekly</dt><dd>Fast macro and company-news relay. Most mentions are factual alerts, not investment stances.</dd>
    <dt>CEOStockWatcher</dt><dd>Useful transaction discovery feed. It does not establish conviction, and transaction details require SEC verification.</dd>
    <dt>artemis</dt><dd>Useful private-market and AI-company context. Public-equity claims are sparse.</dd>
    <dt>ruth_capital</dt><dd>Occasional sentiment counterweight. Only five active days and no extractable picks.</dd>
  </dl>

  <h2>What this probe cannot tell you yet</h2>
  <div class="callout warn">The corpus layer has no verified price or return layer. Every figure is what an account posted. CEOStockWatcher ended on 16 September; stocktalkweekly began on 8 September; ruth_capital began on 9 September and posted on only five days; artemis posted on eight days. Insider relays remain unverified until the runway stage reads the original Form 4s.</div>
  <p>Three next steps make the decision sharper: verify the UBER transactions against SEC filings; measure forward margins, FCF, ROIC, revision breadth and valuation for every tiered name; and rerun after the next earnings print rather than extrapolating a short social window.</p>

  <div class="foot">Sources are the 14 account analyses in data/corpus/analysis/accounts, their persisted raw session posts, and the evidence note at data/probes/runs/2026-09-17/evidence/summary.md. Dates are trading days. Nothing here is investment advice.</div>
</div>
'''
(ROOT / "data/probes/corpus").mkdir(parents=True, exist_ok=True)
out = ROOT / "data/probes/corpus/2026-09-17-probe.html"
out.write_text(head.replace("<title>MONTH Corpus Probe</title>", "<title>September Corpus Probe</title>") + body)
print(out)
