import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import AnalyticsBrief from '@/components/AnalyticsBrief'

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select({ id: brands.id, name: brands.name, websiteUrl: brands.websiteUrl })
    .from(brands)
    .where(eq(brands.userId, user.id))
    .limit(1)
  if (!brand) redirect('/onboarding')

  const integrations = await db
    .select({ provider: brandIntegrations.provider })
    .from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.status, 'connected')))

  const connectedSet = new Set(integrations.map((i) => i.provider))

  return (
    <AnalyticsBrief
      brand={brand}
      connectedProviders={[...connectedSet]}
    />
  )
}
