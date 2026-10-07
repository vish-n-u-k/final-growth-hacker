// ── Brand history ─────────────────────────────────────────────────────────────
// One row per brand per day (brand_history), written by the daily-signals cron for
// the day that just ended. Scores and the diagnosis are otherwise overwritten, so
// this is the only record of "SEO went from 40 to 72" or "moved from awareness to
// conversion". Read by the MCP get_growth_history tool.

import { db } from '@/lib/db'
import { brandHistory, brandSignals, moduleItems, modules } from '@/lib/db/schema'
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { getSnapshot } from '@/lib/signals'
import { countActivity } from '@/lib/activity'
import type { Diagnosis } from '@/lib/daily/diagnosis'

export interface BrandDay {
  overallScore: number | null            // average of analysed, unlocked module scores
  modules: Record<string, number>        // module type → score
  stage: string | null                   // diagnosis bottleneck
  traffic: { sessions30d: number; perDay: number; conversions30d: number } | null
  app: { active30d: number | null; newThisWeek: number | null; returnPct: number | null } | null
  tasks: { itemsDone: number; signalsDone: number; signalsDismissed: number }
  activity: Record<string, number>       // activity_events counts for the day
}

const DAY_MS = 86_400_000

export async function recordBrandHistory(brandId: string, date: string): Promise<BrandDay> {
  const from = new Date(`${date}T00:00:00Z`)
  const to = new Date(from.getTime() + DAY_MS)

  const [mods, diagnosis, activity, [signalCounts]] = await Promise.all([
    db.select({ id: modules.id, type: modules.type, score: modules.score, status: modules.status, lastAnalyzedAt: modules.lastAnalyzedAt })
      .from(modules).where(eq(modules.brandId, brandId)),
    getSnapshot<Diagnosis>(brandId, 'diagnosis').catch(() => null),
    countActivity(brandId, from, to),
    db.select({
      done: sql<number>`count(*) filter (where ${brandSignals.status} = 'done')::int`,
      dismissed: sql<number>`count(*) filter (where ${brandSignals.status} = 'dismissed')::int`,
    })
      .from(brandSignals)
      .where(and(eq(brandSignals.brandId, brandId), gte(brandSignals.resolvedAt, from), lt(brandSignals.resolvedAt, to)))
      .catch(() => [{ done: 0, dismissed: 0 }]),
  ])

  const scored = mods.filter((m) => m.lastAnalyzedAt && m.status !== 'locked' && m.status !== 'not-applicable')
  const moduleScores = Object.fromEntries(scored.map((m) => [m.type, m.score ?? 0]))
  const overallScore = scored.length
    ? Math.round(scored.reduce((s, m) => s + (m.score ?? 0), 0) / scored.length)
    : null

  const [itemRow] = mods.length
    ? await db.select({ n: sql<number>`count(*)::int` })
        .from(moduleItems)
        .where(and(
          inArray(moduleItems.moduleId, mods.map((m) => m.id)),
          eq(moduleItems.userChecked, true),
          gte(moduleItems.userCheckedAt, from),
          lt(moduleItems.userCheckedAt, to),
        ))
    : [{ n: 0 }]

  const m = diagnosis?.metrics
  const day: BrandDay = {
    overallScore,
    modules: moduleScores,
    stage: diagnosis?.stage ?? null,
    traffic: m?.traffic ? { sessions30d: m.traffic.sessions30d, perDay: m.traffic.perDay, conversions30d: m.traffic.conversions30d } : null,
    app: m?.app ? { active30d: m.app.active30d, newThisWeek: m.app.newThisWeek, returnPct: m.app.returnPct } : null,
    tasks: { itemsDone: itemRow?.n ?? 0, signalsDone: signalCounts?.done ?? 0, signalsDismissed: signalCounts?.dismissed ?? 0 },
    activity,
  }

  await db.insert(brandHistory)
    .values({ brandId, date, data: day })
    .onConflictDoUpdate({ target: [brandHistory.brandId, brandHistory.date], set: { data: day } })
  return day
}

export async function getBrandHistory(brandId: string, days: number) {
  const since = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10)
  const rows = await db.select({ date: brandHistory.date, data: brandHistory.data })
    .from(brandHistory)
    .where(and(eq(brandHistory.brandId, brandId), gte(brandHistory.date, since)))
    .orderBy(asc(brandHistory.date))
  return rows.map((r) => ({ date: r.date, ...(r.data as BrandDay) }))
}
