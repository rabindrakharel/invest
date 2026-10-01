-- Formal stances per symbol from the account extraction (v1-acct): the positioning
-- layer of /x-sentiment. Disagreement is kept, not netted: longs and shorts are
-- counted separately.
--
-- Usage: pnpm q x-sentiment-stances --json
SELECT symbol,
       COUNT(DISTINCT author_username)                                   AS accounts,
       COUNT(*) FILTER (direction = 'long')                               AS longs,
       COUNT(*) FILTER (direction = 'short')                              AS shorts,
       COUNT(*) FILTER (direction = 'neutral')                            AS neutrals,
       ROUND(AVG(conviction), 2)                                          AS avg_conviction,
       MAX(as_of_date)::VARCHAR                                           AS last_pick_day,
       STRING_AGG(author_username || ':' || direction || ':' || conviction, ' ' ORDER BY conviction DESC) AS stances
FROM picks_v
WHERE prompt_version = 'v1-acct'
GROUP BY symbol
ORDER BY accounts DESC, avg_conviction DESC;
