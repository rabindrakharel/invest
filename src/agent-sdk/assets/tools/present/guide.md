---
description: "Present tool: show the operator a designed, self-contained HTML5 page inline (report, dashboard, ranked table, inline-SVG chart) with mcp__present__show_html. The answer belongs on the page; the chat text is the verdict."
---

# Present

`show_html({title, html, caption?})` renders an HTML fragment as a card in the operator's chat, sandboxed, and saves it under the run folder. Use it for the finished answer to any research question, not for progress notes.

## Rules

1. **A fragment, not a document.** No `html`, `head`, `body`, `meta`, `link`, `form` or `iframe`; they are stripped. Inline `style` attributes are fine for one-offs, but use the classes below first.
2. **Self-contained.** The page has no network: no external fonts, scripts, images or CDN charts. Draw charts as inline SVG, and put every number in the markup. Inline `<script>` runs but can reach nothing; do not rely on it for content.
3. **Sourced and dated.** Every figure carries its source and as-of date, in a `.src` footer at least. Write "not found" rather than a guess. A stale input is stated first, in a `.callout.warn`.
4. **One idea per page.** Lead with the answer: a `.lede` verdict, then the evidence (`.grid` of `.kpi` cards, a `.table-wrap` table, a chart), then "what would change it", then gaps. Keep it scannable; long prose belongs in the chat or a report file.
5. **Do not repeat the page in the chat.** After presenting, say the verdict in one or two sentences.
6. **Nothing here is investment advice.** End a recommendation page with `<p class="disclaimer">Research, not investment advice.</p>`.

## Design system

| Class | Use |
|---|---|
| `h1 h2 h3`, `p`, `ul`, `code` | text; `.lede` for the verdict, `.muted`, `.small`, `.num` |
| `.grid` / `.grid.wide` | responsive columns for cards |
| `.card` | a bordered panel; holds a `h3` and content |
| `.kpi` | inside a `.card`: `<div class="label">`, `<div class="value">`, `<div class="delta good|bad|warn">` |
| `.badge` + `.good .warn .bad .info` | a status pill: a regime, a stance, a tier |
| `.callout` + `.good .warn .bad` | a highlighted note: stale input, a kill criterion, a flag |
| `.table-wrap > table` | a table; `td.r`/`th.r` right-align numbers; `thead` is sticky |
| `.bar > span` (+ `.good .warn .bad`) | a horizontal meter: `<div class="bar"><span style="width:62%"></span></div>` |
| `.row`, `.spread` | flex rows for inline groups and label/value pairs |
| `.steps` | numbered `ol` of actions or tells |
| `figure`, `figcaption` | wrap an SVG chart and its caption |
| `.chart` on an `<svg>` | classes `.axis`, `.grid-line`, `.line`, and series colors `.s1`..`.s4`. Use `viewBox="0 0 720 240"` (about the rendered width) so the 12px axis text renders at 12px; a small viewBox scales the text up |
| `.src`, `.disclaimer` | source footer; disclaimer |

Colors follow the viewer's light or dark theme automatically; never hard-code a color.

## Example

```html
<p class="lede">Risk-off, but not broken: hold gross at 60% and cap long duration at 15%.</p>
<div class="grid">
  <div class="card kpi"><div class="label">Composite</div><div class="value">-0.42</div><div class="delta bad">risk-off</div></div>
  <div class="card kpi"><div class="label">10y yield</div><div class="value">4.61%</div><div class="delta warn">+18bp in 20d</div></div>
  <div class="card kpi"><div class="label">HY spread</div><div class="value">3.1%</div><div class="delta good">contained</div></div>
</div>
<div class="table-wrap"><table>
  <thead><tr><th>Theme</th><th>Stance</th><th class="r">RS vs SPY</th></tr></thead>
  <tbody><tr><td>Semis</td><td><span class="badge good">Accumulate</span></td><td class="r">+4.1%</td></tr></tbody>
</table></div>
<figure><svg class="chart" viewBox="0 0 720 240" role="img" aria-label="Composite over 60 trading days"><line class="axis" x1="40" y1="200" x2="710" y2="200"/><line class="grid-line" x1="40" y1="100" x2="710" y2="100"/><polyline class="line s1" points="40,140 160,124 280,160 400,148 520,184 640,176 710,192"/><text x="40" y="224">60d ago</text><text x="660" y="224">today</text></svg><figcaption>Composite score, 60 trading days</figcaption></figure>
<div class="callout warn"><strong>What would change it.</strong> A 10y close above 4.8% (FOMC, 2026-10-29).</div>
<p class="src">Sources: macro regime 2026-09-30 (signal ids R12, R31); prices 2026-09-30. <span class="disclaimer">Research, not investment advice.</span></p>
```
