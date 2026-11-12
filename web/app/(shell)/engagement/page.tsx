import { redirect } from 'next/navigation'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import { apifyConfigured } from '@/lib/engagement/apify'
import { readEngagement } from '@/lib/engagement/store'
import EngagementPage from '@/components/engagement/EngagementPage'

export const dynamic = 'force-dynamic'

// Engagement Leads: Reddit threads, Instagram posts and competitor commenters worth a follow or a
// comment. Data is one document per brand (lib/engagement/store.ts); the page is
// components/engagement/EngagementPage.tsx.
export default async function EngagementRoute() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')
  return <EngagementPage initial={await readEngagement(brand.id)} ready={apifyConfigured()} />
}
