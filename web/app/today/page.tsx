import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, modules, moduleItems, moduleCategories } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import TodayDashboard from '@/components/TodayDashboard'
import type { ActionCard } from '@/lib/daily/signals'
import type { DBItemFull } from '@/lib/modules/types'

export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select({
    id: brands.id,
    name: brands.name,
    dailyStreak: brands.dailyStreak,
    lastActionDate: brands.lastActionDate,
    dailySignalsCache: brands.dailySignalsCache,
    signalsCachedAt: brands.signalsCachedAt,
  }).from(brands).where(eq(brands.userId, user.id)).limit(1)

  if (!brand) redirect('/onboarding')

  // Integrations + module IDs in parallel
  const [[gmailInteg], [frektoInteg], [gmailModule], [socialModule]] = await Promise.all([
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
  ])

  const gmailConnected = gmailInteg?.status === 'connected'
  const gmailAddress = (gmailInteg?.metadata as { gmail_address?: string } | null)?.gmail_address ?? null
  const frektoConnected = frektoInteg?.status === 'connected'

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
      cards = brand.dailySignalsCache as ActionCard[]
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
    />
  )
}
