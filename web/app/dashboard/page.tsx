import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, channels, channelItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import MarketingDashboard, { type DBItemState } from '@/components/MarketingDashboard'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Gate: onboarding check
  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  // Get website channel
  const [channel] = await db
    .select()
    .from(channels)
    .where(eq(channels.brandId, brand.id))
    .limit(1)

  if (!channel) redirect('/onboarding')

  // Get all analysed items for this channel
  const items = await db
    .select()
    .from(channelItems)
    .where(eq(channelItems.channelId, channel.id))

  const itemStates: Record<string, DBItemState> = {}
  for (const item of items) {
    itemStates[item.itemSlug] = {
      aiDetail: item.aiDetail,
      aiVerified: item.aiVerified ?? false,
      userChecked: item.userChecked ?? false,
    }
  }

  return (
    <MarketingDashboard
      brand={{ id: brand.id, name: brand.name }}
      channel={{
        id: channel.id,
        url: channel.url,
        lastAnalyzedAt: channel.lastAnalyzedAt?.toISOString() ?? null,
      }}
      itemStates={itemStates}
      userEmail={user.email ?? ''}
    />
  )
}
