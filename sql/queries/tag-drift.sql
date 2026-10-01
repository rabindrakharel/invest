-- Tag distribution over time, as a SHARE of that month's picks.
-- The join to config/tag_taxonomy.csv supplies the denominator: without knowing
-- which tags were AVAILABLE on a given date, adding a tag to the vocabulary
-- shows up as a fake regime shift.
WITH taxonomy AS (
  SELECT * FROM read_csv('{{CONFIG}}/tag_taxonomy.csv', header => true)
),
monthly AS (
  SELECT DATE_TRUNC('month', as_of_date) AS month, tag, COUNT(*) AS n
  FROM pick_tags_v GROUP BY 1, 2
),
totals AS (
  SELECT DATE_TRUNC('month', as_of_date) AS month, COUNT(DISTINCT pick_id) AS picks
  FROM pick_tags_v GROUP BY 1
)
SELECT m.month, m.tag, m.n, t.picks,
       ROUND(m.n::DOUBLE / t.picks, 3) AS share
FROM monthly m
JOIN totals t USING (month)
JOIN taxonomy x ON x.tag = m.tag
WHERE m.month >= DATE_TRUNC('month', x.added_date)
  AND (x.removed_date IS NULL OR m.month < DATE_TRUNC('month', x.removed_date))
ORDER BY m.month, share DESC;
