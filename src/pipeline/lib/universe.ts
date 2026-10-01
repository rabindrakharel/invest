import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { repoRoot } from '../duck/connect.js'
import { log, ghError } from './log.js'

/**
 * The listed-equity universe, from Nasdaq Trader's public symbol directory
 * (free, no key, no signup).
 *
 * Cashtags are self-identifying and never need this file. It exists only so a
 * BARE uppercase token can be resolved without guessing - the difference
 * between reading "NVDA looks strong" as a mention and discarding it.
 */
const SOURCES = [
  'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',
  'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt',
]

export async function syncUniverse(): Promise<number> {
  const symbols = new Set<string>()
  for (const url of SOURCES) {
    const res = await fetch(url, { headers: { 'user-agent': 'cohuron-invest/0.1' } })
    if (!res.ok) {
      log.warn('universe.source_failed', { url, status: res.status })
      continue
    }
    const text = await res.text()
    const lines = text.split('\n')
    const header = (lines[0] ?? '').split('|')
    // Column name differs between the two files.
    const col = header.indexOf('Symbol') > -1 ? header.indexOf('Symbol') : header.indexOf('ACT Symbol')
    if (col === -1) {
      log.warn('universe.unexpected_header', { url, header: header.slice(0, 5) })
      continue
    }
    for (const line of lines.slice(1)) {
      // The directory files end with a "File Creation Time" trailer row.
      if (line.startsWith('File Creation Time') || line.trim() === '') continue
      const symbol = (line.split('|')[col] ?? '').trim().toUpperCase()
      // Skip test issues and anything carrying a class/warrant suffix character.
      if (!/^[A-Z]{1,5}$/.test(symbol)) continue
      symbols.add(symbol)
    }
  }
  if (symbols.size === 0) throw new Error('resolved an empty universe; refusing to overwrite config/universe.txt')

  const sorted = [...symbols].sort()
  writeFileSync(
    resolve(repoRoot, 'config/universe.txt'),
    `# Listed US equity and ETF symbols, from nasdaqtrader.com. Regenerate with \`pnpm task:sync-universe\`.\n` +
    `# ${sorted.length} symbols as of ${new Date().toISOString().slice(0, 10)}.\n` +
    sorted.join('\n') + '\n',
  )
  log.info('universe.synced', { symbols: sorted.length })
  return sorted.length
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncUniverse().catch((err) => {
    ghError(String(err))
    log.error('universe.failed', { error: String(err) })
    process.exit(1)
  })
}
