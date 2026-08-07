import { db } from '@/lib/db'
import { competitors, modules, moduleItems, moduleCategories } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'

export async function getCompetitors(brandId: string) {
  // Get all competitors from registry
  const competitorRows = await db
    .select()
    .from(competitors)
    .where(eq(competitors.brandId, brandId))
    .orderBy(competitors.discoveredAt)

  if (competitorRows.length === 0) {
    return {
      competitors: [],
      message: 'No competitors have been identified yet. Run the Competitor Analysis module to discover and analyse your competitors.',
      aiFindings: [],
    }
  }

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

  return {
    competitors: competitorRows.map(c => ({
      url: c.url,
      name: c.name ?? null,
      type: c.type ?? null,
      marketPosition: c.marketPosition ?? null,
      primaryStrength: c.primaryStrength ?? null,
      discoveredIn: c.discoveredIn ?? 'unknown',
      lastAnalyzedAt: c.lastAnalyzedAt?.toISOString() ?? null,
    })),
    aiFindings,
  }
}
