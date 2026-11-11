import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { ensureRecentHistory } from '@/lib/history'
import {
  COUNTS_LABEL, DEFAULT_GOAL, levelsFromAdds, levelsFromReadings, levelsFromSeries, paceOf,
  type Goal, type GoalCounts, type WeekPoint,
} from '@/lib/goal/progress'
import { NOT_CONNECTED, num, phQuery, posthogConn, type PosthogConn } from './posthog-common'

// The growth goal (Road to 500) for Claude: set it, and read where you stand, the pace and
// whether you're on track. Counts come from PostHog, like the Road to 500 on Today.

const KEY = 'goal'
const WEEKS = 13               // 12 full weeks + this one
const FIRST_SEEN_LOOKBACK = 180 // days scanned to find when someone was first seen (as get_posthog_segments)
const SAFE = /^[\w$]+$/
const SAFE_VALUE = /^[\w\- .]+$/

export async function readGoal(brandId: string): Promise<Goal> {
  const saved = await getSnapshot<Partial<Goal>>(brandId, KEY).catch(() => null)
  return { ...DEFAULT_GOAL, ...(saved ?? {}) }
}

export async function setGoal(brandId: string, args: Record<string, unknown>) {
  const goal = await readGoal(brandId)
  const errors: string[] = []
  if (args.target !== undefined) {
    const t = Math.round(Number(args.target))
    if (Number.isFinite(t) && t > 0 && t <= 10_000_000) goal.target = t
    else errors.push('target must be a positive whole number')
  }
  if (args.counts !== undefined) {
    const c = String(args.counts)
    if (c === 'signed_up' || c === 'active_weekly' || c === 'paying') {
      if (c !== goal.counts) goal.readings = {} // readings of another count would mix two measures
      goal.counts = c
    } else errors.push('counts must be signed_up, active_weekly or paying')
  }
  if (args.deadline !== undefined) {
    const d = String(args.deadline ?? '').trim()
    if (!d || d === 'none') goal.deadline = null
    else if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))) goal.deadline = d
    else errors.push('deadline must be YYYY-MM-DD, or empty to remove it')
  }
  if (args.plan_property !== undefined) {
    const p = String(args.plan_property)
    if (SAFE.test(p)) goal.planProperty = p; else errors.push('plan_property may only have letters, digits, _ and $')
  }
  if (args.plan_value !== undefined) {
    const v = String(args.plan_value)
    if (SAFE_VALUE.test(v)) goal.planValue = v; else errors.push('plan_value may only have letters, digits, spaces, - _ and .')
  }
  if (errors.length) return { saved: false, errors, goal: show(goal) }
  goal.setAt = new Date().toISOString()
  await saveSnapshot(brandId, KEY, goal)
  return { saved: true, goal: show(goal), next: 'Call get_goal_progress to see where you stand.' }
}

const show = (g: Goal) => ({
  target: g.target,
  counts: g.counts,
  counts_means: g.counts === 'paying' ? `people whose PostHog property "${g.planProperty}" is "${g.planValue}"` : COUNTS_LABEL[g.counts],
  deadline: g.deadline,
  set_by_user: !!g.setAt,
})

const day = (v: unknown) => Date.parse(`${String(v).slice(0, 10)}T00:00:00Z`)

