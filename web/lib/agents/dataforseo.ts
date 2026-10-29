// DataForSEO client for the AI Agents (keyword ideas, Google results, site rankings, Maps
// businesses, AI answers and backlinks). Uses GrowJin's own account: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.
// Every call adds its cost (USD, from the response) to the run's meter.

import type { UsageMeter } from './store'
import { agentsDemo, demoSimilarSites, demoSiteVisits, demoStores, demoAiAnswer, demoGoogleResults, demoKeywordIdeas, demoLinkingSites, demoMapsBusinesses, demoRankedKeywords, demoReferringDomains } from './demo'

const BASE = 'https://api.dataforseo.com/v3'

export function dataForSeoConfigured(): boolean {
  return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD)
}

/** Search data is available: the real account, or demo mode (made-up data, see demo.ts). */
export function searchDataReady(): boolean {
  return agentsDemo() || dataForSeoConfigured()
}

// Google location codes for the countries an agent can target
export const LOCATION_CODES: Record<string, number> = {
  US: 2840, IN: 2356, GB: 2826, CA: 2124, AU: 2036, DE: 2276, FR: 2250, AE: 2784, SG: 2702,
}
export const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', IN: 'India', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', AE: 'United Arab Emirates', SG: 'Singapore',
}
const locationOf = (country: string) => LOCATION_CODES[country] ?? LOCATION_CODES.US

// The name each API gets in Settings → Usage
function apiLabel(path: string): string {
  if (path.includes('/serp/google/maps/')) return 'Google Maps businesses'
  if (path.includes('/serp/google/organic/')) return 'Google results'
  if (path.includes('/ranked_keywords/')) return 'Site rankings'
  if (path.includes('/competitors_domain/')) return 'Similar sites'
  if (path.includes('/bulk_traffic_estimation/')) return 'Site size (visits)'
  if (path.includes('/dataforseo_labs/')) return 'Keyword ideas'
  if (path.includes('/backlinks/')) return 'Backlinks'
  if (path.includes('/trustpilot/')) return 'Trustpilot reviews'
  if (path.includes('/technologies/')) return 'Online stores (by platform)'
  const engine = path.match(/\/ai_optimization\/([a-z_]+)\//)?.[1] as AiEngine | undefined
  if (engine) return `AI answers · ${ENGINE_LABEL[engine] ?? engine}`
  return 'Other'
}

function charge(meter: UsageMeter | undefined, path: string, cost: number | undefined) {
  if (!meter || !cost) return
  meter.dataforseo += cost
  const api = apiLabel(path)
  meter.apis[api] = (meter.apis[api] ?? 0) + cost
}

interface DfsTask<T> { status_code?: number; status_message?: string; cost?: number; result?: T[] | null }
interface DfsResponse<T> { status_code?: number; status_message?: string; tasks?: DfsTask<T>[] }

/**
 * DataForSEO's 5xxxx codes, and 40101 "Internal SE Server Error" (Google didn't give DataForSEO a
 * page for that search, often for operator-heavy or very narrow searches): a hiccup, worth one retry.
 */
export class DfsBusyError extends Error {}
const busy = (code: number | undefined) => typeof code === 'number' && (code >= 50000 || code === 40101)
/** 40102 "No Search Results": Google had nothing for that search. Not an error for the caller. */
export class DfsNoResults extends Error {}

async function post<T>(path: string, task: Record<string, unknown>, meter?: UsageMeter, timeoutMs = 60_000): Promise<T> {
  try {
    return await postOnce<T>(path, task, meter, timeoutMs)
  } catch (e) {
    if (!(e instanceof DfsBusyError)) throw e
    // Failed tasks aren't charged, so one retry after a short pause costs nothing extra
    await new Promise(r => setTimeout(r, 2500))
    return postOnce<T>(path, task, meter, timeoutMs)
  }
}

async function postOnce<T>(path: string, task: Record<string, unknown>, meter?: UsageMeter, timeoutMs = 60_000): Promise<T> {
  if (!dataForSeoConfigured()) throw new Error('DataForSEO is not set up (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).')
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64')
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([task]),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    // Keep DataForSEO's own explanation: a bare "500" can't be acted on
    const body = await res.text().catch(() => '')
    let why = ''
    try { const j = JSON.parse(body) as DfsResponse<T>; why = j.tasks?.[0]?.status_message ?? j.status_message ?? '' } catch { why = body.slice(0, 200) }
    console.error(`[dataforseo] ${path} → HTTP ${res.status}${why ? `: ${why}` : ''}`)
    if (res.status >= 500) throw new DfsBusyError(`DataForSEO ${res.status}${why ? `: ${why}` : ''} (${path.split('/').slice(-2).join('/')})`)
    throw new Error(`DataForSEO ${res.status}${why ? `: ${why}` : ''} (${path.split('/').slice(-2).join('/')})`)
  }
  const json = await res.json() as DfsResponse<T>
  if (json.status_code !== 20000) {
    console.error(`[dataforseo] ${path} → ${json.status_code}: ${json.status_message}`)
    if (busy(json.status_code)) throw new DfsBusyError(`DataForSEO: ${json.status_message ?? json.status_code}`)
    throw new Error(`DataForSEO: ${json.status_message ?? json.status_code}`)
  }
  const t = json.tasks?.[0]
  charge(meter, path, t?.cost)
  if (!t || t.status_code !== 20000) {
    console.error(`[dataforseo] ${path} → task ${t?.status_code}: ${t?.status_message}`)
    if (busy(t?.status_code)) throw new DfsBusyError(`DataForSEO: ${t?.status_message ?? 'no result'}`)
    if (t?.status_code === 40102) throw new DfsNoResults(`DataForSEO: ${t.status_message ?? 'no search results'}`)
    throw new Error(`DataForSEO: ${t?.status_message ?? 'no result'}`)
  }
  const result = t.result?.[0]
  if (!result) throw new Error('DataForSEO: empty result')
  return result
}

