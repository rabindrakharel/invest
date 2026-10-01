import { describe, it, expect } from 'vitest'
import { toStooqSymbol } from './provider.js'

describe('toStooqSymbol', () => {
  it('maps US equities and ETFs', () => {
    expect(toStooqSymbol('NVDA', 'equity')).toBe('nvda.us')
    expect(toStooqSymbol('SPY', 'etf')).toBe('spy.us')
  })

  it('maps indices and macro symbols', () => {
    expect(toStooqSymbol('SPX', 'index')).toBe('^spx')
    expect(toStooqSymbol('DXY', 'macro')).toBe('^dxy')
  })

  it('returns null for classes with no price series, by design', () => {
    // Private names are tagged and narrated but never price-enriched: their
    // return fields stay NULL rather than being invented.
    expect(toStooqSymbol('OPENAI', 'private')).toBeNull()
    expect(toStooqSymbol('BTC', 'crypto')).toBeNull()
    expect(toStooqSymbol('ZZQQ', 'unknown')).toBeNull()
  })
})
