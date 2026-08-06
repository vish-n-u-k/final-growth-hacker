import { db } from '@/lib/db'
import { modules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

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

  const nonLocked = rows.filter((m) => m.status !== 'locked' && m.score !== null)
  const overallScore =
    nonLocked.length > 0
      ? Math.round(nonLocked.reduce((s, m) => s + (m.score ?? 0), 0) / nonLocked.length)
      : 0

  return {
    overallScore,
    modules: rows.map((m) => ({
      type: m.type,
      name: m.name,
      status: m.status,
      score: m.score ?? 0,
      lastAnalyzedAt: m.lastAnalyzedAt?.toISOString() ?? null,
    })),
  }
}
