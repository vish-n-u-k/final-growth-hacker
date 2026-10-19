import { db } from '@/lib/db'
import { brands, competitors, modules } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'
import { fetchPage, readHomepage, type HomepageFacts } from '@/lib/modules/brand-audit/fetcher'
import { getSitemap, kindOf } from '@/lib/modules/content-audit/fetcher'
import type { BlockInfo } from '@/lib/audit/blocked'
import { storeCompetitors } from '@/lib/modules/competitor-registry'

// Competitor Analysis reads your homepage and up to 3 competitors' the same way (Brand Audit's
// homepage reader, plus the sitemap for articles), so every check compares like with like.
//
// Competitors, in order: this module's setup → competitors saved by other modules → GEO's list →
// a short AI suggestion, kept only if the sites load. Suggestions are saved into this module's
// setup (marked as suggested) so later runs compare against the same sites, and the user can
// change them from the page.

export type CompetitorSource = 'setup' | 'saved' | 'suggested'

export interface SiteProfile {
  url: string
  name: string
  source: CompetitorSource | 'you'
  loaded: boolean
  blocked: BlockInfo | null
  facts: HomepageFacts | null       // null when the homepage couldn't be read
  postsFound: number                // articles in the sitemap
  postsLast90Days: number | null    // null = the sitemap has no dates
  comparisonPages: string[]         // /vs-…, /…-alternative(s), /compare… URLs
}

export interface CompetitorAnalysisFetchResult {
  websiteUrl: string
  brandName: string
  websiteType: string
  industry: string | null
  targetAudience: string | null
  usp: string | null
  you: SiteProfile
  competitors: SiteProfile[]        // the ones that loaded (up to 3)
  unreachable: string[]             // listed but couldn't be read (blocked, down, JavaScript-only)
  suggested: boolean                // the list is GrowJin's suggestion, not the user's
}

const MAX = 3
const COMPARISON = /\/(vs|versus|compare|comparison)(\/|-|$)|-vs-|\/[^/]*-alternatives?(\/|$)|\/alternatives?(\/|-|$)/i

function normalise(raw: string): string | null {
  const t = raw.trim().replace(/^["']|["']$/g, '')
  if (!t) return null
  try {
    const u = new URL(t.startsWith('http') ? t : `https://${t}`)
    return u.hostname.includes('.') ? u.origin : null
  } catch { return null }
}
export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
const split = (v: string | undefined) => (v ?? '').split(/[,\n]/)

async function suggestCompetitors(websiteUrl: string, brandName: string, brainCtx?: string): Promise<string[]> {
  try {
    const raw = await callAI({
      system: 'You name real, currently operating direct competitors of a business. Reply with JSON only.',
      prompt: `Business: ${brandName || websiteUrl} (${websiteUrl})
${brainCtx ? `Context:\n${brainCtx.slice(0, 1500)}\n` : ''}
List up to 5 direct competitors that sell a similar product to the same customers. Only well-known companies you are confident exist; no marketplaces or review sites.
Return a JSON array of homepage URLs, e.g. ["https://example.com"]. Return [] if unsure.`,
      maxTokens: 300,
      model: 'claude-haiku-4-5-20251001',
    })
    return (JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)) as unknown[]).map(String)
  } catch {
    return []
  }
}

/** One site: its homepage (as Brand Audit reads it) and its sitemap's articles and comparison pages. */
export async function profileSite(url: string, name: string, source: SiteProfile['source']): Promise<SiteProfile> {
  const [home, sitemap] = await Promise.all([fetchPage(url), getSitemap(new URL(url).origin).catch(() => new Map<string, string | null>())])
  const facts = home.html ? readHomepage(home.html, url) : null
  const urls = [...sitemap.keys()]
  const posts = urls.filter(u => kindOf(u, url) === 'post')
  const dates = posts.map(u => sitemap.get(u)).filter((d): d is string => !!d)
  return {
    url, name, source,
    loaded: !!facts && !facts.jsShell,
    blocked: home.block,
    facts,
    postsFound: posts.length,
    postsLast90Days: dates.length ? dates.filter(d => Date.now() - Date.parse(d) <= 90 * 86_400_000).length : null,
    comparisonPages: urls.filter(u => { try { return COMPARISON.test(new URL(u).pathname) } catch { return false } }).slice(0, 10),
  }
}

