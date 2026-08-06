import { db } from '@/lib/db'
import { brands, modules, moduleItems, moduleCategories, brandIntegrations } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { MODULE_MAP } from '@/lib/modules/registry'
import { fetchFoundationData } from '@/lib/modules/foundation/fetcher'
import { analyzeFoundation } from '@/lib/modules/foundation/agent'
import { fetchWebsiteData } from '@/lib/modules/website/fetcher'
import { analyzeWebsite } from '@/lib/modules/website/agent'
import { fetchSeoData } from '@/lib/modules/seo/fetcher'
import { analyzeSeo, type SeoIntegrations } from '@/lib/modules/seo/agent'
import { fetchBrandAuditData } from '@/lib/modules/brand-audit/fetcher'
import { analyzeBrandAudit } from '@/lib/modules/brand-audit/agent'
import { fetchSocialMediaData } from '@/lib/modules/social-media/fetcher'
import { analyzeSocialMedia } from '@/lib/modules/social-media/agent'
import { fetchGeoData } from '@/lib/modules/geo/fetcher'
import { analyzeGeo } from '@/lib/modules/geo/agent'
import { fetchBusinessStageData } from '@/lib/modules/business-stage/fetcher'
import { analyzeBusinessStage } from '@/lib/modules/business-stage/agent'
import { fetchUserAcquisitionData } from '@/lib/modules/user-acquisition/fetcher'
import { analyzeUserAcquisition } from '@/lib/modules/user-acquisition/agent'
import { getRelevantContext, extractAndMergeFacts } from '@/lib/brain'
import { withAIContext } from '@/lib/ai/client'
import type { ModuleAnalysisResult, DynamicModuleAnalysisResult } from '@/lib/modules/types'
import { getAllItems } from '@/lib/modules/types'

async function runModuleAnalysis(
  moduleType: string,
  requirements: Record<string, string>,
  brainCtx?: string,
): Promise<ModuleAnalysisResult[] | DynamicModuleAnalysisResult[]> {
  switch (moduleType) {
    case 'foundation': {
      const data = await fetchFoundationData(requirements)
      if (!data.extracted) throw new Error(`Could not fetch ${requirements['website_url']}`)
      const { results } = await analyzeFoundation(data)
      return results
    }
    case 'website': {
      const data = await fetchWebsiteData(requirements)
      if ('error' in data) throw new Error(data.error)
      return analyzeWebsite(data, requirements['website_url'] ?? '', requirements['brand_name'])
    }
    case 'seo': {
      const data = await fetchSeoData(requirements)
      if ('error' in data) throw new Error(data.error)
      const intRows = await db
        .select()
        .from(brandIntegrations)
        .where(and(eq(brandIntegrations.brandId, requirements['brand_id']), eq(brandIntegrations.status, 'connected')))
      const serpRow = intRows.find((i) => i.provider === 'serpapi')
      const gscRow = intRows.find((i) => i.provider === 'gsc_api')
      const gscMeta = (gscRow?.metadata as Record<string, string> | null) ?? {}
      const seoIntegrations: SeoIntegrations = {
        serpApiKey: serpRow?.apiKey ?? undefined,
        gscClientEmail: gscMeta['client_email'],
        gscPrivateKey: gscMeta['private_key'],
      }
      return analyzeSeo(data, requirements['website_url'] ?? '', brainCtx, seoIntegrations, requirements['brand_name'])
    }
    case 'brand-audit': {
      const data = await fetchBrandAuditData(requirements)
      return analyzeBrandAudit(data, brainCtx)
    }
    case 'social-media': {
      const data = await fetchSocialMediaData(requirements)
      return analyzeSocialMedia(data, brainCtx)
    }
    case 'geo': {
      const data = await fetchGeoData(requirements)
      if ('error' in data) throw new Error(data.error)
      return analyzeGeo(data, brainCtx, requirements['brand_name'] ?? '')
    }
    case 'business-stage': {
      const data = await fetchBusinessStageData(requirements)
      return analyzeBusinessStage(data, brainCtx)
    }
    case 'user-acquisition': {
      const data = await fetchUserAcquisitionData(requirements)
      return analyzeUserAcquisition(data, brainCtx)
    }
    default:
      throw new Error(`Module type "${moduleType}" is not supported via MCP analyze. Use the dashboard to trigger this analysis.`)
  }
}

