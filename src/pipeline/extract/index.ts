import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { connect, rows, dataRoot, requireLayers } from '../duck/connect.js'
import { writeParquet, SCHEMA_VERSION } from '../normalize/parquet.js'
import { extractDay, type PostForPrompt } from './run.js'
import { taxonomyVersion } from '../lib/config.js'
import { sha256Canonical } from '../lib/hash.js'
import { log, ghError } from '../lib/log.js'
import { PROMPT_VERSION } from './prompt.js'

/** Sessions with fewer posts than this are not worth an extraction call. */
const MIN_POSTS = 3

async function tradingDaysNeedingExtraction(root: string, from?: string): Promise<string[]> {
  const connection = await connect({ data: root })
  const filter = from ? `WHERE trading_day >= DATE '${from}'` : ''
  const all = await rows(connection, `SELECT DISTINCT trading_day::VARCHAR AS d FROM posts_v ${filter} ORDER BY d`)
  const days = all.map((r) => String(r['d']))

  // picks are append-only and versioned by prompt: a day already extracted at
  // THIS prompt version is skipped, but a new prompt version re-extracts
  // additively rather than overwriting the earlier judgment.
  const donePath = join(root, 'picks')
  if (!existsSync(donePath)) return days
  const done = await rows(connection, `SELECT DISTINCT as_of_date::VARCHAR AS d FROM picks_v WHERE prompt_version = '${PROMPT_VERSION}'`)
    .catch(() => [] as Record<string, unknown>[])
  const seen = new Set(done.map((r) => String(r['d'])))
  return days.filter((d) => !seen.has(d))
}

export async function extract(opts: { from?: string; only?: string } = {}): Promise<void> {
  const root = dataRoot()
  requireLayers(['posts'], root)

  const days = opts.only ? [opts.only] : await tradingDaysNeedingExtraction(root, opts.from)
  if (days.length === 0) {
    log.info('extract.nothing_to_do', {})
    return
  }

  const connection = await connect({ data: root })
  for (const day of days) {
    const posts = (await rows(connection, `
      SELECT post_id, author_username, created_at::VARCHAR AS created_at, post_type,
             COALESCE(full_text, text) AS text
        FROM posts_v WHERE trading_day = DATE '${day}' AND post_type <> 'retweet'
       ORDER BY created_at, post_id`)) as unknown as PostForPrompt[]

    if (posts.length < MIN_POSTS) {
      log.info('extract.skipped_thin_session', { day, posts: posts.length })
      continue
    }

    const { analysis, meta } = await extractDay(day, posts)

    mkdirSync(join(root, 'analysis'), { recursive: true })
    writeFileSync(
      join(root, `analysis/${day}.json`),
      JSON.stringify({ trading_day: day, ...meta, ...analysis }, null, 2) + '\n',
    )

    const ingestDt = new Date().toISOString().slice(0, 10)
    const llmHash = sha256Canonical(analysis)
    const taxonomy = taxonomyVersion()

    const pickRows = analysis.picks.map((p) => ({
      pick_id: `${day}:${p.symbol}:${meta.prompt_version}`,
      as_of_date: day,
      ingest_dt: ingestDt,
      symbol: p.symbol.toUpperCase(),
      direction: p.direction,
      conviction: p.conviction,
      prospect: p.prospect,
      risk_reward: p.risk_reward,
      thesis: p.thesis,
      time_frame: p.time_frame,
      tags: p.tags,
      evidence_post_ids: p.sources.map((s) => s.post_id),
      n_posts: p.sources.length,
      distinct_authors: new Set(p.sources.map((s) => s.account)).size,
      model: meta.model,
      prompt_version: meta.prompt_version,
      prompt_sha256: meta.prompt_sha256,
      schema_hash: meta.schema_hash,
      taxonomy_version: taxonomy,
      extracted_at: meta.extracted_at,
      input_tokens: meta.input_tokens,
      output_tokens: meta.output_tokens,
      llm_response_sha256: llmHash,
      schema_version: SCHEMA_VERSION,
    }))

    const tagRows = analysis.picks.flatMap((p) => p.tags.map((tag) => ({
      pick_id: `${day}:${p.symbol}:${meta.prompt_version}`,
      as_of_date: day,
      symbol: p.symbol.toUpperCase(),
      tag,
      taxonomy_version: taxonomy,
      prompt_version: meta.prompt_version,
      ingest_dt: ingestDt,
      schema_version: SCHEMA_VERSION,
    })))

    await writeParquet({
      rows: pickRows, orderBy: 'symbol', columns: PICK_COLUMNS,
      outPath: join(root, `picks/ingest_dt=${ingestDt}/picks-${meta.prompt_version}-${day}.parquet`),
    })
    await writeParquet({
      rows: tagRows, orderBy: 'symbol, tag', columns: PICK_TAG_COLUMNS,
      outPath: join(root, `pick_tags/ingest_dt=${ingestDt}/pick_tags-${meta.prompt_version}-${day}.parquet`),
    })

    log.info('extract.day', {
      day, posts: posts.length, picks: pickRows.length,
      input_tokens: meta.input_tokens, output_tokens: meta.output_tokens, attempts: meta.attempts,
    })
  }
}

