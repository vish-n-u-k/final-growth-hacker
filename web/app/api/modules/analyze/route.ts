import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleCategories, moduleItems, modulePageAudit, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { MODULE_MAP } from '@/lib/modules/registry'
import { fetchFoundationData } from '@/lib/modules/foundation/fetcher'
import { analyzeFoundation } from '@/lib/modules/foundation/agent'
import { fetchWebsiteData } from '@/lib/modules/website/fetcher'
import { analyzeWebsite } from '@/lib/modules/website/agent'
import { fetchSeoData } from '@/lib/modules/seo/fetcher'
import { analyzeSeo, type SeoIntegrations } from '@/lib/modules/seo/agent'
import { fetchCompetitorAuditData } from '@/lib/modules/competitor-audit/fetcher'
import { analyzeCompetitorAudit } from '@/lib/modules/competitor-audit/agent'
import { fetchCompetitorAnalysisData } from '@/lib/modules/competitor-analysis/fetcher'
import { analyzeCompetitorAnalysis } from '@/lib/modules/competitor-analysis/agent'
import { fetchBrandAuditData } from '@/lib/modules/brand-audit/fetcher'
import { analyzeBrandAudit } from '@/lib/modules/brand-audit/agent'
import { fetchSocialMediaData } from '@/lib/modules/social-media/fetcher'
import { analyzeSocialMedia } from '@/lib/modules/social-media/agent'
import { fetchContentAuditData } from '@/lib/modules/content-audit/fetcher'
import { analyzeContentAudit } from '@/lib/modules/content-audit/agent'
import { fetchMetaAdsData } from '@/lib/modules/meta-ads/fetcher'
import { analyzeMetaAds } from '@/lib/modules/meta-ads/agent'
import { fetchOutreachTargetsData } from '@/lib/modules/outreach-targets/fetcher'
import { analyzeOutreachTargets } from '@/lib/modules/outreach-targets/agent'
import { fetchGeoData } from '@/lib/modules/geo/fetcher'
import { analyzeGeo } from '@/lib/modules/geo/agent'
import { fetchCompetitorGapData } from '@/lib/modules/geo-competitor-gap/fetcher'
import { analyzeCompetitorGap } from '@/lib/modules/geo-competitor-gap/agent'
import { fetchUserAnalyticsData } from '@/lib/modules/user-analytics/fetcher'
import { analyzeUserAnalytics } from '@/lib/modules/user-analytics/agent'
import { fetchUserAcquisitionData } from '@/lib/modules/user-acquisition/fetcher'
import { analyzeUserAcquisition } from '@/lib/modules/user-acquisition/agent'
import type { ModuleAnalysisResult, DynamicModuleAnalysisResult, ModuleCategoryDefinition } from '@/lib/modules/types'
import { getAllItems } from '@/lib/modules/types'
import { getRelevantContext, extractAndMergeFacts } from '@/lib/brain'

export const maxDuration = 90

