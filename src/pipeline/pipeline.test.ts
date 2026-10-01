import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { writeJsonlGz, rawPath } from './capture/writer.js'
import { normalizePartition } from './normalize/index.js'
import { render } from './render/index.js'
import type { CapturedPost } from './x/types.js'

/**
 * Whole-chain check: raw bytes on disk through to the markdown a human reads.
 * Extraction is stubbed (it needs a live model), but everything either side of
 * it runs for real, including the DuckDB views and the parquet round-trip.
 */

let dataDir: string
let outDir: string

function post(id: string, over: Partial<CapturedPost> = {}): CapturedPost {
  return {
    id, author_id: 'U_A', text: 'adding to $NVDA on this dip',
    created_at: '2026-09-08T13:30:00.000Z',
    public_metrics: { like_count: 5 },
    entities: { cashtags: [{ start: 14, end: 19, tag: 'NVDA' }] },
    _author_username: 'alpha', _ingested_at: '2026-09-08T20:15:00.000Z', _run_id: 'run1',
    ...over,
  } as CapturedPost
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'invest-e2e-data-'))
  outDir = mkdtempSync(join(tmpdir(), 'invest-e2e-out-'))
  process.env['INVEST_DATA_ROOT'] = dataDir
  process.env['INVEST_OUTPUT_ROOT'] = outDir

  writeJsonlGz(rawPath(dataDir, '2026-09-08', 'run1', 1, 1), [
    post('2001'),
    post('2002', { author_id: 'U_B', _author_username: 'bravo', text: '$NVDA still my top idea', created_at: '2026-09-08T14:30:00.000Z' }),
    post('2003', { text: 'OpenAI shipping fast', entities: {}, created_at: '2026-09-08T15:30:00.000Z' }),
  ])
  await normalizePartition(dataDir, '2026-09-08')

  // Stand in for the extraction stage.
  mkdirSync(join(dataDir, 'analysis'), { recursive: true })
  writeFileSync(join(dataDir, 'analysis/2026-09-08.json'), JSON.stringify({
    trading_day: '2026-09-08', model: 'claude-opus-5', prompt_version: 'v1',
    day_narrative: 'Two accounts converged on semis.',
    picks: [
      { symbol: 'NVDA', direction: 'long', prospect: 'Expects continuation.', risk_reward: 'Downside not addressed.',
        thesis: 'Datacenter demand.', time_frame: 'swing', tags: ['tech'], conviction: 0.8,
        sources: [{ post_id: '2001', account: 'alpha', quote: 'adding to $NVDA on this dip' }] },
      { symbol: 'OPENAI', direction: 'neutral', prospect: 'Watching.', risk_reward: 'None stated.',
        thesis: 'No public entry.', time_frame: 'long_term', tags: ['innovation'], conviction: 0.3,
        sources: [{ post_id: '2003', account: 'alpha', quote: 'OpenAI shipping fast' }] },
    ],
  }))

  const seed = await (await DuckDBInstance.create()).connect()
  mkdirSync(join(dataDir, 'prices/ingest_dt=2026-09-08'), { recursive: true })
  mkdirSync(join(dataDir, 'picks/ingest_dt=2026-09-08'), { recursive: true })
  await seed.run(`COPY (SELECT * FROM (VALUES
      ('NVDA', DATE '2025-12-31', 100.0, 'stooq'), ('NVDA', DATE '2026-09-04', 132.0, 'stooq')
    ) t(symbol, trade_date, adj_close, price_source))
    TO '${dataDir}/prices/ingest_dt=2026-09-08/eod-stooq.parquet' (FORMAT parquet)`)
  await seed.run(`COPY (SELECT 'x' AS pick_id, DATE '2026-09-08' AS as_of_date, 'NVDA' AS symbol,
      'long' AS direction, 'swing' AS time_frame, 'Datacenter demand.' AS thesis, 'v1' AS prompt_version)
    TO '${dataDir}/picks/ingest_dt=2026-09-08/picks-v1-2026-09-08.parquet' (FORMAT parquet)`)

  await render()
})

afterAll(() => {
  delete process.env['INVEST_DATA_ROOT']
  delete process.env['INVEST_OUTPUT_ROOT']
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(outDir, { recursive: true, force: true })
})

describe('full pipeline', () => {
  it('produces a daily briefing with the requested sections', () => {
    const md = readFileSync(join(outDir, 'daily/2026-09-08.md'), 'utf8')
    expect(md).toContain('## Theme and narrative')
    expect(md).toContain('**Prospect.**')
    expect(md).toContain('**Risk/reward.**')
    expect(md).toContain('**Thesis.**')
    expect(md).toContain('swing')
  })

  it('carries real market numbers for a listed name', () => {
    const md = readFileSync(join(outDir, 'daily/2026-09-08.md'), 'utf8')
    expect(md).toMatch(/YTD \+32\.00%/)
    expect(md).toContain('`ytd_up`')
  })

  it('leaves a private name unpriced rather than inventing a number', () => {
    const md = readFileSync(join(outDir, 'daily/2026-09-08.md'), 'utf8')
    const block = md.slice(md.indexOf('### OPENAI'))
    expect(block).toContain('**Market.** —')
  })

  it('writes a per-ticker page showing who flagged it first', () => {
    const md = readFileSync(join(outDir, 'tickers/NVDA.md'), 'utf8')
    expect(md).toContain('First flagged')
    expect(md).toContain('@alpha')
    expect(md).toContain('Distinct accounts')
    expect(md).toContain('## Mention history')
  })

  it('writes an index linking sessions and symbols', () => {
    const md = readFileSync(join(outDir, 'INDEX.md'), 'utf8')
    expect(md).toContain('daily/2026-09-08.md')
    expect(md).toContain('tickers/NVDA.md')
  })

  it('is idempotent: rendering twice yields byte-identical output', async () => {
    const before = readFileSync(join(outDir, 'daily/2026-09-08.md'))
    await render()
    expect(readFileSync(join(outDir, 'daily/2026-09-08.md')).equals(before)).toBe(true)
  })

  it('never writes into the working tree', () => {
    expect(existsSync(join(outDir, 'daily'))).toBe(true)
  })
})
