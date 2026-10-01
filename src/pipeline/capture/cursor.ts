import { DuckDBInstance } from '@duckdb/node-api'
import { dataRoot } from '../duck/connect.js'

/**
 * The capture cursors are derived from the RAW layer, never from a mutable state
 * file and never from the normalized layer.
 *
 * Not a state file, because it would be the only path two runs both rewrite -
 * the sole source of rebase conflicts - and a cursor committed out of sync with
 * the data either re-reads (costing money) or skips posts (losing them
 * permanently).
 *
 * Not the normalized layer, because normalize can lag or fail while capture has
 * already committed. Deriving from `posts` would then re-read - and re-pay for -
 * everything captured but not yet normalized.
 *
 * The cursor is PER ACCOUNT. A single global max id is wrong as soon as two
 * accounts were captured to different points (a sweep cut off by a 402, an
 * account added to the allowlist later): the global cursor either re-reads the
 * account that is ahead or silently skips the gap of the one that is behind.
 *
 * Post ids are snowflakes, so the numeric max/min are the newest/oldest held.
 */
export type AccountCursor = {
  author_id: string
  newest_id: string
  oldest_id: string
  newest_at: string
  oldest_at: string
  posts: number
}

async function query(sql: string): Promise<Record<string, unknown>[]> {
  const instance = await DuckDBInstance.create()
  const connection = await instance.connect()
  try {
    return (await connection.runAndReadAll(sql)).getRowObjects() as Record<string, unknown>[]
  } catch (err) {
    // No raw files yet is the expected cold-start case, not a failure.
    if (/No files found|IO Error/i.test(String(err))) return []
    throw err
  }
}

const RAW = (root: string): string =>
  `read_json_auto('${root}/raw/*/*.jsonl.gz', union_by_name => true, ignore_errors => true)`

export async function readAccountCursors(root = dataRoot()): Promise<Map<string, AccountCursor>> {
  const out = new Map<string, AccountCursor>()
  for (const r of await query(`
    SELECT CAST(author_id AS VARCHAR) AS author_id,
           max(CAST(id AS UBIGINT))::VARCHAR AS newest_id,
           min(CAST(id AS UBIGINT))::VARCHAR AS oldest_id,
           strftime(max(CAST(created_at AS TIMESTAMP)), '%Y-%m-%dT%H:%M:%S.000Z') AS newest_at,
           strftime(min(CAST(created_at AS TIMESTAMP)), '%Y-%m-%dT%H:%M:%S.000Z') AS oldest_at,
           count(DISTINCT id) AS posts
      FROM ${RAW(root)}
     WHERE author_id IS NOT NULL
     GROUP BY 1`)) {
    const c: AccountCursor = {
      author_id: String(r['author_id']),
      newest_id: String(r['newest_id']),
      oldest_id: String(r['oldest_id']),
      newest_at: String(r['newest_at']),
      oldest_at: String(r['oldest_at']),
      posts: Number(r['posts']),
    }
    out.set(c.author_id, c)
  }
  return out
}

/** Every post id already held. Used to drop a re-read post before it is written twice. */
export async function readHeldIds(root = dataRoot()): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const r of await query(`SELECT DISTINCT CAST(id AS VARCHAR) AS id FROM ${RAW(root)}`)) ids.add(String(r['id']))
  return ids
}

/**
 * The part of [startTime, endTime) that is NOT already held for one account.
 *
 * At most two segments: the newer side (strictly after the newest held post,
 * by `since_id`, which is exclusive and exact) and the older side (before the
 * oldest held post, only when an explicit start reaches further back than
 * anything held). The span between oldest and newest held is never re-read:
 * every capture has been a contiguous sweep, so it is covered.
 *
 * `refetch` is the explicit opt-in to pay again for the whole window.
 */
export type Segment = {
  side: 'newer' | 'older' | 'full' | 'verify'
  since_id?: string
  start_time?: string
  end_time?: string
}

export function planDelta(
  cursor: AccountCursor | undefined,
  window: { startTime: string; endTime?: string | undefined },
  opts: { refetch?: boolean | undefined; extendBack?: boolean | undefined } = {},
): Segment[] {
  const refetch = !!opts.refetch
  const t = (iso: string): number => Date.parse(iso)
  if (!cursor || refetch) {
    return [{ side: 'full', start_time: window.startTime, ...(window.endTime ? { end_time: window.endTime } : {}) }]
  }
  const segments: Segment[] = []
  // Newer side: only when the window ends after the newest post we hold.
  if (!window.endTime || t(window.endTime) > t(cursor.newest_at)) {
    segments.push({ side: 'newer', since_id: cursor.newest_id, ...(window.endTime ? { end_time: window.endTime } : {}) })
  }
  // Older side: only when asked for (an explicit start) and the window starts
  // before the oldest post we hold. Without it the sweep is strictly "from the
  // last point", and startTime only bounds an account with nothing held yet.
  if (opts.extendBack && t(window.startTime) < t(cursor.oldest_at)) {
    const end = window.endTime && t(window.endTime) < t(cursor.oldest_at) ? window.endTime : cursor.oldest_at
    segments.push({ side: 'older', start_time: window.startTime, end_time: end })
  }
  return segments
}

/**
 * The since_id read is not trustworthy on its own: on 2026-09-24 the timeline
 * endpoint ended a since_id sweep for one account with no next_token and no
 * error, silently skipping 111 posts between the cursor and the oldest post it
 * returned. So every newer-side read is followed by a time-window read of that
 * stretch, from the newest post held to the oldest post just returned (or to
 * the window end when nothing came back). If nothing was skipped this costs the
 * boundary post or two, which are dropped as held.
 */
export function verifySegment(
  cursor: AccountCursor,
  oldestReturned: string | null,
  endTime?: string | undefined,
): Segment | null {
  const end = oldestReturned ?? endTime
  if (end && Date.parse(end) <= Date.parse(cursor.newest_at)) return null
  return { side: 'verify', start_time: cursor.newest_at, ...(end ? { end_time: end } : {}) }
}
