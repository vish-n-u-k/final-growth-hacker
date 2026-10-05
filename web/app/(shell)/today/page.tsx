import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, modules, moduleItems, moduleCategories, brandBlogs } from '@/lib/db/schema'
import { eq, and, ne, desc, count } from 'drizzle-orm'
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
    dailyStreak: brands.dailyStreak,
    lastActionDate: brands.lastActionDate,
    dailySignalsCache: brands.dailySignalsCache,
    signalsCachedAt: brands.signalsCachedAt,
  }).from(brands).where(eq(brands.userId, user.id)).limit(1)

  if (!brand) redirect('/onboarding')

  const blogLimit = BLOG_LIMITS[brand.websiteType ?? ''] ?? DEFAULT_BLOG_LIMIT

  // Integrations + module IDs + blog data in parallel
  const [[gmailInteg], [frektoInteg], [gmailModule], [socialModule], recentBlogs, [blogCountRow]] = await Promise.all([
    db.select({ status: brandIntegrations.status, metadata: brandIntegrations.metadata })
      .from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gmail')))
      .limit(1),
    db.select({ status: brandIntegrations.status })
      .from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'frekto')))
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
  let allGood = false
  let cachedAt = ''
  if (brand.signalsCachedAt && brand.dailySignalsCache) {
    const age = Date.now() - new Date(brand.signalsCachedAt).getTime()
    if (age < 4 * 60 * 60 * 1000) {
      const cached = brand.dailySignalsCache as { cards?: ActionCard[]; impacts?: unknown[] } | ActionCard[]
      cards = Array.isArray(cached) ? cached : (cached.cards ?? [])
      allGood = cards.length === 0
      cachedAt = new Date(brand.signalsCachedAt).toISOString()
    }
  }

  return (
    <TodayDashboard
      initialData={{ cards, impacts: [], streak, allGood, cachedAt }}
      brandName={brand.name}
      gmailConnected={gmailConnected}
      gmailAddress={gmailAddress}
      prospectItems={prospectItems}
      gmailModuleId={gmailModule?.id ?? null}
      socialModuleId={socialModule?.id ?? null}
      frektoConnected={frektoConnected}
      blogData={{
        blogs: recentBlogs,
        limit: blogLimit,
        activeCount: blogActiveCount,
        weeklyDue: blogWeeklyDue,
        lastBlogAt: lastBlogAt ? new Date(lastBlogAt).toISOString() : null,
      }}
    />
  )
}