// ── Keyword ideas ─────────────────────────────────────────────────────────────

export interface KeywordIdea { keyword: string; volume: number; cpc: number | null; difficulty: number | null; intent: string | null }

type IdeaItem = {
  keyword?: string
  keyword_info?: { search_volume?: number | null; cpc?: number | null }
  keyword_properties?: { keyword_difficulty?: number | null }
  search_intent_info?: { main_intent?: string | null }
}

const toIdeas = (items: IdeaItem[]): KeywordIdea[] => items
  .filter(i => i.keyword && (i.keyword_info?.search_volume ?? 0) >= 30)
  .map(i => ({
    keyword: i.keyword!,
    volume: i.keyword_info?.search_volume ?? 0,
    cpc: i.keyword_info?.cpc ?? null,
    // 0 means Labs has no data for it, not that it's easy
    difficulty: i.keyword_properties?.keyword_difficulty || null,
    intent: i.search_intent_info?.main_intent ?? null,
  }))

/**
 * Keyword ideas around the seeds, biggest first. Asks Labs keyword_ideas with the plainest request
 * (volume filter and sorting are done here); if DataForSEO fails on it (it has returned
 * "500 Internal Error" for some accounts), falls back to keyword_suggestions for up to 3 seeds.
 */
export async function keywordIdeas(seeds: string[], country: string, meter?: UsageMeter, limit = 200): Promise<KeywordIdea[]> {
  if (!seeds.length) return []
  if (agentsDemo()) return demoKeywordIdeas(seeds).slice(0, limit)
  const base = { location_code: locationOf(country), language_code: 'en' }
  let ideas: KeywordIdea[]
  try {
    const r = await post<{ items?: IdeaItem[] | null }>('/dataforseo_labs/google/keyword_ideas/live', {
      ...base, keywords: seeds.slice(0, 20).map(s => s.toLowerCase()), limit,
    }, meter)
    ideas = toIdeas(r.items ?? [])
  } catch (e) {
    console.error(`[dataforseo] keyword_ideas failed, trying keyword_suggestions: ${e instanceof Error ? e.message : e}`)
    const settled = await Promise.allSettled(seeds.slice(0, 3).map(seed =>
      post<{ items?: IdeaItem[] | null }>('/dataforseo_labs/google/keyword_suggestions/live', {
        ...base, keyword: seed.toLowerCase(), limit: 70,
      }, meter)))
    const ok = settled.filter((x): x is PromiseFulfilledResult<{ items?: IdeaItem[] | null }> => x.status === 'fulfilled')
    // Both ways failed: report the first error, it is the useful one
    if (!ok.length) throw e
    const seen = new Set<string>()
    ideas = toIdeas(ok.flatMap(x => x.value.items ?? [])).filter(i => !seen.has(i.keyword) && !!seen.add(i.keyword))
  }
  return ideas.sort((x, y) => y.volume - x.volume).slice(0, limit)
}

