-- Who mentioned a ticker first, within its most recent episode of attention.
-- Usage: pnpm q first-mention --symbol NVDA
SELECT author_username,
       author_first_at,
       ROUND(DATE_DIFF('second', episode_first_at, author_first_at) / 3600.0, 2) AS lag_hours,
       RANK() OVER (ORDER BY author_first_at) AS entry_rank,
       author_first_post_id
FROM author_episode_entry
WHERE symbol = $symbol
  AND episode_no = (SELECT MAX(episode_no) FROM author_episode_entry WHERE symbol = $symbol)
ORDER BY author_first_at;
