import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleCategories, moduleItems, modulePageAudit, brandIntegrations } from '@/lib/db/schema'
import { claimRun, finishRun, getRun, getRunStage, setRunStage, isStale, failStaleRun, STALE_RUN_ERROR } from '@/lib/modules/runs'
import { getAccess, canUseModule } from '@/lib/billing/plan'
import { getCompetitorUrlsString, storeCompetitors } from '@/lib/modules/competitor-registry'
import { eq, and } from 'drizzle-orm'
import { MODULE_MAP } from '@/lib/modules/registry'
import { fetchFoundationData, getFaviconColor } from '@/lib/modules/foundation/fetcher'
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
import { fetchCommunityDiscovery } from '@/lib/modules/community-finder/fetcher'
import { analyzeCommunitiesFinder } from '@/lib/modules/community-finder/agent'
import { fetchBusinessStageData } from '@/lib/modules/business-stage/fetcher'
import { analyzeBusinessStage } from '@/lib/modules/business-stage/agent'
import { detectBusinessStageChange } from '@/lib/signals/detectors'
import { fetchGmailOutreachData } from '@/lib/modules/gmail-outreach/fetcher'
import { analyzeGmailOutreach } from '@/lib/modules/gmail-outreach/agent'
import { fetchEmailMarketingData } from '@/lib/modules/email-marketing/fetcher'
import { analyzeEmailMarketing } from '@/lib/modules/email-marketing/agent'
import { fetchAudienceDiscoveryData } from '@/lib/modules/audience-discovery/fetcher'
import { analyzeAudienceDiscovery } from '@/lib/modules/audience-discovery/agent'
import { generatePlaybook, type PlaybookData } from '@/lib/playbook/generator'
import type { ModuleAnalysisResult, DynamicModuleAnalysisResult, ModuleCategoryDefinition, ModuleItemDefinition, ModuleDefinition } from '@/lib/modules/types'
import { getAllItems } from '@/lib/modules/types'

// Derive export type from static item definition (saves adding to every definition file)
function deriveExportType(item: ModuleItemDefinition): 'auto' | 'needs_choice' | 'external' | null {
  if (item.exportType) return item.exportType  // explicit override wins
  if (item.fixType === 'template') return 'auto'
  if (item.fixType === 'value' || item.fixType === 'patch') return 'needs_choice'
  if (item.fixable) return 'auto'
  if (item.assistedInput) return 'external'
  return null
}
import { getRelevantContext, extractAndMergeFacts } from '@/lib/brain'
import { detectAndStoreConflicts } from '@/lib/brain/conflict-detector'
import { withAIContext } from '@/lib/ai/client'

export const maxDuration = 300

async function getFreshModuleState(moduleId: string) {
  const [freshItems, freshCats] = await Promise.all([
    db.select().from(moduleItems).where(eq(moduleItems.moduleId, moduleId)),
    db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId)),
  ])
  return {
    items: freshItems,
    categories: freshCats.filter(c => !c.parentId).map(c => ({ id: c.id, slug: c.slug })),
  }
}

// Search Console metadata for Foundation's indexing checks ({} when not connected).
async function getGscMeta(brandId: string | undefined): Promise<Record<string, string>> {
  if (!brandId) return {}
  const [gscRow] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'google_search_console'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)
  return (gscRow?.metadata as Record<string, string> | null) ?? {}
}

