import { describe, it, expect } from 'vitest'
import { tradingDayOf, tradingDayWindow, zonedTimeToInstant, marketDate, zoneOffsetMs } from './time.js'

describe('trading day boundary', () => {
  it('puts a pre-close post in the same session', () => {
    // 2026-09-08 15:59 ET == 19:59Z (EDT, UTC-4)
    expect(tradingDayOf(new Date('2026-09-08T19:59:00Z'))).toBe('2026-09-08')
  })

  it('rolls an after-close post into the next session', () => {
    // 16:00 ET exactly is the boundary and belongs to the NEXT day
    expect(tradingDayOf(new Date('2026-09-08T20:00:00Z'))).toBe('2026-09-09')
    expect(tradingDayOf(new Date('2026-09-08T23:30:00Z'))).toBe('2026-09-09')
  })

  it('rolls across a month end', () => {
    expect(tradingDayOf(new Date('2026-09-30T20:30:00Z'))).toBe('2026-10-01')
  })

  it('handles DST: the same wall-clock close is a different UTC instant', () => {
    // EDT (UTC-4) in September, EST (UTC-5) in December.
    const sep = zonedTimeToInstant(2026, 9, 8, 16)
    const dec = zonedTimeToInstant(2026, 12, 8, 16)
    expect(sep.toISOString()).toBe('2026-09-08T20:00:00.000Z')
    expect(dec.toISOString()).toBe('2026-12-08T21:00:00.000Z')
  })

  it('classifies correctly on both sides of the DST change', () => {
    // 2026-11-01 is the US fall-back. 15:59 EST == 20:59Z.
    expect(tradingDayOf(new Date('2026-11-02T20:59:00Z'))).toBe('2026-11-02')
    expect(tradingDayOf(new Date('2026-11-02T21:00:00Z'))).toBe('2026-11-03')
  })

  it('produces a half-open window that matches the classifier', () => {
    const { start, end } = tradingDayWindow('2026-09-08')
    expect(start.toISOString()).toBe('2026-09-07T20:00:00.000Z')
    expect(end.toISOString()).toBe('2026-09-08T20:00:00.000Z')
    // the window's own end instant belongs to the NEXT trading day
    expect(tradingDayOf(end)).toBe('2026-09-09')
    expect(tradingDayOf(new Date(end.getTime() - 1))).toBe('2026-09-08')
    expect(tradingDayOf(start)).toBe('2026-09-08')
  })

  it('reports market date and offset independently of the host TZ', () => {
    expect(marketDate(new Date('2026-09-09T03:00:00Z'))).toBe('2026-09-08')
    expect(zoneOffsetMs(new Date('2026-09-08T12:00:00Z'))).toBe(-4 * 3600_000)
    expect(zoneOffsetMs(new Date('2026-12-08T12:00:00Z'))).toBe(-5 * 3600_000)
  })
})
