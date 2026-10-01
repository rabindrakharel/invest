import type { Returns } from '../prices/returns.js'

export const DISCLAIMER =
  '_Not investment advice. This is a record of what a fixed set of accounts said, not an evaluation of whether they were right._'

/** An absent return renders as an em dash. Never as 0, which reads as data. */
export function pctCell(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function returnsLine(r: Returns | undefined): string {
  if (!r || r.as_of === null) return '—'
  return `YTD ${pctCell(r.ytd_pct)} · MTD ${pctCell(r.mtd_pct)} · YoY ${pctCell(r.yoy_pct)} _(close ${r.close?.toFixed(2)} on ${r.as_of})_`
}

export function tagList(qualitative: string[], quantitative: string[]): string {
  const all = [...qualitative, ...quantitative]
  return all.length === 0 ? '—' : all.map((t) => `\`${t}\``).join(' ')
}

export function postUrl(account: string, postId: string): string {
  return `https://x.com/${account}/status/${postId}`
}

export function escapePipes(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}
