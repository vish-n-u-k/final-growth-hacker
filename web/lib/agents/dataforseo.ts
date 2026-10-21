// DataForSEO client for the AI Agents (keyword ideas, Google results, site rankings, Maps
// businesses and AI answers). Uses GrowJin's own account: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.
// Every call adds its cost (USD, from the response) to the run's meter.

import type { UsageMeter } from './store'

const BASE = 'https://api.dataforseo.com/v3'

export function dataForSeoConfigured(): boolean {
  return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD)
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
  if (!res.ok) throw new Error(`DataForSEO ${res.status}`)
  const json = await res.json() as DfsResponse<T>
  if (json.status_code !== 20000) throw new Error(`DataForSEO: ${json.status_message ?? json.status_code}`)
  const t = json.tasks?.[0]
  if (meter) meter.dataforseo += t?.cost ?? 0
  if (!t || t.status_code !== 20000) throw new Error(`DataForSEO: ${t?.status_message ?? 'no result'}`)
  const result = t.result?.[0]
  if (!result) throw new Error('DataForSEO: empty result')
  return result
}

// ── Keyword ideas ─────────────────────────────────────────────────────────────

export interface KeywordIdea { keyword: string; volume: number; cpc: number | null; difficulty: number | null; intent: string | null }

export async function keywordIdeas(seeds: string[], country: string, meter?: UsageMeter, limit = 200): Promise<KeywordIdea[]> {
  if (!seeds.length) return []
  type Item = {
    keyword?: string
    keyword_info?: { search_volume?: number | null; cpc?: number | null }
    keyword_properties?: { keyword_difficulty?: number | null }
    search_intent_info?: { main_intent?: string | null }
  }
  const r = await post<{ items?: Item[] | null }>('/dataforseo_labs/google/keyword_ideas/live', {
    keywords: seeds.slice(0, 20).map(s => s.toLowerCase()),
    location_code: locationOf(country),
    language_code: 'en',
    limit,
    filters: [['keyword_info.search_volume', '>=', 30]],
    order_by: ['keyword_info.search_volume,desc'],
  }, meter)
  return (r.items ?? [])
    .filter(i => i.keyword)
    .map(i => ({
      keyword: i.keyword!,
      volume: i.keyword_info?.search_volume ?? 0,
      cpc: i.keyword_info?.cpc ?? null,
      difficulty: i.keyword_properties?.keyword_difficulty ?? null,
      intent: i.search_intent_info?.main_intent ?? null,
    }))
}

// ── Where the site ranks ──────────────────────────────────────────────────────

export interface RankedKeyword { keyword: string; volume: number; rank: number; url: string }

export async function rankedKeywords(domain: string, country: string, meter?: UsageMeter, limit = 200): Promise<RankedKeyword[]> {
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

export async function mapsBusinesses(query: string, country: string, meter?: UsageMeter): Promise<MapsBusiness[]> {
  type Item = {
    type?: string; title?: string; url?: string | null; domain?: string | null; phone?: string | null
    rating?: { value?: number | null; votes_count?: number | null } | null
    category?: string | null; address?: string | null; check_url?: string | null; cid?: string | null
  }
  const r = await post<{ items?: Item[] | null }>('/serp/google/maps/live/advanced', {
    keyword: query, location_code: locationOf(country), language_code: 'en', depth: 40,
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

// ── AI answers (ChatGPT, Perplexity, Gemini) ──────────────────────────────────

export type AiEngine = 'chat_gpt' | 'perplexity' | 'gemini'
export const AI_ENGINES: AiEngine[] = ['chat_gpt', 'perplexity', 'gemini']
export const ENGINE_LABEL: Record<AiEngine, string> = { chat_gpt: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini' }
const ENGINE_MODEL: Record<AiEngine, string> = { chat_gpt: 'gpt-4.1-mini', perplexity: 'sonar', gemini: 'gemini-2.5-flash' }

export interface AiAnswerRaw { text: string; citations: { url: string; title: string }[] }

export async function aiAnswer(engine: AiEngine, prompt: string, meter?: UsageMeter): Promise<AiAnswerRaw> {
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
