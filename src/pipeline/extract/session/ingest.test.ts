import { describe, it, expect } from 'vitest'
import { normalizeQuote, assertCitations, CitationError, type AccountAnalysis } from './ingest.js'

const corpus = new Map([
  ['100', { author: 'alice', text: 'I am long $NVDA into the print — this is my largest position.' }],
  ['200', { author: 'alice', text: 'Trimming $TSLA here. The setup broke.' }],
  ['300', { author: 'bob', text: 'Adding to $NVDA on weakness.' }],
])

function pick(over: Partial<AccountAnalysis['picks'][number]> = {}): AccountAnalysis['picks'][number] {
  return {
    symbol: 'NVDA', direction: 'long', prospect: 'p', risk_reward: 'r', thesis: 't',
    time_frame: 'swing', tags: [], conviction: 0.8, first_seen: '2026-07-08',
    sources: [{ post_id: '100', quote: 'this is my largest position' }],
    ...over,
  }
}

function analysis(picks: AccountAnalysis['picks']): AccountAnalysis {
  return {
    account: 'alice',
    profile: { beat: 'b', style: 's', cadence: 'c', revisits: 'r', caveats: 'none observed' },
    narrative: 'n',
    picks,
  }
}

describe('normalizeQuote', () => {
  it('ignores differences a faithful copy-paste can still introduce', () => {
    expect(normalizeQuote('“Don’t   fight   the tape”'))
      .toBe(normalizeQuote('"Don\'t fight the tape"'))
  })

  it('strips zero-width characters', () => {
    expect(normalizeQuote('long ​NVDA')).toBe(normalizeQuote('long NVDA'))
  })

  it('folds the several dashes that render identically', () => {
    expect(normalizeQuote('risk—reward')).toBe(normalizeQuote('risk-reward'))
  })

  it('does NOT forgive a reworded quote', () => {
    expect(normalizeQuote('my largest position'))
      .not.toBe(normalizeQuote('my biggest position'))
  })
})

describe('assertCitations', () => {
  it('accepts a verbatim quote from a post the account actually wrote', () => {
    expect(() => assertCitations(analysis([pick()]), corpus)).not.toThrow()
  })

  it('accepts a quote that differs only in unicode punctuation', () => {
    const c = new Map([['1', { author: 'alice', text: 'He said “buy the dip” yesterday.' }]])
    const a = analysis([pick({ sources: [{ post_id: '1', quote: '"buy the dip"' }] })])
    expect(() => assertCitations(a, c)).not.toThrow()
  })

  it('rejects a fabricated post_id', () => {
    const a = analysis([pick({ sources: [{ post_id: '999', quote: 'anything' }] })])
    expect(() => assertCitations(a, corpus)).toThrow(CitationError)
    expect(() => assertCitations(a, corpus)).toThrow(/not in the input/)
  })

  /**
   * The failure this lane makes likely: reading ~2000 posts at once, a model
   * attaches a real quote to a neighbouring post_id. Existence checks alone
   * pass it; only comparing the quote against that specific post catches it.
   */
  it('rejects a real quote attached to the wrong post', () => {
    const a = analysis([pick({ sources: [{ post_id: '200', quote: 'this is my largest position' }] })])
    expect(() => assertCitations(a, corpus)).toThrow(/not verbatim in 200/)
  })

  it("rejects citing another account's post", () => {
    const a = analysis([pick({ sources: [{ post_id: '300', quote: 'Adding to $NVDA on weakness.' }] })])
    expect(() => assertCitations(a, corpus)).toThrow(/belongs to @bob/)
  })

  it('rejects a paraphrase presented as a quote', () => {
    const a = analysis([pick({ sources: [{ post_id: '100', quote: 'NVDA is my biggest holding' }] })])
    expect(() => assertCitations(a, corpus)).toThrow(/not verbatim/)
  })

  it('reports every offender at once rather than only the first', () => {
    const a = analysis([
      pick({ symbol: 'NVDA', sources: [{ post_id: '999', quote: 'x' }] }),
      pick({ symbol: 'TSLA', sources: [{ post_id: '300', quote: 'Adding to $NVDA on weakness.' }] }),
    ])
    try {
      assertCitations(a, corpus)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as CitationError).offenders).toHaveLength(2)
    }
  })
})
