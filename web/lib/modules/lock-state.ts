import { db } from '@/lib/db'
import { modules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { MODULE_MAP } from './registry'

// Mirrors the lock rule in components/AllModulesDashboard.tsx's isModuleLocked:
// a module is locked if the previous module (by order, skipping comingSoon ones)
// scored under 80%. Outside production, nothing is locked. This lives here so
// server code (e.g. the dashboard shell layout) can check a module's lock state
// without importing a 'use client' component.
export async function getLockedModuleTypes(brandId: string): Promise<Set<string>> {
  if (process.env.NEXT_PUBLIC_APP_ENV !== 'production') return new Set()

  const rows = await db
    .select({ type: modules.type, order: modules.order, score: modules.score, status: modules.status })
    .from(modules)
    .where(eq(modules.brandId, brandId))

  const sorted = rows
    .filter((m) => m.status !== 'not-applicable' && MODULE_MAP[m.type] && !MODULE_MAP[m.type].comingSoon)
    .sort((a, b) => a.order - b.order)

  const locked = new Set<string>()
  sorted.forEach((m, i) => {
    if (m.order <= 3) return // Foundation, Website Audit, SEO always unlocked
    const prev = sorted[i - 1]
    if (!prev || (prev.score ?? 0) < 80) locked.add(m.type)
  })
  return locked
}
