import { describe, it, expect } from 'vitest'
import { buildResolver, extractMentions, postType, isTickerShaped } from './tickers.js'
import { loadSymbols, loadBlocklist, loadUniverse, loadBareAllowlist } from '../lib/config.js'
import type { XTweet } from '../x/types.js'

// The REAL universe and allowlist, so these tests exercise the actual
// false-positive risk rather than a convenient toy set.
const resolver = buildResolver(loadSymbols(), loadBlocklist(), loadUniverse(), loadBareAllowlist())

function tweet(partial: Partial<XTweet> & { text: string }): XTweet {
  return {
    id: '1', author_id: 'u1', created_at: '2026-09-06T12:00:00.000Z',
    ...partial,
  } as XTweet
}

const symbols = (t: XTweet) => extractMentions(t, resolver).mentions.map((m) => m.symbol)

describe('extractMentions', () => {
  it('takes cashtags from API entities and marks the source', () => {
    const r = extractMentions(tweet({
      text: 'watching $NVDA here',
      entities: { cashtags: [{ start: 9, end: 14, tag: 'NVDA' }] },
    }), resolver)
    expect(r.mentions).toHaveLength(1)
    expect(r.mentions[0]).toMatchObject({ symbol: 'NVDA', mention_source: 'cashtag_entity' })
  })

  it('catches cashtags the entity parser missed', () => {
    const r = extractMentions(tweet({ text: 'long $AAPL into print' }), resolver)
    expect(r.mentions[0]).toMatchObject({ symbol: 'AAPL', mention_source: 'regex_text' })
  })

  it('records an unknown cashtag rather than dropping it', () => {
    // The author explicitly marked it. Re-deriving is free; re-reading is not.
    const r = extractMentions(tweet({ text: 'watch $ZZZZ closely' }), resolver)
    expect(r.mentions.map((m) => m.symbol)).toContain('ZZZZ')
    expect(r.mentions[0]?.asset_class).toBe('unknown')
  })

  it('does not treat common words as tickers, even though they ARE real tickers', () => {
    // Every one of these is a live listed symbol. Matching the full universe
    // bare would put a false mention in nearly every post.
    const r = extractMentions(tweet({
      text: 'THE CEO SAID IT IS ALL FOR AI AND EV SO HOLD NOW AT THE TOP AND PLAY THE OPEN',
    }), resolver)
    expect(r.mentions).toHaveLength(0)
  })

  it('accepts a bare token only when it is on the bare allowlist', () => {
    expect(symbols(tweet({ text: 'NVDA looks strong' }))).toEqual(['NVDA'])
    // HOOD is genuinely listed but people rarely write it bare, so it is not
    // accepted without a '$'.
    expect(symbols(tweet({ text: 'HOOD looks strong' }))).toEqual([])
    // ...but the explicit cashtag form always resolves.
    expect(symbols(tweet({ text: '$HOOD looks strong' }))).toEqual(['HOOD'])
  })

  it('surfaces listed-but-not-allowlisted tokens so the allowlist can grow from evidence', () => {
    const r = extractMentions(tweet({ text: 'HOOD looks strong' }), resolver)
    expect(r.unresolved).toContain('HOOD')
  })

  it('follows a rename so history stays on one series', () => {
    // config/symbols.csv records FB -> META
    expect(symbols(tweet({ text: 'still holding $FB' }))).toEqual(['META'])
  })

  it('matches private companies by name, since they have no ticker', () => {
    expect(symbols(tweet({ text: 'the OpenAI announcement changes things' }))).toContain('OPENAI')
  })

  it('counts repeats and prefers the cashtag source over a bare match', () => {
    const r = extractMentions(tweet({
      text: 'NVDA NVDA $NVDA',
      entities: { cashtags: [{ start: 10, end: 15, tag: 'NVDA' }] },
    }), resolver)
    expect(r.mentions).toHaveLength(1)
    expect(r.mentions[0]?.mention_source).toBe('cashtag_entity')
    expect(r.mentions[0]?.occurrences).toBeGreaterThan(1)
  })

  it('is deterministic in ordering', () => {
    const t = tweet({ text: '$SPY and $AAPL and $NVDA' })
    expect(symbols(t)).toEqual(['AAPL', 'NVDA', 'SPY'])
  })
})

describe('postType', () => {
  it('classifies by referenced_tweets, retweet winning', () => {
    expect(postType(tweet({ text: 'x' }))).toBe('original')
    expect(postType(tweet({ text: 'x', referenced_tweets: [{ type: 'retweeted', id: '9' }] }))).toBe('retweet')
    expect(postType(tweet({ text: 'x', referenced_tweets: [{ type: 'quoted', id: '9' }] }))).toBe('quote')
    expect(postType(tweet({ text: 'x', referenced_tweets: [{ type: 'replied_to', id: '9' }] }))).toBe('reply')
  })
})

/**
 * X's entity parser returns money amounts as cashtags. An insider-filing feed
 * is made of sentences like "CFO sold $1.77M of stock", so trusting the entity
 * list unconditionally mints a symbol per dollar amount. Found in real captured
 * data: 10 such "symbols" appeared in a 4,992-post backfill.
 */
describe('cashtag entities are shape-checked, not trusted', () => {
  it('rejects money amounts the X entity parser reports as cashtags', () => {
    for (const tag of ['1.77M', '106.20K', '2.8BN', '25MM', '1MM', '30.44M']) {
      expect(isTickerShaped(tag)).toBe(false)
    }
  })

  it('still accepts real ticker shapes, including share classes', () => {
    for (const tag of ['NVDA', 'brk.b', 'BRK-B', 'F', 'GOOGL']) {
      expect(isTickerShaped(tag)).toBe(true)
    }
  })

  it('rejects a tag too long to be a ticker', () => {
    expect(isTickerShaped('ABCDEFG')).toBe(false)
  })

  it('drops the money entity but keeps a real cashtag in the same post', () => {
    const resolver = buildResolver(
      [{ symbol: 'NVDA', asset_class: 'equity', security_name: '', alias_of: '', valid_from: '', valid_to: '' }],
      new Set(), new Set(['NVDA']), new Set(),
    )
    const text = 'CFO sold $1.77M of $NVDA yesterday'
    const { mentions } = extractMentions({
      id: '1', text, created_at: '2026-09-01T12:00:00Z', author_id: 'a',
      entities: {
        cashtags: [
          { start: text.indexOf('$1.77M'), end: text.indexOf('$1.77M') + 6, tag: '1.77M' },
          { start: text.indexOf('$NVDA'), end: text.indexOf('$NVDA') + 5, tag: 'NVDA' },
        ],
      },
    } as never, resolver)
    expect(mentions.map((m) => m.symbol)).toEqual(['NVDA'])
  })

  it('does not let the rejected money token reappear as a bare match', () => {
    const resolver = buildResolver([], new Set(), new Set(['M']), new Set(['M']))
    const text = 'insider bought $25MM here'
    const { mentions } = extractMentions({
      id: '1', text, created_at: '2026-09-01T12:00:00Z', author_id: 'a',
      entities: { cashtags: [{ start: text.indexOf('$25MM'), end: text.indexOf('$25MM') + 5, tag: '25MM' }] },
    } as never, resolver)
    expect(mentions).toHaveLength(0)
  })
})
