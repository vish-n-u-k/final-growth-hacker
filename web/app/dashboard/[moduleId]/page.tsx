import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleCategories, moduleItems, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { MODULE_MAP } from '@/lib/modules/registry'
import ModuleDashboard, { type DBItemState } from '@/components/ModuleDashboard'
import type { DBItemFull } from '@/lib/modules/types'

export default async function ModulePage({
  params,
}: {
  params: Promise<{ moduleId: string }>
}) {
  const { moduleId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId))
  if (!mod || mod.brandId !== brand.id) redirect('/dashboard')

  const def = MODULE_MAP[mod.type]
  if (!def) redirect('/dashboard')

  const [items, allModulesRaw, githubIntegration] = await Promise.all([
    db.select().from(moduleItems).where(eq(moduleItems.moduleId, moduleId)),
    db.select().from(modules).where(eq(modules.brandId, brand.id)).orderBy(modules.order),
    db.select().from(brandIntegrations).where(
      and(
        eq(brandIntegrations.brandId, brand.id),
        eq(brandIntegrations.provider, 'github'),
        eq(brandIntegrations.status, 'connected'),
      ),
    ).limit(1),
  ])

  const allModules = allModulesRaw

  const githubConnected = githubIntegration.length > 0

  // Build a map of all connected integrations for the brand
  const allIntegrations = await db.select().from(brandIntegrations).where(eq(brandIntegrations.brandId, brand.id))
  const connectedIntegrations: Record<string, boolean> = {}
  for (const row of allIntegrations) {
    connectedIntegrations[row.provider] = row.status === 'connected'
  }

  const moduleNavList = allModules.map((m) => ({
    id: m.id,
    type: m.type,
    name: m.name,
    order: m.order,
    status: m.status,
    score: m.score ?? 0,
  }))

  if (def.dynamic) {
    const cats = await db
      .select()
      .from(moduleCategories)
      .where(eq(moduleCategories.moduleId, moduleId))
    const catMap = new Map(cats.map((c) => [c.id, c.slug]))

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
      aiVerified: item.aiVerified ?? false,
      userChecked: item.userChecked ?? false,
      completedBy: item.completedBy,
      fixable: item.fixable ?? false,
      fixInputKey: item.fixInputKey ?? null,
      fixIntegrationProvider: item.fixIntegrationProvider ?? null,
    }))

    return (
      <ModuleDashboard
        brand={{ id: brand.id, name: brand.name }}
        module={{ id: mod.id, type: mod.type, name: mod.name, status: mod.status, lastAnalyzedAt: mod.lastAnalyzedAt?.toISOString() ?? null, requirements: (mod.requirements as Record<string, string> | null) ?? {} }}
        definition={def}
        itemStates={{}}
        fullItems={fullItems}
        allModules={moduleNavList}
        userEmail={user.email ?? ''}
        githubConnected={githubConnected}
        connectedIntegrations={connectedIntegrations}
        modulePrUrl={mod.agentPrUrl ?? null}
      />
    )
  }

  // Static module (Foundation)
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

  return (
    <ModuleDashboard
      brand={{ id: brand.id, name: brand.name }}
      module={{ id: mod.id, type: mod.type, name: mod.name, status: mod.status, lastAnalyzedAt: mod.lastAnalyzedAt?.toISOString() ?? null, requirements: (mod.requirements as Record<string, string> | null) ?? {} }}
      definition={def}
      itemStates={itemStates}
      allModules={moduleNavList}
      userEmail={user.email ?? ''}
      githubConnected={githubConnected}
      connectedIntegrations={connectedIntegrations}
      modulePrUrl={mod.agentPrUrl ?? null}
    />
  )
}
