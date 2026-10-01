import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { repoRoot } from '../duck/connect.js'

const AccountsFile = z.object({
  accounts: z.array(z.object({ handle: z.string().min(1), user_id: z.string().nullable() })).min(1),
})

const Enums = z.object({
  direction: z.array(z.string()),
  time_frame: z.array(z.string()),
  asset_class: z.array(z.string()),
  mention_source: z.array(z.string()),
  post_type: z.array(z.string()),
})

export type Account = { handle: string; user_id: string | null }
export type ResolvedAccount = { handle: string; user_id: string }

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, rel), 'utf8'))
}

export function loadAccounts(): Account[] {
  return AccountsFile.parse(readJson('config/accounts.json')).accounts
}

/**
 * The allowlist with every handle resolved. Capture refuses to run on an
 * unresolved entry: a rename would otherwise silently drop an account, and the
 * failure mode is an empty result rather than an error.
 */
export function loadResolvedAccounts(): ResolvedAccount[] {
  const accounts = loadAccounts()
  const missing = accounts.filter((a) => !a.user_id).map((a) => a.handle)
  if (missing.length > 0) {
    throw new Error(
      `config/accounts.json has unresolved handles: ${missing.join(', ')}. Run \`pnpm task:resolve-accounts\` (needs X_BEARER_TOKEN) and commit the result.`,
    )
  }
  return accounts as ResolvedAccount[]
}

export function loadEnums(): z.infer<typeof Enums> {
  return Enums.parse(readJson('config/enums.json'))
}

function parseCsv(rel: string): Record<string, string>[] {
  const path = resolve(repoRoot, rel)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '')
  const header = splitCsvLine(lines[0]!)
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const row: Record<string, string> = {}
    header.forEach((h, i) => { row[h] = cells[i] ?? '' })
    return row
  })
}

/** Minimal RFC4180: handles quoted cells containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export type SymbolRow = {
  symbol: string
  asset_class: string
  security_name: string
  alias_of: string
  valid_from: string
  valid_to: string
}

export function loadSymbols(): SymbolRow[] {
  return parseCsv('config/symbols.csv').map((r) => ({
    symbol: (r['symbol'] ?? '').toUpperCase(),
    asset_class: r['asset_class'] ?? 'unknown',
    security_name: r['security_name'] ?? '',
    alias_of: (r['alias_of'] ?? '').toUpperCase(),
    valid_from: r['valid_from'] ?? '',
    valid_to: r['valid_to'] ?? '',
  }))
}

/** Tokens that look like tickers but are overwhelmingly ordinary words. */
export function loadBlocklist(): Set<string> {
  return new Set(parseCsv('config/blocklist.csv').map((r) => (r['token'] ?? '').toUpperCase()))
}

export type TagRow = { tag: string; added_date: string; removed_date: string; taxonomy_version: string; description: string }

export function loadTagTaxonomy(): TagRow[] {
  return parseCsv('config/tag_taxonomy.csv').map((r) => ({
    tag: r['tag'] ?? '',
    added_date: r['added_date'] ?? '',
    removed_date: r['removed_date'] ?? '',
    taxonomy_version: r['taxonomy_version'] ?? 'v1',
    description: r['description'] ?? '',
  })).filter((r) => r.tag !== '')
}

/** Tags currently in the vocabulary (no removed_date). */
export function activeTags(): string[] {
  return loadTagTaxonomy().filter((t) => t.removed_date === '').map((t) => t.tag)
}

export function taxonomyVersion(): string {
  const rows = loadTagTaxonomy()
  return rows[0]?.taxonomy_version ?? 'v1'
}

/**
 * Symbols recognised WITHOUT a leading '$'.
 *
 * Deliberately an allowlist, not the full universe: roughly 41 ordinary English
 * words are live tickers (HOLD, NOW, TOP, OPEN, TIME, LOW, HIGH, PLAY, ...), so
 * treating every universe symbol as a bare match would put a false mention in
 * nearly every post - and one false mention corrupts recurrence, lead/lag and
 * hit-rate at once.
 */
export function loadBareAllowlist(): Set<string> {
  return new Set(parseCsv('config/bare_allowlist.csv')
    .map((r) => (r['symbol'] ?? '').toUpperCase())
    .filter((s) => s !== '' && !s.startsWith('#')))
}

/**
 * Bulk listed-equity universe, one symbol per line, from
 * `pnpm task:sync-universe`. Used to CLASSIFY a cashtag as a real listed
 * security; it is not used to decide whether a bare token is a ticker.
 */
export function loadUniverse(): Set<string> {
  const path = resolve(repoRoot, 'config/universe.txt')
  if (!existsSync(path)) return new Set()
  return new Set(
    readFileSync(path, 'utf8').split('\n').map((l) => l.trim().toUpperCase()).filter((l) => l !== '' && !l.startsWith('#')),
  )
}

export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set. Add it to .env (gitignored) or as a repo Actions secret.`)
  return v
}
