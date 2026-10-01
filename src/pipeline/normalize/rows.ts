import { sha256Canonical } from '../lib/hash.js'
import { tradingDayOf } from '../lib/time.js'
import { extractMentions, postType, type Resolver } from './tickers.js'
import { SCHEMA_VERSION } from './parquet.js'
import type { CapturedPost } from '../x/types.js'

export type PostRow = Record<string, unknown>
export type MentionRow = Record<string, unknown>

export function toRows(
  captured: CapturedPost[], ingestDt: string, resolver: Resolver,
): { posts: PostRow[]; mentions: MentionRow[] } {
  const posts: PostRow[] = []
  const mentions: MentionRow[] = []

  for (const c of captured) {
    const createdAt = c.created_at
    const createdMs = Date.parse(createdAt)
    const ingestedAt = c._ingested_at
    const tradingDay = tradingDayOf(new Date(createdMs))
    const type = postType(c)
    const { mentions: found, unresolved } = extractMentions(c, resolver)
    const metrics = c.public_metrics ?? {}
    const ref = c.referenced_tweets?.[0]

    // The raw payload minus our own capture annotations: this hash links the
    // normalized row back to the exact bytes it came from.
    const rawOnly = { ...c } as Record<string, unknown>
    delete rawOnly['_author_username']; delete rawOnly['_ingested_at']; delete rawOnly['_run_id']

    posts.push({
      post_id: c.id,
      author_id: c.author_id,
      author_username: c._author_username,
      created_at: createdAt,
      created_date: createdAt.slice(0, 10),
      trading_day: tradingDay,
      ingest_dt: ingestDt,
      ingested_at: ingestedAt,
      run_id: c._run_id,
      text: c.text ?? '',
      full_text: c.note_tweet?.text ?? null,
      lang: c.lang ?? null,
      post_type: type,
      conversation_id: c.conversation_id ?? null,
      in_reply_to_user_id: c.in_reply_to_user_id ?? null,
      referenced_post_id: ref?.id ?? null,
      referenced_type: ref?.type ?? null,
      like_count_at_ingest: metrics.like_count ?? null,
      retweet_count_at_ingest: metrics.retweet_count ?? null,
      reply_count_at_ingest: metrics.reply_count ?? null,
      quote_count_at_ingest: metrics.quote_count ?? null,
      bookmark_count_at_ingest: metrics.bookmark_count ?? null,
      impression_count_at_ingest: metrics.impression_count ?? null,
      // Metrics are only comparable between posts observed at a similar age.
      metric_age_seconds: Math.max(0, Math.round((Date.parse(ingestedAt) - createdMs) / 1000)),
      // Empty list, never null: mixing the two makes every len(x) > 0 a trap.
      cashtags: (c.entities?.cashtags ?? []).map((x) => x.tag),
      hashtags: (c.entities?.hashtags ?? []).map((x) => x.tag),
      mentioned_user_ids: (c.entities?.mentions ?? []).map((x) => x.id ?? '').filter(Boolean),
      urls: (c.entities?.urls ?? []).map((u) => u.expanded_url ?? u.url),
      media_keys: c.attachments?.media_keys ?? [],
      has_media: (c.attachments?.media_keys ?? []).length > 0,
      unresolved,
      raw_sha256: sha256Canonical(rawOnly),
      schema_version: SCHEMA_VERSION,
    })

    for (const m of found) {
      mentions.push({
        mention_id: `${c.id}:${m.symbol}`,
        post_id: c.id,
        symbol: m.symbol,
        symbol_raw: m.symbol_raw,
        mention_source: m.mention_source,
        asset_class: m.asset_class,
        occurrences: m.occurrences,
        first_char_offset: m.first_char_offset,
        // Denormalised on purpose: every attribution query filters or groups by
        // author and time, so this keeps the lead/lag path join-free.
        author_id: c.author_id,
        author_username: c._author_username,
        created_at: createdAt,
        created_date: createdAt.slice(0, 10),
        trading_day: tradingDay,
        post_type: type,
        ingest_dt: ingestDt,
        run_id: c._run_id,
        schema_version: SCHEMA_VERSION,
      })
    }
  }
  return { posts, mentions }
}

