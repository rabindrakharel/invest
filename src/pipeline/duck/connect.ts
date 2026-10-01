import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '../../..')

/**
 * The data root is parameterised rather than hardcoded so the identical view
 * definitions run against the working tree, a test fixture, or remote object
 * storage. DuckDB reads `s3://` and `r2://` natively, so outgrowing git is a
 * change to one environment variable - not a migration.
 */
export function dataRoot(): string {
  return process.env.INVEST_DATA_ROOT ?? resolve(dataDir(), 'corpus')
}

/**
 * The single data directory (see data/README.md). The corpus layers live in
 * <dataDir>/corpus and rendered markdown in <dataDir>/rendered; the market,
 * research, probe, report and ledger areas are owned by the Claude skills.
 */
export function dataDir(): string {
  return process.env.INVEST_DATA_DIR ?? resolve(repoRoot, 'data')
}

export function configRoot(): string {
  return process.env.INVEST_CONFIG_ROOT ?? resolve(repoRoot, 'config')
}

/**
 * Where rendered markdown is written. Parameterised for the same reason the
 * data root is: so a test run never writes into the working tree.
 */
export function outputRoot(): string {
  return process.env.INVEST_OUTPUT_ROOT ?? resolve(dataDir(), 'rendered')
}

/** Layers that currently have at least one parquet file on disk. */
export function availableLayers(data = dataRoot()): Set<string> {
  const present = new Set<string>()
  for (const layer of ['posts', 'mentions', 'picks', 'pick_tags', 'prices']) {
    const base = resolve(data, layer)
    if (!existsSync(base)) continue
    const hasFile = readdirSync(base).some((partition) => {
      const dir = resolve(base, partition)
      try { return readdirSync(dir).some((f) => f.endsWith('.parquet')) } catch { return false }
    })
    if (hasFile) present.add(layer)
  }
  return present
}

/**
 * Renders sql/views.sql against the active roots, omitting views whose layer
 * has no data yet.
 *
 * The corpus is built up one layer at a time - capture and normalize run for
 * days before the first extraction - so a hard requirement that every layer
 * exist would make the query surface unusable exactly when it is most useful.
 * Each statement declares its layer with a `-- @layer` marker.
 */
export function renderViews(data = dataRoot(), config = configRoot()): string {
  const available = availableLayers(data)
  const raw = readFileSync(resolve(repoRoot, 'sql/views.sql'), 'utf8')
  const kept = raw
    .split(/\n(?=-- @layer )/)
    .filter((block) => {
      const match = block.match(/^-- @layer (\w+)/m)
      return !match || available.has(match[1]!)
    })
    .join('\n')
  return kept.replaceAll('{{DATA}}', data).replaceAll('{{CONFIG}}', config)
}

/** Layers a caller depends on, with a clear error rather than a SQL surprise. */
export function requireLayers(layers: string[], data = dataRoot()): void {
  const available = availableLayers(data)
  const missing = layers.filter((l) => !available.has(l))
  if (missing.length > 0) {
    throw new Error(`corpus layer(s) not built yet: ${missing.join(', ')}. Run the earlier pipeline stages first.`)
  }
}

/** Opens an in-process DuckDB with every corpus view already created. */
export async function connect(
  opts: { data?: string; config?: string } = {},
): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create()
  const connection = await instance.connect()
  await connection.run(renderViews(opts.data ?? dataRoot(), opts.config ?? configRoot()))
  return connection
}

export async function rows(
  connection: DuckDBConnection,
  sql: string,
): Promise<Record<string, unknown>[]> {
  return (await connection.runAndReadAll(sql)).getRowObjects()
}
