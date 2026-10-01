import { readFileSync, writeFileSync } from 'node:fs'
import { connect, rows } from '../../../../src/pipeline/duck/connect.js'
const c = await connect()
// Materialize before shadowing views, so all saved queries use this run only.
await c.run(`CREATE TEMP TABLE run_posts AS SELECT * FROM posts_v WHERE created_at >= TIMESTAMPTZ '2026-09-07T01:45:52Z' AND created_at < TIMESTAMPTZ '2026-09-17T21:58:44Z'`)
await c.run(`CREATE OR REPLACE TEMP VIEW posts_v AS SELECT * FROM run_posts`)
await c.run(`CREATE TEMP TABLE run_picks AS SELECT * FROM picks_v WHERE ingest_dt = DATE '2026-09-17' AND prompt_version='v1-acct'`)
await c.run(`CREATE OR REPLACE TEMP VIEW picks_v AS SELECT * FROM run_picks`)
const plain = (r: Record<string, unknown>[]) => JSON.stringify(r, (_,v) => typeof v==='bigint' ? Number(v) : v, 2)+'\n'
for (const name of ['account-convergence','account-repertoire','account-tag-mix','corpus-coverage']) {
 const sql=readFileSync(`sql/queries/${name}.sql`,'utf8')
 writeFileSync(`data/probes/runs/2026-09-17/${name}.json`,plain(await rows(c,sql)))
}
const tickers=process.argv[2]
if (tickers) {
 const sql=readFileSync('sql/queries/retail-interest.sql','utf8').replaceAll('$symbols',`'${tickers.replaceAll("'", "''")}'`)
 writeFileSync('data/probes/runway/2026-09-17/records/retail.json',plain(await rows(c,sql)))
}
