-- Tickers by how persistently the allowlist keeps returning to them.
SELECT symbol,
       COUNT(*) AS mentions,
       COUNT(DISTINCT author_id) AS distinct_authors,
       COUNT(DISTINCT created_date) AS distinct_days,
       MAX(episode_no) AS episodes,
       MIN(created_at) AS first_seen,
       MAX(created_at) AS last_seen
FROM mention_episodes
GROUP BY 1
HAVING COUNT(DISTINCT author_id) >= 2
ORDER BY distinct_authors DESC, mentions DESC;
