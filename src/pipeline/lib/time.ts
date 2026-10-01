/**
 * Trading-day boundaries in America/New_York.
 *
 * A "day" in this corpus is a market session, not a UTC calendar day: the
 * window runs 16:00 ET to 16:00 ET, so an after-close post belongs to the next
 * session's briefing. The boundary must survive DST, which is why offsets are
 * derived from Intl rather than hardcoded to -04:00/-05:00.
 */

export const MARKET_TZ = 'America/New_York'
/** Session boundary: the US equity close. */
export const SESSION_BOUNDARY_HOUR = 16

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

function partsInZone(instant: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const out: Record<string, number> = {}
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return {
    year: out['year']!,
    month: out['month']!,
    day: out['day']!,
    // Intl with hour12:false reports midnight as 24 in some ICU versions.
    hour: out['hour']! % 24,
    minute: out['minute']!,
    second: out['second']!,
  }
}

/** Milliseconds that the zone is ahead of UTC at the given instant. */
export function zoneOffsetMs(instant: Date, timeZone = MARKET_TZ): number {
  const p = partsInZone(instant, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime()
}

/**
 * The UTC instant of a given wall-clock time in a zone. Two refinement passes
 * are enough: the first lands within an hour, the second is exact except at the
 * ambiguous hour of a DST fall-back, where either answer is defensible.
 */
export function zonedTimeToInstant(
  y: number, m: number, d: number, hour: number, timeZone = MARKET_TZ,
): Date {
  const target = Date.UTC(y, m - 1, d, hour, 0, 0)
  let guess = target
  for (let i = 0; i < 2; i++) {
    guess = target - zoneOffsetMs(new Date(guess), timeZone)
  }
  return new Date(guess)
}

/** `YYYY-MM-DD` for an instant, in the market timezone. */
export function marketDate(instant: Date, timeZone = MARKET_TZ): string {
  const p = partsInZone(instant, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/**
 * The trading day a post belongs to.
 *
 * Anything at or after 16:00 ET rolls into the NEXT calendar day's session,
 * which is what makes an evening post appear in the briefing you read before
 * the following open.
 */
export function tradingDayOf(instant: Date, timeZone = MARKET_TZ): string {
  const p = partsInZone(instant, timeZone)
  const rolls = p.hour >= SESSION_BOUNDARY_HOUR
  const base = Date.UTC(p.year, p.month - 1, p.day)
  const shifted = new Date(base + (rolls ? 86_400_000 : 0))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

/** Half-open [start, end) UTC bounds of a trading day, for auditability. */
export function tradingDayWindow(tradingDay: string, timeZone = MARKET_TZ): { start: Date; end: Date } {
  const [y, m, d] = tradingDay.split('-').map(Number) as [number, number, number]
  const end = zonedTimeToInstant(y, m, d, SESSION_BOUNDARY_HOUR, timeZone)
  const prev = new Date(Date.UTC(y, m - 1, d) - 86_400_000)
  const start = zonedTimeToInstant(
    prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), SESSION_BOUNDARY_HOUR, timeZone,
  )
  return { start, end }
}

export function isoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}
