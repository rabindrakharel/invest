import Anthropic from '@anthropic-ai/sdk'
import { buildOutputSchema, schemaHash } from './schema.js'
import { SYSTEM, buildUserMessage, PROMPT_VERSION, promptHash } from './prompt.js'
import { buildValidator, assertCitationsResolve, UncitedPickError, type Analysis } from './validate.js'
import { log } from '../lib/log.js'
import { requireEnv } from '../lib/config.js'

export const MODEL = 'claude-opus-5'
const MAX_TOKENS = 16_000
/** Retries for output we could not accept - a different sample may be valid. */
const MAX_OUTPUT_RETRIES = 2
/** Retries for provider unavailability - the request itself was fine. */
const MAX_TRANSIENT_RETRIES = 3

export class AiProviderConfigError extends Error {}
export class AiProviderUnavailableError extends Error {}
export class AiProviderError extends Error {}

export type ExtractionResult = {
  analysis: Analysis
  meta: {
    model: string
    prompt_version: string
    prompt_sha256: string
    schema_hash: string
    input_tokens: number
    output_tokens: number
    extracted_at: string
    attempts: number
  }
}

export type PostForPrompt = {
  post_id: string; author_username: string; created_at: string; post_type: string; text: string
}

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (client) return client
  try {
    client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
  } catch (err) {
    throw new AiProviderConfigError(String(err))
  }
  return client
}

/**
 * One structured-output call per trading session.
 *
 * The schema is a shape guarantee, not a truth guarantee, so the parsed result
 * is validated again here and the citation gate runs before anything is
 * returned. Bad output and provider unavailability get separate retry budgets:
 * resampling a 529 wastes the budget that a genuinely invalid response needs.
 */
export async function extractDay(
  tradingDay: string, posts: PostForPrompt[],
): Promise<ExtractionResult> {
  const schema = buildOutputSchema()
  const validator = buildValidator()
  const knownIds = new Set(posts.map((p) => p.post_id))
  const userMessage = buildUserMessage(tradingDay, posts)

  let outputRetries = 0
  let transientRetries = 0
  let attempts = 0

  for (;;) {
    attempts++
    let raw: string
    // Definitely assigned in the try below; the catch either continues the
    // retry loop or throws, so control never reaches the read unassigned.
    let usage!: { input_tokens: number; output_tokens: number }
    try {
      const response = await getClient().messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        thinking: { type: 'adaptive' },
        output_config: { format: { type: 'json_schema', schema }, effort: 'high' },
        messages: [{ role: 'user', content: userMessage }],
      })

      if (response.stop_reason === 'refusal') {
        throw new AiProviderError(`model declined: ${JSON.stringify(response.stop_details ?? {})}`)
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AiProviderError(`response hit max_tokens (${MAX_TOKENS}); the session may be too large for one call`)
      }
      usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
      raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    } catch (err) {
      if (err instanceof AiProviderConfigError || err instanceof AiProviderError) throw err
      const status = (err as { status?: number }).status
      const transient = status === 429 || status === 529 || (status !== undefined && status >= 500)
      if (transient && transientRetries < MAX_TRANSIENT_RETRIES) {
        transientRetries++
        const waitMs = 2 ** transientRetries * 2000
        log.warn('extract.transient_retry', { tradingDay, status, transientRetries, waitMs })
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      if (status === 401 || status === 403) throw new AiProviderConfigError(String(err))
      throw new AiProviderUnavailableError(String(err))
    }

    try {
      const parsed = validator.parse(JSON.parse(raw))
      assertCitationsResolve(parsed, knownIds)
      return {
        analysis: parsed,
        meta: {
          model: MODEL,
          prompt_version: PROMPT_VERSION,
          prompt_sha256: promptHash(),
          schema_hash: schemaHash(),
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          extracted_at: new Date().toISOString(),
          attempts,
        },
      }
    } catch (err) {
      if (outputRetries < MAX_OUTPUT_RETRIES) {
        outputRetries++
        log.warn('extract.output_retry', {
          tradingDay, outputRetries,
          reason: err instanceof UncitedPickError ? 'uncited_pick' : 'schema_violation',
          detail: String(err).slice(0, 300),
        })
        continue
      }
      throw new AiProviderError(`extraction failed after ${attempts} attempts: ${String(err).slice(0, 500)}`)
    }
  }
}