export async function fetchCompetitorAnalysisData(requirements: Record<string, string>, userWebsiteUrl?: string, brainCtx?: string): Promise<CompetitorAnalysisFetchResult> {
  const brandId = requirements['brand_id'] ?? ''
  const raw = (userWebsiteUrl ?? requirements['website_url'] ?? '').trim()
  const websiteUrl = raw.startsWith('http') ? raw : `https://${raw}`
  const ownHost = hostOf(websiteUrl)
  const pick = (list: string[]) => [...new Set(list.map(normalise).filter((u): u is string => !!u && hostOf(u) !== ownHost))]

  const [brand] = brandId
    ? await db.select({ name: brands.name, industry: brands.industry, targetAudience: brands.targetAudience, usp: brands.usp, websiteType: brands.websiteType })
        .from(brands).where(eq(brands.id, brandId)).limit(1)
    : []
  const saved = brandId ? await db.select({ url: competitors.url, name: competitors.name }).from(competitors).where(eq(competitors.brandId, brandId)).catch(() => []) : []
  const nameOf = (u: string) => saved.find(s => hostOf(s.url) === hostOf(u))?.name || hostOf(u)

  // Where the list comes from
  let source: CompetitorSource = 'setup'
  let urls = pick(split(requirements['competitor_urls']))
  const sameAsSuggested = urls.length > 0 && urls.map(hostOf).sort().join(',') === pick(split(requirements['competitor_urls_suggested'])).map(hostOf).sort().join(',')
  if (sameAsSuggested) source = 'suggested'
  if (urls.length === 0) { urls = pick(saved.map(s => s.url)); source = 'saved' }
  if (urls.length === 0 && brandId) {
    const [geo] = await db.select({ requirements: modules.requirements }).from(modules).where(and(eq(modules.brandId, brandId), eq(modules.type, 'geo'))).limit(1).catch(() => [])
    const geoReq = (geo?.requirements as Record<string, string> | null) ?? {}
    urls = pick(split(geoReq.competitor_urls))
    source = urls.length && geoReq.competitor_urls !== geoReq.competitor_urls_suggested ? 'saved' : 'suggested'
  }
  if (urls.length === 0) { urls = pick(await suggestCompetitors(websiteUrl, brand?.name ?? requirements['brand_name'] ?? '', brainCtx)); source = 'suggested' }

  // Read you and the competitors; keep the first 3 competitors that load
  const [you, ...candidates] = await Promise.all([
    profileSite(websiteUrl, brand?.name || requirements['brand_name'] || hostOf(websiteUrl), 'you'),
    ...urls.slice(0, 6).map(u => profileSite(u, nameOf(u), source)),
  ])
  // A readable name: the saved one, else the start of the site's title ("Buffer: Social media…" → "Buffer")
  for (const c of candidates) {
    const fromTitle = c.facts?.title.split(/\s*[|:–—]\s*|\s+-\s+/)[0]?.trim()
    if (c.name === hostOf(c.url) && fromTitle && fromTitle.length <= 24) c.name = fromTitle
  }
  const loaded = candidates.filter(c => c.loaded).slice(0, MAX)
  const unreachable = candidates.filter(c => !c.loaded).map(c => c.url).slice(0, 5)

  // Competitors the user chose are saved for the other modules (GEO, Brand Audit) to use too
  if (source === 'setup' && loaded.length && brandId) {
    await storeCompetitors(brandId, loaded.map(c => ({ url: c.url, name: c.name, discoveredIn: 'competitor-analysis' }))).catch(() => {})
  }

  // Remember a suggested list, so the next run compares the same sites (and the page can show and change it)
  if (source === 'suggested' && loaded.length && brandId && !requirements['competitor_urls']) {
    const list = loaded.map(c => hostOf(c.url)).join(', ')
    const [ca] = await db.select({ id: modules.id, requirements: modules.requirements }).from(modules)
      .where(and(eq(modules.brandId, brandId), eq(modules.type, 'competitor-analysis'))).limit(1).catch(() => [])
    if (ca) {
      const req = (ca.requirements as Record<string, string> | null) ?? {}
      await db.update(modules).set({ requirements: { ...req, competitor_urls: list, competitor_urls_suggested: list } }).where(eq(modules.id, ca.id)).catch(() => {})
    }
  }

  return {
    websiteUrl,
    brandName: brand?.name || requirements['brand_name'] || '',
    websiteType: brand?.websiteType || requirements['website_type'] || 'saas',
    industry: brand?.industry || requirements['industry'] || null,
    targetAudience: brand?.targetAudience || requirements['target_audience'] || null,
    usp: brand?.usp || requirements['usp'] || null,
    you,
    competitors: loaded,
    unreachable,
    suggested: source === 'suggested',
  }
}
