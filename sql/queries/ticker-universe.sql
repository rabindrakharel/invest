-- Every symbol any allowlisted account mentioned in the last $days days of the corpus,
-- with breadth (accounts), depth (posts, days) and engagement. The universe input to
-- /runway-probe when the operator asks for "every ticker from everyone".
--
-- Usage: pnpm q ticker-universe --days 120 --json
-- The window is anchored on the corpus's own last trading day, not today.
WITH last_day AS (SELECT MAX(trading_day) AS d FROM posts_v),
m AS (
  SELECT DISTINCT e.symbol, e.post_id, e.author_username
  FROM mention_events e
),
j AS (
  SELECT m.symbol, m.post_id, m.author_username, p.trading_day,
         COALESCE(p.like_count_at_ingest, 0) AS likes
  FROM m JOIN posts_v p USING (post_id)
  WHERE p.trading_day >= (SELECT d FROM last_day) - CAST($days AS INTEGER) * INTERVAL 1 DAY
)
SELECT symbol,
       COUNT(DISTINCT author_username)                          AS accounts,
       COUNT(DISTINCT post_id)                                  AS posts,
       COUNT(DISTINCT trading_day)                              AS days,
       MIN(trading_day)::VARCHAR                                AS first_day,
       MAX(trading_day)::VARCHAR                                AS last_day,
       SUM(likes)                                               AS likes,
       STRING_AGG(DISTINCT author_username, ',')                AS authors
FROM j
GROUP BY symbol
ORDER BY accounts DESC, posts DESC;
