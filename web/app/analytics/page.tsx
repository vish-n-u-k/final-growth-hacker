import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules as modulesTable, moduleItems } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { MODULE_MAP } from '@/lib/modules/registry'
import AnalyticsDashboard, { type ModuleHealth } from './AnalyticsDashboard'

function getModuleSource(type: string): string {
  const aiRules = ['seo', 'geo', 'content-audit', 'social-media', 'brand-audit', 'geo-competitor-gap']
  const ai = ['competitor-analysis', 'user-acquisition', 'meta-ads', 'outreach-targets', 'user-analytics', 'gmail-outreach']
  if (aiRules.includes(type)) return 'AI + Rules'
  if (ai.includes(type)) return 'AI'
  return 'Internal'
}

export default async function AuthAnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.userId, user.id))
    .limit(1)
  if (!brand) redirect('/onboarding')

  const allModules = await db
    .select()
    .from(modulesTable)
    .where(eq(modulesTable.brandId, brand.id))
    .orderBy(modulesTable.order)

  // Fetch all items to extract per-module insights (worst failing item)
  const moduleIds = allModules.map(m => m.id)
  const allItems = moduleIds.length > 0
    ? await db.select({
        moduleId: moduleItems.moduleId,
        weight: moduleItems.weight,
        aiDetail: moduleItems.aiDetail,
        aiVerified: moduleItems.aiVerified,
        userChecked: moduleItems.userChecked,
      }).from(moduleItems).where(inArray(moduleItems.moduleId, moduleIds))
    : []

  // Group items by module
  const itemsByModule = new Map<string, typeof allItems>()
  for (const item of allItems) {
    if (!itemsByModule.has(item.moduleId)) itemsByModule.set(item.moduleId, [])
    itemsByModule.get(item.moduleId)!.push(item)
  }

  const moduleHealth: ModuleHealth[] = allModules
    .filter(m => m.type !== 'business-stage')
    .flatMap(m => {
      const def = MODULE_MAP[m.type]
      if (!def) return []

      const locked = m.status === 'locked' || def.comingSoon === true
      const items = itemsByModule.get(m.id) ?? []

      // Find worst failing item with an insight to show
      const failingItems = items
        .filter(i => !i.aiVerified && !i.userChecked && i.aiDetail)
        .sort((a, b) => b.weight - a.weight)
      const insight = failingItems[0]?.aiDetail ?? null

      return [{
        name: def.name,
        score: m.score ?? 0,
        source: locked ? 'Locked' : getModuleSource(m.type),
        desc: def.description,
        insight,
        locked,
      }]
    })

  return (
    <AnalyticsDashboard
      brand={{ id: brand.id, name: brand.name }}
      modules={moduleHealth}
      dailyEmailEnabled={brand.dailyEmailEnabled ?? false}
    />
  )
}
