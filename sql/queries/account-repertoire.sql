-- What each account actually does, from its extracted picks.
--
-- concentration is the point: an account with 4 picks at 0.9 conviction is
-- making a different kind of claim than one with 60 picks at 0.5, and a hit
-- rate computed later means something different for each.
SELECT author_username,
       COUNT(*)                                                   AS picks,
       COUNT(DISTINCT symbol)                                     AS symbols,
       ROUND(AVG(conviction), 2)                                  AS avg_conviction,
       COUNT(*) FILTER (conviction >= 0.75)                       AS high_conviction,
       COUNT(*) FILTER (direction = 'long')                       AS n_long,
       COUNT(*) FILTER (direction = 'short')                      AS n_short,
       COUNT(*) FILTER (direction = 'neutral')                    AS n_neutral,
       MODE(time_frame)                                           AS typical_horizon,
       ROUND(AVG(n_posts), 1)                                     AS avg_posts_per_pick,
       MIN(as_of_date)::VARCHAR                                   AS earliest_call
FROM picks_v
WHERE prompt_version = 'v1-acct'
GROUP BY 1
ORDER BY picks DESC;
