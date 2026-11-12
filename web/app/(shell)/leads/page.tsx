import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import { loadBrandContext } from '@/lib/agents/context'
import { searchDataReady } from '@/lib/agents/dataforseo'
import { agentsDemo, demoForced, withDemo } from '@/lib/agents/demo'
import { hunterConfigured } from '@/lib/agents/hunter'
import { leadFallback, quietSocialOf } from '@/lib/agents/lead-agent'
import { hunterOutThisMonth, readDemoSwitch, readLeadData } from '@/lib/agents/store'
import LeadFinderPage from '@/components/leads/LeadFinderPage'

export const dynamic = 'force-dynamic'

// Lead Finder: every source (websites, Google Maps, LinkedIn people, competitors' unhappy reviewers,
// Reddit and Hacker News) goes through the Lead Agent's one funnel, so every lead is checked, filled in
// and contacted the same way. Two tabs: "Contact directly" and "Join conversations". Same data as the
// Lead Agent; the page is components/leads/LeadFinderPage.tsx.
// Shown with the brand's demo-mode switch applied (lib/agents/demo.ts).
export default async function LeadsRoute() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')
  return withDemo(await readDemoSwitch(brand.id), () => Leads(brand.id))
}

async function Leads(brandId: string) {
  const b = await loadBrandContext(brandId)
  if (!b) redirect('/onboarding')

  const [data, [gmail], hunterOut] = await Promise.all([
    readLeadData(brandId).catch(() => null),
    db.select({ id: brandIntegrations.id }).from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'gmail'), eq(brandIntegrations.status, 'connected')))
      .limit(1),
    hunterOutThisMonth(brandId).catch(() => false),
  ])
  const initial = data ?? leadFallback(b)()

  return (
    <LeadFinderPage
      initial={initial}
      competitors={b.competitors.map(c => c.domain).filter(Boolean).slice(0, 4)}
      flags={{
        dataforseo: searchDataReady(), hunter: hunterConfigured(), hunterOut, gmail: !!gmail, demo: agentsDemo(), demoForced: demoForced(),
        linkedin: !!process.env.APIFY_API_TOKEN?.trim(), quietSocial: quietSocialOf(b, initial.settings),
      }}
    />
  )
}
