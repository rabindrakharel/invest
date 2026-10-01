export type Bar = { trade_date: string; adj_close: number }

export type Returns = {
  as_of: string | null
  close: number | null
  ytd_pct: number | null
  mtd_pct: number | null
  yoy_pct: number | null
}

export const NO_RETURNS: Returns = {
  as_of: null, close: null, ytd_pct: null, mtd_pct: null, yoy_pct: null,
}

/** Last bar at or before `date`. Series must be ascending by trade_date. */
function lastAtOrBefore(series: Bar[], date: string): Bar | null {
  let found: Bar | null = null
  for (const bar of series) {
    if (bar.trade_date <= date) found = bar
    else break
  }
  return found
}

function pct(from: number, to: number): number | null {
  if (!Number.isFinite(from) || from === 0) return null
  return Number((((to - from) / from) * 100).toFixed(2))
}

function minusOneYear(date: string): string {
  const [y, m, d] = date.split('-') as [string, string, string]
  return `${Number(y) - 1}-${m}-${d}`
}

/**
 * Point-in-time returns from real closes.
 *
 * These are the only source of ytd/mtd/yoy in the corpus. Asking a model for
 * them yields a confident, invented number; the tags that depend on them are
 * therefore derived here or left null, never guessed.
 *
 * A null is a real answer: a private company has no series, and a symbol whose
 * history does not reach back a year has no YoY. Returning 0 for either would
 * be a lie that looks like data.
 */
export function computeReturns(series: Bar[], asOf: string): Returns {
  if (series.length === 0) return NO_RETURNS
  const sorted = [...series].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
  const latest = lastAtOrBefore(sorted, asOf)
  if (!latest) return NO_RETURNS

  const year = latest.trade_date.slice(0, 4)
  const month = latest.trade_date.slice(0, 7)
  // Anchors are the last close of the PRIOR period, so a move is measured from
  // where the period actually started trading.
  const priorYearEnd = lastAtOrBefore(sorted, `${Number(year) - 1}-12-31`)
  const priorMonthEnd = lastAtOrBefore(sorted, `${month}-01`)
  const yearAgo = lastAtOrBefore(sorted, minusOneYear(latest.trade_date))

  return {
    as_of: latest.trade_date,
    close: latest.adj_close,
    ytd_pct: priorYearEnd ? pct(priorYearEnd.adj_close, latest.adj_close) : null,
    mtd_pct: priorMonthEnd && priorMonthEnd.trade_date < latest.trade_date
      ? pct(priorMonthEnd.adj_close, latest.adj_close) : null,
    yoy_pct: yearAgo ? pct(yearAgo.adj_close, latest.adj_close) : null,
  }
}

/** Boolean tags derived from returns. Absent data yields absent tags. */
export function returnTags(r: Returns): string[] {
  const tags: string[] = []
  if (r.ytd_pct !== null && r.ytd_pct > 0) tags.push('ytd_up')
  if (r.mtd_pct !== null && r.mtd_pct > 0) tags.push('mtd_up')
  if (r.yoy_pct !== null && r.yoy_pct > 0) tags.push('yoy_up')
  return tags
}
