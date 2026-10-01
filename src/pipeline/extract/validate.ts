import { z } from 'zod'
import { activeTags, loadEnums } from '../lib/config.js'

export type Pick = {
  symbol: string
  direction: string
  prospect: string
  risk_reward: string
  thesis: string
  time_frame: string
  tags: string[]
  conviction: number
  sources: { post_id: string; account: string; quote: string }[]
}

export type Analysis = { day_narrative: string; picks: Pick[] }

export function buildValidator(): z.ZodType<Analysis> {
  const enums = loadEnums()
  return z.object({
    day_narrative: z.string().min(1),
    picks: z.array(z.object({
      symbol: z.string().min(1),
      direction: z.enum(enums.direction as [string, ...string[]]),
      prospect: z.string(),
      risk_reward: z.string(),
      thesis: z.string(),
      time_frame: z.enum(enums.time_frame as [string, ...string[]]),
      tags: z.array(z.enum(activeTags() as [string, ...string[]])),
      conviction: z.number().min(0).max(1),
      sources: z.array(z.object({
        post_id: z.string().min(1),
        account: z.string(),
        quote: z.string(),
      })).min(1),
    })),
  }) as unknown as z.ZodType<Analysis>
}

export class UncitedPickError extends Error {
  constructor(readonly offenders: { symbol: string; post_id: string }[]) {
    super(`extraction cited ${offenders.length} post_id(s) that are not in the input: ` +
      offenders.map((o) => `${o.symbol}->${o.post_id}`).join(', '))
    this.name = 'UncitedPickError'
  }
}

/**
 * The hard citation gate.
 *
 * The schema guarantees shape, not truth: a model can emit a well-formed
 * post_id that does not exist. Every claim in this corpus has to be traceable
 * to a post someone actually wrote, so a fabricated citation fails the run
 * rather than being written to disk.
 */
export function assertCitationsResolve(analysis: Analysis, knownPostIds: Set<string>): void {
  const offenders: { symbol: string; post_id: string }[] = []
  for (const pick of analysis.picks) {
    for (const source of pick.sources) {
      if (!knownPostIds.has(source.post_id)) offenders.push({ symbol: pick.symbol, post_id: source.post_id })
    }
  }
  if (offenders.length > 0) throw new UncitedPickError(offenders)
}
