import { gzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Deterministic gzip.
 *
 * The gzip header carries an MTIME field, and a non-zero value there would make
 * identical content produce different bytes on every rebuild. Node writes MTIME
 * as zero and exposes no option to change it, so determinism holds - but it is
 * a property we depend on rather than one we set, which is why writer.test.ts
 * asserts the header bytes directly instead of trusting it.
 */
export function gzipDeterministic(text: string): Buffer {
  return gzipSync(Buffer.from(text, 'utf8'), { level: 9 })
}

export function writeJsonlGz(path: string, rows: unknown[]): number {
  mkdirSync(dirname(path), { recursive: true })
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
  const buf = gzipDeterministic(body)
  writeFileSync(path, buf)
  return buf.byteLength
}

/**
 * Filenames carry run id, attempt and page so that a retry can never overwrite
 * a complete file. A crashed run leaves a harmless orphan that the dedupe views
 * ignore; overwriting would let a partial second attempt truncate a good first.
 */
export function rawPath(root: string, ingestDt: string, runId: string, attempt: number, page: number): string {
  return join(root, `raw/ingest_dt=${ingestDt}`, `posts-${runId}-a${attempt}-p${String(page).padStart(3, '0')}.jsonl.gz`)
}

export function manifestPath(root: string, ingestDt: string, runId: string, attempt: number): string {
  return join(root, `raw/ingest_dt=${ingestDt}`, `_manifest-${runId}-a${attempt}.json`)
}

export function runIdentity(): { runId: string; attempt: number } {
  const ghRun = process.env['GITHUB_RUN_ID']
  const ghAttempt = process.env['GITHUB_RUN_ATTEMPT']
  if (ghRun) return { runId: ghRun, attempt: Number(ghAttempt ?? '1') }
  // Local runs get a sortable, collision-resistant id.
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  return { runId: `local${stamp}`, attempt: 1 }
}
