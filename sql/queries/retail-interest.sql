-- Retail interest in a set of symbols, from the corpus itself.
--
-- Usage: pnpm q retail-interest --symbols "VST,AVGO,RKLB"
--
-- Engagement columns are capture-time snapshots (see metric_age_seconds), so
-- they are comparable only loosely; the ratios and counts are the point.
-- Read it as positioning, not as a buy signal: many accounts, high conviction
-- and a price near its high is a crowded name; heavy mentions after a large
-- drawdown is a capitulation watch; a name only one account ever mentions is
-- single-source however loud that account is.
WITH wanted AS (
  SELECT upper(trim(s)) AS symbol FROM unnest(string_split($symbols, ',')) AS t(s)
),
m AS (
  SELECT DISTINCT e.symbol, e.post_id, e.author_username
  FROM mention_events e JOIN wanted USING (symbol)
),
joined AS (
  SELECT m.symbol, m.post_id, m.author_username, p.trading_day,
         p.like_count_at_ingest AS likes, p.impression_count_at_ingest AS impressions,
         p.reply_count_at_ingest AS replies, p.bookmark_count_at_ingest AS bookmarks
  FROM m JOIN posts_v p USING (post_id)
),
picks AS (
  SELECT symbol,
         COUNT(*) AS formal_picks,
         STRING_AGG(author_username || ':' || direction || ':' || conviction, ' ' ORDER BY conviction DESC) AS stances
  FROM picks_v WHERE prompt_version = 'v1-acct' GROUP BY 1
)
SELECT w.symbol,
       COUNT(DISTINCT j.author_username)                       AS accounts,
       COUNT(DISTINCT j.post_id)                               AS posts,
       COUNT(DISTINCT j.trading_day)                           AS days,
       MIN(j.trading_day)::VARCHAR                             AS first_day,
       MAX(j.trading_day)::VARCHAR                             AS last_day,
       COUNT(DISTINCT j.post_id) FILTER (j.trading_day >= (SELECT MAX(trading_day) FROM posts_v) - INTERVAL 14 DAY) AS posts_last_14d,
       SUM(j.likes)                                            AS likes,
       SUM(j.impressions)                                      AS impressions,
       ROUND(AVG(j.likes), 0)                                  AS likes_per_post,
       SUM(j.replies)                                          AS replies,
       SUM(j.bookmarks)                                        AS bookmarks,
       COALESCE(pk.formal_picks, 0)                            AS formal_picks,
       pk.stances
FROM wanted w
LEFT JOIN joined j USING (symbol)
LEFT JOIN picks pk USING (symbol)
GROUP BY w.symbol, pk.formal_picks, pk.stances
ORDER BY posts DESC, accounts DESC;
