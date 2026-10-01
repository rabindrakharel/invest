-- Names more than one account took a POSITION on, not merely mentioned.
--
-- The mention-level convergence view (mentions_v) counts anyone who typed the
-- ticker; this counts only accounts that expressed a stance, which is the
-- version worth acting on. Disagreement is kept rather than netted out: two
-- accounts on opposite sides of one name is the most interesting row here.
SELECT symbol,
       COUNT(DISTINCT author_username)                                  AS accounts,
       STRING_AGG(DISTINCT direction, '/' ORDER BY direction)           AS directions,
       COUNT(*) FILTER (direction = 'long')                             AS n_long,
       COUNT(*) FILTER (direction = 'short')                            AS n_short,
       ROUND(AVG(conviction), 2)                                        AS avg_conviction,
       MIN(as_of_date)::VARCHAR                                         AS first_called,
       STRING_AGG(author_username || ':' || direction, ', ' ORDER BY as_of_date) AS who
FROM picks_v
WHERE prompt_version = 'v1-acct'
GROUP BY 1
HAVING COUNT(DISTINCT author_username) >= 2
ORDER BY accounts DESC, avg_conviction DESC;
