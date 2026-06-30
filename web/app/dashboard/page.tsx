import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleCategories, moduleItems, brandIntegrations, modulePageAudit } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { MODULE_MAP } from '@/lib/modules/registry'
import AllModulesDashboard, { type ModuleData } from '@/components/AllModulesDashboard'
import { type DBItemState } from '@/components/ModuleDashboard'
import type { DBItemFull } from '@/lib/modules/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const allModulesRaw = await db
    .select()
    .from(modules)
    .where(eq(modules.brandId, brand.id))
    .orderBy(modules.order)

  if (allModulesRaw.length === 0) redirect('/onboarding')

  const moduleIds = allModulesRaw.map((m) => m.id)

  const [allItemsRaw, allCatsRaw, allIntegrations, allPageAudits] = await Promise.all([
    db.select().from(moduleItems).where(inArray(moduleItems.moduleId, moduleIds)),
    db.select().from(moduleCategories).where(inArray(moduleCategories.moduleId, moduleIds)),
    db.select().from(brandIntegrations).where(eq(brandIntegrations.brandId, brand.id)),
    db.select().from(modulePageAudit).where(inArray(modulePageAudit.moduleId, moduleIds)),
  ])

  const githubConnected = allIntegrations.some(i => i.provider === 'github' && i.status === 'connected')
  const connectedIntegrations: Record<string, boolean> = {}
  for (const row of allIntegrations) {
    connectedIntegrations[row.provider] = row.status === 'connected'
  }

  // Group by moduleId
  const itemsByModule = new Map<string, typeof allItemsRaw>()
  for (const item of allItemsRaw) {
    if (!itemsByModule.has(item.moduleId)) itemsByModule.set(item.moduleId, [])
    itemsByModule.get(item.moduleId)!.push(item)
  }

  const catsByModule = new Map<string, typeof allCatsRaw>()
  for (const cat of allCatsRaw) {
    if (!catsByModule.has(cat.moduleId)) catsByModule.set(cat.moduleId, [])
    catsByModule.get(cat.moduleId)!.push(cat)
  }

  const auditsByModule = new Map<string, typeof allPageAudits>()
  for (const audit of allPageAudits) {
    if (!auditsByModule.has(audit.moduleId)) auditsByModule.set(audit.moduleId, [])
    auditsByModule.get(audit.moduleId)!.push(audit)
  }

  const allModulesData: ModuleData[] = []

  for (const mod of allModulesRaw) {
    const def = MODULE_MAP[mod.type]
    if (!def) continue

    const items = itemsByModule.get(mod.id) ?? []
    const cats = catsByModule.get(mod.id) ?? []
    const catMap = new Map(cats.map((c) => [c.id, c.slug]))

    if (def.dynamic) {
      const fullItems: DBItemFull[] = items.map((item) => ({
        id: item.id,
        slug: item.slug,
        label: item.label,
        weight: item.weight,
        categorySlug: catMap.get(item.categoryId) ?? '',
        aiDetail: item.aiDetail,
        aiNarrative: item.aiNarrative,
        aiAction: item.aiAction,
        aiDraft: item.aiDraft ?? null,
        aiData: item.aiData ?? null,
        aiVerified: item.aiVerified ?? false,
        userChecked: item.userChecked ?? false,
        completedBy: item.completedBy,
        fixable: item.fixable ?? false,
        fixType: null,
        fixInputKey: item.fixInputKey ?? null,
        fixIntegrationProvider: item.fixIntegrationProvider ?? null,
      }))

      const audits = auditsByModule.get(mod.id) ?? []

      allModulesData.push({
        id: mod.id,
        type: mod.type,
        name: mod.name,
        order: mod.order,
        status: mod.status,
        score: mod.score ?? 0,
        lastAnalyzedAt: mod.lastAnalyzedAt?.toISOString() ?? null,
        requirements: (mod.requirements as Record<string, string> | null) ?? {},
        agentPrUrl: mod.agentPrUrl ?? null,
        definition: def,
        itemStates: {},
        fullItems,
        pageVerdicts: audits.map((v) => ({
          url: v.url,
          title: v.title ?? null,
          wordCount: v.wordCount ?? 0,
          verdict: v.verdict,
          urgency: v.urgency,
          reason: v.reason ?? null,
          action: v.action ?? null,
        })),
      })
    } else {
      const itemStates: Record<string, DBItemState> = {}
      for (const item of items) {
        itemStates[item.slug] = {
          id: item.id,
          aiDetail: item.aiDetail,
          aiNarrative: item.aiNarrative,
          aiAction: item.aiAction,
          aiVerified: item.aiVerified ?? false,
          userChecked: item.userChecked ?? false,
          completedBy: item.completedBy,
          fixable: item.fixable ?? false,
          fixInputKey: item.fixInputKey ?? null,
          fixIntegrationProvider: item.fixIntegrationProvider ?? null,
        }
      }

      allModulesData.push({
        id: mod.id,
        type: mod.type,
        name: mod.name,
        order: mod.order,
        status: mod.status,
        score: mod.score ?? 0,
        lastAnalyzedAt: mod.lastAnalyzedAt?.toISOString() ?? null,
        requirements: (mod.requirements as Record<string, string> | null) ?? {},
        agentPrUrl: mod.agentPrUrl ?? null,
        definition: def,
        itemStates,
        fullItems: [],
        pageVerdicts: [],
      })
    }
  }

  return (
    <AllModulesDashboard
      brand={{ id: brand.id, name: brand.name, keywords: brand.keywords ?? '' }}
      allModulesData={allModulesData}
      userEmail={user.email ?? ''}
      githubConnected={githubConnected}
      connectedIntegrations={connectedIntegrations}
    />
  )
}