// ── Where the site ranks ──────────────────────────────────────────────────────

export interface RankedKeyword { keyword: string; volume: number; rank: number; url: string }

export async function rankedKeywords(domain: string, country: string, meter?: UsageMeter, limit = 200): Promise<RankedKeyword[]> {
  if (agentsDemo()) return demoRankedKeywords(domain).slice(0, limit)
  type Item = {
    keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number | null } }
    ranked_serp_element?: { serp_item?: { rank_absolute?: number; url?: string } }
  }
  const r = await post<{ items?: Item[] | null }>('/dataforseo_labs/google/ranked_keywords/live', {
    target: domain.replace(/^www\./, ''),
    location_code: locationOf(country),
    language_code: 'en',
    limit,
    order_by: ['keyword_data.keyword_info.search_volume,desc'],
  }, meter)
  return (r.items ?? [])
    .filter(i => i.keyword_data?.keyword && i.ranked_serp_element?.serp_item?.rank_absolute)
    .map(i => ({
      keyword: i.keyword_data!.keyword!,
      volume: i.keyword_data?.keyword_info?.search_volume ?? 0,
      rank: i.ranked_serp_element!.serp_item!.rank_absolute!,
      url: i.ranked_serp_element?.serp_item?.url ?? '',
    }))
}

// ── Google results for one search ─────────────────────────────────────────────

export interface SerpResult { rank: number; url: string; domain: string; title: string; description: string }

export async function googleResults(keyword: string, country: string, meter?: UsageMeter, opts: { depth?: number; recent?: boolean } = {}): Promise<SerpResult[]> {
  if (agentsDemo()) return demoGoogleResults(keyword)
  type Item = { type?: string; rank_group?: number; url?: string; domain?: string; title?: string; description?: string }
  const task: Record<string, unknown> = { keyword, location_code: locationOf(country), language_code: 'en', depth: opts.depth ?? 10 }
  // Past month only (Google's own date filter); some setups reject it, so retry without
  if (opts.recent) task.search_param = 'tbs=qdr:m'
  let r: { items?: Item[] | null }
  try {
    r = await post<{ items?: Item[] | null }>('/serp/google/organic/live/advanced', task, meter)
  } catch (e) {
    if (e instanceof DfsNoResults && !opts.recent) return []
    if (!opts.recent) throw e
    delete task.search_param
    r = await post<{ items?: Item[] | null }>('/serp/google/organic/live/advanced', task, meter).catch(e2 => {
      if (e2 instanceof DfsNoResults) return { items: [] }
      throw e2
    })
  }
  return (r.items ?? [])
    .filter(i => i.type === 'organic' && i.url)
    .map(i => ({ rank: i.rank_group ?? 0, url: i.url!, domain: i.domain ?? '', title: i.title ?? '', description: i.description ?? '' }))
}

// ── Online stores by the platform they run on ────────────────────────────────

export interface PlatformSite { domain: string; title: string; description: string; emails: string[]; socials: string[]; rank: number | null }

