import { normalize } from './normalize/index.js'
import { render } from './render/index.js'
import { log, ghError } from './lib/log.js'

/**
 * Rebuilds ONLY the derived layers.
 *
 * `raw`, `picks` and `prices` are deliberately untouched. Regenerating picks
 * would replace one model's judgments with another's - silently, and with no
 * way to tell afterwards - and regenerating prices would discard adjusted
 * closes as they stood before a corporate action restated them. Both are
 * append-only for that reason; re-running extraction at a NEW prompt_version
 * adds files beside the old ones instead.
 */
export async function rebuild(from?: string): Promise<void> {
  log.info('rebuild.start', { from: from ?? 'all', regenerates: ['posts', 'mentions', 'daily', 'tickers'] })
  await normalize(from ? { from } : {})
  await render()
  log.info('rebuild.done', {})
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--from')
  const from = i > -1 ? process.argv[i + 1] : undefined
  if (process.argv.includes('--picks') || process.argv.includes('--prices')) {
    ghError('rebuild refuses to regenerate picks or prices: both are append-only. Re-run extraction with a new prompt_version instead.')
    process.exit(2)
  }
  rebuild(from).catch((err) => {
    ghError(String(err))
    log.error('rebuild.failed', { error: String(err) })
    process.exit(1)
  })
}
