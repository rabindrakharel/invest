import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { connect, rows, dataRoot, requireLayers } from '../../duck/connect.js'
import { writeParquet, SCHEMA_VERSION } from '../../normalize/parquet.js'
import { activeTags, loadEnums, taxonomyVersion } from '../../lib/config.js'
import { sha256, sha256Canonical } from '../../lib/hash.js'
import { log, ghError } from '../../lib/log.js'
import { SESSION_PROMPT_VERSION, buildSpec, type SessionWindow } from './dump.js'
import { PICK_COLUMNS, PICK_TAG_COLUMNS } from '../index.js'

/**
 * Ingests session-subagent output into the picks layer.
 *
 * The subagent lane replaces the API call, NOT the validation. Everything that
 * made the API lane trustworthy applies here unchanged and is re-checked from
 * the corpus rather than taken on the agent's word.
 */

const Source = z.object({ post_id: z.string().min(1), quote: z.string().min(1) })

function buildValidator(): z.ZodType<AccountAnalysis> {
  const enums = loadEnums()
  return z.object({
    account: z.string().min(1),
    profile: z.object({
      beat: z.string().min(1), style: z.string().min(1), cadence: z.string().min(1),
      revisits: z.string().min(1), caveats: z.string().min(1),
    }),
    narrative: z.string().min(1),
    picks: z.array(z.object({
      symbol: z.string().min(1),
      direction: z.enum(enums.direction as [string, ...string[]]),
      prospect: z.string().min(1),
      risk_reward: z.string().min(1),
      thesis: z.string().min(1),
      time_frame: z.enum(enums.time_frame as [string, ...string[]]),
      tags: z.array(z.enum(activeTags() as [string, ...string[]])),
      conviction: z.number().min(0).max(1),
      first_seen: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      sources: z.array(Source).min(1),
    })),
  }) as unknown as z.ZodType<AccountAnalysis>
}

export type AccountAnalysis = {
  account: string
  profile: { beat: string; style: string; cadence: string; revisits: string; caveats: string }
  narrative: string
  picks: {
    symbol: string; direction: string; prospect: string; risk_reward: string; thesis: string
    time_frame: string; tags: string[]; conviction: number; first_seen: string
    sources: { post_id: string; quote: string }[]
  }[]
}

/**
 * Quotes are compared after Unicode and whitespace normalisation only.
 *
 * Curly quotes, non-breaking spaces and zero-width joiners survive a copy that
 * is otherwise faithful, so comparing raw bytes would reject honest output.
 * Everything else - a reworded phrase, a merged sentence, a dropped negation -
 * still fails, which is the point: a quote is evidence, and evidence that does
 * not appear in the cited post is fabricated regardless of how close it reads.
 */
