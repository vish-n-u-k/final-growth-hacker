import { db } from '@/lib/db'
import { modules, moduleItems } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { moduleScore } from '@/lib/modules/score'
import { MODULE_MAP, isPathModule } from '@/lib/modules/registry'

export async function getGrowthOverview(brandId: string) {
  const rows = await db
    .select({
      id: modules.id,
      type: modules.type,
      name: modules.name,
      status: modules.status,
      score: modules.score,
      order: modules.order,
      lastAnalyzedAt: modules.lastAnalyzedAt,
    })
    .from(modules)
    .where(eq(modules.brandId, brandId))
    .orderBy(modules.order)

  // Growth Path steps only (tools like Meta Ads and retired modules aren't part of the score), in step order.
  const sorted = rows.filter((m) => isPathModule(m.type)).sort((a, b) => MODULE_MAP[a.type].order - MODULE_MAP[b.type].order)

  // Scores recomputed from the items (as Growth Path shows them), so checks that never ran
  // don't count even when the saved score is from an older analysis
  const items = sorted.length
    ? await db.select({
        moduleId: moduleItems.moduleId, slug: moduleItems.slug, weight: moduleItems.weight, aiVerified: moduleItems.aiVerified,
        userChecked: moduleItems.userChecked, userSkipped: moduleItems.userSkipped, aiDetail: moduleItems.aiDetail,
      }).from(moduleItems).where(inArray(moduleItems.moduleId, sorted.map((m) => m.id)))
    : []
  const path = sorted.map((m) => {
    const mine = items.filter((i) => i.moduleId === m.id)
    return { ...m, score: m.score !== null && mine.length ? moduleScore(MODULE_MAP[m.type], mine) : m.score }
  })
  const nonLocked = path.filter((m) => m.status !== 'locked' && m.score !== null)
  const overallScore =
    nonLocked.length > 0
      ? Math.round(nonLocked.reduce((s, m) => s + (m.score ?? 0), 0) / nonLocked.length)
      : 0

  return {
    overallScore,
    modules: path.map((m) => ({
      type: m.type,
      name: m.name,
      status: m.status,
      score: m.score ?? 0,
      lastAnalyzedAt: m.lastAnalyzedAt?.toISOString() ?? null,
    })),
  }
}