async function runAnalysis(
  moduleType: string,
  requirements: Record<string, string>,
  brainCtx?: string,
): Promise<ModuleAnalysisResult[] | DynamicModuleAnalysisResult[]> {
  switch (moduleType) {
    case 'user-acquisition': {
      const data = await fetchUserAcquisitionData(requirements)
      return analyzeUserAcquisition(data, brainCtx)
    }
    case 'foundation': {
      const data = await fetchFoundationData(requirements)
      if (!data.extracted) throw new Error(`Could not fetch ${requirements['website_url']}`)
      return analyzeFoundation(data)
    }
    case 'website': {
      const data = await fetchWebsiteData(requirements)
      if ('error' in data) throw new Error(data.error)
      const url = requirements['website_url'] ?? ''
      return analyzeWebsite(data, url)
    }
    case 'seo': {
      const data = await fetchSeoData(requirements)
      if ('error' in data) throw new Error(data.error)
      const url = requirements['website_url'] ?? ''
      // Fetch keyword research integrations saved by the user
      const seoIntRows = await db
        .select()
        .from(brandIntegrations)
        .where(and(eq(brandIntegrations.brandId, requirements['brand_id']), eq(brandIntegrations.status, 'connected')))
      const serpRow = seoIntRows.find((i) => i.provider === 'serpapi')
      const gscRow = seoIntRows.find((i) => i.provider === 'gsc_api')
      const gscMeta = (gscRow?.metadata as Record<string, string> | null) ?? {}
      const seoIntegrations: SeoIntegrations = {
        serpApiKey: serpRow?.apiKey ?? undefined,
        gscClientEmail: gscMeta['client_email'],
        gscPrivateKey: gscMeta['private_key'],
      }
      return analyzeSeo(data, url, brainCtx, seoIntegrations)
    }
    case 'competitor-audit': {
      if (!requirements['competitor_urls']) {
        throw new Error('No competitor URLs provided. Add at least one competitor URL to run this audit.')
      }
      const data = await fetchCompetitorAuditData(requirements, requirements['website_url'])
      return analyzeCompetitorAudit(data, brainCtx)
    }
    case 'competitor-analysis': {
      const data = await fetchCompetitorAnalysisData(requirements, requirements['website_url'])
      return analyzeCompetitorAnalysis(data, brainCtx)
    }
    case 'social-media': {
      const data = await fetchSocialMediaData(requirements)
      return analyzeSocialMedia(data, brainCtx)
    }
    case 'brand-audit': {
      const data = await fetchBrandAuditData(requirements)
      return analyzeBrandAudit(data, brainCtx)
    }
    case 'meta-ads': {
      const [metaIntegration] = await db
        .select()
        .from(brandIntegrations)
        .where(
          and(
            eq(brandIntegrations.brandId, requirements['brand_id']),
            eq(brandIntegrations.provider, 'meta_ads'),
            eq(brandIntegrations.status, 'connected'),
          ),
        )
        .limit(1)
      if (!metaIntegration?.accessToken) {
        throw new Error('Connect Meta Ads in Settings → Integrations before running this analysis.')
      }
      const metaReqs = {
        ...requirements,
        access_token: metaIntegration.accessToken,
        ad_account_id: (metaIntegration.metadata as Record<string, string> | null)?.['ad_account_id'] ?? '',
      }
      const data = await fetchMetaAdsData(metaReqs)
      return analyzeMetaAds(data, brainCtx)
    }
    case 'outreach-targets': {
      if (!requirements['competitor_urls']) {
        throw new Error('No competitor URLs provided. Add at least one competitor URL to run this analysis.')
      }
      const data = await fetchOutreachTargetsData(requirements)
      return analyzeOutreachTargets(data, brainCtx)
    }
    case 'geo': {
      const data = await fetchGeoData(requirements)
      if ('error' in data) throw new Error(data.error)
      return analyzeGeo(data, brainCtx, requirements['brand_name'] ?? '')
    }
    case 'geo-competitor-gap': {
      const data = await fetchCompetitorGapData(requirements)
      if ('error' in data) throw new Error(data.error)
      return analyzeCompetitorGap(data, brainCtx)
    }
    case 'user-analytics': {
      const data = await fetchUserAnalyticsData(requirements)
      return analyzeUserAnalytics(data, brainCtx)
    }
    case 'community-finder': {
      const data = await fetchCommunityDiscovery(requirements)
      return analyzeCommunitiesFinder(data, brainCtx)
    }
    default:
      throw new Error(`No analyzer registered for module type: ${moduleType}`)
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { moduleId, requirements: incomingRequirements } = body as {
    moduleId: string
    requirements?: Record<string, string>
  }

  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId))
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  // If the caller is passing new requirement values (e.g. competitor URLs), merge and save them
  if (incomingRequirements && Object.keys(incomingRequirements).length > 0) {
    const merged = { ...(mod.requirements as Record<string, string> | null ?? {}), ...incomingRequirements }
    await db.update(modules).set({ requirements: merged }).where(eq(modules.id, moduleId))
    mod.requirements = merged
  }

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId))
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const def = MODULE_MAP[mod.type]
  if (!def) return NextResponse.json({ error: 'Unknown module type' }, { status: 400 })

  await db.update(modules).set({ status: 'analyzing' }).where(eq(modules.id, moduleId))

  // Get relevant brain context to inject into this module's agent (skip for User Acquisition — runs first, no prior context)
  let brainCtx: string | undefined
  if (def.order > 0) {
    try {
      brainCtx = await getRelevantContext(brand.id, mod.type, def.description)
    } catch {
      // Non-fatal — analysis continues without brain context
    }
  }

  // Ensure website_url, brand_id, and brand_name are always available in requirements
  const baseRequirements = (mod.requirements as Record<string, string> | null) ?? {}
  const requirements: Record<string, string> = {
    ...baseRequirements,
    brand_id: brand.id,
    brand_name: brand.name,
    ...(brand.websiteUrl && !baseRequirements['website_url'] ? { website_url: brand.websiteUrl } : {}),
  }

  // ── Content Audit: special pipeline (parallel Claude calls + page verdicts) ──
  if (mod.type === 'content-audit') {
    let contentAuditOutput: Awaited<ReturnType<typeof analyzeContentAudit>>
    try {
      const data = await fetchContentAuditData(requirements)
      contentAuditOutput = await analyzeContentAudit(data, brainCtx)
    } catch (err) {
      await db.update(modules).set({ status: 'pending' }).where(eq(modules.id, moduleId))
      console.error('Content audit analysis failed:', err)
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Content audit failed. Please try again.' },
        { status: 500 },
      )
    }

    const { findings, pageVerdicts, calendarData } = contentAuditOutput

    // Preserve user_checked state before wiping items
    const existingItems = await db.select().from(moduleItems).where(eq(moduleItems.moduleId, moduleId))
    const userCheckedSlugs = new Set(existingItems.filter(i => i.userChecked).map(i => i.slug))

    if (existingItems.length > 0) {
      await db.delete(moduleItems).where(eq(moduleItems.moduleId, moduleId))
    }

    // Build category slug → id map
    let cats = await db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
    let catMap = new Map(cats.filter(c => !c.parentId).map(c => [c.slug, c.id]))

    // If categories weren't seeded at onboarding (module added to registry after user onboarded), seed them now
    if (catMap.size === 0) {
      for (const cat of def.categories) {
        // eslint-disable-next-line no-await-in-loop
        await db.insert(moduleCategories).values({
          moduleId,
          parentId: null,
          slug: cat.slug,
          label: cat.label,
          order: cat.order,
        }).onConflictDoNothing()
      }
      cats = await db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
      catMap = new Map(cats.filter(c => !c.parentId).map(c => [c.slug, c.id]))
    }

    // Insert findings into module_items
    await Promise.all(
      findings.map(r => {
        const categoryId = catMap.get(r.category)
        if (!categoryId) return Promise.resolve()
        const wasChecked = userCheckedSlugs.has(r.slug)
        const isCalendar = r.slug === 'content-calendar-30-day'
        return db.insert(moduleItems).values({
          moduleId,
          categoryId,
          slug: r.slug,
          label: r.label,
          weight: r.weight,
          aiDetail: r.detail,
          aiNarrative: r.narrative,
          aiAction: r.action,
          aiData: isCalendar && calendarData ? calendarData : null,
          aiVerified: r.verified,
          aiVerifiedAt: r.verified ? new Date() : null,
          userChecked: wasChecked,
          userCheckedAt: wasChecked ? new Date() : null,
          completedBy: r.verified ? 'ai' : wasChecked ? 'user' : null,
          fixable: false,
          updatedAt: new Date(),
        })
      }),
    )

    // Upsert page verdicts — wipe old, insert new
    await db.delete(modulePageAudit).where(eq(modulePageAudit.moduleId, moduleId))
    if (pageVerdicts.length > 0) {
      await Promise.all(
        pageVerdicts.map(v =>
          db.insert(modulePageAudit).values({
            moduleId,
            url: v.url,
            title: v.title,
            wordCount: v.wordCount ?? 0,
            verdict: v.verdict,
            urgency: v.urgency,
            reason: v.reason,
            action: v.action,
          }),
        ),
      )
    }

    // Compute score and update module
    const allItems = await db.select().from(moduleItems).where(eq(moduleItems.moduleId, moduleId))
    const totalWeight = allItems.reduce((s, i) => s + i.weight, 0)
    const doneWeight = allItems.filter(i => i.aiVerified || i.userChecked).reduce((s, i) => s + i.weight, 0)
    const score = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0

    await db.update(modules)
      .set({ status: 'complete', score, lastAnalyzedAt: new Date() })
      .where(eq(modules.id, moduleId))

    // Unlock next module if threshold met
    const nextDef = Object.values(MODULE_MAP).find(m => m.order === def.order + 1)
    if (nextDef && score >= nextDef.unlockThreshold) {
      const brandMods = await db.select().from(modules).where(eq(modules.brandId, brand.id))
      const nextMod = brandMods.find(m => m.type === nextDef.type)
      if (nextMod && nextMod.status === 'locked') {
        await db.update(modules).set({ status: 'pending' }).where(eq(modules.id, nextMod.id))
      }
    }

    // Extract brain facts
    try {
      await extractAndMergeFacts(brand.id, mod.type, findings)
    } catch (err) {
      console.error('Brain fact extraction failed (non-fatal):', err)
    }

    return NextResponse.json({ ok: true, itemCount: findings.length, pageCount: pageVerdicts.length })
  }

  // Foundation: pre-fetch to capture social links and save them to requirements
  if (mod.type === 'foundation') {
    try {
      const prefetch = await fetchFoundationData(requirements)
      if (prefetch.extracted && Object.keys(prefetch.extracted.socialLinks).length > 0) {
        const updatedReqs = { ...requirements }
        for (const [platform, url] of Object.entries(prefetch.extracted.socialLinks)) {
          const key = `social_${platform}`
          if (!updatedReqs[key]) updatedReqs[key] = url
        }
        await db.update(modules).set({ requirements: updatedReqs }).where(eq(modules.id, moduleId))
        Object.assign(requirements, updatedReqs)
      }
    } catch {
      // Non-fatal — analysis continues without saving social links
    }
  }

  let results: ModuleAnalysisResult[] | DynamicModuleAnalysisResult[]
  try {
    results = await runAnalysis(mod.type, requirements, brainCtx)
  } catch (err) {
    await db.update(modules).set({ status: 'pending' }).where(eq(modules.id, moduleId))
    console.error('Module analysis failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed. Please try again.' },
      { status: 500 },
    )
  }

  if (def.dynamic) {
    // ── Dynamic module: Claude generates the items themselves ──────────────
    const dynamicResults = results as DynamicModuleAnalysisResult[]

    // Preserve any user_checked state before wiping items
    const existingItems = await db.select().from(moduleItems).where(eq(moduleItems.moduleId, moduleId))
    const userCheckedSlugs = new Set(existingItems.filter((i) => i.userChecked).map((i) => i.slug))

    // Delete all existing items for this module (fresh slate from Claude)
    if (existingItems.length > 0) {
      await db.delete(moduleItems).where(eq(moduleItems.moduleId, moduleId))
    }

    // Build category slug → id map
    let cats = await db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
    let catMap = new Map(cats.filter((c) => !c.parentId).map((c) => [c.slug, c.id]))

    // If categories weren't seeded at onboarding (module added to registry after user onboarded), seed them now
    if (catMap.size === 0) {
      for (const cat of def.categories) {
        // eslint-disable-next-line no-await-in-loop
        await db.insert(moduleCategories).values({
          moduleId,
          parentId: null,
          slug: cat.slug,
          label: cat.label,
          order: cat.order,
        }).onConflictDoNothing()
      }
      cats = await db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
      catMap = new Map(cats.filter((c) => !c.parentId).map((c) => [c.slug, c.id]))
    }

    // Insert fresh items from Claude, restoring user_checked where slug matches
    await Promise.all(
      dynamicResults.map((r) => {
        const categoryId = catMap.get(r.category)
        if (!categoryId) return Promise.resolve()
        const wasChecked = userCheckedSlugs.has(r.slug)
        return db.insert(moduleItems).values({
          moduleId,
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
          fixable: (r as DynamicModuleAnalysisResult).fixable ?? false,
          updatedAt: new Date(),
        })
      }),
    )
  } else {
    // ── Static module: items pre-seeded, update findings by slug ──────────
    const staticResults = results as ModuleAnalysisResult[]
    const defItemMap = new Map(getAllItems(def).map((i) => [i.slug, i]))

    // Handle migration: if expected slugs are missing (e.g. module was previously dynamic),
    // wipe stale items/categories and re-seed the structure from the current definition
    const expectedSlugs = [...defItemMap.keys()]
    const existingForModule = await db.select({ slug: moduleItems.slug }).from(moduleItems).where(eq(moduleItems.moduleId, moduleId))
    if (expectedSlugs.length > 0) {
      const hasExpectedItem = existingForModule.some((i) => expectedSlugs.includes(i.slug))
      if (!hasExpectedItem) {
        await db.delete(moduleItems).where(eq(moduleItems.moduleId, moduleId))
        await db.delete(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
        // Re-seed categories and items from definition
        for (const cat of def.categories as ModuleCategoryDefinition[]) {
          // eslint-disable-next-line no-await-in-loop
          const [parentCat] = await db.insert(moduleCategories)
            .values({ moduleId, parentId: null, slug: cat.slug, label: cat.label, order: cat.order })
            .returning()
          for (const sub of cat.subCategories) {
            // eslint-disable-next-line no-await-in-loop
            const [subCat] = await db.insert(moduleCategories)
              .values({ moduleId, parentId: parentCat.id, slug: sub.slug, label: sub.label, order: sub.order })
              .returning()
            for (const item of sub.items) {
              // eslint-disable-next-line no-await-in-loop
              await db.insert(moduleItems).values({ moduleId, categoryId: subCat.id, slug: item.slug, label: item.label, weight: item.weight })
            }
          }
        }
      }
    }

    // Seed any items added to the definition after the module was already created
    // (e.g. lb-* link-building items added to an existing SEO module)
    const existingSlugsSet = new Set(existingForModule.map((i) => i.slug))
    const newDefItems = getAllItems(def).filter((item) => !existingSlugsSet.has(item.slug))
    if (newDefItems.length > 0) {
      const allCats = await db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
      const parentCatMap = new Map(allCats.filter((c) => !c.parentId).map((c) => [c.slug, c.id]))
      const subCatMap = new Map(allCats.filter((c) => c.parentId).map((c) => [c.slug, c.id]))

      for (const cat of def.categories as ModuleCategoryDefinition[]) {
        // Ensure parent category exists
        if (!parentCatMap.has(cat.slug)) {
          // eslint-disable-next-line no-await-in-loop
          const [newCat] = await db.insert(moduleCategories)
            .values({ moduleId, parentId: null, slug: cat.slug, label: cat.label, order: cat.order })
            .returning()
          parentCatMap.set(cat.slug, newCat.id)
        }
        for (const sub of cat.subCategories) {
          // Ensure sub-category exists
          if (!subCatMap.has(sub.slug)) {
            // eslint-disable-next-line no-await-in-loop
            const [newSub] = await db.insert(moduleCategories)
              .values({ moduleId, parentId: parentCatMap.get(cat.slug)!, slug: sub.slug, label: sub.label, order: sub.order })
              .returning()
            subCatMap.set(sub.slug, newSub.id)
          }
          // Insert missing items
          for (const item of sub.items) {
            if (!existingSlugsSet.has(item.slug)) {
              // eslint-disable-next-line no-await-in-loop
              await db.insert(moduleItems).values({
                moduleId,
                categoryId: subCatMap.get(sub.slug)!,
                slug: item.slug,
                label: item.label,
                weight: item.weight,
              }).onConflictDoNothing()
            }
          }
        }
      }
    }

    await Promise.all(
      staticResults.map((r) => {
        const defItem = defItemMap.get(r.slug)
        return db
          .update(moduleItems)
          .set({
            aiDetail: r.detail,
            aiNarrative: r.narrative,
            aiAction: r.action,
            aiVerified: r.verified,
            aiVerifiedAt: r.verified ? new Date() : null,
            completedBy: r.verified ? 'ai' : null,
            fixable: !!(defItem?.fixable || defItem?.assistedInput || defItem?.upgradeInput),
            fixType: defItem?.fixType ?? null,
            fixInputKey: defItem?.assistedInput?.key ?? defItem?.upgradeInput?.key ?? null,
            fixIntegrationProvider: defItem?.assistedInput?.integrationProvider ?? (defItem?.upgradeInput ? 'brand_assets' : null),
            updatedAt: new Date(),
          })
          .where(and(eq(moduleItems.moduleId, moduleId), eq(moduleItems.slug, r.slug)))
      }),
    )
  }

  // Compute score and update module status
  const allItems = await db.select().from(moduleItems).where(eq(moduleItems.moduleId, moduleId))
  const totalWeight = allItems.reduce((s, i) => s + i.weight, 0)
  const doneWeight = allItems.filter((i) => i.aiVerified || i.userChecked).reduce((s, i) => s + i.weight, 0)
  const score = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0

  await db
    .update(modules)
    .set({ status: 'complete', score, lastAnalyzedAt: new Date() })
    .where(eq(modules.id, moduleId))

  // Unlock next module if score meets its threshold
  const nextDef = Object.values(MODULE_MAP).find((m) => m.order === def.order + 1)
  if (nextDef && score >= nextDef.unlockThreshold) {
    const brandMods = await db.select().from(modules).where(eq(modules.brandId, brand.id))
    const nextMod = brandMods.find((m) => m.type === nextDef.type)
    if (nextMod && nextMod.status === 'locked') {
      await db.update(modules).set({ status: 'pending' }).where(eq(modules.id, nextMod.id))
    }
  }

  // Extract facts from this module's results and merge into brain memory
  try {
    await extractAndMergeFacts(brand.id, mod.type, results)
  } catch (err) {
    console.error('Brain fact extraction failed (non-fatal):', err)
  }

  return NextResponse.json({ ok: true, itemCount: results.length })
}
