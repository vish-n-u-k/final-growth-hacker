import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import LeadFinder from '@/components/LeadFinder'
import { loadBrandContext } from '@/lib/agents/context'
import { dataForSeoConfigured } from '@/lib/agents/dataforseo'
import { listScans, loadScanReviews } from '@/lib/lead-finder/saved'

export default async function LeadFinderPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const [integration] = await db
    .select({ status: brandIntegrations.status })
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.provider, 'gmail'),
    ))
    .limit(1)

  const gmailConnected = integration?.status === 'connected'
  const [ctx, history] = await Promise.all([loadBrandContext(brand.id).catch(() => null), listScans(brand.id)])
  const latest = history[0] ?? null
  const latestReviews = latest ? await loadScanReviews(brand.id, latest.id) : []

  return (
    <LeadFinder
      brandName={brand.name}
      gmailConnected={gmailConnected}
      competitors={(ctx?.competitors ?? []).map(c => c.domain).slice(0, 4)}
      trustpilotReady={dataForSeoConfigured()}
      initialScan={latest}
      initialReviews={latestReviews}
      history={history}
    />
  )
}