export const POST_COLUMNS: Record<string, string> = {
  post_id: 'CAST(post_id AS VARCHAR)',
  author_id: 'CAST(author_id AS VARCHAR)',
  author_username: 'CAST(author_username AS VARCHAR)',
  created_at: 'CAST(created_at AS TIMESTAMPTZ)',
  created_date: 'CAST(created_date AS DATE)',
  trading_day: 'CAST(trading_day AS DATE)',
  ingest_dt: 'CAST(ingest_dt AS DATE)',
  ingested_at: 'CAST(ingested_at AS TIMESTAMPTZ)',
  run_id: 'CAST(run_id AS VARCHAR)',
  text: 'CAST(text AS VARCHAR)',
  full_text: 'CAST(full_text AS VARCHAR)',
  lang: 'CAST(lang AS VARCHAR)',
  post_type: 'CAST(post_type AS VARCHAR)',
  conversation_id: 'CAST(conversation_id AS VARCHAR)',
  in_reply_to_user_id: 'CAST(in_reply_to_user_id AS VARCHAR)',
  referenced_post_id: 'CAST(referenced_post_id AS VARCHAR)',
  referenced_type: 'CAST(referenced_type AS VARCHAR)',
  like_count_at_ingest: 'CAST(like_count_at_ingest AS INTEGER)',
  retweet_count_at_ingest: 'CAST(retweet_count_at_ingest AS INTEGER)',
  reply_count_at_ingest: 'CAST(reply_count_at_ingest AS INTEGER)',
  quote_count_at_ingest: 'CAST(quote_count_at_ingest AS INTEGER)',
  bookmark_count_at_ingest: 'CAST(bookmark_count_at_ingest AS INTEGER)',
  impression_count_at_ingest: 'CAST(impression_count_at_ingest AS BIGINT)',
  metric_age_seconds: 'CAST(metric_age_seconds AS INTEGER)',
  cashtags: 'CAST(cashtags AS VARCHAR[])',
  hashtags: 'CAST(hashtags AS VARCHAR[])',
  mentioned_user_ids: 'CAST(mentioned_user_ids AS VARCHAR[])',
  urls: 'CAST(urls AS VARCHAR[])',
  media_keys: 'CAST(media_keys AS VARCHAR[])',
  has_media: 'CAST(has_media AS BOOLEAN)',
  unresolved: 'CAST(unresolved AS VARCHAR[])',
  raw_sha256: 'CAST(raw_sha256 AS VARCHAR)',
  schema_version: 'CAST(schema_version AS SMALLINT)',
}

export const MENTION_COLUMNS: Record<string, string> = {
  mention_id: 'CAST(mention_id AS VARCHAR)',
  post_id: 'CAST(post_id AS VARCHAR)',
  symbol: 'CAST(symbol AS VARCHAR)',
  symbol_raw: 'CAST(symbol_raw AS VARCHAR)',
  mention_source: 'CAST(mention_source AS VARCHAR)',
  asset_class: 'CAST(asset_class AS VARCHAR)',
  occurrences: 'CAST(occurrences AS SMALLINT)',
  first_char_offset: 'CAST(first_char_offset AS INTEGER)',
  author_id: 'CAST(author_id AS VARCHAR)',
  author_username: 'CAST(author_username AS VARCHAR)',
  created_at: 'CAST(created_at AS TIMESTAMPTZ)',
  created_date: 'CAST(created_date AS DATE)',
  trading_day: 'CAST(trading_day AS DATE)',
  post_type: 'CAST(post_type AS VARCHAR)',
  ingest_dt: 'CAST(ingest_dt AS DATE)',
  run_id: 'CAST(run_id AS VARCHAR)',
  schema_version: 'CAST(schema_version AS SMALLINT)',
}
