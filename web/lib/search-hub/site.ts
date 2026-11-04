// Search & AI page: the SEO and AI readiness (GEO) module scores, and the AI readiness checklist
// ("Site ready for AI"). Read from the Growth Path modules; nothing is analysed here.

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { moduleItems, modules } from '@/lib/db/schema'

export interface SiteCheck { key: string; label: string; ok: boolean; detail: string }
export interface SiteChecks {
  seo: { score: number; href: string } | null
  geo: { score: number; href: string } | null
  aiChecks: SiteCheck[]     // the AI readiness module's important items: done or to fix
}

export async function readSiteChecks(brandId: string): Promise<SiteChecks> {
  const mods = await db.select({ id: modules.id, type: modules.type, score: modules.score, status: modules.status, last: modules.lastAnalyzedAt })
    .from(modules).where(and(eq(modules.brandId, brandId), inArray(modules.type, ['seo', 'geo'])))
  const done = mods.filter(m => m.last && m.status !== 'locked')
  const one = (type: string) => {
    const m = done.find(x => x.type === type)
    return m ? { score: m.score ?? 0, href: `/dashboard/${m.id}` } : null
  }
  const geo = done.find(m => m.type === 'geo')
  if (!geo) return { seo: one('seo'), geo: null, aiChecks: [] }
  const items = await db.select({
    slug: moduleItems.slug, label: moduleItems.label, weight: moduleItems.weight, detail: moduleItems.aiDetail, action: moduleItems.aiAction,
    verified: moduleItems.aiVerified, checked: moduleItems.userChecked, skipped: moduleItems.userSkipped,
  }).from(moduleItems).where(eq(moduleItems.moduleId, geo.id))
  // The important ones: to fix first, then done
  const aiChecks = items
    .filter(i => i.weight >= 2 && !i.skipped)
    .map(i => {
      const ok = !!(i.verified || i.checked)
      return { key: i.slug, label: i.label, ok, detail: ((ok ? i.detail : i.action || i.detail) ?? '').replace(/\s+/g, ' ').slice(0, 200), weight: i.weight }
    })
    .sort((a, b) => Number(a.ok) - Number(b.ok) || b.weight - a.weight)
    .slice(0, 8)
    .map(({ weight: _w, ...c }) => c)
  return { seo: one('seo'), geo: one('geo'), aiChecks }
}
