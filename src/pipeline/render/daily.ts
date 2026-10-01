import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { computeReturns, returnTags, type Bar, type Returns } from '../prices/returns.js'
import { DISCLAIMER, returnsLine, tagList, postUrl, escapePipes } from './format.js'
import type { Analysis } from '../extract/validate.js'

export type DayInput = {
  tradingDay: string
  analysis: Analysis & { model?: string; prompt_version?: string }
  priceSeries: Map<string, Bar[]>
  postCount: number
  accountCount: number
}

export function renderDaily(input: DayInput): string {
  const { tradingDay, analysis } = input
  const lines: string[] = []

  lines.push(`# ${tradingDay}`)
  lines.push('')
  lines.push(`_${input.postCount} posts from ${input.accountCount} accounts._`)
  lines.push('')
  lines.push('## Theme and narrative')
  lines.push('')
  lines.push(analysis.day_narrative.trim())
  lines.push('')

  if (analysis.picks.length === 0) {
    lines.push('## Picks')
    lines.push('')
    lines.push('_No account expressed a directional view with enough support to record._')
  } else {
    lines.push('## Picks')
    lines.push('')
    lines.push('| Symbol | Direction | Time frame | Conviction | Market |')
    lines.push('|---|---|---|---|---|')
    for (const pick of analysis.picks) {
      const r = returnsFor(input, pick.symbol)
      lines.push(
        `| **${pick.symbol}** | ${pick.direction} | ${pick.time_frame} | ${pick.conviction.toFixed(2)} | ` +
        `${r.as_of ? returnsLine(r) : '—'} |`,
      )
    }
    lines.push('')

    for (const pick of analysis.picks) {
      const r = returnsFor(input, pick.symbol)
      lines.push(`### ${pick.symbol} — ${pick.direction}, ${pick.time_frame}`)
      lines.push('')
      lines.push(`**Tags** ${tagList(pick.tags, returnTags(r))}`)
      lines.push('')
      lines.push(`**Prospect.** ${pick.prospect.trim()}`)
      lines.push('')
      lines.push(`**Risk/reward.** ${pick.risk_reward.trim()}`)
      lines.push('')
      lines.push(`**Thesis.** ${pick.thesis.trim()}`)
      lines.push('')
      lines.push(`**Market.** ${returnsLine(r)}`)
      lines.push('')
      lines.push('**Said by**')
      lines.push('')
      for (const s of pick.sources) {
        lines.push(`- [@${s.account}](${postUrl(s.account, s.post_id)}) — "${escapePipes(s.quote)}"`)
      }
      lines.push('')
    }
  }

  lines.push('---')
  lines.push('')
  lines.push(DISCLAIMER)
  if (analysis.model) {
    lines.push('')
    lines.push(`<sub>Extracted by ${analysis.model} (prompt ${analysis.prompt_version ?? 'v1'}). Returns computed from end-of-day closes, never from the model.</sub>`)
  }
  lines.push('')
  return lines.join('\n')
}

function returnsFor(input: DayInput, symbol: string): Returns {
  const series = input.priceSeries.get(symbol.toUpperCase())
  if (!series) return { as_of: null, close: null, ytd_pct: null, mtd_pct: null, yoy_pct: null }
  return computeReturns(series, input.tradingDay)
}

export function loadAnalysis(root: string, tradingDay: string): (Analysis & { model?: string }) | null {
  const path = join(root, `analysis/${tradingDay}.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Analysis & { model?: string }
}