/**
 * Websites that run one of these platforms (Shopify, WooCommerce…), from DataForSEO's technology
 * index, optionally only those whose title or description has one of `keywords` (what they sell).
 * Smaller sites only (low domain rank), a different page each day so new ones come up.
 * Platform names are matched partly (`mode: entry`), as DataForSEO's own names can differ in case
 * or wording. With keywords and nothing found, it tries again without them, so the log shows
 * whether the platform names or the keywords were the problem.
 */
export async function storesByPlatform(platforms: string[], country: string, meter?: UsageMeter, opts: { limit?: number; offset?: number; keywords?: string[] } = {}): Promise<PlatformSite[]> {
  if (!platforms.length && !opts.keywords?.length) return []
  if (agentsDemo()) return demoStores(platforms.length ? platforms : ['site'])
  type Item = { domain?: string; title?: string | null; description?: string | null; emails?: string[] | null; social_graph_urls?: string[] | null; domain_rank?: number | null }
  // Single words only: DataForSEO matches them in a site's title or description
  const keywords = [...new Set((opts.keywords ?? []).flatMap(k => k.trim().toLowerCase().split(/\s+/)).filter(w => w.length > 2))].slice(0, 10)
  const ask = async (withKeywords: boolean, offset: number) => {
    const task: Record<string, unknown> = {
      mode: 'entry',
      order_by: ['last_visited,desc'],
      limit: opts.limit ?? 50,
      offset,
    }
    // No rank filter: most small shops have no domain rank at all, and "rank < 300" left them out.
    // Big sites are dropped below instead.
    if (country !== 'ANY') task.filters = ['country_iso_code', '=', country.toUpperCase()]
    if (platforms.length) task.technologies = platforms.slice(0, 3)
    if (withKeywords && keywords.length) task.keywords = keywords
    const r = await post<{ items?: Item[] | null; total_count?: number | null }>('/domain_analytics/technologies/domains_by_technology/live', task, meter)
    console.log(`[dataforseo] stores ${platforms.join('/')} · ${country}${withKeywords && keywords.length ? ` · keywords ${keywords.join(', ')}` : ''} · offset ${offset}: ${r.items?.length ?? 0} back of ${r.total_count ?? '?'}`)
    return r
  }
  // The day's page, or (past the end of the results) the same place counted from the top
  const page = async (withKeywords: boolean) => {
    const offset = opts.offset ?? 0
    const r = await ask(withKeywords, offset)
    const total = r.total_count ?? 0
    if (!r.items?.length && offset > 0 && total > 0) {
      const limit = opts.limit ?? 50
      return ask(withKeywords, Math.floor((offset % total) / limit) * limit)
    }
    return r
  }
  let r = await page(true)
  // Nothing with the keywords: try the platforms alone, so stores still come up (the trade check and scorer judge them)
  if (!r.items?.length && keywords.length && platforms.length) r = await page(false)
  return (r.items ?? [])
    // Big, well-linked sites aren't small shops (rank runs 0-1000; most small shops have none)
    .filter(i => i.domain && (i.domain_rank ?? 0) < 400)
    .map(i => ({
      domain: i.domain!.replace(/^www\./, '').toLowerCase(),
      title: (i.title ?? '').trim(),
      description: (i.description ?? '').trim(),
      emails: (i.emails ?? []).filter(e => typeof e === 'string' && e.includes('@')).map(e => e.toLowerCase()),
      socials: (i.social_graph_urls ?? []).filter(u => typeof u === 'string'),
      rank: i.domain_rank ?? null,
    }))
}

// ── Sites like a given site ───────────────────────────────────────────────────

export interface SimilarSite { domain: string; shared: number; visits: number | null }

/**
 * Sites that show up on Google for the same searches as `domain` (Labs competitors_domain), most
 * shared searches first. Used for "more like this customer": a candle shop's neighbours are mostly
 * other candle shops. Big sites (Amazon, Etsy…) are left out by DataForSEO; `offset` pages on.
 */
