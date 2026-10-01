-- What the corpus actually holds, per account: the first check after any fetch.
--
-- Compare first_day / last_day against the window you paid for. An account whose
-- first_day is later than --start was not fully reached (the timeline endpoint
-- stopped paginating, or the sweep was cut off by a 402 or the --max-posts cap),
-- and any analysis built on it must say so.
SELECT author_username                                            AS account,
       COUNT(*)                                                   AS posts,
       COUNT(*) FILTER (post_type <> 'retweet')                   AS non_retweets,
       ROUND(COUNT(*) FILTER (post_type = 'retweet') * 1.0 / COUNT(*), 2) AS retweet_share,
       MIN(trading_day)::VARCHAR                                  AS first_day,
       MAX(trading_day)::VARCHAR                                  AS last_day,
       COUNT(DISTINCT trading_day)                                AS days_with_posts,
       COUNT(DISTINCT ingest_dt)                                  AS capture_runs
FROM posts_v
GROUP BY 1
ORDER BY posts DESC;
