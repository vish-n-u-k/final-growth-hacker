import { db } from '@/lib/db'
import { modules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { MODULE_MAP, isPathModule } from '@/lib/modules/registry'

export async function getGrowthOverview(brandId: string) {
  const rows = await db
    .select({
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
  const path = rows.filter((m) => isPathModule(m.type)).sort((a, b) => MODULE_MAP[a.type].order - MODULE_MAP[b.type].order)
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
