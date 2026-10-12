import { redirect } from 'next/navigation'
import { getSessionUser, getBrandForUser, getAccessCached } from '@/lib/server-session'
import { getPrices } from '@/lib/billing/stripe'
import { MODULE_MAP } from '@/lib/modules/registry'
import PricingPlans from '@/components/PricingPlans'

export const dynamic = 'force-dynamic'

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')

  const access = await getAccessCached(brand.id, user.email)
  const prices = access.enabled ? await getPrices().catch(() => []) : []
  const { checkout } = await searchParams

  return (
    <PricingPlans
      access={access}
      prices={prices}
      freeModuleNames={access.freeModules.map(t => MODULE_MAP[t]?.name ?? t)}
      checkout={checkout === 'success' || checkout === 'cancelled' ? checkout : null}
    />
  )
}
