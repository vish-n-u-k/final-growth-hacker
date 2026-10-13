import { redirect } from 'next/navigation'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import UserDetailsTable, { type DetailType } from './UserDetailsTable'

const TYPES: DetailType[] = ['signups', 'signins', 'dau', 'deleted']
const RANGES = ['24h', '7d', '30d'] as const

// /analytics/details?type=signups&range=24h — opened from "View details" on an Analytics card.
export default async function AnalyticsDetailsPage({ searchParams }: { searchParams: Promise<{ type?: string; range?: string }> }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')

  const sp = await searchParams
  const type = TYPES.includes(sp.type as DetailType) ? (sp.type as DetailType) : 'signups'
  const range = (RANGES as readonly string[]).includes(sp.range ?? '') ? (sp.range as (typeof RANGES)[number]) : '24h'

  return (
    <UserDetailsTable
      brandId={brand.id}
      type={type}
      range={range}
      savedColFields={(brand.analyticsColFields as Record<string, string> | null) ?? null}
    />
  )
}
