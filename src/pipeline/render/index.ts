import { writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { connect, rows, dataRoot, outputRoot, availableLayers } from '../duck/connect.js'
import { renderDaily, loadAnalysis } from './daily.js'
import { renderTicker, type TickerMention } from './ticker.js'
import { DISCLAIMER } from './format.js'
import type { Bar } from '../prices/returns.js'
import { log, ghError } from '../lib/log.js'

async function priceSeries(root: string): Promise<Map<string, Bar[]>> {
  const out = new Map<string, Bar[]>()
  if (!availableLayers(root).has('prices')) return out
  const connection = await connect({ data: root })
  const r = await rows(connection, `SELECT symbol, trade_date::VARCHAR AS d, adj_close FROM prices_v ORDER BY symbol, trade_date`)
  for (const row of r) {
    const symbol = String(row['symbol'])
    const list = out.get(symbol) ?? []
    list.push({ trade_date: String(row['d']), adj_close: Number(row['adj_close']) })
    out.set(symbol, list)
  }
  return out
}

export async function render(): Promise<void> {
  const root = dataRoot()
  const out = outputRoot()
  if (!availableLayers(root).has('posts')) {
    log.warn('render.no_posts_yet', {})
    return
  }
  const connection = await connect({ data: root })
  const series = await priceSeries(root)

  // ---- daily briefings -------------------------------------------------
  const analysisDir = join(root, 'analysis')
  const days = existsSync(analysisDir)
    ? readdirSync(analysisDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort()
    : []

  mkdirSync(join(out, 'daily'), { recursive: true })
  for (const day of days) {
    const analysis = loadAnalysis(root, day)
    if (!analysis) continue
    const stats = await rows(connection, `
      SELECT count(*) AS posts, count(DISTINCT author_id) AS accounts
        FROM posts_v WHERE trading_day = DATE '${day}'`)
    const md = renderDaily({
      tradingDay: day,
      analysis,
      priceSeries: series,
      postCount: Number(stats[0]?.['posts'] ?? 0),
      accountCount: Number(stats[0]?.['accounts'] ?? 0),
    })
    writeFileSync(join(out, `daily/${day}.md`), md)
  }

  // ---- per-ticker pages ------------------------------------------------
  mkdirSync(join(out, 'tickers'), { recursive: true })
  // Queried flat and grouped here rather than with list(struct_pack(...)):
  // DuckDB returns nested values as wrapper objects, not plain JS arrays.
  const mentionRows = await rows(connection, `
    SELECT symbol, asset_class, trading_day::VARCHAR AS trading_day, author_username,
           post_id, mention_source, post_type
      FROM mentions_v ORDER BY symbol, trading_day, post_id`)

  const bySymbol = new Map<string, { assetClass: string; mentions: TickerMention[] }>()
  for (const row of mentionRows) {
    const symbol = String(row['symbol'])
    const entry = bySymbol.get(symbol) ?? { assetClass: String(row['asset_class']), mentions: [] }
    entry.mentions.push({
      trading_day: String(row['trading_day']),
      author_username: String(row['author_username']),
      post_id: String(row['post_id']),
      mention_source: String(row['mention_source']),
      post_type: String(row['post_type']),
    })
    bySymbol.set(symbol, entry)
  }

  const hasPicks = availableLayers(root).has('picks')
  for (const [symbol, entry] of [...bySymbol.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const picks = hasPicks
      ? (await rows(connection, `
          SELECT as_of_date::VARCHAR AS as_of_date, direction, time_frame, thesis
            FROM picks_v WHERE symbol = '${symbol.replace(/'/g, "''")}'`)) as unknown as
          { as_of_date: string; direction: string; time_frame: string; thesis: string }[]
      : []
    writeFileSync(
      join(out, `tickers/${symbol.replace(/[^A-Za-z0-9._-]/g, '_')}.md`),
      renderTicker({ symbol, assetClass: entry.assetClass, mentions: entry.mentions, series: series.get(symbol) ?? [], picks }),
    )
  }

  // ---- index -----------------------------------------------------------
  const lines: string[] = ['# Index', '']
  lines.push(`_${days.length} sessions · ${bySymbol.size} symbols tracked._`, '')
  lines.push('## Sessions', '')
  for (const day of [...days].reverse()) lines.push(`- [${day}](daily/${day}.md)`)
  lines.push('', '## Symbols', '')
  for (const symbol of [...bySymbol.keys()].sort()) {
    lines.push(`- [${symbol}](tickers/${symbol.replace(/[^A-Za-z0-9._-]/g, '_')}.md)`)
  }
  lines.push('', '---', '', DISCLAIMER, '')
  writeFileSync(join(out, 'INDEX.md'), lines.join('\n'))

  log.info('render.done', { sessions: days.length, tickers: bySymbol.size })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  render().catch((err) => {
    ghError(String(err))
    log.error('render.failed', { error: String(err) })
    process.exit(1)
  })
}