async function runAnalysis(
  moduleType: string,
  requirements: Record<string, string>,
  brainCtx?: string,
): Promise<ModuleAnalysisResult[] | DynamicModuleAnalysisResult[]> {
  switch (moduleType) {
    case 'foundation': {
      const data = await fetchFoundationData(requirements)
      if (!data.extracted) throw new Error(`Could not fetch ${requirements['website_url']}`)
      const { results } = await analyzeFoundation(data, await getGscMeta(requirements['brand_id']))
      return results
    }
    case 'website': {
      const data = await fetchWebsiteData(requirements)
      if ('error' in data) throw new Error(data.error)
      const url = requirements['website_url'] ?? ''
      return analyzeWebsite(data, url, requirements['brand_name'])
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
      return analyzeSeo(data, url, brainCtx, seoIntegrations, requirements['brand_name'])
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
      const [serperRow] = await db
        .select()
        .from(brandIntegrations)
        .where(and(
          eq(brandIntegrations.brandId, requirements['brand_id']),
          eq(brandIntegrations.provider, 'serper'),
          eq(brandIntegrations.status, 'connected'),
        ))
        .limit(1)
      const outreachReqs = serperRow?.apiKey
        ? { ...requirements, serper_api_key: serperRow.apiKey }
        : requirements
      const data = await fetchOutreachTargetsData(outreachReqs)
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
    case 'business-stage': {
      const data = await fetchBusinessStageData(requirements)
      return analyzeBusinessStage(data, brainCtx)
    }
    case 'gmail-outreach': {
      const data = await fetchGmailOutreachData(requirements)
      return analyzeGmailOutreach(data, brainCtx)
    }
    case 'email-marketing': {
      const data = await fetchEmailMarketingData(requirements)
      return analyzeEmailMarketing(data, brainCtx)
    }
    case 'audience-discovery': {
      const data = await fetchAudienceDiscoveryData(requirements)
      return analyzeAudienceDiscovery(data, brainCtx)
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
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const isAdmin = adminEmails.includes(user.email ?? '')
  if (!brand || (!isAdmin && brand.userId !== user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const def = MODULE_MAP[mod.type]
  if (!def) return NextResponse.json({ error: 'Unknown module type' }, { status: 400 })

  // Pro gate — a no-op unless BILLING_ENABLED=true. Admins analysing on a brand's behalf are exempt.
  if (!isAdmin && !canUseModule(await getAccess(brand.id, user.email), mod.type)) {
    return NextResponse.json({ error: `${def.name} is part of GrowJin Pro.`, upgrade: true }, { status: 402 })
  }

  const background = (body as { background?: boolean }).background === true

  // Only one analysis per module at a time — reloads and second devices join the live run.
  const { claimed, runId } = await claimRun(moduleId)
  if (!claimed) {
    if (background) return NextResponse.json({ running: true, runId }, { status: 202 })
    return NextResponse.json({ error: 'An analysis is already running for this module. Results will appear when it finishes.' }, { status: 409 })
  }

  const job = () => runTracked(() => executeAnalysis(mod, brand, def, moduleId), moduleId, runId)
  if (background) {
    // Respond immediately; the work continues after the response (bounded by maxDuration).
    // The dashboard polls GET ?moduleId=…&runId=… for the outcome, so a dropped connection
    // (phone locked, flaky network) no longer loses the result.
    after(async () => { await job() })
    return NextResponse.json({ running: true, runId }, { status: 202 })
  }
  return job()
}

// Records the run's outcome; any unexpected throw releases the module instead of leaving it 'analyzing'.
async function runTracked(work: () => Promise<Response>, moduleId: string, runId: string | null): Promise<Response> {
  try {
    const res = await work()
    let error: string | null = null
    if (!res.ok) {
      const data = await res.clone().json().catch(() => ({})) as { error?: string }
      error = data.error ?? 'Analysis failed. Please try again.'
    }
    await finishRun(runId, error)
    return res
  } catch (err) {
    console.error('[analyze] unexpected failure:', err)
    const error = 'Analysis failed. Please try again.'
    await db.update(modules).set({ status: 'pending' }).where(eq(modules.id, moduleId)).catch(() => {})
    await finishRun(runId, error)
    return NextResponse.json({ error }, { status: 500 })
  }
}

async function executeAnalysis(
  mod: typeof modules.$inferSelect,
  brand: typeof brands.$inferSelect,
  def: ModuleDefinition,
  moduleId: string,
): Promise<Response> {
  // Get relevant brain context to inject into this module's agent (skip for User Acquisition — runs first, no prior context)
  let brainCtx: string | undefined
  if (def.order > 0) {
    try {
      brainCtx = await getRelevantContext(brand.id, mod.type, def.description)
    } catch {
      // Non-fatal — analysis continues without brain context
    }

    // Prepend playbook (sales context) to brainCtx if it exists
    const pb = brand.playbook as PlaybookData | null
    if (pb?.icp) {
      const playbookStr = `=== Brand Playbook ===
Executive Summary: ${pb.executiveSummary}
ICP: ${pb.icp}
Buyer Personas: ${pb.buyerPersonas}
Competitive Landscape: ${pb.competitiveLandscape}
Industry Trends: ${pb.industryTrends}
Key One-Liners: ${pb.keyOneLiners}`
      brainCtx = playbookStr + (brainCtx ? '\n\n' + brainCtx : '')
    }
  }

  // For dynamic modules: pre-fetch user_checked items and inject into brainCtx so Claude
  // doesn't re-surface tasks the user has already completed (Option A).
  let preResolvedItems: (typeof moduleItems.$inferSelect)[] = []
  if (def.dynamic) {
    preResolvedItems = await db
      .select()
      .from(moduleItems)
      .where(and(eq(moduleItems.moduleId, moduleId), eq(moduleItems.userChecked, true)))
    if (preResolvedItems.length > 0) {
      const resolvedNote = `\n\n=== Tasks already completed by the user ===\nThese tasks have been marked as done. You have two options for each:\n1. OMIT it entirely — it will be preserved as completed automatically.\n2. Re-include it if still relevant — but you MUST use the EXACT same "slug" value shown below.\nNever generate a new slug for a task the user has already completed.\n\n${preResolvedItems.map((i) => `- slug: "${i.slug}", label: "${i.label}"`).join('\n')}`
      brainCtx = (brainCtx ?? '') + resolvedNote
    }
  }

  // Ensure website_url, brand_id, brand_name, and website_type are always available in requirements
  const baseRequirements = (mod.requirements as Record<string, string> | null) ?? {}
  let requirements: Record<string, string> = {
    ...baseRequirements,
    brand_id: brand.id,
    brand_name: brand.name,
    website_type: brand.websiteType ?? 'saas',
    ...(brand.websiteUrl && !baseRequirements['website_url'] ? { website_url: brand.websiteUrl } : {}),
  }

  // Prepend website-type context to brainCtx so all agents tailor output to this site type
  const WEBSITE_TYPE_LABELS: Record<string, string> = {
    saas: 'SaaS / Software', event: 'Event / Conference', ecommerce: 'E-commerce / Retail',
    agency: 'Agency / Consulting', blog: 'Blog / Media / Content', local: 'Local Business / Services',
    nonprofit: 'Non-profit / NGO', portfolio: 'Portfolio / Personal Brand',
  }
  const wt = requirements['website_type']
  const wtLabel = WEBSITE_TYPE_LABELS[wt] ?? wt
  const websiteTypeNote = `=== Website Type: ${wtLabel} ===\nTailor all analysis, recommendations, and action items to this type of website.\n\n`
  brainCtx = websiteTypeNote + (brainCtx ?? '')

  // Auto-populate competitor URLs from registry if not provided and module uses competitors
  if (
    (mod.type === 'competitor-analysis' || mod.type === 'competitor-audit' || mod.type === 'outreach-targets') &&
    !requirements['competitor_urls']
  ) {
    try {
      const registryUrls = await getCompetitorUrlsString(brand.id)
      if (registryUrls) {
        requirements['competitor_urls'] = registryUrls
      }
    } catch {
      // Non-fatal — analysis continues without auto-populated competitors
    }
  }

  // ── Content Audit: special pipeline (parallel Claude calls + page verdicts) ──
  if (mod.type === 'content-audit') {
    let contentAuditOutput: Awaited<ReturnType<typeof analyzeContentAudit>>
    try {
      const data = await fetchContentAuditData(requirements)
      contentAuditOutput = await withAIContext(
        { brandId: brand.id, moduleType: mod.type, websiteUrl: brand.websiteUrl ?? undefined },
        () => analyzeContentAudit(data, brainCtx),
      )
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

    // Replace findings: one transaction, so a page load never sees the module half-written.
    await db.transaction(async (tx) => {
      if (existingItems.length > 0) {
        await tx.delete(moduleItems).where(eq(moduleItems.moduleId, moduleId))
      }

      // Build category slug → id map
      let cats = await tx.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
      let catMap = new Map(cats.filter(c => !c.parentId).map(c => [c.slug, c.id]))

      // If categories weren't seeded at onboarding (module added to registry after user onboarded), seed them now
      if (catMap.size === 0) {
        for (const cat of def.categories) {
          // eslint-disable-next-line no-await-in-loop
          await tx.insert(moduleCategories).values({
            moduleId,
            parentId: null,
            slug: cat.slug,
            label: cat.label,
            order: cat.order,
          }).onConflictDoNothing()
        }
        cats = await tx.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
        catMap = new Map(cats.filter(c => !c.parentId).map(c => [c.slug, c.id]))
      }

      // Insert findings into module_items
      await Promise.all(
        findings.map(r => {
          const categoryId = catMap.get(r.category)
          if (!categoryId) return Promise.resolve()
          const wasChecked = userCheckedSlugs.has(r.slug)
          const isCalendar = r.slug === 'content-calendar-30-day'
          return tx.insert(moduleItems).values({
            moduleId,
            categoryId,
            slug: r.slug,
            label: r.label,
            weight: r.weight,
            aiDetail: r.detail,
            aiHighlight: r.highlight ?? null,
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

      // Re-insert user_checked items Claude didn't return — keep them visible in checklist as completed
      const returnedSlugsCa = new Set(findings.map((r) => r.slug))
      const orphansCa = existingItems.filter((i) => i.userChecked && !returnedSlugsCa.has(i.slug))
      if (orphansCa.length > 0) {
        await Promise.all(
          orphansCa.map((i) =>
            tx.insert(moduleItems).values({
              moduleId: i.moduleId,
              categoryId: i.categoryId,
              slug: i.slug,
              label: i.label,
              weight: i.weight,
              aiDetail: i.aiDetail,
              aiHighlight: i.aiHighlight,
              aiNarrative: i.aiNarrative,
              aiAction: i.aiAction,
              aiData: i.aiData,
              aiVerified: i.aiVerified,
              aiVerifiedAt: i.aiVerifiedAt,
              userChecked: true,
              userCheckedAt: i.userCheckedAt,
              completedBy: i.completedBy,
              fixable: i.fixable,
              updatedAt: new Date(),
            }).onConflictDoNothing(),
          ),
        )
      }
    })

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

    // Unlock next module if threshold met (skip comingSoon modules in the chain)
    const nextDef = Object.values(MODULE_MAP)
      .filter(m => !m.comingSoon)
      .sort((a, b) => a.order - b.order)
      .find(m => m.order > def.order)
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

    // Detect cross-module conflicts (fire-and-forget)
    detectAndStoreConflicts(brand.id, moduleId, allItems.map(i => ({ id: i.id, slug: i.slug, label: i.label ?? '' }))).catch(err =>
      console.error('Conflict detection failed (non-fatal):', err)
    )

    // Mark playbook stale so user knows it can be regenerated with richer context
    if (brand.playbook) {
      try {
        await db.update(brands)
          .set({ playbook: { ...(brand.playbook as object), _stale: true } })
          .where(eq(brands.id, brand.id))
      } catch {
        // Non-fatal
      }
    }

    const { items: freshItems, categories: freshCats } = await getFreshModuleState(moduleId)
    return NextResponse.json({ ok: true, dynamic: def.dynamic ?? false, score, lastAnalyzedAt: new Date().toISOString(), items: freshItems, categories: freshCats, pageVerdicts })
  }

  // Foundation: fetch + analyse in one pass (avoids double fetch)
  let foundationResults: ModuleAnalysisResult[] | null = null
  if (mod.type === 'foundation') {
    try {
      await setRunStage(moduleId, 'fetch')
      const prefetch = await fetchFoundationData(requirements)
      if (!prefetch.extracted) throw new Error(`Could not fetch ${requirements['website_url']}`)
      await setRunStage(moduleId, 'analyse')

      const [{ brandColor, results }, playbookResult] = await withAIContext(
        { brandId: brand.id, moduleType: mod.type, websiteUrl: brand.websiteUrl ?? undefined },
        async () => {
          const gscMeta = await getGscMeta(brand.id)
          return Promise.all([
            analyzeFoundation(prefetch, gscMeta),
            generatePlaybook(prefetch, brand.name).catch(() => null),
          ])
        },
      )
      console.log('[Foundation] brandColor from Claude:', brandColor || '(empty)')
      foundationResults = results

      const updatedReqs = { ...requirements }
      const upserts = []
      for (const [platform, url] of Object.entries(prefetch.extracted.socialLinks)) {
        const key = `social_${platform}`
        if (!updatedReqs[key]) updatedReqs[key] = url
        upserts.push(
          db.insert(brandIntegrations).values({
            brandId: brand.id,
            provider: platform,
            type: 'social',
            status: 'connected',
            metadata: { url },
          }).onConflictDoUpdate({
            target: [brandIntegrations.brandId, brandIntegrations.provider],
            set: { metadata: { url }, status: 'connected' },
          })
        )
      }
      const brandUpdates: Record<string, string> = {}
      let logoUrl = ''
      if (prefetch.extracted.favicon) {
        try { logoUrl = new URL(prefetch.extracted.favicon, prefetch.url).href } catch { /* ignore */ }
      }
      console.log('[Foundation] logoUrl:', logoUrl || '(none)')
      console.log('[Foundation] themeColor from meta:', prefetch.extracted.themeColor || '(empty)')
      if (logoUrl) brandUpdates.logoUrl = logoUrl
      let themeColor = prefetch.extracted.themeColor || brandColor
      if (!themeColor && logoUrl) {
        console.log('[Foundation] Trying getFaviconColor from:', logoUrl)
        themeColor = await getFaviconColor(logoUrl)
        console.log('[Foundation] getFaviconColor result:', themeColor || '(empty)')
      }
      if (themeColor) brandUpdates.themeColor = themeColor
      console.log('[Foundation] brandUpdates:', JSON.stringify(brandUpdates))
      await Promise.all([
        db.update(modules).set({ requirements: updatedReqs }).where(eq(modules.id, moduleId)),
        Object.keys(brandUpdates).length > 0
          ? db.update(brands).set(brandUpdates).where(eq(brands.id, brand.id))
          : Promise.resolve(),
        playbookResult
          ? db.update(brands).set({ playbook: playbookResult }).where(eq(brands.id, brand.id))
          : Promise.resolve(),
        ...upserts,
      ])
      Object.assign(requirements, updatedReqs)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed'
      const isFetchError = msg.startsWith('Could not fetch')
      console.error('[Foundation] prefetch/analysis block threw:', err)
      await db.update(modules).set({ status: 'pending' }).where(eq(modules.id, moduleId))
      if (isFetchError) {
        return NextResponse.json(
          { error: `Unable to reach ${requirements['website_url']}. Make sure the site is publicly accessible and try again.` },
          { status: 400 },
        )
      }
      // Don't fall through to runAnalysis: it would re-read the whole site and run the analysis again,
      // doubling the wait after the AI client has already retried. Fail now with a clear message.
      return NextResponse.json(
        { error: 'The analysis didn’t finish this time. Please try again in a minute.' },
        { status: 502 },
      )
    }
  }

  let results: ModuleAnalysisResult[] | DynamicModuleAnalysisResult[]
  if (foundationResults !== null) {
    results = foundationResults
  } else {
    try {
      await setRunStage(moduleId, 'analyse')
      results = await withAIContext(
        { brandId: brand.id, moduleType: mod.type, websiteUrl: brand.websiteUrl ?? undefined },
        () => runAnalysis(mod.type, requirements, brainCtx),
      )
    } catch (err) {
      await db.update(modules).set({ status: 'pending' }).where(eq(modules.id, moduleId))
      console.error('Module analysis failed:', err)
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Analysis failed. Please try again.' },
        { status: 500 },
      )
    }
  }

  await setRunStage(moduleId, 'save')

  if (def.dynamic) {
    // ── Dynamic module: Claude generates the items themselves ──────────────
    const dynamicResults = results as DynamicModuleAnalysisResult[]

    // Preserve any user_checked state before wiping items
    const existingItems = await db.select().from(moduleItems).where(eq(moduleItems.moduleId, moduleId))

    // Business stage: compare previous vs new classification / red flag → signals
    if (mod.type === 'business-stage') {
      try {
        const stageCats = await db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
        const catSlugById = new Map(stageCats.map((c) => [c.id, c.slug]))
        const prevOf = (slug: string) => existingItems.find((i) => catSlugById.get(i.categoryId) === slug)
        const nextOf = (slug: string) => dynamicResults.find((r) => r.category === slug)
        await detectBusinessStageChange(
          brand.id,
          { classification: prevOf('classification')?.label ?? null, redFlag: prevOf('red-flag')?.label ?? null },
          { classification: nextOf('classification')?.label ?? null, redFlag: nextOf('red-flag')?.label ?? null, redFlagDetail: nextOf('red-flag')?.detail ?? null },
        )
      } catch (err) {
        console.error('Business stage signal detection failed:', err)
      }
    }

    const userCheckedSlugs = new Set(existingItems.filter((i) => i.userChecked).map((i) => i.slug))
    // Normalize label for fuzzy matching (handles slug drift between runs)
    const normalizeLabel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
    const checkedByLabel = new Map(
      existingItems.filter((i) => i.userChecked).map((i) => [normalizeLabel(i.label ?? ''), i]),
    )

    // Replace items: one transaction, so a page load never sees the module half-written.
    await db.transaction(async (tx) => {
      // Delete all existing items for this module (fresh slate from Claude)
      if (existingItems.length > 0) {
        await tx.delete(moduleItems).where(eq(moduleItems.moduleId, moduleId))
      }

      // Get or create categories for this module
      let cats = await tx.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
      const existingCatSlugs = new Set(cats.filter((c) => !c.parentId).map((c) => c.slug))

      // If new categories in definition don't exist in DB, create them
      if (def.categories) {
        const missingCats = (def.categories as ModuleCategoryDefinition[]).filter((cat) => !existingCatSlugs.has(cat.slug))
        if (missingCats.length > 0) {
          const catInserts = missingCats.map((cat) => ({
            moduleId,
            slug: cat.slug,
            label: cat.label,
            order: cat.order ?? 0,
            parentId: null as string | null,
          }))
          await tx.insert(moduleCategories).values(catInserts)
          cats = await tx.select().from(moduleCategories).where(eq(moduleCategories.moduleId, moduleId))
        }
      }

      const catMap = new Map(cats.filter((c) => !c.parentId).map((c) => [c.slug, c.id]))

      // Insert fresh items from Claude, restoring user_checked where slug OR label matches
      await Promise.all(
        dynamicResults.map((r) => {
          const categoryId = catMap.get(r.category)
          if (!categoryId) return Promise.resolve()
          const wasChecked = userCheckedSlugs.has(r.slug) || checkedByLabel.has(normalizeLabel(r.label))
          return tx.insert(moduleItems).values({
            moduleId,
            categoryId,
            slug: r.slug,
            label: r.label,
            weight: r.weight,
            aiDetail: r.detail,
            aiHighlight: (r as DynamicModuleAnalysisResult).highlight ?? null,
            aiNarrative: r.narrative,
            aiAction: r.action,
            aiData: (r as DynamicModuleAnalysisResult).aiData ?? null,
            aiVerified: r.verified,
            aiVerifiedAt: r.verified ? new Date() : null,
            userChecked: wasChecked,
            userCheckedAt: wasChecked ? new Date() : null,
            completedBy: r.verified ? 'ai' : wasChecked ? 'user' : null,
            fixable: (r as DynamicModuleAnalysisResult).fixable ?? false,
            exportType: (r as DynamicModuleAnalysisResult).exportType ?? null,
            choiceOptions: (r as DynamicModuleAnalysisResult).choiceOptions ?? null,
            updatedAt: new Date(),
          })
        }),
      )

      // Re-insert user_checked items Claude didn't return — keep them visible in checklist as completed
      const returnedSlugs = new Set(dynamicResults.map((r) => r.slug))
      const returnedLabels = new Set(dynamicResults.map((r) => normalizeLabel(r.label)))
      // Exclude orphans whose label already appears in Claude's output (label-matched → userChecked restored above)
      const completedOrphans = existingItems.filter(
        (i) => i.userChecked && !returnedSlugs.has(i.slug) && !returnedLabels.has(normalizeLabel(i.label ?? '')),
      )
      if (completedOrphans.length > 0) {
        await Promise.all(
          completedOrphans.map((i) =>
            tx.insert(moduleItems).values({
              moduleId: i.moduleId,
              categoryId: i.categoryId,
              slug: i.slug,
              label: i.label,
              weight: i.weight,
              aiDetail: i.aiDetail,
              aiHighlight: i.aiHighlight,
              aiNarrative: i.aiNarrative,
              aiAction: i.aiAction,
              aiVerified: i.aiVerified,
              aiVerifiedAt: i.aiVerifiedAt,
              userChecked: true,
              userCheckedAt: i.userCheckedAt,
              completedBy: i.completedBy,
              fixable: i.fixable,
              updatedAt: new Date(),
            }).onConflictDoNothing(),
          ),
        )
      }
    })

    // Store discovered competitors in the registry (for competitor-related modules)
    if ((mod.type === 'competitor-analysis' || mod.type === 'competitor-audit') && brand.id) {
      try {
        const competitorFindings = dynamicResults.filter((r) => r.category === 'competitor-discovery')
        if (competitorFindings.length > 0) {
          const competitorsList = competitorFindings
            .map((f) => {
              // Extract URL from label (e.g. "Buffer (buffer.com)" → "buffer.com")
              const urlMatch = f.label.match(/\(([^)]+)\)/)
              const url = urlMatch ? urlMatch[1] : f.label
              return {
                url: url.startsWith('http') ? url : `https://${url}`,
                name: f.label.split(' (')[0]?.trim(),
                primaryStrength: f.detail,
                discoveredIn: mod.type,
              }
            })
            .filter((c) => c.url)
          if (competitorsList.length > 0) {
            await storeCompetitors(brand.id, competitorsList)
          }
        }
      } catch (err) {
        console.error('Failed to store competitors in registry (non-fatal):', err)
      }
    }
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
            aiHighlight: (r as ModuleAnalysisResult).highlight ?? null,
            aiNarrative: r.narrative,
            aiAction: r.action,
            aiVerified: r.verified,
            aiVerifiedAt: r.verified ? new Date() : null,
            completedBy: r.verified ? 'ai' : null,
            fixable: !!(defItem?.fixable || defItem?.assistedInput || defItem?.upgradeInput),
            fixType: defItem?.fixType ?? null,
            fixInputKey: defItem?.assistedInput?.key ?? defItem?.upgradeInput?.key ?? null,
            fixIntegrationProvider: defItem?.assistedInput?.integrationProvider ?? (defItem?.upgradeInput ? 'brand_assets' : null),
            exportType: (r as ModuleAnalysisResult).exportType ?? (defItem ? deriveExportType(defItem) : null),
            choiceOptions: (r as ModuleAnalysisResult).choiceOptions ?? null,
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

  // Unlock next module if score meets its threshold (skip comingSoon modules in the chain)
  const nextDef = Object.values(MODULE_MAP)
    .filter((m) => !m.comingSoon)
    .sort((a, b) => a.order - b.order)
    .find((m) => m.order > def.order)
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

  // Detect cross-module conflicts (fire-and-forget)
  detectAndStoreConflicts(brand.id, moduleId, allItems.map(i => ({ id: i.id, slug: i.slug, label: i.label ?? '' }))).catch(err =>
    console.error('Conflict detection failed (non-fatal):', err)
  )

  const { items: freshItems, categories: freshCats } = await getFreshModuleState(moduleId)
  return NextResponse.json({ ok: true, dynamic: def.dynamic ?? false, score, lastAnalyzedAt: new Date().toISOString(), items: freshItems, categories: freshCats })
}

// Poll target for background analyses: { state: 'running' | 'failed' | 'done' | 'idle' }.
// 'done' carries the same payload as a synchronous POST so the dashboard applies it the same way.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const moduleId = request.nextUrl.searchParams.get('moduleId')
  const runId = request.nextUrl.searchParams.get('runId')
  if (!moduleId) return NextResponse.json({ error: 'moduleId is required' }, { status: 400 })

  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId))
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })
  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId))
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!brand || (!adminEmails.includes(user.email ?? '') && brand.userId !== user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const run = await getRun(moduleId, runId)
  if (run && isStale(run)) {
    await failStaleRun(run)
    return NextResponse.json({ state: 'failed', error: STALE_RUN_ERROR })
  }
  if (run?.status === 'running') {
    return NextResponse.json({ state: 'running', stage: await getRunStage(run.id), startedAt: run.startedAt.toISOString() })
  }
  if (run?.status === 'failed') return NextResponse.json({ state: 'failed', error: run.error ?? 'Analysis failed. Please try again.' })
  if (!run && mod.status === 'analyzing') {
    // Table missing: the module's own status is all we have. Table present but no run row:
    // 'analyzing' was set by something that doesn't track runs (MCP tool, or a run from before
    // run tracking existed) — nothing to wait on from here.
    return NextResponse.json({ state: run === undefined ? 'running' : 'idle' })
  }
  if (!run && !mod.lastAnalyzedAt) return NextResponse.json({ state: 'idle' })

  const def = MODULE_MAP[mod.type]
  const { items, categories } = await getFreshModuleState(moduleId)
  const pageVerdicts = mod.type === 'content-audit'
    ? (await db.select().from(modulePageAudit).where(eq(modulePageAudit.moduleId, moduleId))).map(v => ({
        url: v.url, title: v.title ?? null, wordCount: v.wordCount ?? 0, verdict: v.verdict,
        urgency: v.urgency, reason: v.reason ?? null, action: v.action ?? null,
      }))
    : undefined
  return NextResponse.json({
    state: 'done',
    ok: true,
    dynamic: def?.dynamic ?? false,
    score: mod.score ?? 0,
    lastAnalyzedAt: (mod.lastAnalyzedAt ?? new Date()).toISOString(),
    items,
    categories,
    pageVerdicts,
  })
}
