import type { Bar } from './returns.js'

export type PriceProvider = {
  name: string
  /** Null when the provider has no series for this symbol - not an error. */
  fetchDaily(symbol: string, assetClass: string): Promise<Bar[] | null>
}

/**
 * Stooq: free, no API key, no signup, and one request returns a symbol's entire
 * daily history. Sits behind this interface so swapping to Finnhub or another
 * vendor never touches a caller.
 */
export const stooq: PriceProvider = {
  name: 'stooq',
  async fetchDaily(symbol, assetClass) {
    const vendorSymbol = toStooqSymbol(symbol, assetClass)
    if (!vendorSymbol) return null

    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(vendorSymbol)}&i=d`
    const res = await fetch(url, { headers: { 'user-agent': 'cohuron-invest/0.1' } })
    if (!res.ok) return null
    const text = await res.text()
    // Stooq answers an unknown symbol with a non-CSV body rather than a 404.
    if (!text.startsWith('Date,')) return null

    const bars: Bar[] = []
    for (const line of text.split('\n').slice(1)) {
      const [date, , , , close] = line.split(',')
      if (!date || !close) continue
      const value = Number(close)
      if (!Number.isFinite(value)) continue
      bars.push({ trade_date: date, adj_close: value })
    }
    return bars.length > 0 ? bars : null
  },
}

/** Private and pre-IPO names have no series by definition, and return null. */
export function toStooqSymbol(symbol: string, assetClass: string): string | null {
  const lower = symbol.toLowerCase()
  switch (assetClass) {
    case 'equity':
    case 'etf':
      return `${lower}.us`
    case 'index':
    case 'macro':
      return `^${lower}`
    case 'private':
    case 'crypto':
    case 'unknown':
    default:
      return null
  }
}
