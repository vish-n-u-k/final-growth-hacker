import { db } from '@/lib/db'
import { brands, competitors, modules, moduleItems, moduleCategories } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { domainOf } from '@/lib/agents/context'

type Row = {
  url: string
  name: string | null
  type: string | null
  marketPosition: string | null
  primaryStrength: string | null
  discoveredIn: string
  lastAnalyzedAt: string | null
}

export async function getCompetitors(brandId: string) {
  // Get all competitors from registry
  const competitorRows = await db
    .select()
    .from(competitors)
    .where(eq(competitors.brandId, brandId))
    .orderBy(competitors.discoveredAt)

  // Get AI findings from competitor-analysis and competitor-audit modules
  const competitorModules = await db
    .select({ id: modules.id, type: modules.type })
    .from(modules)
    .where(and(
      eq(modules.brandId, brandId),
      inArray(modules.type, ['competitor-analysis', 'competitor-audit']),
    ))

  let aiFindings: { module: string; label: string; finding: string; action: string | null }[] = []

  if (competitorModules.length > 0) {
    const moduleIds = competitorModules.map(m => m.id)
    const moduleTypeMap = Object.fromEntries(competitorModules.map(m => [m.id, m.type]))

    const items = await db
      .select({
        moduleId: moduleItems.moduleId,
        label: moduleItems.label,
        aiDetail: moduleItems.aiDetail,
        aiAction: moduleItems.aiAction,
        aiVerified: moduleItems.aiVerified,
      })
      .from(moduleItems)
      .where(and(
        inArray(moduleItems.moduleId, moduleIds),
        eq(moduleItems.aiVerified, true),
      ))

    aiFindings = items
      .filter(i => i.aiDetail)
      .map(i => ({
        module: moduleTypeMap[i.moduleId] ?? 'competitor',
        label: i.label,
        finding: i.aiDetail!,
        action: i.aiAction ?? null,
      }))
  }

  const list: Row[] = competitorRows.map(c => ({
    url: c.url,
    name: c.name ?? null,
    type: c.type ?? null,
    marketPosition: c.marketPosition ?? null,
    primaryStrength: c.primaryStrength ?? null,
    discoveredIn: c.discoveredIn ?? 'unknown',
    lastAnalyzedAt: c.lastAnalyzedAt?.toISOString() ?? null,
  }))

  // The table only holds competitors the user typed in. A list Competitor Analysis (or GEO)
  // suggested lives in that module's setup, so read those too (same as the agents do).
  const [brand] = await db.select({ websiteUrl: brands.websiteUrl }).from(brands).where(eq(brands.id, brandId)).limit(1)
  const seen = new Set<string>([domainOf(brand?.websiteUrl), ...list.map(c => domainOf(c.url))].filter(Boolean))
  const setups = await db.select({ type: modules.type, requirements: modules.requirements })
    .from(modules)
    .where(and(eq(modules.brandId, brandId), inArray(modules.type, ['competitor-analysis', 'geo'])))
  for (const type of ['competitor-analysis', 'geo']) {
    const req = (setups.find(m => m.type === type)?.requirements as Record<string, string> | null) ?? {}
    let named: { name?: string; url?: string }[] = []
    try { named = JSON.parse(req.achievable_competitors || '[]') } catch { /* no names cached */ }
    for (const url of (req.competitor_urls ?? '').split(/[,\n]/).map(u => u.trim()).filter(Boolean)) {
      const d = domainOf(url)
      if (!d || seen.has(d)) continue
      seen.add(d)
      const label = d.split('.')[0]
      list.push({
        url,
        name: named.find(a => a.url && domainOf(a.url) === d)?.name ?? label.charAt(0).toUpperCase() + label.slice(1),
        type: null,
        marketPosition: null,
        primaryStrength: null,
        discoveredIn: `${type} module setup`,
        lastAnalyzedAt: null,
      })
    }
  }

  if (list.length === 0) {
    return {
      competitors: [],
      message: 'No competitors have been identified yet. Run the Competitor Analysis module to discover and analyse your competitors.',
      aiFindings,
    }
  }

  return { competitors: list, aiFindings }
}
