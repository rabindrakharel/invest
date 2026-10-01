import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { XClient, XApiError, explain, estimateCostUsd } from '../x/client.js'
import { loadResolvedAccounts, requireEnv } from '../lib/config.js'
import { dataRoot } from '../duck/connect.js'
import { readAccountCursors, readHeldIds } from './cursor.js'
import { rawPath, manifestPath, runIdentity, writeJsonlGz } from './writer.js'
import { marketDate, isoUtc } from '../lib/time.js'
import { log, ghError } from '../lib/log.js'
import type { CapturedPost } from '../x/types.js'

/** Cold start: sweep everything recent search still exposes. */
const COLD_START_LOOKBACK_DAYS = 7
/**
 * Recent search rejects a since_id older than its seven-day reach. An account
 * whose cursor is that old is left to `pnpm task:delta` (the timeline lane),
 * never re-read from a wider start_time.
 */
const RECENT_SEARCH_REACH_MS = 6.5 * 86_400_000
/** Abort rather than let a malformed query or a viral day 10x the bill. */
const COST_GUARD_MULTIPLE = 3
const COST_GUARD_FLOOR = 1500

export type CaptureManifest = {
  run_id: string
  attempt: number
  ingest_dt: string
  started_at: string
  finished_at: string
  queries: string[]
  /** Per-account since_id used, keyed by handle; null means cold start. */
  cursors_before: Record<string, string | null>
  /** Accounts whose cursor is past recent search's reach; run `pnpm task:delta`. */
  skipped_stale: string[]
  duplicates_dropped: number
  cursor_before: string | null
  cursor_after: string | null
  pages: number
  posts_read: number
  estimated_cost_usd: number
  files: { path: string; bytes: number; posts: number }[]
  status: 'ok' | 'aborted_cost_guard'
}

function readManifests(root: string): CaptureManifest[] {
  const base = join(root, 'raw')
  if (!existsSync(base)) return []
  const out: CaptureManifest[] = []
  for (const dir of readdirSync(base)) {
    const partition = join(base, dir)
    let entries: string[]
    try { entries = readdirSync(partition) } catch { continue }
    for (const f of entries) {
      if (!f.startsWith('_manifest-')) continue
      try { out.push(JSON.parse(readFileSync(join(partition, f), 'utf8')) as CaptureManifest) } catch { /* ignore */ }
    }
  }
  return out
}

/** Trailing median posts-per-run, used as the cost guard baseline. */
function trailingMedianPosts(manifests: CaptureManifest[]): number | null {
  const counts = manifests
    .filter((m) => m.status === 'ok' && m.cursor_before != null)
    .map((m) => m.posts_read)
    .sort((a, b) => a - b)
  if (counts.length < 5) return null
  return counts[Math.floor(counts.length / 2)] ?? null
}

export type CaptureOptions = {
  /** Cap pages and page size to verify the wiring without paying for a full run. */
  maxPages?: number
  maxResults?: number
}

