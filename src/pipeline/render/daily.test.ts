import { describe, it, expect } from 'vitest'
import { renderDaily, type DayInput } from './daily.js'
import type { Analysis } from '../extract/validate.js'

const analysis: Analysis & { model?: string } = {
  day_narrative: 'Two accounts converged on semis; one pushed back on valuation.',
  model: 'claude-opus-5',
  picks: [
    {
      symbol: 'NVDA', direction: 'long', prospect: 'Expects a beat.',
      risk_reward: 'Author did not address downside.', thesis: 'Datacenter demand.',
      time_frame: 'swing', tags: ['tech', 'momentum'], conviction: 0.8,
      sources: [{ post_id: '1001', account: 'alpha', quote: 'loading $NVDA' }],
    },
    {
      symbol: 'OPENAI', direction: 'neutral', prospect: 'Watching.',
      risk_reward: 'No downside stated.', thesis: 'Private, no entry.',
      time_frame: 'long_term', tags: ['innovation'], conviction: 0.3,
      sources: [{ post_id: '1002', account: 'bravo', quote: 'OpenAI news matters' }],
    },
  ],
}

const input: DayInput = {
  tradingDay: '2026-09-08',
  analysis,
  postCount: 42,
  accountCount: 7,
  priceSeries: new Map([['NVDA', [
    { trade_date: '2025-12-31', adj_close: 100 },
    { trade_date: '2026-09-04', adj_close: 132 },
  ]]]),
}

describe('renderDaily', () => {
  const md = renderDaily(input)

  it('leads with the day narrative', () => {
    expect(md).toContain('## Theme and narrative')
    expect(md).toContain('converged on semis')
  })

  it('renders every requested section per pick', () => {
    for (const section of ['**Prospect.**', '**Risk/reward.**', '**Thesis.**', '**Tags**']) {
      expect(md).toContain(section)
    }
    expect(md).toContain('swing')
  })

  it('combines qualitative tags with market-derived ones', () => {
    expect(md).toMatch(/`tech`.*`momentum`.*`ytd_up`/)
  })

  it('shows an em dash - never a number - for a symbol with no price series', () => {
    // OPENAI is private. A zero here would read as "flat", which is a lie.
    const openaiBlock = md.slice(md.indexOf('### OPENAI'))
    expect(openaiBlock).toContain('**Market.** —')
    expect(openaiBlock).not.toMatch(/0\.00%/)
  })

  it('links every claim back to the post it came from', () => {
    expect(md).toContain('https://x.com/alpha/status/1001')
    expect(md).toContain('"loading $NVDA"')
  })

  it('carries the disclaimer and says returns did not come from the model', () => {
    expect(md).toContain('Not investment advice')
    expect(md).toContain('never from the model')
  })

  it('handles a session where nobody committed to a view', () => {
    const empty = renderDaily({ ...input, analysis: { ...analysis, picks: [] } })
    expect(empty).toContain('No account expressed a directional view')
  })
})
