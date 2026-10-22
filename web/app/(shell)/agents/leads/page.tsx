import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import { loadBrandContext } from '@/lib/agents/context'
import { searchDataReady } from '@/lib/agents/dataforseo'
import { agentsDemo } from '@/lib/agents/demo'
import { hunterConfigured } from '@/lib/agents/hunter'
import { leadFallback } from '@/lib/agents/lead-agent'
import { readLeadData } from '@/lib/agents/store'
import LeadAgentPage from '@/components/agents/LeadAgentPage'

export const dynamic = 'force-dynamic'

export default async function LeadAgent() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')
  const b = await loadBrandContext(brand.id)
  if (!b) redirect('/onboarding')

  const [data, [gmail]] = await Promise.all([
    readLeadData(brand.id).catch(() => null),
    db.select({ id: brandIntegrations.id }).from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gmail'), eq(brandIntegrations.status, 'connected')))
      .limit(1),
  ])

  return (
    <LeadAgentPage
      initial={data ?? leadFallback(b)()}
      flags={{ dataforseo: searchDataReady(), hunter: hunterConfigured(), gmail: agentsDemo() || !!gmail, demo: agentsDemo() }}
      competitorsHint={b.competitors.map(c => c.domain)}
    />
  )
}
