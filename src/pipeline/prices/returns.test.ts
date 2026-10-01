import { describe, it, expect } from 'vitest'
import { computeReturns, returnTags, NO_RETURNS, type Bar } from './returns.js'

const series: Bar[] = [
  { trade_date: '2025-09-04', adj_close: 80 },
  { trade_date: '2025-12-31', adj_close: 100 },
  { trade_date: '2026-08-29', adj_close: 120 },
  { trade_date: '2026-09-04', adj_close: 132 },
]

describe('computeReturns', () => {
  it('measures YTD from the prior year-end close', () => {
    expect(computeReturns(series, '2026-09-05').ytd_pct).toBe(32)
  })

  it('measures MTD from the prior month-end close', () => {
    // last close before 2026-09-01 is 120 on 08-29 -> 132 is +10%
    expect(computeReturns(series, '2026-09-05').mtd_pct).toBe(10)
  })

  it('measures YoY from the close a year back', () => {
    expect(computeReturns(series, '2026-09-05').yoy_pct).toBe(65)
  })

  it('uses the last bar at or before the as-of date, not the newest bar', () => {
    const r = computeReturns(series, '2026-08-30')
    expect(r.as_of).toBe('2026-08-29')
    expect(r.close).toBe(120)
  })

  it('returns null - not zero - when there is no series', () => {
    // A private company has no price. Zero would be a lie that looks like data.
    expect(computeReturns([], '2026-09-05')).toEqual(NO_RETURNS)
  })

  it('walks back to the prior trading day when the anchor lands on a holiday', () => {
    // The YoY anchor for 2026-09-04 is 2025-09-04. If the market was closed
    // that day, the last close at or before it is the right answer - not null.
    const withGap: Bar[] = [
      { trade_date: '2025-09-02', adj_close: 80 },  // anchor falls in this gap
      { trade_date: '2025-12-31', adj_close: 100 },
      { trade_date: '2026-09-04', adj_close: 132 },
    ]
    expect(computeReturns(withGap, '2026-09-05').yoy_pct).toBe(65)
  })

  it('returns null for YoY when history does not reach back a year', () => {
    const short: Bar[] = [{ trade_date: '2026-08-01', adj_close: 10 }, { trade_date: '2026-09-04', adj_close: 12 }]
    const r = computeReturns(short, '2026-09-05')
    expect(r.yoy_pct).toBeNull()
    expect(r.ytd_pct).toBeNull()
    expect(r.mtd_pct).toBe(20)
  })

  it('does not divide by a zero anchor', () => {
    const zero: Bar[] = [{ trade_date: '2025-12-31', adj_close: 0 }, { trade_date: '2026-09-04', adj_close: 5 }]
    expect(computeReturns(zero, '2026-09-05').ytd_pct).toBeNull()
  })
})

describe('returnTags', () => {
  it('emits a tag only where the underlying number exists and is positive', () => {
    expect(returnTags(computeReturns(series, '2026-09-05'))).toEqual(['ytd_up', 'mtd_up', 'yoy_up'])
    expect(returnTags(NO_RETURNS)).toEqual([])
    expect(returnTags({ ...NO_RETURNS, ytd_pct: -4 })).toEqual([])
  })
})
