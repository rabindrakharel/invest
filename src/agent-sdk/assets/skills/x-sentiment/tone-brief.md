# Tone brief (one subagent, optional)

Paste this brief with the path to `x-sentiment.json` and the theme ids to cover.

---

Read `data/research/<DATE>/sentiment/x-sentiment.json`. Then fetch the recent-window
posts with:

```bash
pnpm -s q x-sentiment-posts --days <RECENT> --json
```

Keep the posts that mention a member of the listed themes (from `config/themes.json`), or
that match a theme keyword. For each kept post, grade the author's stance toward the
security or theme it discusses:

| Value | Meaning |
|---|---|
| 1.0 | Clearly bullish: buying, adding, a raised target, a beat framed positively |
| 0.5 | Leaning bullish |
| 0.0 | Neutral, informational, a question, a joke, or mixed |
| -0.5 | Leaning bearish |
| -1.0 | Clearly bearish: selling, shorting, trimming, a miss framed negatively, a valuation warning |

Grade the author's stance, not the news. "MU beat but I'm selling into it" is -0.5 or
-1.0. Sarcasm counts as its intended meaning. Do not guess where a post is unreadable;
leave it out.

Write `data/research/<DATE>/sentiment/tone.json` as
`{"<post_id>": {"tone": <value>, "symbol": "<main symbol or theme id>"}}`. Reply with the
count graded and three posts per theme that best show the prevailing tone, by
`post_id`.