export async function capture(opts: CaptureOptions = {}): Promise<CaptureManifest> {
  const started = new Date()
  const root = dataRoot()
  const accounts = loadResolvedAccounts()
  const { runId, attempt } = runIdentity()
  const ingestDt = marketDate(started)

  // One query and one since_id PER ACCOUNT. A shared `from:a OR from:b` query
  // can carry only one since_id, so any account ahead of the others would be
  // re-read (and re-billed) from the laggard's cursor.
  const cursors = await readAccountCursors(root)
  const held = await readHeldIds(root)
  const coldStart = isoUtc(new Date(started.getTime() - COLD_START_LOOKBACK_DAYS * 86_400_000))
  const plan: { handle: string; query: string; sinceId: string | undefined; startTime: string | undefined }[] = []
  const cursorsBefore: Record<string, string | null> = {}
  const skippedStale: string[] = []
  for (const a of accounts) {
    const c = cursors.get(a.user_id)
    cursorsBefore[a.handle] = c?.newest_id ?? null
    if (c && started.getTime() - Date.parse(c.newest_at) > RECENT_SEARCH_REACH_MS) {
      skippedStale.push(a.handle)
      continue
    }
    plan.push({ handle: a.handle, query: `from:${a.handle}`, sinceId: c?.newest_id, startTime: c ? undefined : coldStart })
  }
  if (skippedStale.length > 0) {
    ghError(`Cursor older than recent search's reach for ${skippedStale.join(', ')}; run \`pnpm task:delta\` to read them from their last post.`)
  }
  const queries = plan.map((p) => p.query)
  const cursorBefore = [...cursors.values()].reduce<string | null>(
    (m, c) => (m === null || BigInt(c.newest_id) > BigInt(m) ? c.newest_id : m), null)

  log.info('capture.start', {
    runId, attempt, ingestDt, queries: queries.length, skipped_stale: skippedStale.length, cursors_before: cursorsBefore,
  })

  const client = new XClient(requireEnv('X_BEARER_TOKEN'))
  const files: CaptureManifest['files'] = []
  const guard = trailingMedianPosts(readManifests(root))
  const guardLimit = guard === null ? Infinity : Math.max(COST_GUARD_FLOOR, guard * COST_GUARD_MULTIPLE)
  let pages = 0
  let aborted = false
  let newestId: string | null = null
  let duplicates = 0

  outer: for (const { query, sinceId, startTime } of plan) {
    const search = client.searchRecent({
      query,
      sinceId,
      startTime,
      ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
      ...(opts.maxResults !== undefined ? { maxResults: opts.maxResults } : {}),
    })
    for await (const { tweets, users, pageNo } of search) {
      pages++
      const fresh = tweets.filter((t) => !held.has(t.id))
      duplicates += tweets.length - fresh.length
      for (const t of fresh) held.add(t.id)
      if (fresh.length === 0) continue

      // Resolve the author handle at capture time. It is recorded as a
      // point-in-time observation; author_id remains the join key.
      const ingestedAt = isoUtc(new Date())
      const enriched: CapturedPost[] = fresh.map((t) => ({
        ...t,
        _author_username: users.get(t.author_id) ?? '',
        _ingested_at: ingestedAt,
        _run_id: runId,
      }))
      for (const t of fresh) {
        if (newestId === null || BigInt(t.id) > BigInt(newestId)) newestId = t.id
      }

      const path = rawPath(root, ingestDt, runId, attempt, pages)
      const bytes = writeJsonlGz(path, enriched)
      files.push({ path: path.slice(root.length + 1), bytes, posts: enriched.length })
      log.info('capture.page', { pageNo, posts: enriched.length, postsRead: client.postsRead })

      if (client.postsRead > guardLimit) {
        aborted = true
        ghError(
          `Cost guard tripped: ${client.postsRead} posts read exceeds ${guardLimit} ` +
          `(${COST_GUARD_MULTIPLE}x trailing median ${guard}). Captured pages are kept; investigate before rerunning.`,
        )
        break outer
      }
    }
  }

  const manifest: CaptureManifest = {
    run_id: runId,
    attempt,
    ingest_dt: ingestDt,
    started_at: isoUtc(started),
    finished_at: isoUtc(new Date()),
    queries,
    cursors_before: cursorsBefore,
    skipped_stale: skippedStale,
    duplicates_dropped: duplicates,
    cursor_before: cursorBefore,
    cursor_after: newestId ?? cursorBefore,
    pages,
    posts_read: client.postsRead,
    estimated_cost_usd: estimateCostUsd(client.postsRead),
    files,
    status: aborted ? 'aborted_cost_guard' : 'ok',
  }

  mkdirSync(join(root, `raw/ingest_dt=${ingestDt}`), { recursive: true })
  writeFileSync(manifestPath(root, ingestDt, runId, attempt), JSON.stringify(manifest, null, 2) + '\n')
  log.info('capture.done', {
    posts_read: manifest.posts_read,
    estimated_cost_usd: manifest.estimated_cost_usd,
    files: files.length,
    status: manifest.status,
  })
  return manifest
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flag = (name: string): number | undefined => {
    const i = process.argv.indexOf(name)
    return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : undefined
  }
  const opts: CaptureOptions = {}
  const pages = flag('--max-pages'); if (pages !== undefined) opts.maxPages = pages
  const size = flag('--max-results'); if (size !== undefined) opts.maxResults = size
  capture(opts)
    .then((m) => { if (m.status !== 'ok') process.exitCode = 1 })
    .catch((err) => {
      const message = err instanceof XApiError ? explain(err) : String(err)
      ghError(message)
      log.error('capture.failed', { error: message, status: err instanceof XApiError ? err.status : undefined })
      process.exit(1)
    })
}
