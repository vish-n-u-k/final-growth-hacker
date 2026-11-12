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

/** The day before today (UTC), the last complete day: what the nightly cron records. */
export const yesterdayUtc = (now = Date.now()) => new Date(now - DAY_MS).toISOString().slice(0, 10)

// The table is in drizzle/tracking.sql, run by hand. When that was missed every nightly save
// failed quietly and the MCP said "No history yet", so the table is also made here on first use.
const CREATE_TABLE = sql`CREATE TABLE IF NOT EXISTS brand_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  date text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT brand_history_unique UNIQUE (brand_id, date)
)`

export const isMissingTable = (e: unknown) => {
  const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } }
  const code = err?.code ?? err?.cause?.code
  const msg = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`
  return code === '42P01' || (/brand_history/.test(msg) && /does not exist/i.test(msg))
}

let tableChecked = false
async function withTable<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (tableChecked || !isMissingTable(e)) throw e
    tableChecked = true
    console.error('[history] brand_history was missing; creating it (drizzle/tracking.sql)')
    await db.execute(CREATE_TABLE)
    return run()
  }
}

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

  // A failing count (e.g. a column missing in an older database) mustn't lose the whole day
  const [itemRow] = mods.length
    ? await db.select({ n: sql<number>`count(*)::int` })
        .from(moduleItems)
        .where(and(
          inArray(moduleItems.moduleId, mods.map((m) => m.id)),
          eq(moduleItems.userChecked, true),
          gte(moduleItems.userCheckedAt, from),
          lt(moduleItems.userCheckedAt, to),
        ))
        .catch((e) => { console.error('[history] ticked items count failed', e); return [{ n: 0 }] })
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

  await withTable(() => db.insert(brandHistory)
    .values({ brandId, date, data: day })
    .onConflictDoUpdate({ target: [brandHistory.brandId, brandHistory.date], set: { data: day } }))
  return day
}

export interface HistoryStatus {
  ok: boolean
  rows: number
  firstDate: string | null
  lastDate: string | null
  recordedNow: boolean      // yesterday was missing and was saved during this call
  problem: string | null    // plain reason when history is empty or behind
}

/**
 * Makes sure yesterday is saved for this brand (the nightly cron may not have run, or failed),
 * and says plainly what state the history is in. Used by the MCP history and goal tools.
 */
export async function ensureRecentHistory(brandId: string): Promise<HistoryStatus> {
  const yesterday = yesterdayUtc()
  let recordedNow = false
  let problem: string | null = null
  const read = () => db.select({
    rows: sql<number>`count(*)::int`,
    first: sql<string | null>`min(${brandHistory.date})`,
    last: sql<string | null>`max(${brandHistory.date})`,
  }).from(brandHistory).where(eq(brandHistory.brandId, brandId))

  let stats: { rows: number; first: string | null; last: string | null }
  try {
    [stats] = await withTable(read)
  } catch (e) {
    return { ok: false, rows: 0, firstDate: null, lastDate: null, recordedNow: false, problem: `The history table can't be read: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (stats.last !== yesterday) {
    const before = stats.last
    try {
      await recordBrandHistory(brandId, yesterday)
      recordedNow = true
      ;[stats] = await read()
    } catch (e) {
      problem = `Saving yesterday's numbers failed: ${e instanceof Error ? e.message : String(e)}`
    }
    if (!problem) {
      problem = before
        ? `The nightly save last ran for ${before}, so days after that are missing (saved ${yesterday} just now). Check that the daily-signals cron is running in Vercel.`
        : `Nothing was saved before ${yesterday} (saved just now). The nightly daily-signals cron hasn't recorded this brand yet, so trends start from today.`
    }
  }

  return { ok: stats.rows > 0, rows: stats.rows, firstDate: stats.first, lastDate: stats.last, recordedNow, problem }
}

export async function getBrandHistory(brandId: string, days: number) {
  const since = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10)
  const rows = await withTable(() => db.select({ date: brandHistory.date, data: brandHistory.data })
    .from(brandHistory)
    .where(and(eq(brandHistory.brandId, brandId), gte(brandHistory.date, since)))
    .orderBy(asc(brandHistory.date)))
  return rows.map((r) => ({ date: r.date, ...(r.data as BrandDay) }))
}
