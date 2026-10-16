import { redirect } from 'next/navigation'
import { blogMarkdownUrl } from '@/lib/blog-share'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, modules, moduleItems, moduleCategories, brandBlogs } from '@/lib/db/schema'
import { eq, and, ne, desc, count, inArray, like } from 'drizzle-orm'
import TodayDashboard from '@/components/TodayDashboard'
import type { ActionCard } from '@/lib/daily/signals'
import type { DBItemFull } from '@/lib/modules/types'

const BLOG_LIMITS: Record<string, number> = {
  blog: 30, saas: 15, ecommerce: 12, agency: 10,
  local: 6, nonprofit: 8, event: 4, portfolio: 6,
}
const DEFAULT_BLOG_LIMIT = 10

export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) redirect('/login')

  const [brand] = await db.select({
    id: brands.id,
    name: brands.name,
    websiteType: brands.websiteType,
    websiteUrl: brands.websiteUrl,
    dailyStreak: brands.dailyStreak,
    lastActionDate: brands.lastActionDate,
    dailySignalsCache: brands.dailySignalsCache,
    signalsCachedAt: brands.signalsCachedAt,
  }).from(brands).where(eq(brands.userId, user.id)).limit(1)

  if (!brand) redirect('/onboarding')

  const blogLimit = BLOG_LIMITS[brand.websiteType ?? ''] ?? DEFAULT_BLOG_LIMIT

  // Integrations + module IDs + blog data in parallel
  const [[gmailInteg], [frektoInteg], [posthogInteg], [gmailModule], [socialModule], recentBlogs, [blogCountRow]] = await Promise.all([
    db.select({ status: brandIntegrations.status, metadata: brandIntegrations.metadata })
      .from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gmail')))
      .limit(1),
    db.select({ status: brandIntegrations.status, metadata: brandIntegrations.metadata })
      .from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'frekto')))
      .limit(1),
    db.select({ status: brandIntegrations.status })
      .from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'posthog')))
      .limit(1),
    db.select({ id: modules.id })
      .from(modules)
      .where(and(eq(modules.brandId, brand.id), eq(modules.type, 'gmail-outreach')))
      .limit(1),
    db.select({ id: modules.id })
      .from(modules)
      .where(and(eq(modules.brandId, brand.id), eq(modules.type, 'social-media')))
      .limit(1),

    db.select({
      id: brandBlogs.id,
      title: brandBlogs.title,
      slug: brandBlogs.slug,
      status: brandBlogs.status,
      verificationStatus: brandBlogs.verificationStatus,
      verifiedLiveAt: brandBlogs.verifiedLiveAt,
      liveUrl: brandBlogs.liveUrl,
      createdAt: brandBlogs.createdAt,
    })
      .from(brandBlogs)
      .where(and(eq(brandBlogs.brandId, brand.id), ne(brandBlogs.status, 'replaced')))
      .orderBy(desc(brandBlogs.createdAt))
      .limit(10),

    db.select({ n: count() })
      .from(brandBlogs)
      .where(and(eq(brandBlogs.brandId, brand.id), ne(brandBlogs.status, 'replaced'))),
  ])

  const gmailConnected = gmailInteg?.status === 'connected'
  const gmailAddress = (gmailInteg?.metadata as { gmail_address?: string } | null)?.gmail_address ?? null
  const frektoConnected = frektoInteg?.status === 'connected'
  const frektoDefaultPlatform = ((frektoInteg?.metadata as Record<string, string> | null)?.auto_post_platforms ?? '').split(',')[0]?.trim().toLowerCase() || null

  // "Create a post": the Social Media audit's post suggestions as ready ideas
  const postIdeas = socialModule
    ? (await db.select({ label: moduleItems.label, detail: moduleItems.aiDetail, action: moduleItems.aiAction })
        .from(moduleItems)
        .where(and(eq(moduleItems.moduleId, socialModule.id), like(moduleItems.slug, 'post-suggestions-%')))
        .limit(8)
        .catch(() => []))
        .filter(i => i.label)
        .map(i => ({
          label: (i.label ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').slice(0, 300),
          platform: /\b(linkedin|instagram|facebook|pinterest|youtube|tiktok|twitter|x)\b/i.exec(i.detail ?? '')?.[1]?.toLowerCase() ?? null,
          hook: i.action ?? null,
        }))
    : []

  const blogActiveCount = Number(blogCountRow?.n ?? 0)
  const lastBlogAt = recentBlogs[0]?.createdAt ?? null
  const daysSinceLastBlog = lastBlogAt
    ? Math.floor((Date.now() - new Date(lastBlogAt).getTime()) / 864e5)
    : null
  const blogWeeklyDue = daysSinceLastBlog === null || daysSinceLastBlog >= 7

  let prospectItems: DBItemFull[] = []
  if (gmailModule) {
    const [cats, rawItems] = await Promise.all([
      db.select().from(moduleCategories).where(eq(moduleCategories.moduleId, gmailModule.id)),
      db.select().from(moduleItems).where(eq(moduleItems.moduleId, gmailModule.id)),
    ])
    const catMap = new Map(cats.map(c => [c.id, c.slug]))
    prospectItems = rawItems.map(item => ({
      id: item.id,
      slug: item.slug ?? '',
      label: item.label ?? '',
      weight: item.weight ?? 1,
      categorySlug: catMap.get(item.categoryId ?? '') ?? '',
      aiDetail: item.aiDetail,
      aiHighlight: null,
      aiNarrative: item.aiNarrative,
      aiAction: item.aiAction,
      aiDraft: item.aiDraft ?? null,
      aiData: item.aiData ?? null,
      aiVerified: item.aiVerified ?? false,
      userChecked: item.userChecked ?? false,
      completedBy: item.completedBy ?? null,
      fixable: item.fixable ?? false,
      fixType: (item.fixType ?? null) as DBItemFull['fixType'],
      fixInputKey: item.fixInputKey ?? null,
      fixIntegrationProvider: item.fixIntegrationProvider ?? null,
      userSkipped: item.userSkipped ?? false,
      userSkipReason: item.userSkipReason ?? null,
      exportType: item.exportType ?? null,
      choiceOptions: (item.choiceOptions ?? null) as string[] | null,
      userChoice: item.userChoice ?? null,
    }))
  }

  // Compute streak from stored values
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  const last = brand.lastActionDate
  let streak = brand.dailyStreak ?? 0
  if (last && last !== today && last !== yesterday) streak = 0 // reset if stale

  // Use cached signals if < 4 hours old; otherwise show empty + let client fetch
  let cards: ActionCard[] = []
  let focus: { stage: string; summary: string } | null = null
  let allGood = false
  let cachedAt = ''
  if (brand.signalsCachedAt && brand.dailySignalsCache) {
    const age = Date.now() - new Date(brand.signalsCachedAt).getTime()
    if (age < 4 * 60 * 60 * 1000) {
      const cached = brand.dailySignalsCache as { cards?: ActionCard[]; impacts?: unknown[]; focus?: { stage: string; summary: string } | null } | ActionCard[]
      cards = Array.isArray(cached) ? cached : (cached.cards ?? [])
      focus = Array.isArray(cached) ? null : (cached.focus ?? null)
      allGood = cards.length === 0
      cachedAt = new Date(brand.signalsCachedAt).toISOString()
    }
  }

  // For the "do it with Claude" hand-off: GrowJin MCP status and the connected GitHub repo.
  const handoffRows = await db.select({ provider: brandIntegrations.provider, status: brandIntegrations.status, lastUsedAt: brandIntegrations.lastUsedAt, metadata: brandIntegrations.metadata })
    .from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brand.id), inArray(brandIntegrations.provider, ['mcp', 'github'])))
    .catch(() => [] as { provider: string; status: string; lastUsedAt: Date | null; metadata: unknown }[])
  const mcpRow = handoffRows.find(r => r.provider === 'mcp' && r.status === 'connected')
  const repoUrl = (handoffRows.find(r => r.provider === 'github' && r.status === 'connected')?.metadata as Record<string, string> | null)?.repo_url ?? ''
  const githubRepo = repoUrl.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1] ?? null

  return (
    <TodayDashboard
      initialData={{ cards, impacts: [], focus, streak, allGood, cachedAt }}
      brandName={brand.name}
      websiteUrl={brand.websiteUrl ?? null}
      mcpLastUsedAt={mcpRow?.lastUsedAt ? new Date(mcpRow.lastUsedAt).toISOString() : null}
      githubRepo={githubRepo}
      gmailConnected={gmailConnected}
      gmailAddress={gmailAddress}
      prospectItems={prospectItems}
      gmailModuleId={gmailModule?.id ?? null}
      frektoConnected={frektoConnected}
      frektoDefaultPlatform={frektoDefaultPlatform}
      postIdeas={postIdeas}
      posthogConnected={posthogInteg?.status === 'connected'}
      blogData={{
        blogs: recentBlogs.map(b => ({ ...b, mdUrl: blogMarkdownUrl((process.env.NEXT_PUBLIC_APP_URL || 'https://app.growjin.com'), b.id) })),
        limit: blogLimit,
        activeCount: blogActiveCount,
        weeklyDue: blogWeeklyDue,
        lastBlogAt: lastBlogAt ? new Date(lastBlogAt).toISOString() : null,
      }}
    />
  )
}
