import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { outreachEmails } from '@/lib/db/schema'
import { getBrandHistory } from '@/lib/history'
import { readDemoSwitch, readSearchData } from '@/lib/agents/store'
import { withDemo } from '@/lib/agents/demo'
import { getGoalProgress } from './goal'
import { getDailyNumbers } from './daily_numbers'
import { listWork } from './work_log'

// MCP get_weekly_review: one answer for "what moved us towards the goal this week, and what
// barely mattered?". Puts side by side: goal pace, this week vs last week per number and per
// channel, the work done (work log, emails sent, tasks ticked), and changes being tested.
// The judgement (what to double down on) stays with Claude.

const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

const change = (now: number, before: number) => ({
  last_7d: now,
  previous_7d: before,
  change: now - before,
  change_pct: before > 0 ? Math.round(((now - before) / before) * 100) : null,
})

export async function getWeeklyReview(brandId: string) {
  const since = iso(Date.now() - 7 * DAY)
  const [goal, daily, work, emails, history, search] = await Promise.all([
    getGoalProgress(brandId).catch(e => ({ error: String(e) })),
    getDailyNumbers(brandId).catch(e => ({ error: String(e) })),
    listWork(brandId, { from: since, limit: 50 }).catch(() => null),
    db.select({ source: outreachEmails.source, n: sql<number>`count(*)::int` })
      .from(outreachEmails)
      .where(and(eq(outreachEmails.brandId, brandId), eq(outreachEmails.status, 'sent'), gte(outreachEmails.sentAt, new Date(Date.now() - 7 * DAY))))
      .groupBy(outreachEmails.source)
      .catch(() => [] as { source: string | null; n: number }[]),
    getBrandHistory(brandId, 8).catch(() => []),
    readDemoSwitch(brandId).then(demo => withDemo(demo, () => readSearchData(brandId))).catch(() => null),
  ])

  // This week vs last week for each number the daily tool has
  const d = daily as Record<string, any>
  const numbers: Record<string, unknown> = {}
  const add = (name: string, b: { last_7d?: number; previous_7d?: number } | undefined) => {
    if (b && typeof b.last_7d === 'number' && typeof b.previous_7d === 'number') numbers[name] = change(b.last_7d, b.previous_7d)
  }
  add('website_visits', d.website?.visits)
  add('new_visitors', d.website?.new_visitors)
  add('signups', d.app?.signups)
  if (typeof d.google_search?.clicks_last_7d === 'number') numbers.google_clicks = change(d.google_search.clicks_last_7d, d.google_search.clicks_previous_7d)

  // Module scores at the start and end of the week, from the daily history
  const first = history[0], last = history[history.length - 1]
  const scoreMoves = first && last && first !== last
    ? Object.keys(last.modules).filter(t => t in first.modules && first.modules[t] !== last.modules[t]).map(t => ({ module: t, from: first.modules[t], to: last.modules[t] }))
    : []
  const sum = (pick: (r: (typeof history)[number]) => number) => history.slice(1).reduce((s, r) => s + pick(r), 0)

  const w = work as { total?: number; by_kind?: Record<string, number>; entries?: { kind: string; title: string; done_on: string; status: string }[]; error?: string; message?: string } | null
  const tests = (search?.changes ?? []).filter(c => c.status === 'testing')

  return {
    week: { from: since, to: iso(Date.now() - DAY) },
    goal: 'error' in (goal as object)
      ? goal
      : (({ goal: g, current, target, percent, per_week_last_4, per_week_4_before, trend, trend_why, reach_target_on, on_track, needed_per_week, weeks }: any) => ({
          goal: g, current, target, percent, per_week_last_4, per_week_4_before, trend, trend_why, reach_target_on, on_track, needed_per_week,
          this_week_so_far: weeks?.at(-1)?.change ?? null,
          last_full_week: weeks?.at(-2)?.change ?? null,
        }))(goal),
    numbers_this_week_vs_last: numbers,
    channels: {
      last_7d_vs_previous_7d: d.website?.channels_last_7d_vs_previous_7d ?? null,
      moved_most: d.website?.moved_most ?? null,
      went_quiet: d.website?.went_quiet ?? null,
    },
    unusual_days: d.unusual ?? null,
    work_done: {
      work_log: w?.entries ? { total: w.total, by_kind: w.by_kind, entries: w.entries.slice(0, 20).map(e => ({ kind: e.kind, title: e.title, done_on: e.done_on, status: e.status })) } : (w?.error ?? w?.message ?? 'Nothing logged.'),
      emails_sent: Object.fromEntries(emails.map(e => [e.source ?? 'other', e.n])),
      growjin_tasks_done: history.length > 1 ? { checklist_items: sum(r => r.tasks.itemsDone), today_tasks: sum(r => r.tasks.signalsDone) } : 'Not enough daily history yet.',
    },
    changes_being_tested: tests.map(t => ({ area: t.area, what: t.what, page: t.path ?? null, keyword: t.keyword ?? null, question: t.question ?? null, since: t.at.slice(0, 10) })),
    module_score_changes: scoreMoves,
    ...(d.not_available ? { not_available: d.not_available } : {}),
    how_to_read: 'Compare what changed (numbers, channels, goal pace) with what was done (work, emails, tests). Say what most likely moved the goal and what barely mattered, and be clear when the numbers are too small to tell. Search & AI tests take about 6 weeks to judge.',
  }
}
