import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Rows are staged as NDJSON and converted by DuckDB rather than by a JS parquet
 * writer, so the column types are declared once, in SQL, in the same engine
 * that reads them back.
 *
 * The ORDER BY is not cosmetic: without a deterministic sort, two rebuilds of
 * identical input produce different row order, which defeats content-hash
 * comparison and makes row-group statistics useless.
 */
export async function writeParquet(opts: {
  rows: Record<string, unknown>[]
  /** column -> SQL expression producing it, in output order */
  columns: Record<string, string>
  orderBy: string
  outPath: string
  connection?: DuckDBConnection
}): Promise<number> {
  if (opts.rows.length === 0) return 0
  const dir = mkdtempSync(join(tmpdir(), 'invest-pq-'))
  const staged = join(dir, 'rows.ndjson')
  try {
    writeFileSync(staged, opts.rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    const connection = opts.connection ?? (await (await DuckDBInstance.create()).connect())
    // JSON inference can strip Z into a naive TIMESTAMP; cast it in UTC.
    await connection.run("SET TimeZone = 'UTC'")
    const select = Object.entries(opts.columns).map(([name, expr]) => `${expr} AS "${name}"`).join(',\n         ')
    mkdirSync(dirname(opts.outPath), { recursive: true })
    await connection.run(
      `COPY (SELECT ${select}
         FROM read_json_auto('${staged}', union_by_name => true)
        ORDER BY ${opts.orderBy})
       TO '${opts.outPath}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)`,
    )
    return opts.rows.length
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export const SCHEMA_VERSION = 1