export const PICK_COLUMNS: Record<string, string> = {
  pick_id: 'CAST(pick_id AS VARCHAR)',
  as_of_date: 'CAST(as_of_date AS DATE)',
  ingest_dt: 'CAST(ingest_dt AS DATE)',
  symbol: 'CAST(symbol AS VARCHAR)',
  direction: 'CAST(direction AS VARCHAR)',
  conviction: 'CAST(conviction AS DOUBLE)',
  prospect: 'CAST(prospect AS VARCHAR)',
  risk_reward: 'CAST(risk_reward AS VARCHAR)',
  thesis: 'CAST(thesis AS VARCHAR)',
  time_frame: 'CAST(time_frame AS VARCHAR)',
  tags: 'CAST(tags AS VARCHAR[])',
  evidence_post_ids: 'CAST(evidence_post_ids AS VARCHAR[])',
  n_posts: 'CAST(n_posts AS SMALLINT)',
  distinct_authors: 'CAST(distinct_authors AS SMALLINT)',
  model: 'CAST(model AS VARCHAR)',
  prompt_version: 'CAST(prompt_version AS VARCHAR)',
  prompt_sha256: 'CAST(prompt_sha256 AS VARCHAR)',
  schema_hash: 'CAST(schema_hash AS VARCHAR)',
  taxonomy_version: 'CAST(taxonomy_version AS VARCHAR)',
  extracted_at: 'CAST(extracted_at AS TIMESTAMPTZ)',
  input_tokens: 'CAST(input_tokens AS INTEGER)',
  output_tokens: 'CAST(output_tokens AS INTEGER)',
  llm_response_sha256: 'CAST(llm_response_sha256 AS VARCHAR)',
  schema_version: 'CAST(schema_version AS SMALLINT)',
}

export const PICK_TAG_COLUMNS: Record<string, string> = {
  pick_id: 'CAST(pick_id AS VARCHAR)',
  as_of_date: 'CAST(as_of_date AS DATE)',
  symbol: 'CAST(symbol AS VARCHAR)',
  tag: 'CAST(tag AS VARCHAR)',
  taxonomy_version: 'CAST(taxonomy_version AS VARCHAR)',
  prompt_version: 'CAST(prompt_version AS VARCHAR)',
  ingest_dt: 'CAST(ingest_dt AS DATE)',
  schema_version: 'CAST(schema_version AS SMALLINT)',
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag)
    return i > -1 ? process.argv[i + 1] : undefined
  }
  const opts: { from?: string; only?: string } = {}
  const from = arg('--from'); if (from) opts.from = from
  const only = arg('--day'); if (only) opts.only = only
  extract(opts).catch((err) => {
    ghError(String(err))
    log.error('extract.failed', { error: String(err) })
    process.exit(1)
  })
}
