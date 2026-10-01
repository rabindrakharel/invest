import { describe, it, expect } from 'vitest'
import { assertCitationsResolve, UncitedPickError, buildValidator, type Analysis } from './validate.js'

const pick = (over: Record<string, unknown> = {}) => ({
  symbol: 'NVDA', direction: 'long', prospect: 'p', risk_reward: 'r', thesis: 't',
  time_frame: 'swing', tags: ['tech'], conviction: 0.7,
  sources: [{ post_id: '1001', account: 'alpha', quote: 'q' }],
  ...over,
})

describe('assertCitationsResolve', () => {
  it('passes when every cited post exists', () => {
    const a = { day_narrative: 'n', picks: [pick()] } as Analysis
    expect(() => assertCitationsResolve(a, new Set(['1001']))).not.toThrow()
  })

  it('fails the run on a fabricated post_id rather than writing it', () => {
    const a = { day_narrative: 'n', picks: [pick({ sources: [{ post_id: '9999', account: 'x', quote: 'q' }] })] } as Analysis
    expect(() => assertCitationsResolve(a, new Set(['1001']))).toThrow(UncitedPickError)
  })

  it('names every offender, not just the first', () => {
    const a = { day_narrative: 'n', picks: [
      pick({ symbol: 'A', sources: [{ post_id: '8', account: 'x', quote: 'q' }] }),
      pick({ symbol: 'B', sources: [{ post_id: '9', account: 'x', quote: 'q' }] }),
    ] } as Analysis
    try {
      assertCitationsResolve(a, new Set(['1001']))
      expect.unreachable()
    } catch (err) {
      expect((err as UncitedPickError).offenders).toHaveLength(2)
    }
  })
})

describe('buildValidator', () => {
  it('rejects a tag outside the taxonomy', () => {
    const r = buildValidator().safeParse({ day_narrative: 'n', picks: [pick({ tags: ['not-a-real-tag'] })] })
    expect(r.success).toBe(false)
  })

  it('rejects a pick with no sources', () => {
    const r = buildValidator().safeParse({ day_narrative: 'n', picks: [pick({ sources: [] })] })
    expect(r.success).toBe(false)
  })

  it('accepts a well-formed analysis', () => {
    const r = buildValidator().safeParse({ day_narrative: 'n', picks: [pick()] })
    expect(r.success).toBe(true)
  })
})
