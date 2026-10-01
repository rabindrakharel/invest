import { describe, it, expect } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { gzipDeterministic, rawPath } from './writer.js'

describe('gzipDeterministic', () => {
  it('produces identical bytes for identical content across time', async () => {
    const a = gzipDeterministic('{"id":"1"}\n')
    await new Promise((r) => setTimeout(r, 1100)) // cross a wall-clock second
    const b = gzipDeterministic('{"id":"1"}\n')
    // Without an explicit zero mtime the gzip header would differ here and
    // every rebuild would look like a change.
    expect(a.equals(b)).toBe(true)
  })

  it('writes a zero MTIME in the gzip header', () => {
    // Bytes 4..7 are MTIME, little-endian. A non-zero value here is what would
    // make a rebuild of identical content show up as a diff.
    const buf = gzipDeterministic('hello')
    expect(buf.readUInt32LE(4)).toBe(0)
  })

  it('round-trips', () => {
    expect(gunzipSync(gzipDeterministic('hello')).toString()).toBe('hello')
  })
})

describe('rawPath', () => {
  it('encodes run, attempt and page so a retry cannot overwrite a good file', () => {
    const first = rawPath('/d', '2026-09-06', '123', 1, 1)
    const retry = rawPath('/d', '2026-09-06', '123', 2, 1)
    expect(first).not.toBe(retry)
    expect(first).toContain('ingest_dt=2026-09-06')
    expect(first).toMatch(/posts-123-a1-p001\.jsonl\.gz$/)
  })
})