export async function similarSites(domain: string, country: string, meter?: UsageMeter, opts: { limit?: number; offset?: number } = {}): Promise<SimilarSite[]> {
  if (agentsDemo()) return demoSimilarSites(domain)
  type Item = { domain?: string; intersections?: number | null; full_domain_metrics?: { organic?: { etv?: number | null } | null } | null }
  const r = await post<{ items?: Item[] | null; total_count?: number | null }>('/dataforseo_labs/google/competitors_domain/live', {
    target: domain.replace(/^www\./, ''),
    location_code: locationOf(country),
    language_code: 'en',
    exclude_top_domains: true,
    order_by: ['intersections,desc'],
    limit: opts.limit ?? 30,
    offset: opts.offset ?? 0,
  }, meter)
  console.log(`[dataforseo] sites like ${domain} · offset ${opts.offset ?? 0}: ${r.items?.length ?? 0} back of ${r.total_count ?? '?'}`)
  return (r.items ?? [])
    .filter(i => i.domain && i.domain !== domain)
    .map(i => ({ domain: i.domain!.replace(/^www\./, '').toLowerCase(), shared: i.intersections ?? 0, visits: i.full_domain_metrics?.organic?.etv ?? null }))
}

/**
 * Estimated monthly visits from Google for each site (Labs bulk_traffic_estimation, one call for up
 * to 1,000 sites). A site missing from the answer is too small for DataForSEO to measure: 0.
 */
export async function siteVisits(domains: string[], country: string, meter?: UsageMeter): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!domains.length) return out
  if (agentsDemo()) return demoSiteVisits(domains)
  type Item = { target?: string; metrics?: { organic?: { etv?: number | null } | null } | null }
  const r = await post<{ items?: Item[] | null }>('/dataforseo_labs/google/bulk_traffic_estimation/live', {
    targets: domains.slice(0, 1000),
    location_code: locationOf(country),
    language_code: 'en',
    item_types: ['organic'],
  }, meter)
  for (const d of domains) out.set(d, 0)
  for (const i of r.items ?? []) if (i.target) out.set(i.target.replace(/^www\./, '').toLowerCase(), Math.round(i.metrics?.organic?.etv ?? 0))
  return out
}

// ── Google's AI Overview ───────────────────────────────────────────────────────

/**
 * The AI Overview Google shows on top of the results for a search, with the pages it cites, or
 * null when Google shows none. `load_async_ai_overview` costs $0.002 more, refunded when there's none.
 */
export async function googleAiOverview(keyword: string, country: string, meter?: UsageMeter): Promise<AiAnswerRaw | null> {
  if (agentsDemo()) return null
  type Ref = { url?: string; title?: string; source?: string }
  type El = { text?: string | null; markdown?: string | null; references?: Ref[] | null }
  type Item = { type?: string; markdown?: string | null; items?: El[] | null; references?: Ref[] | null }
  const r = await post<{ items?: Item[] | null }>('/serp/google/organic/live/advanced', {
    keyword, location_code: locationOf(country), language_code: 'en', depth: 10, load_async_ai_overview: true,
  }, meter)
  const o = (r.items ?? []).find(i => i.type === 'ai_overview')
  if (!o) return null
  const text = (o.markdown || (o.items ?? []).map(e => e.markdown || e.text || '').join('\n')).trim()
  const seen = new Set<string>()
  const citations: AiAnswerRaw['citations'] = []
  for (const ref of [...(o.references ?? []), ...(o.items ?? []).flatMap(e => e.references ?? [])]) {
    if (!ref.url || seen.has(ref.url)) continue
    seen.add(ref.url)
    citations.push({ url: ref.url, title: ref.title ?? ref.source ?? '' })
  }
  return text ? { text, citations } : null
}

// ── Local businesses on Google Maps ───────────────────────────────────────────

export interface MapsBusiness { title: string; url: string | null; domain: string | null; phone: string | null; rating: number | null; reviews: number | null; category: string | null; address: string | null; mapsUrl: string | null }

