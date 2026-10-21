import { db } from '@/lib/db'
import { modules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { MODULE_MAP, isPathModule } from './registry'

// Mirrors the lock rule in components/AllModulesDashboard.tsx's isModuleLocked:
// a module is locked if the previous module (by order, skipping comingSoon ones)
// scored under 80%. Outside production, or for an early-access user, nothing is locked. This lives here so
// server code (e.g. the dashboard shell layout) can check a module's lock state
// without importing a 'use client' component.
export async function getLockedModuleTypes(brandId: string, earlyAccess = false): Promise<Set<string>> {
  if (earlyAccess || process.env.NEXT_PUBLIC_APP_ENV !== 'production') return new Set()

  const rows = await db
    .select({ type: modules.type, order: modules.order, score: modules.score, status: modules.status })
    .from(modules)
    .where(eq(modules.brandId, brandId))

  // Growth Path steps only, in registry order (stored orders can lag behind a reorder).
  const sorted = rows
    .filter((m) => m.status !== 'not-applicable' && isPathModule(m.type) && !MODULE_MAP[m.type].comingSoon)
    .map((m) => ({ ...m, order: MODULE_MAP[m.type].order }))
    .sort((a, b) => a.order - b.order)

  const locked = new Set<string>()
  sorted.forEach((m, i) => {
    if (m.order <= 3) return // Foundation, Website Audit, SEO always unlocked
    const prev = sorted[i - 1]
    if (!prev || (prev.score ?? 0) < 80) locked.add(m.type)
  })
  return locked
}
