import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { connect, rows, dataRoot, requireLayers } from '../../duck/connect.js'
import { activeTags, loadEnums, loadTagTaxonomy } from '../../lib/config.js'
import { log } from '../../lib/log.js'

/**
 * Bundles the corpus into one text-only file per account, for the
 * session-subagent extraction lane.
 *
 * The daily lane (src/pipeline/extract/run.ts) sends one trading session to the
 * Anthropic API. This lane instead slices by AUTHOR across the whole captured
 * window and hands each slice to a subagent inside an interactive Claude Code
 * session - no API key, no per-call billing. The trade is deliberate: an
 * author-sliced pass answers "how does this commentator actually operate"
 * (their repertoire, their conviction language, whether they ever revisit a
 * call), which a day-sliced pass structurally cannot see.
 *
 * Two invariants the bundle enforces:
 *   - RETWEETS ARE EXCLUDED. A retweet is an echo, not a call, and the
 *     attribution views already refuse to credit one. Feeding them to an
 *     extractor would let an account earn a pick for someone else's words.
 *   - TEXT ONLY. media_keys and image references never enter the bundle. The
 *     corpus stores media keys, not image bytes, and nothing here resolves
 *     them, so no image can reach a model along this path.
 */

export const SESSION_PROMPT_VERSION = 'v1-acct'

export type BundlePost = {
  post_id: string
  created_at: string
  trading_day: string
  post_type: string
  text: string
}

/** The extraction contract, generated from config/ so the enums cannot drift. */
export function buildSpec(): string {
  const enums = loadEnums()
  const tags = loadTagTaxonomy().filter((t) => t.removed_date === '')
  return `# Account extraction contract (${SESSION_PROMPT_VERSION})

You are a research analyst reading everything ONE market commentator posted over the
window in WINDOW.json (with --since-last, only posts newer than the last extraction). You are reporting what this account claimed. You are not
evaluating whether they were right, and you are not offering investment advice.

## Input

\`<handle>.posts.jsonl\` — one JSON object per line, oldest first:
\`{ post_id, created_at, trading_day, post_type, text }\`.
Retweets are already excluded. There are no images anywhere in this task.

## Output

Write exactly one JSON file to the path you are given. No markdown fence, no prose
around it. It must match this shape:

\`\`\`json
{
  "account": "<handle>",
  "profile": {
    "beat": "What this account actually covers, in 1-2 sentences.",
    "style": "How they express a view: conviction language, position sizing talk, chart vs fundamentals, etc. 2-4 sentences.",
    "cadence": "Post rhythm and format — threads, one-liners, replies, recurring series.",
    "revisits": "Do they revisit or update earlier calls, or only post new ones? Cite post_ids if so.",
    "caveats": "Anything that should make a reader discount this account's record. Say 'none observed' if so."
  },
  "narrative": "The dominant arc of this account over the window, in 4-8 sentences. Where their view changed, say when and why.",
  "picks": [
    {
      "symbol": "TICKER, uppercase, no $",
      "direction": ${JSON.stringify(enums.direction)},
      "prospect": "What the author expects to happen.",
      "risk_reward": "The stated or clearly implied downside against the upside. Say so plainly if the author never addressed risk.",
      "thesis": "Why, in the author's own logic.",
      "time_frame": ${JSON.stringify(enums.time_frame)},
      "tags": ["zero or more of the tags below"],
      "conviction": 0.0,
      "first_seen": "YYYY-MM-DD — trading_day of the earliest post supporting this pick",
      "sources": [
        { "post_id": "must exist in the input", "quote": "verbatim span from THAT post" }
      ]
    }
  ]
}
\`\`\`

### Allowed tags
${tags.map((t) => `- \`${t.tag}\` — ${t.description}`).join('\n')}

## Rules

1. **Every pick cites at least one real post_id from the input.** A pick citing a
   post_id that is not in the file is rejected by the ingest gate and fails the run.
2. **Quotes are verbatim.** Copy the span exactly as written. Never paraphrase inside
   a quote field. Do not fix typos.
3. **A mention is not a pick.** Only include a symbol where the author expressed an
   actual stance. Naming a ticker in passing, or reporting someone else's view, is not
   a pick.