export async function mapsBusinesses(query: string, country: string, meter?: UsageMeter, depth = 40): Promise<MapsBusiness[]> {
  if (agentsDemo()) return demoMapsBusinesses(query)
  type Item = {
    type?: string; title?: string; url?: string | null; domain?: string | null; phone?: string | null
    rating?: { value?: number | null; votes_count?: number | null } | null
    category?: string | null; address?: string | null; check_url?: string | null; cid?: string | null
  }
  const r = await post<{ items?: Item[] | null }>('/serp/google/maps/live/advanced', {
    keyword: query, location_code: locationOf(country), language_code: 'en', depth,
  }, meter)
  return (r.items ?? [])
    .filter(i => i.type === 'maps_search' && i.title)
    .map(i => ({
      title: i.title!,
      url: i.url ?? null,
      domain: i.domain ?? null,
      phone: i.phone ?? null,
      rating: i.rating?.value ?? null,
      reviews: i.rating?.votes_count ?? null,
      category: i.category ?? null,
      address: i.address ?? null,
      mapsUrl: i.cid ? `https://maps.google.com/?cid=${i.cid}` : (i.check_url ?? null),
    }))
}

// ── Backlinks (DataForSEO's Backlinks API, a separate subscription) ──────────

export interface LinkingSite { domain: string; url: string; title: string; rank: number | null; spam: number | null }

/** Sites that link to `target`, one example page each, strongest first. */
export async function linkingSites(target: string, meter?: UsageMeter, limit = 100): Promise<LinkingSite[]> {
  if (agentsDemo()) return demoLinkingSites(target).slice(0, limit)
  type Item = {
    domain_from?: string; url_from?: string; page_from_title?: string | null
    domain_from_rank?: number | null; backlink_spam_score?: number | null; is_lost?: boolean
  }
  const r = await post<{ items?: Item[] | null }>('/backlinks/backlinks/live', {
    target: target.replace(/^www\./, ''),
    mode: 'one_per_domain',
    limit,
    order_by: ['domain_from_rank,desc'],
    filters: ['dofollow', '=', true],
  }, meter)
  return (r.items ?? [])
    .filter(i => i.domain_from && i.url_from && !i.is_lost)
    .map(i => ({
      domain: i.domain_from!.replace(/^www\./, '').toLowerCase(),
      url: i.url_from!,
      title: i.page_from_title ?? '',
      rank: i.domain_from_rank ?? null,
      spam: i.backlink_spam_score ?? null,
    }))
}

/** Domains that already link to `target` (so they aren't suggested again). */
export async function referringDomains(target: string, meter?: UsageMeter, limit = 1000): Promise<string[]> {
  if (agentsDemo()) return demoReferringDomains(target)
  const r = await post<{ items?: { domain?: string }[] | null }>('/backlinks/referring_domains/live', {
    target: target.replace(/^www\./, ''),
    limit,
    order_by: ['rank,desc'],
  }, meter)
  return (r.items ?? []).map(i => (i.domain ?? '').replace(/^www\./, '').toLowerCase()).filter(Boolean)
}

// ── Trustpilot reviews (Business Data API; queued: post a task, then collect it) ──
// Trustpilot blocks direct reading from servers, so reviews come from here when DataForSEO is set up.

export interface TrustpilotReview { name: string; rating: number; text: string; date: string | null; url: string | null }

function dfsAuth(): string {
  if (!dataForSeoConfigured()) throw new Error('DataForSEO is not set up (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).')
  return `Basic ${Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64')}`
}

/** Starts a high-priority task (about a minute) for the newest `depth` reviews. Returns its id. */
export async function trustpilotReviewsTask(domain: string, meter?: UsageMeter, depth = 60): Promise<string> {
  const res = await fetch(`${BASE}/business_data/trustpilot/reviews/task_post`, {
    method: 'POST',
    headers: { Authorization: dfsAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify([{ domain: domain.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), depth, sort_by: 'recency', priority: 2 }]),
    signal: AbortSignal.timeout(30_000),
  })
  const j = await res.json().catch(() => null) as DfsResponse<unknown> & { tasks?: { id?: string; status_code?: number; status_message?: string; cost?: number }[] } | null
  const t = j?.tasks?.[0]
  if (!res.ok || !t?.id || (t.status_code !== 20100 && t.status_code !== 20000)) {
    const why = t?.status_message ?? j?.status_message ?? `HTTP ${res.status}`
    console.error(`[dataforseo] trustpilot task_post → ${why}`)
    throw new Error(`DataForSEO: ${why}`)
  }
  charge(meter, '/business_data/trustpilot/reviews/task_post', t.cost)
  return t.id
}

