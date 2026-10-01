import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { XClient, XApiError, explain } from './client.js'
import { loadAccounts, requireEnv } from '../lib/config.js'
import { repoRoot } from '../duck/connect.js'
import { log, ghError } from '../lib/log.js'

/**
 * One-shot: fill in config/accounts.json with immutable numeric user ids, then commit.
 * Handles are mutable and a rename would silently drop an account from the
 * feed - an empty result, not an error - so capture joins on ids only.
 */
async function main(): Promise<void> {
  const accounts = loadAccounts()
  const client = new XClient(requireEnv('X_BEARER_TOKEN'))
  const users = await client.usersByUsername(accounts.map((a) => a.handle))

  const byLower = new Map(users.map((u) => [u.username.toLowerCase(), u.id]))
  const unresolved: string[] = []
  const next = accounts.map((a) => {
    const id = byLower.get(a.handle.toLowerCase()) ?? a.user_id
    if (!id) unresolved.push(a.handle)
    return { handle: a.handle, user_id: id ?? null }
  })

  const path = resolve(repoRoot, 'config/accounts.json')
  const current = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  current['accounts'] = next
  writeFileSync(path, JSON.stringify(current, null, 2) + '\n')

  log.info('accounts.resolved', { resolved: next.filter((a) => a.user_id).length, total: next.length })
  if (unresolved.length > 0) {
    ghError(`Unresolved handles: ${unresolved.join(', ')} - check for renames or suspensions.`)
    log.error('accounts.unresolved', { handles: unresolved })
    process.exitCode = 1
  }
}

main().catch((err) => {
  const message = err instanceof XApiError ? explain(err) : String(err)
  ghError(message)
  log.error('accounts.failed', { error: message, status: err instanceof XApiError ? err.status : undefined })
  process.exit(1)
})
