import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import { loadBrandContext } from '@/lib/agents/context'
import { dataForSeoConfigured, searchDataReady } from '@/lib/agents/dataforseo'
import { agentsDemo, demoForced, withDemo } from '@/lib/agents/demo'
import { hunterConfigured } from '@/lib/agents/hunter'
import { leadFallback } from '@/lib/agents/lead-agent'
import { hunterOutThisMonth, readDemoSwitch, readLeadData } from '@/lib/agents/store'
import { listScans, loadScanReviews } from '@/lib/lead-finder/saved'
import LeadFinderHub, { type RivalScan } from '@/components/leads/LeadFinderHub'

export const dynamic = 'force-dynamic'

// Lead Finder: the Lead Agent (Google Maps, Reddit, Hacker News, your own lists) and Competitor
// Leads (unhappy reviewers) on one board. Both keep their own data and API; this page reads both.
// Shown with the brand's demo-mode switch applied (lib/agents/demo.ts), which covers the Lead Agent part.
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

  const [data, [gmail], scans, hunterOut] = await Promise.all([
    readLeadData(brandId).catch(() => null),
    db.select({ id: brandIntegrations.id }).from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'gmail'), eq(brandIntegrations.status, 'connected')))
      .limit(1),
    listScans(brandId).catch(() => []),
    hunterOutThisMonth(brandId).catch(() => false),
  ])
  // Every saved scan with its reviews (newest first), so people already emailed or skipped in an
  // earlier read of the same competitor stay that way
  const rivals: RivalScan[] = await Promise.all(scans.slice(0, 12).map(async scan => ({ scan, reviews: await loadScanReviews(brandId, scan.id).catch(() => []) })))

  return (
    <LeadFinderHub
      initial={data ?? leadFallback(b)()}
      scans={rivals}
      brandName={b.name}
      competitors={b.competitors.map(c => c.domain).filter(Boolean).slice(0, 4)}
      flags={{ linkedin: !!process.env.APIFY_API_TOKEN?.trim(), dataforseo: searchDataReady(), trustpilot: dataForSeoConfigured(), hunter: hunterConfigured(), hunterOut, gmail: !!gmail, demo: agentsDemo(), demoForced: demoForced() }}
    />
  )
}