/** The task's reviews, or null while DataForSEO is still collecting them. */
export async function trustpilotReviewsResult(id: string): Promise<TrustpilotReview[] | null> {
  const res = await fetch(`${BASE}/business_data/trustpilot/reviews/task_get/${encodeURIComponent(id)}`, {
    headers: { Authorization: dfsAuth() },
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  })
  type Item = { rating?: { value?: number } | null; review_text?: string | null; title?: string | null; user_profile?: { name?: string } | null; timestamp?: string | null; url?: string | null }
  const j = await res.json().catch(() => null) as { status_code?: number; status_message?: string; tasks?: { status_code?: number; status_message?: string; result?: { items?: Item[] | null }[] | null }[] } | null
  const t = j?.tasks?.[0]
  // 40601 "Task Handed", 40602 "Task In Queue": not ready yet
  if (t?.status_code === 40601 || t?.status_code === 40602) return null
  if (!res.ok || t?.status_code !== 20000) {
    const why = t?.status_message ?? j?.status_message ?? `HTTP ${res.status}`
    console.error(`[dataforseo] trustpilot task_get → ${why}`)
    throw new Error(`DataForSEO: ${why}`)
  }
  return (t.result?.[0]?.items ?? [])
    .filter(i => (i.review_text ?? i.title ?? '').trim().length > 0)
    .map(i => ({
      name: i.user_profile?.name?.trim() || 'Trustpilot reviewer',
      rating: i.rating?.value ?? 0,
      text: [i.title, i.review_text].filter(Boolean).join('. ').slice(0, 400),
      date: i.timestamp ? i.timestamp.slice(0, 10) : null,
      url: i.url ?? null,
    }))
}

// ── AI answers (ChatGPT, Perplexity, Gemini) ──────────────────────────────────

export type AiEngine = 'chat_gpt' | 'perplexity' | 'gemini'
export const AI_ENGINES: AiEngine[] = ['chat_gpt', 'perplexity', 'gemini']
export const ENGINE_LABEL: Record<AiEngine, string> = { chat_gpt: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini' }
const ENGINE_MODEL: Record<AiEngine, string> = { chat_gpt: 'gpt-4.1-mini', perplexity: 'sonar', gemini: 'gemini-2.5-flash' }

export interface AiAnswerRaw { text: string; citations: { url: string; title: string }[] }

export async function aiAnswer(engine: AiEngine, prompt: string, meter?: UsageMeter): Promise<AiAnswerRaw> {
  if (agentsDemo()) return demoAiAnswer(engine, prompt)
  type Section = { type?: string; text?: string | null; annotations?: { url?: string; direct_url?: string; title?: string }[] | null }
  type Item = { type?: string; sections?: Section[] | null }
  const task: Record<string, unknown> = { user_prompt: prompt.slice(0, 500), model_name: ENGINE_MODEL[engine], max_output_tokens: 1024 }
  if (engine !== 'perplexity') task.web_search = true // Perplexity searches by default
  const r = await post<{ items?: Item[] | null }>(`/ai_optimization/${engine}/llm_responses/live`, task, meter, 110_000)
  const sections = (r.items ?? []).filter(i => i.type === 'message').flatMap(i => i.sections ?? [])
  const text = sections.map(s => s.text ?? '').join('\n').trim()
  const seen = new Set<string>()
  const citations: AiAnswerRaw['citations'] = []
  for (const a of sections.flatMap(s => s.annotations ?? [])) {
    const url = a.direct_url || a.url
    if (!url || seen.has(url)) continue
    seen.add(url)
    citations.push({ url, title: a.title ?? '' })
  }
  return { text, citations }
}
