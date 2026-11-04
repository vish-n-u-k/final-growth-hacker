import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import { loadBrandContext } from '@/lib/agents/context'
import { LOCATION_CODES, searchDataReady } from '@/lib/agents/dataforseo'
import { agentsDemo, demoForced, withDemo } from '@/lib/agents/demo'
import { readDemoSwitch, readSearchData } from '@/lib/agents/store'
import { searchFallback, tidySearchData } from '@/lib/agents/search-agent'
import { readSiteChecks } from '@/lib/search-hub/site'
import SearchHubPage from '@/components/search-hub/SearchHubPage'

export const dynamic = 'force-dynamic'

// Search & AI: two tabs. SEO = the brand's homepage and main pages, the search each targets, where it
// ranks and what to change; GEO = whether AI assistants name the brand for buyer questions. Every change
// is a test with a know-by date. Reads and writes the Search Agent's data (/api/agents/search); the
// logic is lib/search-hub/model.ts (+ verdict.ts, pages.ts).
// Built from the approved preview design-previews/tools-cleanup/search-seo-geo.html.
export default async function SearchAiRoute() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')
  return withDemo(await readDemoSwitch(brand.id), () => SearchAi(brand.id))
}

async function SearchAi(brandId: string) {
  const b = await loadBrandContext(brandId)
  if (!b) redirect('/onboarding')
  const saved = await readSearchData(brandId).catch(() => null)
  const [data, site, [gsc]] = await Promise.all([
    saved ? tidySearchData(brandId, b, saved).catch(() => saved) : Promise.resolve(searchFallback(b)()),
    readSiteChecks(brandId).catch(() => ({ seo: null, geo: null, aiChecks: [] })),
    db.select({ id: brandIntegrations.id }).from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'gsc_api'), eq(brandIntegrations.status, 'connected')))
      .limit(1),
  ])
  return (
    <SearchHubPage
      initial={data}
      brandName={b.name}
      domain={b.domain}
      now={Date.now()}
      site={site}
      countries={Object.keys(LOCATION_CODES)}
      flags={{ gsc: !!gsc, dataforseo: searchDataReady(), demo: agentsDemo(), demoForced: demoForced() }}
    />
  )
}
