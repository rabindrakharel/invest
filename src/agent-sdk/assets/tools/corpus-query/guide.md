---
description: "Corpus query tool: run a saved DuckDB query over the corpus views, the only sanctioned way to read the X corpus. Call with no name to list the saved queries."
---

# Corpus query

1. Read the corpus only through `corpus_query`, never by opening the Parquet files: the same `post_id` appears in several capture partitions and the views resolve that.
2. Call it with no `name` to list the saved queries. Parameters are named: `symbol`, `symbols` (comma-separated), `days`. Pass `json` true when you will process the rows.
3. A fact about an account is cited by `post_id`. A query that does not exist is a gap to report, not a query to improvise.
4. The tool reads only; it writes nothing.
