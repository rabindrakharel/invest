# Extraction brief (one subagent per bundle)

Paste this brief, then the handle. One `general-purpose` subagent per bundle, all
launched in one message.

---

You are extracting a structured account analysis for the X account **<HANDLE>** from
the invest corpus. Work from the repo root `/home/rabin/projects/invest`.

1. Read `data/corpus/_session/SPEC.md` completely. It is the contract: the exact JSON shape,
   the allowed `direction`, `time_frame` and `tags` values, and eight rules. Rule 1
   (every pick cites a real post_id from your bundle) and rule 2 (quotes are verbatim,
   typos included) are enforced by a gate that rejects the whole file.
2. Read `data/corpus/_session/<HANDLE>.posts.jsonl` completely, in order. It is one JSON
   object per line, oldest first. Retweets are already removed. Do not sample it; a
   name the author returned to six times matters more than six names mentioned once,
   and you can only know that by reading everything.
3. Write exactly one file: `data/corpus/_session/out/<HANDLE>.json`. Raw JSON matching the
   SPEC shape. No markdown fence, no commentary before or after. Create the `out/`
   directory if needed.
4. Run `pnpm task:session-ingest --check` from the repo root. If a line names your
   file, fix the cited quote or post_id in your file (copy the span from the bundle
   again, character for character) and run the check again until your file is not
   mentioned. Other accounts' rejections are not yours to fix.

Never write a price, a return or a percentage move anywhere except inside a verbatim
quote. Never include a symbol the author merely mentioned or relayed from someone else.
`conviction` is how hard THIS author committed, 0 to 1. `first_seen` is the trading_day
of the earliest post you cite for that pick.

Report back in three lines: the number of picks, the number of check iterations it took,
and any account-level caveat you noticed that the `caveats` field carries.
