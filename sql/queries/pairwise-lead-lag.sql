-- Who leads WHOM. lead_rate is the interpretable number: "in episodes where
-- both participated, A was ahead of B this fraction of the time." Robust to the
-- outlier-heavy hour distributions that wreck means.
SELECT l.author_username AS leader,
       f.author_username AS follower,
       COUNT(*) AS co_episodes,
       MEDIAN(DATE_DIFF('second', l.author_first_at, f.author_first_at) / 3600.0) AS median_lead_hours,
       SUM((l.author_first_at < f.author_first_at)::INT)::DOUBLE / COUNT(*) AS lead_rate
FROM author_episode_entry l
JOIN author_episode_entry f USING (symbol, episode_no)
WHERE l.author_id <> f.author_id
GROUP BY 1, 2
HAVING COUNT(*) >= 8
ORDER BY lead_rate DESC, median_lead_hours;
