import { describe, it, expect } from 'vitest'
import { XApiError, explain, estimateCostUsd } from './client.js'

const problem = (detail: string) =>
  JSON.stringify({ detail, status: 402, title: 'Payment Required' })

describe('XApiError', () => {
  it('pulls the useful field out of an RFC7807 problem document', () => {
    const err = new XApiError('X API 402 on /users/by', 402, problem('credits depleted'))
    expect(err.detail).toBe('credits depleted')
  })

  it('does not throw on a non-JSON body', () => {
    expect(new XApiError('boom', 500, '<html>gateway</html>').detail).toBe('')
  })
})

describe('explain', () => {
  it('distinguishes a billing state from a broken request', () => {
    // "X API 402" reads like a bug in the request. It is a credit balance.
    const msg = explain(new XApiError('X API 402', 402, problem('credits depleted')))
    expect(msg).toContain('no credits')
    expect(msg).toContain('credits depleted')
    expect(msg).toContain('nothing was charged')
  })

  it('points a 401 at the token rather than the balance', () => {
    expect(explain(new XApiError('x', 401, '{}'))).toContain('bearer token')
  })

  it('falls through with the status for anything unrecognised', () => {
    expect(explain(new XApiError('x', 503, problem('over capacity')))).toContain('503')
  })
})

describe('estimateCostUsd', () => {
  it('prices reads at the pay-per-use rate', () => {
    expect(estimateCostUsd(250)).toBe(1.25)
    expect(estimateCostUsd(0)).toBe(0)
  })
})
