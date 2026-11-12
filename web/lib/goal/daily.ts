// Day-by-day numbers: a day against the 7- and 30-day averages, spikes and drops, and which
// channel moved. Pure functions; the data comes from lib/mcp/tools/daily_numbers.ts.

const DAY = 86_400_000
export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)
export const addDays = (date: string, n: number) => isoDay(Date.parse(`${date}T00:00:00Z`) + n * DAY)

/** Values for each of the `days` days ending on `end` (missing days are 0). */
export function window(series: Map<string, number>, end: string, days: number): number[] {
  return Array.from({ length: days }, (_, i) => series.get(addDays(end, -i)) ?? 0)
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const round1 = (n: number) => Math.round(n * 10) / 10

export interface DayCompare {
  day: string
  value: number
  avg_7d: number            // the 7 days before `day`
  avg_30d: number           // the 30 days before `day`
  vs_7d_pct: number | null
  vs_30d_pct: number | null
}

const pct = (v: number, base: number) => (base > 0 ? Math.round(((v - base) / base) * 100) : null)

export function compareDay(series: Map<string, number>, day: string): DayCompare {
  const value = series.get(day) ?? 0
  const a7 = avg(window(series, addDays(day, -1), 7))
  const a30 = avg(window(series, addDays(day, -1), 30))
  return { day, value, avg_7d: round1(a7), avg_30d: round1(a30), vs_7d_pct: pct(value, a7), vs_30d_pct: pct(value, a30) }
}

export interface Unusual { metric: string; day: string; value: number; normal: number; direction: 'spike' | 'drop'; how_far: string }

/**
 * Days far outside the 28 days before them: at least 2.5 standard deviations away, and a real
 * difference (5+ and 50%+ off the average), so 1 visit vs 0 isn't news at small numbers.
 */
export function unusualDays(metric: string, series: Map<string, number>, days: string[]): Unusual[] {
  const out: Unusual[] = []
  for (const day of days) {
    const base = window(series, addDays(day, -1), 28)
    if (base.filter(v => v > 0).length < 7) continue // too little history to call anything unusual
    const mean = avg(base)
    const sd = Math.sqrt(avg(base.map(v => (v - mean) ** 2)))
    const v = series.get(day) ?? 0
    const diff = v - mean
    if (Math.abs(diff) < 5 || Math.abs(diff) < 0.5 * Math.max(mean, 1)) continue
    if (sd > 0 && Math.abs(diff) / sd < 2.5) continue
    out.push({
      metric, day, value: v, normal: round1(mean),
      direction: diff > 0 ? 'spike' : 'drop',
      how_far: sd > 0 ? `${round1(Math.abs(diff) / sd)}× the usual day-to-day swing` : 'normally flat',
    })
  }
  return out
}

export interface ChannelMove { channel: string; last_7d: number; previous_7d: number; change: number; change_pct: number | null }

/** Each channel's last 7 days vs the 7 before (ending on `end`), biggest moves first. */
export function channelMoves(byChannel: Map<string, Map<string, number>>, end: string): ChannelMove[] {
  return [...byChannel.entries()].map(([channel, s]) => {
    const last = window(s, end, 7).reduce((a, b) => a + b, 0)
    const prev = window(s, addDays(end, -7), 7).reduce((a, b) => a + b, 0)
    return { channel, last_7d: last, previous_7d: prev, change: last - prev, change_pct: pct(last, prev) }
  }).filter(c => c.last_7d || c.previous_7d).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
}

/** A channel that went quiet: had 3+ in the previous 7 days and fell by half or more. */
export const wentQuiet = (moves: ChannelMove[]) =>
  moves.filter(m => m.previous_7d >= 3 && m.last_7d <= m.previous_7d / 2).sort((a, b) => a.change - b.change)[0] ?? null
