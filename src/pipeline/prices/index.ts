import { join } from 'node:path'
import { connect, rows, dataRoot, availableLayers } from '../duck/connect.js'
import { writeParquet, SCHEMA_VERSION } from '../normalize/parquet.js'
import { stooq, type PriceProvider } from './provider.js'
import { marketDate } from '../lib/time.js'
import { log, ghError } from '../lib/log.js'

const PRICE_COLUMNS: Record<string, string> = {
  symbol: 'CAST(symbol AS VARCHAR)',
  trade_date: 'CAST(trade_date AS DATE)',
  adj_close: 'CAST(adj_close AS DOUBLE)',
  price_source: 'CAST(price_source AS VARCHAR)',
  fetched_at: 'CAST(fetched_at AS TIMESTAMPTZ)',
  ingest_dt: 'CAST(ingest_dt AS DATE)',
  schema_version: 'CAST(schema_version AS SMALLINT)',
}

/** Symbols the corpus actually references, with their asset class. */
async function symbolsInCorpus(root: string): Promise<{ symbol: string; asset_class: string }[]> {
  const connection = await connect({ data: root })
  const r = await rows(connection, `
    SELECT symbol, any_value(asset_class) AS asset_class
      FROM mentions_v GROUP BY symbol ORDER BY symbol`)
  return r.map((x) => ({ symbol: String(x['symbol']), asset_class: String(x['asset_class']) }))
}

/** Symbols already covered, so a rerun refreshes rather than re-downloads all. */
async function alreadyPriced(root: string): Promise<Map<string, string>> {
  const covered = new Map<string, string>()
  if (!availableLayers(root).has('prices')) return covered
  const connection = await connect({ data: root })
  const r = await rows(connection, `SELECT symbol, max(trade_date)::VARCHAR AS latest FROM prices_v GROUP BY symbol`)
  for (const row of r) covered.set(String(row['symbol']), String(row['latest']))
  return covered
}

export async function enrich(provider: PriceProvider = stooq): Promise<void> {
  const root = dataRoot()
  if (!availableLayers(root).has('mentions')) {
    log.warn('prices.no_mentions_yet', {})
    return
  }

  const symbols = await symbolsInCorpus(root)
  const covered = await alreadyPriced(root)
  const ingestDt = marketDate(new Date())
  const today = ingestDt

  const out: Record<string, unknown>[] = []
  let skippedNoSeries = 0

  for (const { symbol, asset_class } of symbols) {
    // Already refreshed today: the daily bar has not changed since.
    if (covered.get(symbol) === today) continue
    let bars
    try {
      bars = await provider.fetchDaily(symbol, asset_class)
    } catch (err) {
      log.warn('prices.fetch_failed', { symbol, error: String(err).slice(0, 200) })
      continue
    }
    if (!bars) { skippedNoSeries++; continue }

    // Append-only: adjusted closes are restated after splits and dividends, so
    // each observation is stored with the date it was observed rather than
    // overwriting what we previously believed.
    const fetchedAt = new Date().toISOString()
    for (const bar of bars) {
      out.push({
        symbol, trade_date: bar.trade_date, adj_close: bar.adj_close,
        price_source: provider.name, fetched_at: fetchedAt,
        ingest_dt: ingestDt, schema_version: SCHEMA_VERSION,
      })
    }
  }

  if (out.length === 0) {
    log.info('prices.nothing_written', { symbols: symbols.length, skippedNoSeries })
    return
  }

  await writeParquet({
    rows: out, columns: PRICE_COLUMNS, orderBy: 'symbol, trade_date',
    outPath: join(root, `prices/ingest_dt=${ingestDt}/eod-${provider.name}.parquet`),
  })
  log.info('prices.done', {
    symbols: symbols.length, bars: out.length,
    no_series: skippedNoSeries, provider: provider.name,
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  enrich().catch((err) => {
    ghError(String(err))
    log.error('prices.failed', { error: String(err) })
    process.exit(1)
  })
}
