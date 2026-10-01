-- Which thesis styles each account reaches for.
--
-- Read the share, not the count: accounts differ ~10x in pick volume, so raw
-- tag counts just re-rank the accounts by how much they post.
SELECT p.author_username,
       t.tag,
       COUNT(*)                                                                  AS picks,
       ROUND(COUNT(*) * 1.0 / SUM(COUNT(*)) OVER (PARTITION BY p.author_username), 3) AS share_of_account
FROM pick_tags_v t
JOIN picks_v p USING (pick_id)
WHERE t.prompt_version = 'v1-acct'
GROUP BY 1, 2
HAVING COUNT(*) >= 2
ORDER BY p.author_username, share_of_account DESC;
