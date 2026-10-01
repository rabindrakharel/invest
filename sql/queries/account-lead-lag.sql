-- Each account's median lead/lag against the field, across all episodes.
-- Read median_lag_hours NEXT TO episodes_entered: the median is survivorship-
-- biased in both directions, and 2.0 hours over 3 episodes is noise while the
-- same number over 60 episodes is signal.
SELECT author_username,
       COUNT(*) AS episodes_entered,
       MEDIAN(DATE_DIFF('second', episode_first_at, author_first_at) / 3600.0) AS median_lag_hours,
       QUANTILE_CONT(DATE_DIFF('second', episode_first_at, author_first_at) / 3600.0, 0.25) AS p25_lag_hours,
       SUM((author_first_at = episode_first_at)::INT) AS times_first,
       SUM((author_first_at = episode_first_at)::INT)::DOUBLE / COUNT(*) AS first_rate,
       AVG(episode_n_authors) AS avg_episode_size
FROM author_episode_entry
-- Episodes beginning in the first week may have had their true t0 outside the
-- 7-day search window at cold start; they would hand out spurious first-mover credit.
WHERE episode_first_at > (SELECT MIN(created_at) + INTERVAL 7 DAY FROM mention_events)
GROUP BY 1
HAVING COUNT(*) >= 5
ORDER BY median_lag_hours;
