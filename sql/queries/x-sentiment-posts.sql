-- Original posts, replies and quotes in the last $days days of the corpus, each with the
-- symbols it mentions. Input to /x-sentiment (compute_x_sentiment.py), which buckets
-- them into recent and prior windows, maps them to config/themes.json and scores tone.
--
-- Usage: pnpm q x-sentiment-posts --days 42 --json
-- The window is anchored on the corpus's own last trading day, not today, so a stale
-- corpus reads as stale rather than as silence.
WITH last_day AS (SELECT MAX(trading_day) AS d FROM posts_v),
syms AS (
  SELECT post_id, LIST(DISTINCT symbol ORDER BY symbol) AS symbols
  FROM mention_events GROUP BY post_id
)
SELECT p.post_id,
       p.author_username,
       p.trading_day::VARCHAR                        AS trading_day,
       (SELECT d FROM last_day)::VARCHAR             AS corpus_last_day,
       p.post_type,
       COALESCE(p.full_text, p.text)                 AS text,
       COALESCE(p.like_count_at_ingest, 0)           AS likes,
       COALESCE(p.impression_count_at_ingest, 0)     AS impressions,
       COALESCE(ARRAY_TO_STRING(s.symbols, ','), '') AS symbols  -- comma-joined: the node client wraps LISTs
FROM posts_v p
LEFT JOIN syms s USING (post_id)
WHERE p.post_type <> 'retweet'
  AND p.trading_day > (SELECT d FROM last_day) - CAST($days AS INTEGER)
ORDER BY p.trading_day, p.post_id;
