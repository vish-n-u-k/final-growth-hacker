import { redirect } from 'next/navigation'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandBlogs } from '@/lib/db/schema'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import { blogMarkdownUrl } from '@/lib/blog-share'
import { loadBrandContext } from '@/lib/agents/context'
import { searchDataReady } from '@/lib/agents/dataforseo'
import { agentsDemo } from '@/lib/agents/demo'
import { readGoogleAdsCreds } from '@/lib/agents/google-ads'
import { searchFallback } from '@/lib/agents/search-agent'
import { readSearchData } from '@/lib/agents/store'
import SearchAgentPage from '@/components/agents/SearchAgentPage'

export const dynamic = 'force-dynamic'

export default async function SearchAgent() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')
  const b = await loadBrandContext(brand.id)
  if (!b) redirect('/onboarding')

  const data = (await readSearchData(brand.id).catch(() => null)) ?? searchFallback(b)()
  const ids = data.topics.map(t => t.blogId).filter((x): x is string => !!x)
  const [blogs, ads] = await Promise.all([
    ids.length
      ? db.select({ id: brandBlogs.id, title: brandBlogs.title, content: brandBlogs.content, metaDescription: brandBlogs.metaDescription })
        .from(brandBlogs).where(and(eq(brandBlogs.brandId, brand.id), inArray(brandBlogs.id, ids)))
      : Promise.resolve([]),
    readGoogleAdsCreds(brand.id).catch(() => null),
  ])
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.growjin.com'

  return (
    <SearchAgentPage
      initial={data}
      brandName={b.name}
      flags={{ dataforseo: searchDataReady(), googleAds: !!ads, demo: agentsDemo() }}
      drafts={blogs.map(x => ({ ...x, mdUrl: blogMarkdownUrl(appUrl, x.id) }))}
    />
  )
}
