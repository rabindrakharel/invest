import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, rows } from './connect.js'

/**
 * These views are the only sanctioned read path for the corpus, and two of
 * their guarantees are easy to break silently:
 *
 *   1. The same post_id legitimately appears in MORE THAN ONE ingest partition,
 *      because partitions are keyed by capture date and search/recent reaches
 *      back 7 days. The dedupe must collapse it.
 *   2. Retweets are echoes and LLM-inferred mentions are not testimony; both
 *      must be excluded from first-mover attribution or the lead/lag
 *      leaderboard is quietly wrong.
 */

let root: string
let conn: DuckDBConnection

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'invest-views-'))
  for (const p of [
    'posts/ingest_dt=2026-09-05', 'posts/ingest_dt=2026-09-06',
    'mentions/ingest_dt=2026-09-05', 'mentions/ingest_dt=2026-09-06',
    'picks/ingest_dt=2026-09-06', 'pick_tags/ingest_dt=2026-09-06',
    'prices/ingest_dt=2026-09-06',
  ]) mkdirSync(join(root, p), { recursive: true })

  const seed = await (await DuckDBInstance.create()).connect()
  await seed.run(`CREATE TABLE p AS SELECT * FROM (VALUES
    ('P1','U_A','alpha',  TIMESTAMPTZ '2026-09-05 13:00:00+00', DATE '2026-09-05','original'),
    ('P2','U_B','bravo',  TIMESTAMPTZ '2026-09-05 15:00:00+00', DATE '2026-09-05','original'),
    ('P3','U_C','charlie',TIMESTAMPTZ '2026-09-05 18:30:00+00', DATE '2026-09-05','retweet'),
    ('P4','U_B','bravo',  TIMESTAMPTZ '2026-09-06 12:00:00+00', DATE '2026-09-06','original'),
    ('P5','U_A','alpha',  TIMESTAMPTZ '2026-09-06 11:00:00+00', DATE '2026-09-06','original')
  ) t(post_id,author_id,author_username,created_at,created_date,post_type)`)

  await seed.run(`COPY (SELECT *, DATE '2026-09-05' AS ingest_dt,
      TIMESTAMPTZ '2026-09-05 20:15:00+00' AS ingested_at FROM p WHERE created_date=DATE '2026-09-05')
    TO '${root}/posts/ingest_dt=2026-09-05/posts-run1-a1.parquet' (FORMAT parquet, COMPRESSION zstd)`)
  // P3 is captured a SECOND time in the next day's window -> duplicate post_id.
  await seed.run(`COPY (SELECT *, DATE '2026-09-06' AS ingest_dt,
      TIMESTAMPTZ '2026-09-06 20:15:00+00' AS ingested_at FROM p
      WHERE created_date=DATE '2026-09-06' OR post_id='P3')
    TO '${root}/posts/ingest_dt=2026-09-06/posts-run2-a1.parquet' (FORMAT parquet, COMPRESSION zstd)`)

  await seed.run(`CREATE TABLE m AS SELECT * FROM (VALUES
    ('P1:NVDA','P1','NVDA','cashtag_entity','U_A','alpha',  TIMESTAMPTZ '2026-09-05 13:00:00+00', DATE '2026-09-05','original'),
    ('P2:NVDA','P2','NVDA','cashtag_entity','U_B','bravo',  TIMESTAMPTZ '2026-09-05 15:00:00+00', DATE '2026-09-05','original'),
    ('P3:NVDA','P3','NVDA','cashtag_entity','U_C','charlie',TIMESTAMPTZ '2026-09-05 18:30:00+00', DATE '2026-09-05','retweet'),
    ('P4:NVDA','P4','NVDA','regex_text',    'U_B','bravo',  TIMESTAMPTZ '2026-09-06 12:00:00+00', DATE '2026-09-06','original'),
    ('P5:NVDA','P5','NVDA','llm',           'U_A','alpha',  TIMESTAMPTZ '2026-09-06 11:00:00+00', DATE '2026-09-06','original')
  ) t(mention_id,post_id,symbol,mention_source,author_id,author_username,created_at,created_date,post_type)`)
  await seed.run(`COPY (SELECT *, DATE '2026-09-05' AS ingest_dt FROM m WHERE created_date=DATE '2026-09-05')
    TO '${root}/mentions/ingest_dt=2026-09-05/mentions-run1.parquet' (FORMAT parquet, COMPRESSION zstd)`)
  await seed.run(`COPY (SELECT *, DATE '2026-09-06' AS ingest_dt FROM m
      WHERE created_date=DATE '2026-09-06' OR mention_id='P3:NVDA')
    TO '${root}/mentions/ingest_dt=2026-09-06/mentions-run2.parquet' (FORMAT parquet, COMPRESSION zstd)`)

  await seed.run(`COPY (SELECT 'x' AS pick_id, DATE '2026-09-06' AS as_of_date, 'NVDA' AS symbol)
    TO '${root}/picks/ingest_dt=2026-09-06/picks-v1-run2.parquet' (FORMAT parquet)`)
  await seed.run(`COPY (SELECT 'x' AS pick_id, DATE '2026-09-06' AS as_of_date, 'tech' AS tag)
    TO '${root}/pick_tags/ingest_dt=2026-09-06/pick_tags-v1-run2.parquet' (FORMAT parquet)`)
  await seed.run(`COPY (SELECT 'NVDA' AS symbol, DATE '2026-09-05' AS trade_date,
      100.0 AS adj_close, 'stooq' AS price_source)
    TO '${root}/prices/ingest_dt=2026-09-06/eod.parquet' (FORMAT parquet)`)

  conn = await connect({ data: root })
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('posts_v', () => {
  it('collapses a post captured in two ingest partitions to a single row', async () => {
    const r = await rows(conn, `SELECT post_id, ingest_dt::VARCHAR AS d FROM posts_v ORDER BY post_id`)
    expect(r.map((x) => x['post_id'])).toEqual(['P1', 'P2', 'P3', 'P4', 'P5'])
    // and it keeps the EARLIEST capture, so first-seen semantics stay honest
    expect(r.find((x) => x['post_id'] === 'P3')?.['d']).toBe('2026-09-05')
  })
})

describe('mention_events', () => {
  it('excludes retweets and llm-inferred mentions from attribution', async () => {
    const r = await rows(conn, `SELECT post_id FROM mention_events ORDER BY post_id`)
    expect(r.map((x) => x['post_id'])).toEqual(['P1', 'P2', 'P4'])
  })
})

describe('author_episode_entry', () => {
  it('groups a burst into one episode and ranks entrants by lead time', async () => {
    const r = await rows(conn, `SELECT author_username,
        ROUND(DATE_DIFF('second', episode_first_at, author_first_at)/3600.0, 2) AS lag_hours,
        episode_n_authors FROM author_episode_entry ORDER BY author_first_at`)
    expect(r).toHaveLength(2)
    expect(r[0]?.['author_username']).toBe('alpha')
    expect(Number(r[0]?.['lag_hours'])).toBe(0)
    expect(Number(r[1]?.['lag_hours'])).toBe(2)
    expect(Number(r[0]?.['episode_n_authors'])).toBe(2)
  })
})
