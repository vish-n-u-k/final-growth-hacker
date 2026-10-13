import { db } from '@/lib/db'
import { modules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { MODULE_MAP, MODULE_REGISTRY } from './registry'
import type { RoadmapModule } from './roadmap'

// Read-only list of a brand's modules for the sidebar roadmap. Same filters as the Growth Path page:
// not-applicable and business-stage modules are left out, and coming-soon modules sit last.
export async function getRoadmapModules(brandId: string, lockedTypes: Set<string>, planLockedTypes: string[]): Promise<RoadmapModule[]> {
  let rows: { id: string; type: string; name: string; order: number; score: number | null; status: string; lastAnalyzedAt: Date | null }[] = []
  try {
    rows = await db
      .select({ id: modules.id, type: modules.type, name: modules.name, order: modules.order, score: modules.score, status: modules.status, lastAnalyzedAt: modules.lastAnalyzedAt })
      .from(modules)
      .where(eq(modules.brandId, brandId))
  } catch (err) {
    console.error('[roadmap] module list failed', err)
    return []
  }
  const list: RoadmapModule[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const def = MODULE_MAP[r.type]
    if (!def || r.status === 'not-applicable' || r.type === 'business-stage') continue
    seen.add(r.type)
    list.push({
      id: r.id, type: r.type, name: r.name, order: def.order, score: r.score ?? 0, analysed: !!r.lastAnalyzedAt,
      comingSoon: !!def.comingSoon, locked: lockedTypes.has(r.type), planLocked: planLockedTypes.includes(r.type),
    })
  }
  for (const def of MODULE_REGISTRY) {
    if (def.comingSoon && !seen.has(def.type) && def.type !== 'business-stage') {
      list.push({ id: `coming-soon-${def.type}`, type: def.type, name: def.name, order: def.order, score: 0, analysed: false, comingSoon: true, locked: false, planLocked: false })
    }
  }
  return list.sort((a, b) => (Number(a.comingSoon) - Number(b.comingSoon)) || a.order - b.order)
}
