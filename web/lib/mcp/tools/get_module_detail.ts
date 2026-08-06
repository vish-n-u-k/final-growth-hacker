import { db } from '@/lib/db'
import { modules, moduleItems, moduleCategories } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

export async function getModuleDetail(brandId: string, moduleType: string) {
  const [mod] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.brandId, brandId), eq(modules.type, moduleType)))
    .limit(1)

  if (!mod) return { error: `Module type "${moduleType}" not found for this brand.` }

  const [items, cats] = await Promise.all([
    db.select().from(moduleItems).where(eq(moduleItems.moduleId, mod.id)),
    db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, mod.id)),
  ])

  // Build category map: id → category row
  const catMap = new Map(cats.map((c) => [c.id, c]))

  // Group items by their category label
  const grouped: Record<string, { slug: string; label: string; items: unknown[] }> = {}

  for (const item of items) {
    const cat = catMap.get(item.categoryId)
    const catSlug = cat?.slug ?? 'uncategorized'
    const catLabel = cat?.label ?? 'Uncategorized'

    if (!grouped[catSlug]) {
      grouped[catSlug] = { slug: catSlug, label: catLabel, items: [] }
    }

    grouped[catSlug].items.push({
      id: item.id,
      slug: item.slug,
      label: item.label,
      weight: item.weight,
      aiVerified: item.aiVerified,
      userChecked: item.userChecked,
      completedBy: item.completedBy,
      aiDetail: item.aiDetail,
      aiNarrative: item.aiNarrative,
      aiAction: item.aiAction,
    })
  }

  return {
    module: {
      type: mod.type,
      name: mod.name,
      status: mod.status,
      score: mod.score ?? 0,
      lastAnalyzedAt: mod.lastAnalyzedAt?.toISOString() ?? null,
    },
    categories: Object.values(grouped),
  }
}