async function measure(c: PosthogConn, g: Goal, now: number): Promise<{ current: number | null; points: WeekPoint[]; since_yesterday: number | null; error?: string }> {
  const who = c.filter.eventDistinctCol
  const pre = c.filter.eventPersonWherePrefix

  if (g.counts === 'signed_up') {
    // Total as the Road to 500 shows it; weekly sign-ups = people first seen that week
    const [total, weekly, today] = await Promise.all([
      phQuery(c, c.filter.personsCountQuery),
      phQuery(c, `SELECT toStartOfWeek(first_seen, 1) AS w, count() FROM (
          SELECT ${who} AS who, min(timestamp) AS first_seen FROM events
          WHERE ${pre}timestamp > now() - interval ${FIRST_SEEN_LOOKBACK} day GROUP BY who
        ) WHERE first_seen > now() - interval ${WEEKS * 7} day GROUP BY w ORDER BY w`),
      phQuery(c, `SELECT count() FROM (
          SELECT ${who} AS who, min(timestamp) AS first_seen FROM events
          WHERE ${pre}timestamp > now() - interval ${FIRST_SEEN_LOOKBACK} day GROUP BY who
        ) WHERE first_seen > now() - interval 1 day`),
    ])
    const current = num(total)
    if (current == null) return { current: null, points: [], since_yesterday: null, error: total.ok ? 'PostHog returned no count.' : total.error }
    const adds = new Map<number, number>()
    if (weekly.ok) for (const [w, n] of weekly.results) adds.set(day(w), Number(n))
    return { current, points: levelsFromAdds(current, adds, WEEKS, now), since_yesterday: num(today), ...(weekly.ok ? {} : { error: `Weekly numbers failed: ${weekly.error}` }) }
  }

  if (g.counts === 'active_weekly') {
    const [cur, weekly] = await Promise.all([
      phQuery(c, `SELECT count(DISTINCT ${who}) FROM events WHERE ${pre}timestamp > now() - interval 7 day`),
      phQuery(c, `SELECT toStartOfWeek(timestamp, 1) AS w, count(DISTINCT ${who}) FROM events
          WHERE ${pre}timestamp > now() - interval ${WEEKS * 7} day GROUP BY w ORDER BY w`),
    ])
    const current = num(cur)
    if (current == null) return { current: null, points: [], since_yesterday: null, error: cur.ok ? 'PostHog returned no count.' : cur.error }
    const series = new Map<number, number>()
    if (weekly.ok) for (const [w, n] of weekly.results) series.set(day(w), Number(n))
    return { current, points: levelsFromSeries(series, WEEKS, now), since_yesterday: null, ...(weekly.ok ? {} : { error: `Weekly numbers failed: ${weekly.error}` }) }
  }

  // paying: today's count from person properties; PostHog can't say when someone started paying,
  // so the trend comes from the daily readings this tool saves
  const prop = SAFE.test(g.planProperty) ? g.planProperty : 'plan'
  const val = SAFE_VALUE.test(g.planValue) ? g.planValue.replace(/'/g, '') : 'pro'
  const where = c.filter.personWhereClause
  const cond = `lower(toString(properties.${prop})) = lower('${val}')`
  const countExpr = c.filter.personsCountQuery.match(/^SELECT (.+?) FROM persons/)?.[1] ?? 'count()'
  const r = await phQuery(c, `SELECT ${countExpr} FROM persons ${where ? `${where} AND ${cond}` : `WHERE ${cond}`}`)
  const current = num(r)
  if (current == null) return { current: null, points: [], since_yesterday: null, error: r.ok ? 'PostHog returned no count.' : r.error }
  return { current, points: [], since_yesterday: null }
}

export async function getGoalProgress(brandId: string) {
  const goal = await readGoal(brandId)
  const c = await posthogConn(brandId)
  if (!c) return { goal: show(goal), ...NOT_CONNECTED, note: 'The goal is counted from PostHog. Without it there is no user count.' }

  const now = Date.now()
  const [m, history] = await Promise.all([
    measure(c, goal, now),
    // Keeps the daily history going even if the nightly run missed a day
    ensureRecentHistory(brandId).catch(() => null),
  ])
  if (m.current == null) return { goal: show(goal), connected: true, error: m.error }

  // Save today's reading (one per day, a year kept): the trend for 'paying', a record for the others
  const today = new Date(now).toISOString().slice(0, 10)
  const readings = { ...(goal.readings ?? {}), [today]: m.current }
  const keep = Object.keys(readings).sort().slice(-400)
  goal.readings = Object.fromEntries(keep.map(k => [k, readings[k]]))
  await saveSnapshot(brandId, KEY, goal).catch(() => {})

  const points = goal.counts === 'paying' ? levelsFromReadings(goal.readings, WEEKS, now) : m.points
  const { stage, ...pace } = paceOf(goal, m.current, points, now)

  return {
    goal: show(goal),
    ...pace,
    // The Road to 500 stages are about everyone who signed up
    ...(goal.counts === 'signed_up' ? { road_to_500_stage: stage } : {}),
    ...(m.since_yesterday != null ? { new_in_last_24h: m.since_yesterday } : {}),
    weeks: points.map(p => ({ week_of: p.week, total: p.level, change: p.added, ...(p.partial ? { so_far: true } : {}) })),
    how_counted: goal.counts === 'signed_up'
      ? `Total: everyone in PostHog (with the app's "Count unique users only" setting), as Road to 500 shows. Weekly change: people first seen that week (looking back ${FIRST_SEEN_LOOKBACK} days).`
      : goal.counts === 'active_weekly'
        ? 'People with any event in the last 7 days; each week is that week\'s active people.'
        : `People whose PostHog property "${goal.planProperty}" is "${goal.planValue}". PostHog doesn't record when someone started paying, so the trend builds from one reading a day, taken when this tool runs.`,
    ...(goal.setAt ? {} : { note: 'Using the default goal (500 people who signed up, no deadline). Ask the user if that\'s right, then save it with set_goal.' }),
    ...(m.error ? { warning: m.error } : {}),
    ...(history?.problem ? { history_note: history.problem } : {}),
  }
}

export type { GoalCounts }