export async function analyzeModule(brandId: string, moduleType: string) {
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!brand) return { error: 'Brand not found.' }

  const [mod] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.brandId, brandId), eq(modules.type, moduleType)))
    .limit(1)
  if (!mod) return { error: `Module type "${moduleType}" not found for this brand.` }

  if (mod.status === 'analyzing') {
    return { message: 'Analysis already in progress for this module. Check back shortly.' }
  }

  const def = MODULE_MAP[mod.type]
  if (!def) return { error: 'Unknown module type.' }

  await db.update(modules).set({ status: 'analyzing' }).where(eq(modules.id, mod.id))

  let brainCtx: string | undefined
  if (def.order > 0) {
    try {
      brainCtx = await getRelevantContext(brand.id, mod.type, def.description)
    } catch {
      // Non-fatal
    }
  }

  const baseRequirements = (mod.requirements as Record<string, string> | null) ?? {}
  const requirements: Record<string, string> = {
    ...baseRequirements,
    brand_id: brand.id,
    brand_name: brand.name,
    ...(brand.websiteUrl && !baseRequirements['website_url'] ? { website_url: brand.websiteUrl } : {}),
  }

  let results: ModuleAnalysisResult[] | DynamicModuleAnalysisResult[]
  try {
    results = await withAIContext(
      { brandId: brand.id, moduleType: mod.type, websiteUrl: brand.websiteUrl ?? undefined },
      () => runModuleAnalysis(mod.type, requirements, brainCtx),
    )
  } catch (err) {
    await db.update(modules).set({ status: 'pending' }).where(eq(modules.id, mod.id))
    return { error: err instanceof Error ? err.message : 'Analysis failed.' }
  }

  if (def.dynamic) {
    const dynamicResults = results as DynamicModuleAnalysisResult[]
    const existingItems = await db.select().from(moduleItems).where(eq(moduleItems.moduleId, mod.id))
    const userCheckedSlugs = new Set(existingItems.filter((i) => i.userChecked).map((i) => i.slug))

    if (existingItems.length > 0) {
      await db.delete(moduleItems).where(eq(moduleItems.moduleId, mod.id))
    }

    const cats = await db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, mod.id))
    const catMap = new Map(cats.filter((c) => !c.parentId).map((c) => [c.slug, c.id]))

    await Promise.all(
      dynamicResults.map((r) => {
        const categoryId = catMap.get(r.category)
        if (!categoryId) return Promise.resolve()
        const wasChecked = userCheckedSlugs.has(r.slug)
        return db.insert(moduleItems).values({
          moduleId: mod.id,
          categoryId,
          slug: r.slug,
          label: r.label,
          weight: r.weight,
          aiDetail: r.detail,
          aiNarrative: r.narrative,
          aiAction: r.action,
          aiVerified: r.verified,
          aiVerifiedAt: r.verified ? new Date() : null,
          userChecked: wasChecked,
          userCheckedAt: wasChecked ? new Date() : null,
          completedBy: r.verified ? 'ai' : wasChecked ? 'user' : null,
          updatedAt: new Date(),
        })
      }),
    )
  } else {
    const staticResults = results as ModuleAnalysisResult[]
    const defItemMap = new Map(getAllItems(def).map((i) => [i.slug, i]))

    await Promise.all(
      staticResults.map((r) =>
        db
          .update(moduleItems)
          .set({
            aiDetail: r.detail,
            aiNarrative: r.narrative,
            aiAction: r.action,
            aiVerified: r.verified,
            aiVerifiedAt: r.verified ? new Date() : null,
            completedBy: r.verified ? 'ai' : null,
            fixable: !!(defItemMap.get(r.slug)?.fixable),
            updatedAt: new Date(),
          })
          .where(and(eq(moduleItems.moduleId, mod.id), eq(moduleItems.slug, r.slug))),
      ),
    )
  }

  const allItems = await db.select().from(moduleItems).where(eq(moduleItems.moduleId, mod.id))
  const totalWeight = allItems.reduce((s, i) => s + i.weight, 0)
  const doneWeight = allItems.filter((i) => i.aiVerified || i.userChecked).reduce((s, i) => s + i.weight, 0)
  const score = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0

  await db.update(modules).set({ status: 'complete', score, lastAnalyzedAt: new Date() }).where(eq(modules.id, mod.id))

  try {
    await extractAndMergeFacts(brand.id, mod.type, results)
  } catch {
    // Non-fatal
  }

  return { completed: true, score, itemsUpdated: results.length }
}
