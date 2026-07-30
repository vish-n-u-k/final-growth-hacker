import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleCategories, moduleItems, brandIntegrations, modulePageAudit, analysisRequests, itemLinks } from '@/lib/db/schema'
import { eq, inArray, and, desc } from 'drizzle-orm'
import { MODULE_MAP, MODULE_REGISTRY } from '@/lib/modules/registry'
import AllModulesDashboard, { type ModuleData } from '@/components/AllModulesDashboard'
import { type DBItemState } from '@/components/ModuleDashboard'
import type { DBItemFull } from '@/lib/modules/types'

export default async function AdminViewBrandPage({
  params,
}: {
  params: Promise<{ brandId: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!user || !adminEmails.includes(user.email ?? '')) {
    redirect('/dashboard')
  }

  const { brandId } = await params

  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!brand) redirect('/admin')

  // Get user email
  const [latestRequest] = await db
    .select({ userEmail: analysisRequests.userEmail })
    .from(analysisRequests)
    .where(eq(analysisRequests.userId, brand.userId))
    .orderBy(desc(analysisRequests.requestedAt))
    .limit(1)
  const viewedUserEmail = latestRequest?.userEmail ?? '(no requests yet)'

  const allModulesRaw = await db
    .select()
    .from(modules)
    .where(eq(modules.brandId, brand.id))
    .orderBy(modules.order)

  const moduleIds = allModulesRaw.map(m => m.id)

  const [allItemsRaw, allCatsRaw, allIntegrations, allPageAudits] = await Promise.all([
    moduleIds.length > 0 ? db.select().from(moduleItems).where(inArray(moduleItems.moduleId, moduleIds)) : db.select().from(moduleItems).where(eq(moduleItems.moduleId, 'none')),
    moduleIds.length > 0 ? db.select().from(moduleCategories).where(inArray(moduleCategories.moduleId, moduleIds)) : db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, 'none')),
    db.select().from(brandIntegrations).where(eq(brandIntegrations.brandId, brand.id)),
    moduleIds.length > 0 ? db.select().from(modulePageAudit).where(inArray(modulePageAudit.moduleId, moduleIds)) : db.select().from(modulePageAudit).where(eq(modulePageAudit.moduleId, 'none')),
  ])

  const allItemIds = allItemsRaw.map(i => i.id)
  let conflictLinks: { itemIdA: string; itemIdB: string }[] = []
  if (allItemIds.length > 0) {
    try {
      const [linksA, linksB] = await Promise.all([
        db.select({ itemIdA: itemLinks.itemIdA, itemIdB: itemLinks.itemIdB })
          .from(itemLinks)
          .where(and(inArray(itemLinks.itemIdA, allItemIds), eq(itemLinks.relationshipType, 'same_issue'))),
        db.select({ itemIdA: itemLinks.itemIdA, itemIdB: itemLinks.itemIdB })
          .from(itemLinks)
          .where(and(inArray(itemLinks.itemIdB, allItemIds), eq(itemLinks.relationshipType, 'same_issue'))),
      ])
      conflictLinks = [...linksA, ...linksB]
    } catch {
      // item_links table not yet created
    }
  }

  const connectedIntegrations: Record<string, boolean> = {}
  const socialLinks: Record<string, string> = {}
  for (const row of allIntegrations) {
    connectedIntegrations[row.provider] = row.status === 'connected'
    if (row.type === 'social' && row.status === 'connected' && row.metadata && typeof row.metadata === 'object' && 'url' in row.metadata) {
      socialLinks[row.provider] = (row.metadata as { url: string }).url
    }
  }
  const githubConnected = allIntegrations.some(i => i.provider === 'github' && i.status === 'connected')

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
    const catMap = new Map(cats.map(c => [c.id, c.slug]))

    if (def.dynamic) {
      const fullItems: DBItemFull[] = items.map(item => ({
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
        pageVerdicts: (auditsByModule.get(mod.id) ?? []).map(v => ({
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
    <>
      {/* Admin banner */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        background: '#1a0a0a',
        borderBottom: '1px solid #7f1d1d',
        padding: '8px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 13,
        fontFamily: 'var(--font-body, sans-serif)',
      }}>
        <span style={{ background: '#991b1b', color: '#fca5a5', padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Admin View
        </span>
        <span style={{ color: '#fca5a5' }}>
          {viewedUserEmail}
        </span>
        <span style={{ color: '#7f1d1d' }}>—</span>
        <span style={{ color: '#fecaca', fontWeight: 600 }}>{brand.name}</span>
        <span style={{ color: '#6b7280', fontSize: 12 }}>{brand.websiteUrl}</span>
        <a
          href="/admin"
          style={{
            marginLeft: 'auto',
            color: '#fca5a5',
            textDecoration: 'underline',
            fontSize: 12,
          }}
        >
          Back to Admin
        </a>
      </div>

      <AllModulesDashboard
        brand={{
          id: brand.id,
          name: brand.name,
          keywords: brand.keywords ?? '',
          websiteUrl: brand.websiteUrl,
          logoUrl: brand.logoUrl ?? '',
          themeColor: brand.themeColor ?? '',
          playbook: (brand.playbook as Record<string, string> | null) ?? null,
        }}
        allModulesData={allModulesData}
        pendingModuleIds={[]}
        userEmail={viewedUserEmail}
        githubConnected={githubConnected}
        connectedIntegrations={connectedIntegrations}
        socialLinks={socialLinks}
        conflictLinks={conflictLinks}
      />
    </>
  )
}
