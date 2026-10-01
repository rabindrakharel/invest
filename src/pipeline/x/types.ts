/** Subset of the X API v2 payload this pipeline depends on. */

export type XPublicMetrics = {
  like_count?: number
  retweet_count?: number
  reply_count?: number
  quote_count?: number
  bookmark_count?: number
  impression_count?: number
}

export type XReferencedTweet = { type: 'replied_to' | 'quoted' | 'retweeted'; id: string }

export type XEntities = {
  cashtags?: { start: number; end: number; tag: string }[]
  hashtags?: { start: number; end: number; tag: string }[]
  mentions?: { start: number; end: number; username: string; id?: string }[]
  urls?: { url: string; expanded_url?: string; display_url?: string }[]
}

export type XTweet = {
  id: string
  text: string
  created_at: string
  author_id: string
  lang?: string
  conversation_id?: string
  in_reply_to_user_id?: string
  public_metrics?: XPublicMetrics
  entities?: XEntities
  referenced_tweets?: XReferencedTweet[]
  note_tweet?: { text?: string }
  attachments?: { media_keys?: string[] }
}

export type XUser = { id: string; username: string; name?: string }

export type XSearchPage = {
  data?: XTweet[]
  includes?: { users?: XUser[] }
  meta?: { next_token?: string; result_count?: number; newest_id?: string; oldest_id?: string }
  errors?: { title?: string; detail?: string }[]
}

/**
 * One post as captured. `_ingested_at` is stamped here and nowhere else:
 * engagement counts are snapshots at capture time and capture latency varies
 * from minutes to seven days, so without the capture instant every engagement
 * comparison is silently biased - and it cannot be reconstructed afterwards.
 */
export type CapturedPost = XTweet & {
  _author_username: string
  _ingested_at: string
  _run_id: string
}
