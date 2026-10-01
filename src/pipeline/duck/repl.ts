import { createInterface } from 'node:readline'
import { connect, rows, availableLayers, dataRoot } from './connect.js'

/** An interactive DuckDB shell with every corpus view already created. */
async function main(): Promise<void> {
  const layers = [...availableLayers(dataRoot())]
  const connection = await connect()
  console.log(`invest repl - layers available: ${layers.length ? layers.join(', ') : '(none yet)'}`)
  console.log('views: posts_v, mentions_v, mention_events, mention_episodes, author_episode_entry, picks_v, pick_tags_v, prices_v')
  console.log('type SQL, or .exit\n')

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'D ' })
  rl.prompt()
  for await (const line of rl) {
    const sql = line.trim().replace(/;$/, '')
    if (sql === '.exit' || sql === '.quit') break
    if (sql !== '') {
      try {
        const result = await rows(connection, sql)
        if (result.length === 0) console.log('(no rows)')
        else console.table(result.map((r) => Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]),
        )))
      } catch (err) {
        console.error(String(err).split('\n')[0])
      }
    }
    rl.prompt()
  }
  rl.close()
}

main().catch((err) => { console.error(String(err)); process.exit(1) })
