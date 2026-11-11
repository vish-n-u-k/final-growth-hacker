// The growth goal (default: 500 users, the Road to 500) and the maths for "are we on pace?".
// Pure functions here; the PostHog queries are in lib/mcp/tools/goal.ts.

import { JOURNEY_PHASES } from '@/lib/journey'

/** What counts towards the goal. */
export type GoalCounts =
  | 'signed_up'      // everyone in PostHog (the Road to 500 count, with the app's "unique users" setting)
  | 'active_weekly'  // people active in the last 7 days
  | 'paying'         // people whose PostHog property (planProperty) equals planValue

export interface Goal {
  target: number
  counts: GoalCounts
  deadline: string | null      // YYYY-MM-DD
  planProperty: string         // for 'paying'
  planValue: string
  setAt: string | null         // null = never set by the user (defaults)
  // One reading per day, kept when progress is read (the only history for 'paying', which
  // PostHog can't give back in time). Date → count.
  readings?: Record<string, number>
}

export const DEFAULT_GOAL: Goal = { target: 500, counts: 'signed_up', deadline: null, planProperty: 'plan', planValue: 'pro', setAt: null }

export const COUNTS_LABEL: Record<GoalCounts, string> = {
  signed_up: 'people who signed up',
  active_weekly: 'people active in the last 7 days',
  paying: 'paying customers',
}

const DAY = 86_400_000
const WEEK = 7 * DAY

/** Monday 00:00 UTC of the week containing t. */
export function weekStart(t: number): number {
  const d = new Date(t)
  const day = (d.getUTCDay() + 6) % 7 // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY
}

export interface WeekPoint { week: string; level: number; added: number | null; partial: boolean }

/**
 * Weekly levels from new sign-ups per week and today's total: the total at the end of each
 * week is today's total minus everyone who signed up after that week.
 */
export function levelsFromAdds(total: number, adds: Map<number, number>, weeks: number, now: number): WeekPoint[] {
  const current = weekStart(now)
  const out: WeekPoint[] = []
  let after = 0
  for (let i = 0; i < weeks; i++) {
    const ws = current - i * WEEK
    const added = adds.get(ws) ?? 0
    out.push({ week: iso(ws), level: total - after, added, partial: i === 0 })
    after += added
  }
  return out.reverse()
}

/** Weekly levels when each week has its own value (weekly active users). */
export function levelsFromSeries(series: Map<number, number>, weeks: number, now: number): WeekPoint[] {
  const current = weekStart(now)
  const out: WeekPoint[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = current - i * WEEK
    out.push({ week: iso(ws), level: series.get(ws) ?? 0, added: null, partial: i === 0 })
  }
  return out.map((p, i) => ({ ...p, added: i === 0 ? null : p.level - out[i - 1].level }))
}

/** Weekly levels from saved daily readings (last reading in each week). */
export function levelsFromReadings(readings: Record<string, number>, weeks: number, now: number): WeekPoint[] {
  const byWeek = new Map<number, number>()
  for (const date of Object.keys(readings).sort()) byWeek.set(weekStart(Date.parse(`${date}T00:00:00Z`)), readings[date])
  const current = weekStart(now)
  const out: WeekPoint[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = current - i * WEEK
    if (byWeek.has(ws)) out.push({ week: iso(ws), level: byWeek.get(ws)!, added: null, partial: i === 0 })
  }
  return out.map((p, i) => ({ ...p, added: i === 0 ? null : p.level - out[i - 1].level }))
}

export interface Pace {
  current: number
  target: number
  left: number
  percent: number
  stage: { range: string; name: string }
  per_week_last_4: number | null      // average change per week over the last 4 full weeks
  per_week_4_before: number | null    // the 4 weeks before that
  trend: 'speeding up' | 'steady' | 'slowing down' | 'not enough data'
  trend_why: string
  reach_target_on: string | null      // at the last 4 weeks' pace
  deadline: string | null
  weeks_to_deadline: number | null
  needed_per_week: number | null
  on_track: boolean | null
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const round1 = (n: number) => Math.round(n * 10) / 10

/** Pace, trend and "on track?" from weekly levels (oldest first; the last one may be the current, partial week). */
export function paceOf(goal: Goal, current: number, points: WeekPoint[], now: number): Pace {
  const full = points.filter(p => !p.partial)
  const lvl = (weeksBack: number) => full.length > weeksBack ? full[full.length - 1 - weeksBack].level : null
  const l0 = lvl(0), l4 = lvl(4), l8 = lvl(8)
  const last4 = l0 != null && l4 != null ? (l0 - l4) / 4 : null
  const before4 = l4 != null && l8 != null ? (l4 - l8) / 4 : null

  let trend: Pace['trend'] = 'not enough data'
  let why = 'Needs at least 9 full weeks of data to compare the last 4 weeks with the 4 before.'
  if (last4 != null && before4 != null) {
    const diff = last4 - before4
    const base = Math.max(Math.abs(before4), 1)
    trend = diff > 0.15 * base ? 'speeding up' : diff < -0.15 * base ? 'slowing down' : 'steady'
    why = `${round1(last4)} a week over the last 4 full weeks vs ${round1(before4)} a week the 4 weeks before.`
  } else if (last4 != null) {
    why = `${round1(last4)} a week over the last 4 full weeks; not enough older data to say if it's speeding up.`
  }

  const left = Math.max(0, goal.target - current)
  const reach = left === 0 ? iso(now) : last4 && last4 > 0 ? iso(now + (left / last4) * WEEK) : null
  const weeksLeft = goal.deadline ? Math.max(0, (Date.parse(`${goal.deadline}T00:00:00Z`) - now) / WEEK) : null
  const needed = weeksLeft != null ? (weeksLeft > 0 ? left / weeksLeft : left > 0 ? Infinity : 0) : null
  const phase = JOURNEY_PHASES.find(p => current >= p.min && current < p.max) ?? JOURNEY_PHASES[JOURNEY_PHASES.length - 1]

  return {
    current,
    target: goal.target,
    left,
    percent: goal.target > 0 ? Math.min(100, Math.round((current / goal.target) * 1000) / 10) : 0,
    stage: { range: phase.range, name: phase.name },
    per_week_last_4: last4 == null ? null : round1(last4),
    per_week_4_before: before4 == null ? null : round1(before4),
    trend,
    trend_why: why,
    reach_target_on: reach,
    deadline: goal.deadline,
    weeks_to_deadline: weeksLeft == null ? null : round1(weeksLeft),
    needed_per_week: needed == null ? null : Number.isFinite(needed) ? round1(needed) : null,
    on_track: needed == null || last4 == null ? null : left === 0 || (Number.isFinite(needed) && last4 >= needed),
  }
}
