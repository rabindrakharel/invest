import { describe, it, expect } from 'vitest'
import { planDelta, verifySegment, type AccountCursor } from './cursor.js'

const held: AccountCursor = {
  author_id: '1', newest_id: '2100000000000000000', oldest_id: '2074000000000000000',
  newest_at: '2026-09-17T20:00:00.000Z', oldest_at: '2026-09-07T00:00:00.000Z', posts: 100,
}

describe('planDelta', () => {
  it('reads the whole window for an account with nothing held', () => {
    expect(planDelta(undefined, { startTime: '2026-09-01T00:00:00Z' }))
      .toEqual([{ side: 'full', start_time: '2026-09-01T00:00:00Z' }])
  })

  it('reads only past the newest held post, by since_id, when no start is explicit', () => {
    // The default start is older than anything held, but without extendBack it
    // must not buy the older side.
    expect(planDelta(held, { startTime: '2026-07-01T00:00:00Z' }))
      .toEqual([{ side: 'newer', since_id: held.newest_id }])
  })

  it('never re-reads the held span, even for an explicit window covering it', () => {
    const segs = planDelta(held, { startTime: '2026-09-01T00:00:00Z', endTime: '2026-09-24T00:00:00Z' }, { extendBack: true })
    expect(segs).toEqual([
      { side: 'newer', since_id: held.newest_id, end_time: '2026-09-24T00:00:00Z' },
      { side: 'older', start_time: '2026-09-01T00:00:00Z', end_time: held.oldest_at },
    ])
  })

  it('reads nothing when the window is inside what is held', () => {
    expect(planDelta(held, { startTime: '2026-09-08T00:00:00Z', endTime: '2026-09-15T00:00:00Z' }, { extendBack: true }))
      .toEqual([])
  })

  it('pays again only on an explicit refetch', () => {
    expect(planDelta(held, { startTime: '2026-09-08T00:00:00Z' }, { refetch: true }))
      .toEqual([{ side: 'full', start_time: '2026-09-08T00:00:00Z' }])
  })
})

describe('verifySegment', () => {
  it('re-reads by time the stretch a since_id sweep may have skipped', () => {
    expect(verifySegment(held, '2026-09-21T20:03:04.000Z'))
      .toEqual({ side: 'verify', start_time: held.newest_at, end_time: '2026-09-21T20:03:04.000Z' })
  })
  it('re-reads to the window end when the sweep returned nothing', () => {
    expect(verifySegment(held, null)).toEqual({ side: 'verify', start_time: held.newest_at })
  })
  it('does nothing when the returned posts start at the cursor', () => {
    expect(verifySegment(held, held.newest_at)).toBeNull()
  })
})
