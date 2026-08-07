import { db } from '@/lib/db'
import { modules, moduleItems, moduleCategories } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

const WEIGHT_LABEL: Record<number, string> = { 3: 'critical', 2: 'important', 1: 'minor' }

export async function getPendingItems(brandId: string, moduleType?: string) {
  // Get relevant modules
  const allModules = await db
    .select()
    .from(modules)
    .where(eq(modules.brandId, brandId))
    .orderBy(modules.order)

  const targetModules = moduleType
    ? allModules.filter((m) => m.type === moduleType)
    : allModules.filter((m) => m.status !== 'locked')

  if (moduleType && targetModules.length === 0) {
    return { error: `Module type "${moduleType}" not found for this brand.` }
  }

  const moduleIds = targetModules.map((m) => m.id)
  if (moduleIds.length === 0) return { totalPending: 0, items: [] }

  // Fetch all items and categories for these modules
  const [allItems, allCats] = await Promise.all([
    db.select().from(moduleItems).where(inArray(moduleItems.moduleId, moduleIds)),
    db.select().from(moduleCategories).where(inArray(moduleCategories.moduleId, moduleIds)),
  ])

  const catMap = new Map(allCats.map((c) => [c.id, c]))
  const modMap = new Map(targetModules.map((m) => [m.id, m]))

  // Filter to pending only (not verified by AI and not checked by user)
  const pending = allItems.filter((item) => !item.aiVerified && !item.userChecked)

  // Sort: weight desc (critical first), then by module order
  pending.sort((a, b) => {
    const weightDiff = (b.weight ?? 1) - (a.weight ?? 1)
    if (weightDiff !== 0) return weightDiff
    const modA = modMap.get(a.moduleId)?.order ?? 99
    const modB = modMap.get(b.moduleId)?.order ?? 99
    return modA - modB
  })

  const items = pending.map((item) => {
    const mod = modMap.get(item.moduleId)
    const cat = catMap.get(item.categoryId)
    return {
      id: item.id,
      slug: item.slug,
      label: item.label,
      priority: WEIGHT_LABEL[item.weight ?? 1] ?? 'minor',
      module: mod?.name ?? 'Unknown',
      moduleType: mod?.type ?? 'unknown',
      category: cat?.label ?? 'Uncategorized',
      aiDetail: item.aiDetail ?? null,
      aiAction: item.aiAction ?? null,
    }
  })

  return {
    totalPending: items.length,
    ...(moduleType ? {} : { acrossModules: targetModules.length }),
    items,
  }
}
