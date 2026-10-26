// DataForSEO client for the AI Agents (keyword ideas, Google results, site rankings, Maps
// businesses, AI answers and backlinks). Uses GrowJin's own account: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.
// Every call adds its cost (USD, from the response) to the run's meter.

import type { UsageMeter } from './store'
import { agentsDemo, demoAiAnswer, demoGoogleResults, demoKeywordIdeas, demoLinkingSites, demoMapsBusinesses, demoRankedKeywords, demoReferringDomains } from './demo'

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
  if (path.includes('/dataforseo_labs/')) return 'Keyword ideas'
  if (path.includes('/backlinks/')) return 'Backlinks'
  if (path.includes('/trustpilot/')) return 'Trustpilot reviews'
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

async function post<T>(path: string, task: Record<string, unknown>, meter?: UsageMeter, timeoutMs = 60_000): Promise<T> {
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
    throw new Error(`DataForSEO ${res.status}${why ? `: ${why}` : ''} (${path.split('/').slice(-2).join('/')})`)
  }
  const json = await res.json() as DfsResponse<T>
  if (json.status_code !== 20000) {
    console.error(`[dataforseo] ${path} → ${json.status_code}: ${json.status_message}`)
    throw new Error(`DataForSEO: ${json.status_message ?? json.status_code}`)
  }
  const t = json.tasks?.[0]
  charge(meter, path, t?.cost)
  if (!t || t.status_code !== 20000) {
    console.error(`[dataforseo] ${path} → task ${t?.status_code}: ${t?.status_message}`)
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
    difficulty: i.keyword_properties?.keyword_difficulty ?? null,
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
    if (!opts.recent) throw e
    delete task.search_param
    r = await post<{ items?: Item[] | null }>('/serp/google/organic/live/advanced', task, meter)
  }
  return (r.items ?? [])
    .filter(i => i.type === 'organic' && i.url)
    .map(i => ({ rank: i.rank_group ?? 0, url: i.url!, domain: i.domain ?? '', title: i.title ?? '', description: i.description ?? '' }))
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
