import { db } from '@/lib/db'
import { modules, moduleItems, moduleCategories } from '@/lib/db/schema'
import { isElementEvidence } from '@/lib/audit/elements'
import { and, eq } from 'drizzle-orm'
import { isNotChecked } from '@/lib/modules/types'
import { moduleScore } from '@/lib/modules/score'
import { MODULE_MAP } from '@/lib/modules/registry'

export async function getModuleDetail(brandId: string, moduleType: string) {
  const [mod] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.brandId, brandId), eq(modules.type, moduleType)))
    .limit(1)

  if (!mod) {
    return {
      error: `Module type "${moduleType}" not found for this brand.`,
      ...(moduleType.includes('search') ? { hint: 'The Search Agent is not a module: use get_search_agent.' } : {}),
    }
  }

  const [items, cats] = await Promise.all([
    db.select().from(moduleItems).where(eq(moduleItems.moduleId, mod.id)),
    db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, mod.id)),
  ])

  // Build category map: id → category row
  const catMap = new Map(cats.map((c) => [c.id, c]))

  // Group items by their category label
  const grouped: Record<string, { slug: string; label: string; items: unknown[] }> = {}

  let notCheckedCount = 0
  for (const item of items) {
    const cat = catMap.get(item.categoryId)
    const catSlug = cat?.slug ?? 'uncategorized'
    const catLabel = cat?.label ?? 'Uncategorized'

    if (!grouped[catSlug]) {
      grouped[catSlug] = { slug: catSlug, label: catLabel, items: [] }
    }

    // A check that never ran is "not_checked", never a pass (older analyses saved some as verified)
    const notChecked = isNotChecked(item.aiDetail) && !item.userChecked
    if (notChecked) notCheckedCount++
    grouped[catSlug].items.push({
      id: item.id,
      slug: item.slug,
      label: item.label,
      weight: item.weight,
      status: item.userSkipped ? 'skipped'
        : item.userChecked ? 'done_by_user'
        : notChecked ? 'not_checked'
        : item.aiVerified ? 'passed'
        : item.aiDetail ? 'failed' : 'not_analysed',
      aiVerified: notChecked ? false : item.aiVerified,
      userChecked: item.userChecked,
      completedBy: item.completedBy,
      aiDetail: item.aiDetail,
      aiNarrative: item.aiNarrative,
      aiAction: item.aiAction,
      // Website Audit: the exact failing elements (selector, text, colours and a passing colour)
      ...(isElementEvidence(item.aiData) ? { elements: item.aiData.elements.map(({ rect: _r, ...el }) => el) } : {}),
    })
  }

  return {
    module: {
      type: mod.type,
      name: mod.name,
      status: mod.status,
      // Recomputed from the items, so checks that never ran don't count (the saved score may be older)
      score: items.length ? moduleScore(MODULE_MAP[mod.type], items) : mod.score ?? 0,
      lastAnalyzedAt: mod.lastAnalyzedAt?.toISOString() ?? null,
    },
    ...(notCheckedCount ? { not_checked: `${notCheckedCount} check${notCheckedCount === 1 ? '' : 's'} couldn't run and are left out of the score. Re-analyse the module (analyze_module) to try them again.` } : {}),
    categories: Object.values(grouped),
  }
}
