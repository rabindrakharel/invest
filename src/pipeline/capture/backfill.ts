import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { XApiError, explain, estimateCostUsd } from '../x/client.js'
import { loadResolvedAccounts, requireEnv } from '../lib/config.js'
import { dataRoot } from '../duck/connect.js'
import { rawPath, manifestPath, runIdentity, writeJsonlGz } from './writer.js'
import { readAccountCursors, readHeldIds, planDelta, verifySegment, type Segment } from './cursor.js'
import { marketDate, isoUtc } from '../lib/time.js'
import { log, ghError } from '../lib/log.js'
import type { CapturedPost, XTweet } from '../x/types.js'

/**
 * Historical backfill from the USER TIMELINE endpoint.
 *
 * `capture` uses /2/tweets/search/recent, which reaches back seven days and no
 * further; anything older is Enterprise-only full-archive. /2/users/:id/tweets
 * has no such window - it walks a single author's timeline back to ~3200 posts
 * - so it is the only affordable way to acquire history that recent search has
 * already dropped.
 *
 * It is INCREMENTAL PER ACCOUNT by default. Each account's newest and oldest
 * held post are derived from data/raw (see cursor.ts), and only the part of the
 * requested window outside that span is read: newer posts by `since_id`, older
 * posts only if the window reaches further back than anything held. A post
 * already held is dropped before it is written, so an overlap can cost at most
 * the read, never a duplicate. `refetch` is the explicit opt-in to pay again.
 * Output lands in the same raw layout, so normalize and everything downstream
 * cannot tell the difference.
 */

const TWEET_FIELDS = [
  'id', 'text', 'created_at', 'author_id', 'lang', 'conversation_id',
  'in_reply_to_user_id', 'public_metrics', 'entities', 'referenced_tweets',
  'note_tweet', 'attachments',
].join(',')

const API = 'https://api.x.com/2'

type TimelinePage = {
  data?: XTweet[]
  meta?: { next_token?: string; result_count?: number; oldest_id?: string; newest_id?: string }
  errors?: { title?: string; detail?: string }[]
}

async function getJson(token: string, path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${API}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, 'user-agent': 'cohuron-invest/0.1' },
    })
    if (res.ok) return res.json()
    const body = await res.text()
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt === maxAttempts) {
      throw new XApiError(`X API ${res.status} on ${path}`, res.status, body.slice(0, 500))
    }
    const header = res.headers.get('retry-after')
    const waitMs = header ? Number(header) * 1000 : Math.min(60_000, 2 ** attempt * 1000)
    log.warn('x.retry', { path, status: res.status, attempt, waitMs })
    await new Promise((r) => setTimeout(r, waitMs))
  }
  throw new Error('unreachable')
}

export type BackfillManifest = {
  run_id: string
  attempt: number
  ingest_dt: string
  mode: 'backfill'
  started_at: string
  finished_at: string
  start_time: string
  end_time: string
  accounts: {
    handle: string; user_id: string; posts: number; pages: number
    oldest: string | null; newest: string | null; truncated: boolean
    /** What was asked of the API for this account; empty when nothing was missing. */
    segments: Segment[]
    /** Posts returned that were already held; read (and billed) but not written. */
    duplicates_dropped: number
  }[]
  /** False only when --refetch asked to re-read what is already held. */
  incremental: boolean
  pages: number
  posts_read: number
  estimated_cost_usd: number
  files: { path: string; bytes: number; posts: number }[]
  status: 'ok' | 'aborted_budget' | 'aborted_error'
  error: string | null
}

export type BackfillOptions = {
  /** Inclusive lower bound, ISO8601. */
  startTime: string
  /** Exclusive upper bound, ISO8601. Defaults to now. */
  endTime?: string
  /** Hard stop on metered posts. This is a real bill, so it is not optional. */
  maxPosts: number
  /** Pages per account; the sweep stops early when the window is covered. */
  maxPagesPerAccount?: number
  maxResults?: number
  /** Report what would be read without writing files. */
  dryRun?: boolean
  /**
   * Restrict the sweep to these handles. Backfill is not incremental - a rerun
   * re-reads and re-pays for every account it touches - so when a 402 or the
   * budget stops a sweep partway down the allowlist, this is how the remaining
   * accounts are fetched without buying the finished ones twice.
   */
  accounts?: string[]
  /** Re-read the whole window even where data/raw already holds it. Costs money. */
  refetch?: boolean
  /**
   * Also read the part of the window older than the oldest post held for an
   * account. Set when the operator gave an explicit --start; otherwise the sweep
   * only moves forward from each account's last captured post.
   */
  extendBack?: boolean
}

