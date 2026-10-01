import { computeReturns, returnTags, type Bar } from '../prices/returns.js'
import { DISCLAIMER, returnsLine, postUrl, escapePipes } from './format.js'

export type TickerMention = {
  trading_day: string
  author_username: string
  post_id: string
  mention_source: string
  post_type: string
}

export type TickerInput = {
  symbol: string
  assetClass: string
  mentions: TickerMention[]
  series: Bar[]
  picks: { as_of_date: string; direction: string; time_frame: string; thesis: string }[]
}

/**
 * The per-ticker page is the thing a folder of daily files cannot produce:
 * who said it first, who followed, and how often the allowlist returns to it.
 */
export function renderTicker(input: TickerInput): string {
  const { symbol, mentions } = input
  const sorted = [...mentions].sort((a, b) => a.trading_day.localeCompare(b.trading_day))
  const first = sorted[0]
  const authors = new Set(sorted.map((m) => m.author_username))
  const days = new Set(sorted.map((m) => m.trading_day))
  const returns = computeReturns(input.series, new Date().toISOString().slice(0, 10))

  const lines: string[] = []
  lines.push(`# ${symbol}`)
  lines.push('')
  lines.push(`_${input.assetClass}_`)
  lines.push('')
  lines.push('| | |')
  lines.push('|---|---|')
  lines.push(`| Mentions | ${sorted.length} |`)
  lines.push(`| Distinct accounts | ${authors.size} |`)
  lines.push(`| Sessions mentioned | ${days.size} |`)
  if (first) {
    lines.push(`| First flagged | ${first.trading_day} by [@${first.author_username}](${postUrl(first.author_username, first.post_id)}) |`)
  }
  lines.push(`| Market | ${returnsLine(returns)} |`)
  const tags = returnTags(returns)
  if (tags.length > 0) lines.push(`| Tags | ${tags.map((t) => `\`${t}\``).join(' ')} |`)
  lines.push('')

  if (input.picks.length > 0) {
    lines.push('## Recorded views')
    lines.push('')
    lines.push('| Session | Direction | Time frame | Thesis |')
    lines.push('|---|---|---|---|')
    for (const p of [...input.picks].sort((a, b) => b.as_of_date.localeCompare(a.as_of_date))) {
      lines.push(`| [${p.as_of_date}](../daily/${p.as_of_date}.md) | ${p.direction} | ${p.time_frame} | ${escapePipes(p.thesis)} |`)
    }
    lines.push('')
  }

  lines.push('## Mention history')
  lines.push('')
  lines.push('| Session | Account | Source | Type |')
  lines.push('|---|---|---|---|')
  for (const m of [...sorted].reverse()) {
    lines.push(`| [${m.trading_day}](../daily/${m.trading_day}.md) | [@${m.author_username}](${postUrl(m.author_username, m.post_id)}) | ${m.mention_source} | ${m.post_type} |`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(DISCLAIMER)
  lines.push('')
  return lines.join('\n')
}
