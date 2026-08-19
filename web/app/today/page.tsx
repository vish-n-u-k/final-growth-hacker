import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import TodayDashboard from '@/components/TodayDashboard'
import type { ActionCard } from '@/lib/daily/signals'

export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select({
    id: brands.id,
    dailyStreak: brands.dailyStreak,
    lastActionDate: brands.lastActionDate,
    dailySignalsCache: brands.dailySignalsCache,
    signalsCachedAt: brands.signalsCachedAt,
  }).from(brands).where(eq(brands.userId, user.id)).limit(1)

  if (!brand) redirect('/onboarding')

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
      initialData={{ cards, streak, allGood, cachedAt }}
    />
  )
}
