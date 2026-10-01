import { readdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { dataRoot } from '../duck/connect.js'
import { loadSymbols, loadBlocklist, loadUniverse, loadBareAllowlist } from '../lib/config.js'
import { buildResolver } from './tickers.js'
import { toRows, POST_COLUMNS, MENTION_COLUMNS } from './rows.js'
import { writeParquet } from './parquet.js'
import { log, ghError } from '../lib/log.js'
import type { CapturedPost } from '../x/types.js'

/** `ingest_dt=YYYY-MM-DD` partition directories present in a layer. */
export function partitions(root: string, layer: string): string[] {
  const base = join(root, layer)
  if (!existsSync(base)) return []
  return readdirSync(base)
    .filter((d) => d.startsWith('ingest_dt='))
    .map((d) => d.slice('ingest_dt='.length))
    .sort()
}

function readRawPartition(root: string, ingestDt: string): CapturedPost[] {
  const dir = join(root, `raw/ingest_dt=${ingestDt}`)
  const out: CapturedPost[] = []
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.jsonl.gz')) continue
    const text = gunzipSync(readFileSync(join(dir, file))).toString('utf8')
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      out.push(JSON.parse(line) as CapturedPost)
    }
  }
  return out
}

export async function normalizePartition(root: string, ingestDt: string): Promise<{ posts: number; mentions: number }> {
  const resolver = buildResolver(loadSymbols(), loadBlocklist(), loadUniverse(), loadBareAllowlist())
  const captured = readRawPartition(root, ingestDt)

  // A retry writes an additional file rather than overwriting, so the same post
  // can appear twice within one partition. Collapse here; the views handle the
  // across-partition case.
  const unique = new Map<string, CapturedPost>()
  for (const c of captured) if (!unique.has(c.id)) unique.set(c.id, c)

  const { posts, mentions } = toRows([...unique.values()], ingestDt, resolver)

  // Derived output is replaced wholesale for the partition being rebuilt, so a
  // rebuild after a resolver change cannot leave stale rows behind.
  for (const layer of ['posts', 'mentions']) {
    const dir = join(root, `${layer}/ingest_dt=${ingestDt}`)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }

  await writeParquet({
    rows: posts, columns: POST_COLUMNS, orderBy: 'created_at, post_id',
    outPath: join(root, `posts/ingest_dt=${ingestDt}/posts.parquet`),
  })
  await writeParquet({
    rows: mentions, columns: MENTION_COLUMNS, orderBy: 'created_at, post_id, symbol',
    outPath: join(root, `mentions/ingest_dt=${ingestDt}/mentions.parquet`),
  })

  const unresolvedCount = posts.reduce((n, p) => n + ((p['unresolved'] as string[]).length > 0 ? 1 : 0), 0)
  log.info('normalize.partition', {
    ingest_dt: ingestDt, posts: posts.length, mentions: mentions.length,
    posts_with_unresolved: unresolvedCount,
  })
  return { posts: posts.length, mentions: mentions.length }
}

export async function normalize(opts: { from?: string } = {}): Promise<void> {
  const root = dataRoot()
  const all = partitions(root, 'raw')
  const todo = opts.from ? all.filter((d) => d >= opts.from!) : all
  if (todo.length === 0) {
    log.warn('normalize.nothing_to_do', { raw_partitions: all.length })
    return
  }
  let posts = 0
  let mentions = 0
  for (const ingestDt of todo) {
    const r = await normalizePartition(root, ingestDt)
    posts += r.posts
    mentions += r.mentions
  }
  log.info('normalize.done', { partitions: todo.length, posts, mentions })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fromIdx = process.argv.indexOf('--from')
  const from = fromIdx > -1 ? process.argv[fromIdx + 1] : undefined
  normalize(from ? { from } : {}).catch((err) => {
    ghError(String(err))
    log.error('normalize.failed', { error: String(err) })
    process.exit(1)
  })
}
