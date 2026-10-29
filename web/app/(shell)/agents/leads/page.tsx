import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import { loadBrandContext } from '@/lib/agents/context'
import { searchDataReady } from '@/lib/agents/dataforseo'
import { agentsDemo, demoForced, withDemo } from '@/lib/agents/demo'
import { hunterOutThisMonth, readDemoSwitch } from '@/lib/agents/store'
import { hunterConfigured } from '@/lib/agents/hunter'
import { leadFallback } from '@/lib/agents/lead-agent'
import { readLeadData } from '@/lib/agents/store'
import LeadAgentPage from '@/components/agents/LeadAgentPage'

export const dynamic = 'force-dynamic'

// Shown with the brand's demo-mode switch applied (lib/agents/demo.ts)
export default async function LeadAgentRoute() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')
  return withDemo(await readDemoSwitch(brand.id), () => LeadAgent())
}

async function LeadAgent() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')
  const b = await loadBrandContext(brand.id)
  if (!b) redirect('/onboarding')

  const [data, [gmail], hunterOut] = await Promise.all([
    readLeadData(brand.id).catch(() => null),
    db.select({ id: brandIntegrations.id }).from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gmail'), eq(brandIntegrations.status, 'connected')))
      .limit(1),
    hunterOutThisMonth(brand.id).catch(() => false),
  ])

  return (
    <LeadAgentPage
      initial={data ?? leadFallback(b)()}
      flags={{ dataforseo: searchDataReady(), hunter: hunterConfigured(), hunterOut, gmail: !!gmail, demo: agentsDemo(), demoForced: demoForced() }}
    />
  )
}
