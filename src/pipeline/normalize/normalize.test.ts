import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizePartition } from './index.js'
import { writeJsonlGz, rawPath } from '../capture/writer.js'
import { connect, rows } from '../duck/connect.js'
import type { CapturedPost } from '../x/types.js'

let root: string

function post(id: string, over: Partial<CapturedPost> = {}): CapturedPost {
  return {
    id, author_id: 'U_A', text: 'buying $NVDA here', created_at: '2026-09-08T13:00:00.000Z',
    public_metrics: { like_count: 10, retweet_count: 2 },
    entities: { cashtags: [{ start: 7, end: 12, tag: 'NVDA' }] },
    _author_username: 'alpha', _ingested_at: '2026-09-08T20:15:00.000Z', _run_id: 'run1',
    ...over,
  } as CapturedPost
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'invest-norm-'))
  // Two files in the SAME partition, with P1 duplicated across them - the shape
  // a retry produces.
  writeJsonlGz(rawPath(root, '2026-09-08', 'run1', 1, 1), [
    post('1001'),
    post('1002', { author_id: 'U_B', _author_username: 'bravo', text: 'RT $NVDA', created_at: '2026-09-08T14:00:00.000Z', referenced_tweets: [{ type: 'retweeted', id: '9' }] }),
  ])
  writeJsonlGz(rawPath(root, '2026-09-08', 'run1', 2, 1), [
    post('1001'),
    post('1003', { text: 'HOOD looks strong to me', entities: {}, created_at: '2026-09-08T15:00:00.000Z' }),
  ])
  await normalizePartition(root, '2026-09-08')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('normalize', () => {
  it('preserves the UTC instant from the raw post through JSON inference', async () => {
    const c = await connect({ data: root })
    const r = await rows(c, `SELECT epoch(created_at) AS seconds FROM posts_v WHERE post_id='1001'`)
    expect(Number(r[0]!['seconds'])).toBe(Date.parse('2026-09-08T13:00:00.000Z') / 1000)
  })

  it('collapses a post duplicated by a retry inside one partition', async () => {
    const c = await connect({ data: root })
    const r = await rows(c, `SELECT post_id FROM posts_v ORDER BY post_id`)
    expect(r.map((x) => x['post_id'])).toEqual(['1001', '1002', '1003'])
  })

  it('assigns the trading day from the ET session boundary', async () => {
    const c = await connect({ data: root })
    const r = await rows(c, `SELECT DISTINCT trading_day::VARCHAR AS d FROM posts_v`)
    expect(r).toEqual([{ d: '2026-09-08' }])
  })

  it('computes metric_age_seconds, which cannot be reconstructed later', async () => {
    const c = await connect({ data: root })
    const r = await rows(c, `SELECT metric_age_seconds FROM posts_v WHERE post_id='1001'`)
    // 13:00Z captured 20:15Z -> 7h15m
    expect(Number(r[0]!['metric_age_seconds'])).toBe(7 * 3600 + 15 * 60)
  })

  it('materialises post_type so attribution can exclude echoes', async () => {
    const c = await connect({ data: root })
    const r = await rows(c, `SELECT post_id FROM mention_events ORDER BY post_id`)
    // 1002 is a retweet and must not earn first-mover credit
    expect(r.map((x) => x['post_id'])).toEqual(['1001'])
  })

  it('writes mentions with denormalised author and time', async () => {
    const c = await connect({ data: root })
    const r = await rows(c, `SELECT symbol, author_username, mention_source, asset_class FROM mentions_v WHERE post_id='1001'`)
    expect(r[0]).toMatchObject({ symbol: 'NVDA', author_username: 'alpha', mention_source: 'cashtag_entity' })
  })

  it('is content-stable: normalizing twice yields identical row content', async () => {
    const c1 = await connect({ data: root })
    const before = await rows(c1, `SELECT post_id, raw_sha256 FROM posts_v ORDER BY post_id`)
    await normalizePartition(root, '2026-09-08')
    const c2 = await connect({ data: root })
    const after = await rows(c2, `SELECT post_id, raw_sha256 FROM posts_v ORDER BY post_id`)
    expect(after).toEqual(before)
  })

  it('records ticker-shaped tokens it could not classify instead of dropping them', async () => {
    const c = await connect({ data: root })
    // HOOD is a real listed ticker written bare, but not on the bare
    // allowlist. It must surface in `unresolved` - the feedback loop that grows
    // the allowlist from evidence - rather than vanish.
    const r = await rows(c, `SELECT list_contains(unresolved, 'HOOD') AS found,
                                    len(unresolved) AS n FROM posts_v WHERE post_id='1003'`)
    expect(r[0]!['found']).toBe(true)
    expect(Number(r[0]!['n'])).toBeGreaterThan(0)
    // ...and it must NOT have been promoted to a mention
    const m = await rows(c, `SELECT count(*) AS n FROM mentions_v WHERE symbol='HOOD'`)
    expect(Number(m[0]!['n'])).toBe(0)
  })
})
