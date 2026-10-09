import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getAccess } from '@/lib/billing/plan'
import { getPrices } from '@/lib/billing/stripe'
import { MODULE_MAP } from '@/lib/modules/registry'
import PricingPlans from '@/components/PricingPlans'

export const dynamic = 'force-dynamic'

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const access = await getAccess(brand.id, user.email)
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
