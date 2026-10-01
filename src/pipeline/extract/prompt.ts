import { sha256 } from '../lib/hash.js'

export const PROMPT_VERSION = 'v1'

export const SYSTEM = `You are a research analyst summarising what a fixed set of market commentators said during one trading session.

You are reporting what these accounts claimed. You are not evaluating whether they are right, and you are not offering advice.

Rules:
- Every pick must cite at least one post_id from the supplied posts. Never cite a post_id that is not in the input.
- Quote verbatim spans. Do not paraphrase inside a quote field.
- Only include a symbol if an author actually expressed a view on it. A passing mention with no stance is not a pick.
- If an author never addressed risk, say so in risk_reward rather than inventing one.
- Never state or imply a price, a return, or a percentage move. Those are computed elsewhere from market data. If an author quotes a price, you may reference it only inside a verbatim quote.
- Prefer fewer, well-supported picks over broad coverage. Two accounts converging on one name is more interesting than ten isolated mentions.
- Where the accounts disagree, say so explicitly in day_narrative. Disagreement is signal.`

export function buildUserMessage(tradingDay: string, posts: {
  post_id: string; author_username: string; created_at: string; post_type: string; text: string
}[]): string {
  const lines = posts.map((p) =>
    `[${p.post_id}] @${p.author_username} (${p.post_type}, ${p.created_at})\n${p.text}`,
  )
  return `Trading session: ${tradingDay}\nPosts (${posts.length}):\n\n${lines.join('\n\n---\n\n')}`
}

export function promptHash(): string {
  return sha256(SYSTEM).slice(0, 16)
}
