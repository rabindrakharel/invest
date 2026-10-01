import { activeTags, loadEnums } from '../lib/config.js'
import { sha256 } from '../lib/hash.js'

/**
 * Built at runtime from config/, so the closed enums the model may emit are the
 * same ones the corpus documents. `additionalProperties: false` plus explicit
 * `required` is what makes the schema a contract rather than a suggestion.
 *
 * Deliberately absent: any price or return field. Those are computed in
 * src/pipeline/prices/ from real closes. A model asked for "YTD" will always produce a
 * confident number, and it will be invented.
 */
export function buildOutputSchema(): Record<string, unknown> {
  const enums = loadEnums()
  return {
    type: 'object',
    additionalProperties: false,
    required: ['day_narrative', 'picks'],
    properties: {
      day_narrative: {
        type: 'string',
        description: 'The single dominant theme across the day, in 3-6 sentences. Say what the allowlist collectively believed and where they disagreed. No hedging boilerplate.',
      },
      picks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['symbol', 'direction', 'prospect', 'risk_reward', 'thesis', 'time_frame', 'tags', 'sources', 'conviction'],
          properties: {
            symbol: { type: 'string', description: 'Ticker as written by the author, uppercase, no $.' },
            direction: { type: 'string', enum: enums.direction },
            prospect: { type: 'string', description: 'What the author expects to happen.' },
            risk_reward: { type: 'string', description: 'The stated or clearly implied downside against the upside. Say so if the author never addressed risk.' },
            thesis: { type: 'string', description: 'Why, in the author’s own logic.' },
            time_frame: { type: 'string', enum: enums.time_frame },
            tags: { type: 'array', items: { type: 'string', enum: activeTags() } },
            conviction: { type: 'number', description: '0-1, how strongly the author committed.' },
            sources: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['post_id', 'account', 'quote'],
                properties: {
                  post_id: { type: 'string' },
                  account: { type: 'string' },
                  quote: { type: 'string', description: 'A verbatim span from that post supporting this pick.' },
                },
              },
            },
          },
        },
      },
    },
  }
}

export function schemaHash(): string {
  return sha256(JSON.stringify(buildOutputSchema())).slice(0, 16)
}