4. **Never state or imply a price, a return, or a percentage move** in any field
   except inside a verbatim quote. Returns are computed elsewhere from real closes; a
   number invented here would silently corrupt the corpus.
5. **conviction is 0-1** and reflects how strongly THIS author committed — hedged
   language is low, "this is my largest position" is high.
6. **Prefer fewer, well-supported picks.** A name the author returned to six times is
   worth more than six names mentioned once.
7. If the author never addressed risk for a pick, say exactly that in \`risk_reward\`.
8. \`first_seen\` must be the trading_day of the earliest post you cite for that pick.
`
}

/**
 * The window the bundles cover. Written next to SPEC.md so that ingest stamps
 * the analyses with the dates the subagents actually saw, rather than a
 * constant that was true for the first run only.
 */
export type SessionWindow = {
  window_start: string
  window_end: string
  from_flag: boolean
  /**
   * The newest post_id handed to a subagent, per handle, across every dump so
   * far. `--since-last` bundles only posts newer than this, so a post is read by
   * an extractor once. Carried forward for accounts with nothing new.
   */
  last_post_ids?: Record<string, string>
}

/**
 * What the previous dump already handed out. Older WINDOW.json files predate
 * last_post_ids, so fall back to the newest post_id in each existing bundle.
 */
export function previousLastPostIds(outDir: string): Record<string, string> {
  const windowPath = join(outDir, 'WINDOW.json')
  if (existsSync(windowPath)) {
    const w = JSON.parse(readFileSync(windowPath, 'utf8')) as SessionWindow
    if (w.last_post_ids) return w.last_post_ids
  }
  const out: Record<string, string> = {}
  if (!existsSync(outDir)) return out
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith('.posts.jsonl')) continue
    let max: bigint | null = null
    for (const line of readFileSync(join(outDir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue
      const id = BigInt((JSON.parse(line) as BundlePost).post_id)
      if (max === null || id > max) max = id
    }
    if (max !== null) out[f.slice(0, -'.posts.jsonl'.length)] = max.toString()
  }
  return out
}

