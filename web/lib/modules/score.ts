import { db } from '@/lib/db'
import { modules, moduleItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { MODULE_MAP } from './registry'
import { isNotChecked, type ModuleCategoryDefinition, type ModuleDefinition } from './types'

// A module's score, the same way the Growth Path page shows it live: weighted share of items that
// are AI-verified or ticked by the user, leaving out skipped items. Static modules take the item
// list and weights from their definition; dynamic modules from their stored items.

type ItemState = { slug: string; weight: number; aiVerified: boolean | null; userChecked: boolean | null; userSkipped: boolean | null; aiDetail?: string | null }

export function moduleScore(def: ModuleDefinition | undefined, items: ItemState[]): number {
  let list: { weight: number; done: boolean }[]
  if (!def || def.dynamic) {
    list = items.filter(i => !i.userSkipped).map(i => ({ weight: i.weight, done: !!(i.aiVerified || i.userChecked) }))
  } else {
    const bySlug = new Map(items.map(i => [i.slug, i]))
    list = (def.categories as ModuleCategoryDefinition[])
      .flatMap(c => c.subCategories.flatMap(s => s.items))
      // Checks added after the last analysis don't count until they've been run (see AllModulesDashboard).
      // Insights (ideas) and checks that couldn't run this time never count.
      .filter(i => !i.insight && (bySlug.size === 0 || bySlug.has(i.slug)) && !bySlug.get(i.slug)?.userSkipped && !isNotChecked(bySlug.get(i.slug)?.aiDetail))
      .map(i => {
        const s = bySlug.get(i.slug)
        return { weight: i.weight, done: !!(s?.aiVerified || s?.userChecked) }
      })
  }
  const total = list.reduce((sum, i) => sum + i.weight, 0)
  const done = list.filter(i => i.done).reduce((sum, i) => sum + i.weight, 0)
  return total > 0 ? Math.round((done / total) * 100) : 0
}

/**
 * Recomputes and stores a module's score from its items. Called after anything changes an item
 * (tick, skip, verify, auto-fix), so the saved score that locks the next module, the sidebar and
 * the daily email always match what Growth Path shows. Returns the new score.
 */
export async function refreshModuleScore(moduleId: string): Promise<number | null> {
  try {
    const [mod] = await db.select({ type: modules.type }).from(modules).where(eq(modules.id, moduleId)).limit(1)
    if (!mod) return null
    const items = await db
      .select({ slug: moduleItems.slug, weight: moduleItems.weight, aiVerified: moduleItems.aiVerified, userChecked: moduleItems.userChecked, userSkipped: moduleItems.userSkipped, aiDetail: moduleItems.aiDetail })
      .from(moduleItems)
      .where(eq(moduleItems.moduleId, moduleId))
    const score = moduleScore(MODULE_MAP[mod.type], items)
    await db.update(modules).set({ score }).where(eq(modules.id, moduleId))
    return score
  } catch (err) {
    console.error('[score] refresh failed', err)
    return null
  }
}
