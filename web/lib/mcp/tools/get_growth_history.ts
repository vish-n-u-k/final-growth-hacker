import { getBrandHistory } from '@/lib/history'

// Day-by-day history plus a first-vs-latest summary, so Claude can say
// "SEO went from 40 to 72 this month" or "you moved from awareness to conversion".
export async function getGrowthHistory(brandId: string, days: number) {
  const rows = await getBrandHistory(brandId, days).catch(() => [])
  if (rows.length === 0) {
    return { message: 'No history yet. GrowJin records one snapshot per day, starting from the first nightly run after this feature went live.' }
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