export function normalizeQuote(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export class CitationError extends Error {
  constructor(readonly account: string, readonly offenders: string[]) {
    super(`@${account}: ${offenders.length} citation failure(s):\n  ` + offenders.join('\n  '))
    this.name = 'CitationError'
  }
}

/**
 * The hard gate. A pick may only survive if every post it cites exists in this
 * account's corpus AND the quoted span actually appears in that post.
 *
 * Checking existence alone is not enough here: an author-sliced pass reads
 * ~2000 posts at once, which is exactly the condition under which a plausible
 * quote gets attached to the wrong neighbouring post_id.
 */
export function assertCitations(
  analysis: AccountAnalysis, corpus: Map<string, { text: string; author: string }>,
): void {
  const offenders: string[] = []
  for (const pick of analysis.picks) {
    for (const src of pick.sources) {
      const post = corpus.get(src.post_id)
      if (!post) { offenders.push(`${pick.symbol}: post_id ${src.post_id} is not in the input`); continue }
      if (post.author !== analysis.account) {
        offenders.push(`${pick.symbol}: post_id ${src.post_id} belongs to @${post.author}, not @${analysis.account}`)
        continue
      }
      if (!normalizeQuote(post.text).includes(normalizeQuote(src.quote))) {
        offenders.push(`${pick.symbol}: quote not verbatim in ${src.post_id}: "${src.quote.slice(0, 90)}"`)
      }
    }
    const days = pick.sources.map((s) => s.post_id)
    if (days.length === 0) offenders.push(`${pick.symbol}: no sources`)
  }
  if (offenders.length > 0) throw new CitationError(analysis.account, offenders)
}

/**
 * `check` validates and writes nothing.
 *
 * The subagent lane has a human in the loop, so the useful failure is one an
 * agent can be handed back and asked to fix. Running the real gate in a mode
 * that cannot write means a bad quote is caught while the agent that produced
 * it is still around, rather than after five siblings have already landed.
 */
export async function ingestSession(opts: { inDir?: string; check?: boolean } = {}): Promise<void> {
  const root = dataRoot()
  requireLayers(['posts'], root)
  const inDir = opts.inDir ?? join(root, '_session', 'out')
  if (!existsSync(inDir)) throw new Error(`no subagent output at ${inDir}`)

  const connection = await connect({ data: root })
  // The window is whatever the dump handed the subagents. Fall back to the
  // corpus span only for output produced before WINDOW.json existed.
  const windowPath = join(inDir, '..', 'WINDOW.json')
  let window: Pick<SessionWindow, 'window_start' | 'window_end'>
  if (existsSync(windowPath)) {
    window = JSON.parse(readFileSync(windowPath, 'utf8')) as SessionWindow
  } else {
    const span = (await rows(connection, `
      SELECT min(trading_day)::VARCHAR AS lo, max(trading_day)::VARCHAR AS hi
        FROM posts_v WHERE post_type <> 'retweet'`))[0]
    window = { window_start: String(span?.['lo']), window_end: String(span?.['hi']) }
    log.warn('session.ingest.window_inferred', window)
  }
  const corpus = new Map<string, { text: string; author: string }>()
  for (const r of await rows(connection, `
    SELECT post_id, author_username, COALESCE(full_text, text) AS text
      FROM posts_v WHERE post_type <> 'retweet'`)) {
    corpus.set(String(r['post_id']), { text: String(r['text']), author: String(r['author_username']) })
  }

  const validator = buildValidator()
  const ingestDt = new Date().toISOString().slice(0, 10)
  const taxonomy = taxonomyVersion()
  const specHash = sha256(buildSpec()).slice(0, 16)
  const model = process.env['SESSION_MODEL'] ?? 'claude-opus-5[1m]/session-subagent'

  const pickRows: Record<string, unknown>[] = []
  const tagRows: Record<string, unknown>[] = []
  const failures: string[] = []

  for (const file of readdirSync(inDir).filter((f) => f.endsWith('.json')).sort()) {
    const raw = readFileSync(join(inDir, file), 'utf8')
    let analysis: AccountAnalysis
    try {
      analysis = validator.parse(JSON.parse(raw))
      assertCitations(analysis, corpus)
    } catch (err) {
      failures.push(`${file}: ${String(err).slice(0, 2000)}`)
      continue
    }

    if (!opts.check) {
    mkdirSync(join(root, 'analysis/accounts'), { recursive: true })
    writeFileSync(
      join(root, `analysis/accounts/${analysis.account}.json`),
      JSON.stringify({
        window_start: window.window_start, window_end: window.window_end,
        model, prompt_version: SESSION_PROMPT_VERSION, spec_sha256: specHash,
        taxonomy_version: taxonomy, extracted_at: new Date().toISOString(),
        ...analysis,
      }, null, 2) + '\n',
    )
    }

    const llmHash = sha256Canonical(analysis as unknown as Record<string, unknown>)
    for (const p of analysis.picks) {
      // The account is part of the key: an author-sliced pass will legitimately
      // produce two picks for the same symbol on the same day from two
      // commentators, and collapsing them would silently drop one.
      const pickId = `${p.first_seen}:${p.symbol.toUpperCase()}:${analysis.account}:${SESSION_PROMPT_VERSION}`
      pickRows.push({
        pick_id: pickId, as_of_date: p.first_seen, ingest_dt: ingestDt,
        symbol: p.symbol.toUpperCase(), direction: p.direction, conviction: p.conviction,
        prospect: p.prospect, risk_reward: p.risk_reward, thesis: p.thesis,
        time_frame: p.time_frame, tags: p.tags,
        evidence_post_ids: p.sources.map((s) => s.post_id),
        n_posts: p.sources.length, distinct_authors: 1,
        author_username: analysis.account,
        model, prompt_version: SESSION_PROMPT_VERSION, prompt_sha256: specHash,
        schema_hash: specHash, taxonomy_version: taxonomy,
        extracted_at: new Date().toISOString(), input_tokens: null, output_tokens: null,
        llm_response_sha256: llmHash, schema_version: SCHEMA_VERSION,
      })
      for (const tag of p.tags) {
        tagRows.push({
          pick_id: pickId, as_of_date: p.first_seen, symbol: p.symbol.toUpperCase(), tag,
          taxonomy_version: taxonomy, prompt_version: SESSION_PROMPT_VERSION,
          ingest_dt: ingestDt, schema_version: SCHEMA_VERSION,
        })
      }
    }
    log.info('session.ingest.account', { account: analysis.account, picks: analysis.picks.length })
  }

  if (failures.length > 0) {
    ghError(`session ingest rejected ${failures.length} file(s)`)
    for (const f of failures) log.error('session.ingest.rejected', { detail: f })
    throw new Error(`${failures.length} account file(s) failed validation; nothing was written.`)
  }

  if (opts.check) {
    log.info('session.ingest.check_ok', { picks: pickRows.length, pick_tags: tagRows.length })
    return
  }

  const columns = { ...PICK_COLUMNS, author_username: 'CAST(author_username AS VARCHAR)' }
  await writeParquet({
    rows: pickRows, orderBy: 'author_username, symbol, as_of_date', columns,
    outPath: join(root, `picks/ingest_dt=${ingestDt}/picks-${SESSION_PROMPT_VERSION}-accounts.parquet`),
  })
  await writeParquet({
    rows: tagRows, orderBy: 'symbol, tag, pick_id', columns: PICK_TAG_COLUMNS,
    outPath: join(root, `pick_tags/ingest_dt=${ingestDt}/pick_tags-${SESSION_PROMPT_VERSION}-accounts.parquet`),
  })
  log.info('session.ingest.done', { picks: pickRows.length, pick_tags: tagRows.length })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--in')
  const opts: { inDir?: string; check?: boolean } = {}
  if (i > -1 && process.argv[i + 1]) opts.inDir = process.argv[i + 1]!
  if (process.argv.includes('--check')) opts.check = true
  ingestSession(opts).catch((err) => { console.error(String(err)); process.exit(1) })
}
