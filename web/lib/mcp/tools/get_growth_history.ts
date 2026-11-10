import { ensureRecentHistory, getBrandHistory } from '@/lib/history'

// Day-by-day history plus a first-vs-latest summary, so Claude can say
// "SEO went from 40 to 72 this month" or "you moved from awareness to conversion".
export async function getGrowthHistory(brandId: string, days: number) {
  // Saves yesterday if the nightly run missed it, and says why history is short or empty
  const status = await ensureRecentHistory(brandId)
  let rows: Awaited<ReturnType<typeof getBrandHistory>> = []
  let readError: string | null = null
  try { rows = await getBrandHistory(brandId, days) } catch (e) { readError = e instanceof Error ? e.message : String(e) }
  const history = { days_saved: status.rows, first_day: status.firstDate, last_day: status.lastDate, ...(status.problem ? { problem: status.problem } : {}) }
  if (rows.length === 0) {
    return {
      message: readError ? `History couldn't be read: ${readError}` : status.problem ?? 'No history yet.',
      history,
    }
  }
  if (rows.length === 1) {
    return {
      message: 'Only one day saved so far, so there is no change to compare yet. Each night adds a day.',
      history,
      days: rows,
    }
  }

  const first = rows[0]
  const last = rows[rows.length - 1]
  const moduleChanges = Object.fromEntries(
    Object.keys(last.modules)
      .filter((type) => type in first.modules && first.modules[type] !== last.modules[type])
      .map((type) => [type, { from: first.modules[type], to: last.modules[type] }]),
  )
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0)

  return {
    history,
    from: first.date,
    to: last.date,
    change: {
      overallScore: { from: first.overallScore, to: last.overallScore },
      stage: { from: first.stage, to: last.stage },
      sessionsPerDay: { from: first.traffic?.perDay ?? null, to: last.traffic?.perDay ?? null },
      appActive30d: { from: first.app?.active30d ?? null, to: last.app?.active30d ?? null },
      modules: moduleChanges,
    },
    totals: {
      itemsDone: sum((r) => r.tasks.itemsDone),
      signalsDone: sum((r) => r.tasks.signalsDone),
      tasksDoneInClaude: sum((r) => r.activity['task_completed'] ?? 0),
    },
    days: rows,
  }
}