export async function backfill(opts: BackfillOptions): Promise<BackfillManifest> {
  const started = new Date()
  const root = dataRoot()
  const all = loadResolvedAccounts()
  const wanted = opts.accounts?.map((h) => h.replace(/^@/, '').toLowerCase())
  const accounts = wanted ? all.filter((a) => wanted.includes(a.handle.toLowerCase())) : all
  if (wanted) {
    const unknown = wanted.filter((h) => !all.some((a) => a.handle.toLowerCase() === h))
    if (unknown.length > 0) throw new Error(`--accounts names handles not in config/accounts.json: ${unknown.join(', ')}`)
  }
  const { runId, attempt } = runIdentity()
  const ingestDt = marketDate(started)
  const endTime = opts.endTime ?? isoUtc(started)
  const token = requireEnv('X_BEARER_TOKEN')

  log.info('backfill.start', {
    runId, ingestDt, accounts: accounts.length,
    start_time: opts.startTime, end_time: endTime, max_posts: opts.maxPosts, dry_run: !!opts.dryRun,
  })

  const files: BackfillManifest['files'] = []
  const perAccount: BackfillManifest['accounts'] = []
  let postsRead = 0
  let pages = 0
  let aborted = false

  let fatal: unknown = null
  try {
  const cursors = await readAccountCursors(root)
  // Always loaded, even under --refetch: re-reading a window (to fill a gap the
  // endpoint skipped) must still never write a post that is already held.
  const held = await readHeldIds(root)
  for (const account of accounts) {
    const cursor = cursors.get(account.user_id)
    const segments = planDelta(
      cursor,
      { startTime: opts.startTime, endTime: opts.endTime },
      { refetch: opts.refetch, extendBack: opts.extendBack },
    )
    let accountPages = 0
    let accountPosts = 0
    let duplicates = 0
    let oldest: string | null = null
    let newest: string | null = null
    let truncated = false
    const maxPages = opts.maxPagesPerAccount ?? 60
    log.info('backfill.plan', { handle: account.handle, segments })

    // Indexed, not for-of: a newer-side read appends its verify segment.
    for (let si = 0; si < segments.length; si++) {
    const segment = segments[si]!
    let nextToken: string | undefined
    let segmentPages = 0
    let segmentOldest: string | null = null
    do {
      if (postsRead >= opts.maxPosts) { aborted = true; break }
      accountPages++
      segmentPages++
      pages++
      const params: Record<string, string> = {
        max_results: String(opts.maxResults ?? 100),
        'tweet.fields': TWEET_FIELDS,
      }
      // since_id is exclusive and exact: the cursor that makes a rerun free.
      if (segment.since_id) params['since_id'] = segment.since_id
      if (segment.start_time) params['start_time'] = segment.start_time
      if (segment.end_time) params['end_time'] = segment.end_time
      if (nextToken) params['pagination_token'] = nextToken

      const page = (await getJson(token, `/users/${account.user_id}/tweets`, params)) as TimelinePage
      for (const e of page.errors ?? []) log.warn('x.partial_error', { title: e.title, detail: e.detail })

      const read = page.data ?? []
      postsRead += read.length
      for (const t of read) if (segmentOldest === null || t.created_at < segmentOldest) segmentOldest = t.created_at
      const tweets = read.filter((t) => !held.has(t.id))
      duplicates += read.length - tweets.length
      for (const t of tweets) held.add(t.id)
      accountPosts += tweets.length

      if (tweets.length > 0) {
        const ingestedAt = isoUtc(new Date())
        const enriched: CapturedPost[] = tweets.map((t) => ({
          ...t,
          // The timeline endpoint is queried per author, so the handle is known
          // from the allowlist and needs no expansion round-trip. author_id is
          // still the join key; this stays a point-in-time observation.
          _author_username: account.handle,
          _ingested_at: ingestedAt,
          _run_id: runId,
        }))
        for (const t of tweets) {
          if (oldest === null || t.created_at < oldest) oldest = t.created_at
          if (newest === null || t.created_at > newest) newest = t.created_at
        }
        if (!opts.dryRun) {
          const path = rawPath(root, ingestDt, runId, attempt, pages)
          const bytes = writeJsonlGz(path, enriched)
          files.push({ path: path.slice(root.length + 1), bytes, posts: enriched.length })
        }
      }

      log.info('backfill.page', {
        handle: account.handle, side: segment.side, page: segmentPages, posts: tweets.length,
        duplicates: read.length - tweets.length, postsRead, oldest,
      })
      nextToken = page.meta?.next_token
      if (segmentPages >= maxPages && nextToken) {
        truncated = true
        log.warn('backfill.max_pages_reached', { handle: account.handle, side: segment.side, segmentPages, accountPosts })
        break
      }
    } while (nextToken)
    if (aborted) break
    if (segment.side === 'newer' && cursor && !truncated) {
      const verify = verifySegment(cursor, segmentOldest, segment.end_time)
      if (verify) segments.push(verify)
    }
    }

    perAccount.push({
      handle: account.handle, user_id: account.user_id, posts: accountPosts,
      pages: accountPages, oldest, newest, truncated, segments, duplicates_dropped: duplicates,
    })
    if (aborted) {
      ghError(`Backfill budget of ${opts.maxPosts} posts reached at @${account.handle}. Captured pages are kept; rerun and the cursor resumes where this stopped.`)
      break
    }
  }
  } catch (err) {
    // Pages already written cost real money and cannot be re-read for free.
    // A 402 or a network fault mid-sweep must therefore still leave a manifest
    // describing exactly what was paid for and how far each account got -
    // otherwise the only record of a partial capture is a pile of anonymous
    // .jsonl.gz files. The error is rethrown after the manifest is on disk.
    fatal = err
  }

  const manifest: BackfillManifest = {
    run_id: runId,
    attempt,
    ingest_dt: ingestDt,
    mode: 'backfill',
    started_at: isoUtc(started),
    finished_at: isoUtc(new Date()),
    start_time: opts.startTime,
    end_time: endTime,
    accounts: perAccount,
    incremental: !opts.refetch,
    pages,
    posts_read: postsRead,
    estimated_cost_usd: estimateCostUsd(postsRead),
    files,
    status: fatal ? 'aborted_error' : aborted ? 'aborted_budget' : 'ok',
    error: fatal ? String(fatal) : null,
  }

  if (!opts.dryRun) {
    mkdirSync(join(root, `raw/ingest_dt=${ingestDt}`), { recursive: true })
    writeFileSync(manifestPath(root, ingestDt, `${runId}-backfill`, attempt), JSON.stringify(manifest, null, 2) + '\n')
  }
  log.info('backfill.done', {
    posts_read: postsRead, estimated_cost_usd: manifest.estimated_cost_usd,
    files: files.length, status: manifest.status,
  })
  if (fatal) throw fatal
  return manifest
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag)
    return i > -1 ? process.argv[i + 1] : undefined
  }
  // Without --start the sweep is strictly from each account's last captured
  // post; --months only sizes the first read of an account with nothing held.
  const months = Number(arg('--months') ?? '2')
  const explicitStart = arg('--start')
  const opts: BackfillOptions = {
    startTime: explicitStart ?? isoUtc(new Date(Date.now() - months * 30 * 86_400_000)),
    maxPosts: Number(arg('--max-posts') ?? '2000'),
    extendBack: Boolean(explicitStart),
  }
  const end = arg('--end'); if (end) opts.endTime = end
  const pp = arg('--max-pages'); if (pp) opts.maxPagesPerAccount = Number(pp)
  const mr = arg('--max-results'); if (mr) opts.maxResults = Number(mr)
  if (process.argv.includes('--dry-run')) opts.dryRun = true
  if (process.argv.includes('--refetch')) opts.refetch = true
  const only = arg('--accounts'); if (only) opts.accounts = only.split(',').map((h) => h.trim()).filter(Boolean)

  backfill(opts)
    .then((m) => { console.log(JSON.stringify(m.accounts, null, 2)); if (m.status !== 'ok') process.exitCode = 1 })
    .catch((err) => {
      const message = err instanceof XApiError ? explain(err) : String(err)
      ghError(message)
      log.error('backfill.failed', { error: message })
      process.exit(1)
    })
}
