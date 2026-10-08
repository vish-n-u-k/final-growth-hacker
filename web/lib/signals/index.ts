// ── Signals ───────────────────────────────────────────────────────────────────
// A signal is a timely task raised because something CHANGED (DNS record broke,
// ad spend dropped, business stage moved). Detectors compare fresh data with the
// last snapshot, then open or clear signals. getTodayTasks surfaces open ones.

import { db } from '@/lib/db'
import { brandSignals, signalSnapshots } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { TaskRoute } from '@/lib/daily/today-tasks'

export interface SignalInput {
  source: string
  signalKey: string
  title: string
  detail?: string
  action?: string
  route?: TaskRoute
  priority?: 1 | 2 | 3
  cooldownDays?: number // override COOLDOWN_DAYS (e.g. social posts recur every few days)
}

// Don't re-raise a signal the user closed this recently, even if the condition persists
const COOLDOWN_DAYS = 7

export async function openSignal(brandId: string, s: SignalInput): Promise<boolean> {
  const since = new Date(Date.now() - (s.cooldownDays ?? COOLDOWN_DAYS) * 86400000)
  const recent = await db
    .select({ id: brandSignals.id, status: brandSignals.status, resolvedAt: brandSignals.resolvedAt })
    .from(brandSignals)
    .where(and(
      eq(brandSignals.brandId, brandId),
      eq(brandSignals.source, s.source),
      eq(brandSignals.signalKey, s.signalKey),
    ))

  // Already open → refresh its wording so numbers ("last post 4 days ago") stay current
  const open = recent.find((r) => r.status === 'open')
  if (open) {
    await db
      .update(brandSignals)
      .set({ title: s.title, detail: s.detail ?? null, action: s.action ?? null, route: s.route ?? 'manual', priority: s.priority ?? 2 })
      .where(eq(brandSignals.id, open.id))
    return false
  }

  // The user closed it within the cooldown → skip.
  // 'cleared' (condition went away on its own) doesn't block re-raising.
  const blocked = recent.some((r) =>
    (r.status === 'done' || r.status === 'dismissed') && r.resolvedAt && r.resolvedAt >= since,
  )
  if (blocked) return false

  await db.insert(brandSignals).values({
    brandId,
    source: s.source,
    signalKey: s.signalKey,
    title: s.title,
    detail: s.detail ?? null,
    action: s.action ?? null,
    route: s.route ?? 'manual',
    priority: s.priority ?? 2,
  })
  return true
}

// Condition no longer holds → close open signals automatically
export async function clearSignals(brandId: string, source: string, signalKeys: string[]) {
  if (signalKeys.length === 0) return
  await db
    .update(brandSignals)
    .set({ status: 'cleared', resolvedAt: new Date() })
    .where(and(
      eq(brandSignals.brandId, brandId),
      eq(brandSignals.source, source),
      eq(brandSignals.status, 'open'),
      inArray(brandSignals.signalKey, signalKeys),
    ))
}

// User (or Claude via MCP) marks a signal done / dismissed
export async function resolveSignal(brandId: string, signalId: string, status: 'done' | 'dismissed') {
  const [row] = await db
    .update(brandSignals)
    .set({ status, resolvedAt: new Date() })
    .where(and(eq(brandSignals.id, signalId), eq(brandSignals.brandId, brandId)))
    .returning({ id: brandSignals.id })
  return row ? { ok: true, signalId, status } : { error: 'Signal not found.' }
}

export async function getOpenSignals(brandId: string) {
  return db
    .select()
    .from(brandSignals)
    .where(and(eq(brandSignals.brandId, brandId), eq(brandSignals.status, 'open')))
}

export async function getSnapshot<T>(brandId: string, source: string): Promise<T | null> {
  const [row] = await db
    .select({ data: signalSnapshots.data })
    .from(signalSnapshots)
    .where(and(eq(signalSnapshots.brandId, brandId), eq(signalSnapshots.source, source)))
    .limit(1)
  return (row?.data as T) ?? null
}

export async function saveSnapshot(brandId: string, source: string, data: unknown) {
  await db
    .insert(signalSnapshots)
    .values({ brandId, source, data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [signalSnapshots.brandId, signalSnapshots.source],
      set: { data, updatedAt: new Date() },
    })
}

