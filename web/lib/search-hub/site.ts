// Search & AI page: the SEO and AI readiness (GEO) module scores, and their most important open items
// as to-dos. Read from the Growth Path modules; nothing is analysed here.

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { moduleItems, modules } from '@/lib/db/schema'
import type { SiteIssue } from './verdict'

export interface SiteChecks {
  seo: { score: number; href: string } | null
  geo: { score: number; href: string } | null
  issues: SiteIssue[]
}

export async function readSiteChecks(brandId: string): Promise<SiteChecks> {
  const mods = await db.select({ id: modules.id, type: modules.type, score: modules.score, status: modules.status, last: modules.lastAnalyzedAt })
    .from(modules).where(and(eq(modules.brandId, brandId), inArray(modules.type, ['seo', 'geo'])))
  const done = mods.filter(m => m.last && m.status !== 'locked')
  const one = (type: string) => {
    const m = done.find(x => x.type === type)
    return m ? { score: m.score ?? 0, href: `/dashboard/${m.id}` } : null
  }
  if (!done.length) return { seo: null, geo: null, issues: [] }
  const items = await db.select({
    moduleId: moduleItems.moduleId, slug: moduleItems.slug, label: moduleItems.label, weight: moduleItems.weight,
    detail: moduleItems.aiDetail, action: moduleItems.aiAction, verified: moduleItems.aiVerified, checked: moduleItems.userChecked, skipped: moduleItems.userSkipped,
  }).from(moduleItems).where(inArray(moduleItems.moduleId, done.map(m => m.id)))
  const typeOf = new Map(done.map(m => [m.id, m.type]))
  // Open, important items: AI readiness first (it's what moves AI answers), then by weight
  const issues = items
    .filter(i => !i.verified && !i.checked && !i.skipped && i.weight >= 2)
    .sort((a, b) => Number(typeOf.get(b.moduleId) === 'geo') - Number(typeOf.get(a.moduleId) === 'geo') || b.weight - a.weight)
    .slice(0, 3)
    .map(i => ({
      key: `${typeOf.get(i.moduleId)}:${i.slug}`,
      label: i.label,
      detail: (i.action || i.detail || 'Open the check for the fix.').replace(/\s+/g, ' ').slice(0, 220),
      module: typeOf.get(i.moduleId) === 'geo' ? 'AI readiness' as const : 'SEO' as const,
      href: `/dashboard/${i.moduleId}`,
    }))
  return { seo: one('seo'), geo: one('geo'), issues }
}
