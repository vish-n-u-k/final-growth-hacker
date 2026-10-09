import { db } from '@/lib/db'
import { modules, moduleRuns } from '@/lib/db/schema'
import { and, desc, eq, ne, sql } from 'drizzle-orm'

// Bookkeeping for module analysis jobs (drizzle/module_runs.sql).
// Every function here tolerates the module_runs table not existing yet: reads return
// undefined and writes are skipped, so the analyze route falls back to its old behaviour.

// The analyze route's maxDuration is 300s. A run still 'running' after this was killed
// by the platform before it could record its outcome.
export const RUN_STALE_MS = 330_000
export const STALE_RUN_ERROR = 'The analysis took too long and was stopped. Please try again.'

export type ModuleRun = typeof moduleRuns.$inferSelect

export function isStale(run: ModuleRun): boolean {
  return run.status === 'running' && Date.now() - run.startedAt.getTime() > RUN_STALE_MS
}

/** Latest (or the given) run. null = no runs recorded; undefined = module_runs table unavailable. */
export async function getRun(moduleId: string, runId?: string | null): Promise<ModuleRun | null | undefined> {
  try {
    const [row] = await db
      .select()
      .from(moduleRuns)
      .where(runId ? and(eq(moduleRuns.id, runId), eq(moduleRuns.moduleId, moduleId)) : eq(moduleRuns.moduleId, moduleId))
      .orderBy(desc(moduleRuns.startedAt))
      .limit(1)
    return row ?? null
  } catch (err) {
    console.error('[module_runs] read failed — has drizzle/module_runs.sql been run?', err)
    return undefined
  }
}

export async function finishRun(runId: string | null, error: string | null): Promise<void> {
  if (!runId) return
  try {
    await db
      .update(moduleRuns)
      .set({ status: error ? 'failed' : 'done', error, finishedAt: new Date() })
      .where(eq(moduleRuns.id, runId))
  } catch (err) {
    console.error('[module_runs] finish failed:', err)
  }
}

/** Marks a dead run failed and releases the module's 'analyzing' status. */
export async function failStaleRun(run: ModuleRun): Promise<void> {
  await finishRun(run.id, STALE_RUN_ERROR)
  await db
    .update(modules)
    .set({ status: 'pending' })
    .where(and(eq(modules.id, run.moduleId), eq(modules.status, 'analyzing')))
}

/**
 * Claims a module for a new analysis. Only one caller can flip the module to 'analyzing',
 * so concurrent requests (reloads, a second device) can't start duplicate runs.
 * Returns claimed=false with the live run's id when one is already in flight.
 */
export async function claimRun(moduleId: string): Promise<{ claimed: boolean; runId: string | null }> {
  const flipped = await db
    .update(modules)
    .set({ status: 'analyzing' })
    .where(and(eq(modules.id, moduleId), ne(modules.status, 'analyzing')))
    .returning({ id: modules.id })

  if (flipped.length === 0) {
    const live = await getRun(moduleId)
    if (live && live.status === 'running' && !isStale(live)) return { claimed: false, runId: live.id }
    // Stale run, or 'analyzing' set by something that doesn't track runs: take it over.
    if (live && live.status === 'running') await finishRun(live.id, STALE_RUN_ERROR)
  }

  try {
    const [row] = await db.insert(moduleRuns).values({ moduleId }).returning({ id: moduleRuns.id })
    return { claimed: true, runId: row.id }
  } catch (err) {
    console.error('[module_runs] insert failed — has drizzle/module_runs.sql been run?', err)
    return { claimed: true, runId: null }
  }
}

// ── Progress stage ("fetch" → "analyse" → "save") for the run in flight ──
// Stored in module_runs.stage (drizzle/module_runs_stage.sql). Deliberately raw SQL and outside the
// drizzle schema: until that migration runs, writes are skipped and reads return null, and nothing else breaks.
export type RunStage = 'fetch' | 'analyse' | 'save'

export async function setRunStage(moduleId: string, stage: RunStage): Promise<void> {
  try {
    await db.execute(sql`update module_runs set stage = ${stage} where module_id = ${moduleId} and status = 'running'`)
  } catch { /* stage column not added yet */ }
}

export async function getRunStage(runId: string): Promise<RunStage | null> {
  try {
    const rows = await db.execute(sql`select stage from module_runs where id = ${runId}`)
    const row = (rows as unknown as { stage: string | null }[])[0]
    return (row?.stage as RunStage | null) ?? null
  } catch {
    return null
  }
}
