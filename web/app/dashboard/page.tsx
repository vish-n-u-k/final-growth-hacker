import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleCategories, moduleItems, brandIntegrations, modulePageAudit, analysisRequests, itemLinks } from '@/lib/db/schema'
import { eq, inArray, and } from 'drizzle-orm'
import { MODULE_MAP, MODULE_REGISTRY } from '@/lib/modules/registry'
import AllModulesDashboard, { type ModuleData } from '@/components/AllModulesDashboard'
import { type DBItemState } from '@/components/ModuleDashboard'
import type { DBItemFull } from '@/lib/modules/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) redirect('/login')

  // Run brand lookup and pending analysis requests in parallel — both only need user.id
  const [[brand], pendingRequestsRaw] = await Promise.all([
    db.select().from(brands).where(eq(brands.userId, user.id)).limit(1),
    db.select({ moduleId: analysisRequests.moduleId })
      .from(analysisRequests)
      .where(and(eq(analysisRequests.userId, user.id), eq(analysisRequests.status, 'pending')))
      .catch(() => [] as { moduleId: string }[]),
  ])
  const pendingModuleIds = pendingRequestsRaw.map(r => r.moduleId)

  if (!brand) redirect('/onboarding')

  let allModulesRaw = await db
    .select()
    .from(modules)
    .where(eq(modules.brandId, brand.id))
    .orderBy(modules.order)

  if (allModulesRaw.length === 0) redirect('/onboarding')

  // Seed any modules added to the registry after this user onboarded
  const seededTypes = new Set(allModulesRaw.map(m => m.type))
  const missingDefs = MODULE_REGISTRY.filter(def => !seededTypes.has(def.type) && !def.comingSoon)
  if (missingDefs.length > 0) {
    await Promise.all(missingDefs.map(def =>
      db.insert(modules).values({
        brandId: brand.id,
        type: def.type,
        name: def.name,
        order: def.order,
        status: def.unlockThreshold === 0 ? 'pending' : 'locked',
        requirements: brand.websiteUrl ? { website_url: brand.websiteUrl } : {},
      }).onConflictDoNothing()
    ))
    allModulesRaw = await db
      .select()
      .from(modules)
      .where(eq(modules.brandId, brand.id))
      .orderBy(modules.order)
  }

  const moduleIds = allModulesRaw.map((m) => m.id)

  const [allItemsRaw, allCatsRaw, allIntegrations, allPageAudits] = await Promise.all([
    db.select().from(moduleItems).where(inArray(moduleItems.moduleId, moduleIds)),
    db.select().from(moduleCategories).where(inArray(moduleCategories.moduleId, moduleIds)),
    db.select().from(brandIntegrations).where(eq(brandIntegrations.brandId, brand.id)),
    db.select().from(modulePageAudit).where(inArray(modulePageAudit.moduleId, moduleIds)),
  ])

  // Load conflict links — needs allItemIds so runs after main batch, but both directions in parallel
  const allItemIds = allItemsRaw.map(i => i.id)
  let conflictLinks: { itemIdA: string; itemIdB: string }[] = []
  if (allItemIds.length > 0) {
    const [linksA, linksB] = await Promise.all([
      db.select({ itemIdA: itemLinks.itemIdA, itemIdB: itemLinks.itemIdB })
        .from(itemLinks)
        .where(and(inArray(itemLinks.itemIdA, allItemIds), eq(itemLinks.relationshipType, 'same_issue')))
        .catch(() => [] as { itemIdA: string; itemIdB: string }[]),
      db.select({ itemIdA: itemLinks.itemIdA, itemIdB: itemLinks.itemIdB })
        .from(itemLinks)
        .where(and(inArray(itemLinks.itemIdB, allItemIds), eq(itemLinks.relationshipType, 'same_issue')))
        .catch(() => [] as { itemIdA: string; itemIdB: string }[]),
    ])
    conflictLinks = [...linksA, ...linksB]
  }

  const githubConnected = allIntegrations.some(i => i.provider === 'github' && i.status === 'connected')
  const connectedIntegrations: Record<string, boolean> = {}
  const socialLinks: Record<string, string> = {}
  for (const row of allIntegrations) {
    connectedIntegrations[row.provider] = row.status === 'connected'
    if (row.type === 'social' && row.status === 'connected' && row.metadata && typeof row.metadata === 'object' && 'url' in row.metadata) {
      socialLinks[row.provider] = (row.metadata as { url: string }).url
    }
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
        aiHighlight: item.aiHighlight ?? null,
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
        userSkipped: item.userSkipped ?? false,
        userSkipReason: item.userSkipReason ?? null,
        exportType: (item.exportType as string | null) ?? null,
        choiceOptions: (item.choiceOptions as string[] | null) ?? null,
        userChoice: (item.userChoice as string | null) ?? null,
      }))

      const audits = auditsByModule.get(mod.id) ?? []

      allModulesData.push({
        id: mod.id,
        type: mod.type,
        name: mod.name,
        order: def.order,
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
          aiHighlight: item.aiHighlight ?? null,
          aiNarrative: item.aiNarrative,
          aiAction: item.aiAction,
          aiVerified: item.aiVerified ?? false,
          userChecked: item.userChecked ?? false,
          completedBy: item.completedBy,
          fixable: item.fixable ?? false,
          fixInputKey: item.fixInputKey ?? null,
          fixIntegrationProvider: item.fixIntegrationProvider ?? null,
          userSkipped: item.userSkipped ?? false,
          userSkipReason: item.userSkipReason ?? null,
          exportType: (item.exportType as string | null) ?? null,
          choiceOptions: (item.choiceOptions as string[] | null) ?? null,
          userChoice: (item.userChoice as string | null) ?? null,
        }
      }

      allModulesData.push({
        id: mod.id,
        type: mod.type,
        name: mod.name,
        order: def.order,
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

  // Inject Coming Soon modules from registry that don't exist in DB yet (for existing users)
  const existingTypes = new Set(allModulesData.map(m => m.type))
  for (const def of MODULE_REGISTRY) {
    if (def.comingSoon && !existingTypes.has(def.type)) {
      allModulesData.push({
        id: `coming-soon-${def.type}`,
        type: def.type,
        name: def.name,
        order: def.order,
        status: 'pending',
        score: 0,
        lastAnalyzedAt: null,
        requirements: {},
        agentPrUrl: null,
        definition: def,
        itemStates: {},
        fullItems: [],
        pageVerdicts: [],
      })
    }
  }
  allModulesData.sort((a, b) => a.order - b.order)

  return (
    <AllModulesDashboard
      brand={{ id: brand.id, name: brand.name, keywords: brand.keywords ?? '', websiteUrl: brand.websiteUrl, logoUrl: brand.logoUrl ?? '', themeColor: brand.themeColor ?? '', playbook: (brand.playbook as Record<string, string> | null) ?? null }}
      allModulesData={allModulesData}
      pendingModuleIds={pendingModuleIds}
      userEmail={user.email ?? ''}
      githubConnected={githubConnected}
      connectedIntegrations={connectedIntegrations}
      socialLinks={socialLinks}
      conflictLinks={conflictLinks}
    />
  )
}
