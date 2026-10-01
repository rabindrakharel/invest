import { createHash } from 'node:crypto'

/**
 * Stable JSON: object keys sorted at every depth. Used for content hashes that
 * must not change because a JSON serialiser reordered a map.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) out[k] = sortDeep(src[k])
    return out
  }
  return v
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

export function sha256Canonical(value: unknown): string {
  return sha256(canonicalJson(value))
}
