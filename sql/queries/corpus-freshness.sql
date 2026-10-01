-- One row: how current the corpus is. Read by src/agent-sdk/assets/tools/repo/state/state.py before every report.
SELECT MAX(trading_day)::VARCHAR                 AS last_day,
       MIN(trading_day)::VARCHAR                 AS first_day,
       COUNT(*)                                  AS posts,
       COUNT(DISTINCT author_username)           AS accounts,
       MAX(ingest_dt)::VARCHAR                   AS last_ingest
FROM posts_v;