export async function dumpAccounts(
  opts: { outDir?: string; from?: string; to?: string; sinceLast?: boolean; accounts?: string[] } = {},
): Promise<string[]> {
  const root = dataRoot()
  requireLayers(['posts'], root)
  const outDir = opts.outDir ?? join(root, '_session')
  // Read before the old WINDOW.json and bundles are replaced below. Always
  // carried forward, so an explicit --from/--to or --accounts re-read never
  // resets the cursor of accounts it did not touch.
  const carried = previousLastPostIds(outDir)
  const previous = opts.sinceLast ? carried : {}
  const connection = await connect({ data: root })
  // Inclusive trading_day bounds. Without flags the bundle is the whole corpus,
  // which is right for a single backfill and wrong once history accumulates.
  const bounds = [
    opts.from ? `trading_day >= DATE '${opts.from}'` : null,
    opts.to ? `trading_day <= DATE '${opts.to}'` : null,
  ].filter(Boolean).map((c) => ` AND ${c}`).join('')

  // --since-last: per handle, only posts newer than the last one already handed
  // to an extractor. Post ids are snowflakes, so numeric order is time order.
  const handles = Object.keys(previous)
  const delta = handles.length === 0 ? '' : ` AND CASE author_username ${handles
    .map((h) => `WHEN '${h.replace(/'/g, "''")}' THEN CAST(post_id AS UBIGINT) > ${BigInt(previous[h]!).toString()}`)
    .join(' ')} ELSE TRUE END`
  const only = opts.accounts?.length
    ? ` AND author_username IN (${opts.accounts.map((h) => `'${h.replace(/'/g, "''")}'`).join(', ')})`
    : ''
  const filter = bounds + delta + only

  const accounts = (await rows(connection, `
    SELECT author_username AS handle, count(*) AS n
      FROM posts_v WHERE post_type <> 'retweet'${filter}
     GROUP BY 1 ORDER BY n DESC`)).map((r) => String(r['handle']))

  const span = (await rows(connection, `
    SELECT min(trading_day)::VARCHAR AS lo, max(trading_day)::VARCHAR AS hi
      FROM posts_v WHERE post_type <> 'retweet'${filter}`))[0]
  const window: SessionWindow = {
    window_start: opts.from ?? String(span?.['lo'] ?? ''),
    window_end: opts.to ?? String(span?.['hi'] ?? ''),
    from_flag: Boolean(opts.from || opts.to || opts.sinceLast),
    last_post_ids: { ...carried },
  }
  if (!window.window_start || !window.window_end) {
    throw new Error(opts.sinceLast ? 'no posts newer than the last dump; nothing to extract' : 'no non-retweet posts in the requested window')
  }
  // Only now, with something to hand out, is the previous dump replaced: a
  // --since-last with nothing new leaves the last bundles and cursor intact.
  if (opts.sinceLast) {
    // The previous run's subagent output was for the previous window. Leaving it
    // in out/ would let ingest re-stamp it with the new window, so it is moved
    // aside (never deleted) under out/done-<its window_end>/.
    const outFiles = join(outDir, 'out')
    const prevWindow = existsSync(join(outDir, 'WINDOW.json'))
      ? (JSON.parse(readFileSync(join(outDir, 'WINDOW.json'), 'utf8')) as SessionWindow).window_end
      : 'unknown'
    if (existsSync(outFiles)) {
      const done = join(outFiles, `done-${prevWindow}`)
      for (const f of readdirSync(outFiles).filter((x) => x.endsWith('.json'))) {
        mkdirSync(done, { recursive: true })
        renameSync(join(outFiles, f), join(done, f))
      }
    }
  }
  // Replace the bundles and the contract, but never out/: that holds subagent
  // work that may not have been ingested yet, and re-dumping must not cost it.
  mkdirSync(outDir, { recursive: true })
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.posts.jsonl') || f === 'SPEC.md' || f === 'WINDOW.json') rmSync(join(outDir, f), { force: true })
  }

  writeFileSync(join(outDir, 'SPEC.md'), buildSpec())

  const written: string[] = []
  for (const handle of accounts) {
    // COALESCE(full_text, text): note_tweet carries the untruncated body of a
    // long post, and extracting from the truncated form would cite a quote the
    // author's actual post does not contain.
    const posts = (await rows(connection, `
      SELECT post_id, created_at::VARCHAR AS created_at, trading_day::VARCHAR AS trading_day,
             post_type, COALESCE(full_text, text) AS text
        FROM posts_v
       WHERE author_username = '${handle.replace(/'/g, "''")}' AND post_type <> 'retweet'${filter}
       ORDER BY created_at, post_id`)) as unknown as BundlePost[]
    const newest = posts.reduce<bigint | null>((m, p) => (m === null || BigInt(p.post_id) > m ? BigInt(p.post_id) : m), null)
    const prev = window.last_post_ids![handle]
    if (newest !== null && (prev === undefined || newest > BigInt(prev))) window.last_post_ids![handle] = newest.toString()

    const path = join(outDir, `${handle}.posts.jsonl`)
    writeFileSync(path, posts.map((p) => JSON.stringify(p)).join('\n') + '\n')
    written.push(path)
    log.info('session.dump', { handle, posts: posts.length, bytes: Buffer.byteLength(JSON.stringify(posts)) })
  }
  writeFileSync(join(outDir, 'WINDOW.json'), JSON.stringify(window, null, 2) + '\n')
  log.info('session.dump.done', { accounts: written.length, outDir, window, tags: activeTags().length })
  return written
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag)
    return i > -1 ? process.argv[i + 1] : undefined
  }
  const opts: { from?: string; to?: string; sinceLast?: boolean; accounts?: string[] } = {}
  if (process.argv.includes('--since-last')) opts.sinceLast = true
  const only = arg('--accounts'); if (only) opts.accounts = only.split(',').map((h) => h.trim()).filter(Boolean)
  const from = arg('--from'); if (from) opts.from = from
  const to = arg('--to'); if (to) opts.to = to
  dumpAccounts(opts).catch((err) => { console.error(String(err)); process.exit(1) })
}
