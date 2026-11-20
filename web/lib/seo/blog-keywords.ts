import * as cheerio from 'cheerio'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { trackedKeywords } from '@/lib/db/schema'
import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { loadBrandContext, domainOf } from '@/lib/agents/context'
import { readSearchData, defaultCountry, addUsage, newMeter, type UsageMeter, type SearchAgentData } from '@/lib/agents/store'
import { dfsRaw, locationOf, languageOf, dataForSeoConfigured } from '@/lib/agents/dataforseo'
import { brandMatcher, siteReach } from '@/lib/search-hub/model'
import { getSitemap } from '@/lib/modules/content-audit/fetcher'
import { gsc, ga4 } from '@/lib/mcp/tools/google_raw'
import { listWork } from '@/lib/mcp/tools/work_log'
import {
  anchorIn, bestPage, formatOf, groupKeywords, isQuestion, pathOf, placement, samePage, slugWords, tokens, trendOf,
  type Month, type PageFacts, type Trend,
} from './blog-keywords-pure'

// The blog_keywords tool: the owner's weekly blog keyword routine (discover → evaluate → plan →
// track) from DataForSEO, Search Console, GA4, the site's own pages and what GrowJin already knows
// (Search Agent research, tracked keywords, the work log). It only reads and suggests; it never
// changes the website. DataForSEO answers are kept 7 days; weekly reviews are saved for comparison.

const KEY = 'seo:blog-keywords'
const DAY = 86_400_000
const CACHE_DAYS = 7
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
type Json = Record<string, unknown>

interface Store {
  cache?: Record<string, { at: string; data: Json }>
  weeks?: { at: string; keywords: Record<string, { position: number | null; clicks: number; impressions: number }>; summary: Json }[]
}

async function readStore(brandId: string): Promise<Store> {
  return (await getSnapshot<Store>(brandId, KEY).catch(() => null)) ?? {}
}
async function writeStore(brandId: string, change: (s: Store) => void) {
  const s = await readStore(brandId)
  change(s)
  // Keep the newest 20 cached answers and 12 weeks
  const entries = Object.entries(s.cache ?? {}).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 20)
  s.cache = Object.fromEntries(entries)
  s.weeks = (s.weeks ?? []).slice(-12)
  await saveSnapshot(brandId, KEY, s).catch(() => {})
}
async function cached(brandId: string, key: string, fresh: boolean): Promise<Json | null> {
  if (fresh) return null
  const hit = (await readStore(brandId)).cache?.[key]
  return hit && Date.now() - Date.parse(hit.at) < CACHE_DAYS * DAY ? { ...hit.data, from_cache: `Saved ${hit.at.slice(0, 10)} (kept ${CACHE_DAYS} days; pass fresh: true to look again, which costs again).` } : null
}

// ── What GrowJin knows about the brand ────────────────────────────────────────

interface Ctx {
  brandId: string
  name: string
  site: string          // https://domain
  domain: string
  country: string
  competitors: string[] // domains
  search: SearchAgentData | null
  isBrand: (k: string) => boolean
}

async function context(brandId: string, country?: string): Promise<Ctx | { error: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { error: 'Brand not found.' }
  const search = await readSearchData(brandId).catch(() => null)
  const site = /^https?:\/\//.test(b.websiteUrl) ? b.websiteUrl.replace(/\/+$/, '') : `https://${b.domain}`
  return {
    brandId, name: b.name, site, domain: b.domain,
    country: (country ?? search?.settings.country ?? defaultCountry(b.websiteUrl)).toUpperCase(),
    competitors: b.competitors.map(c => c.domain).filter(Boolean),
    search,
    isBrand: brandMatcher({ name: b.name, domain: b.domain }),
  }
}

export interface Tracked { keyword: string; page: string | null; from: string[]; where?: string }

/** Keywords the owner is targeting: the work log (kind seo_keyword), Search & AI and the Keywords page. */
async function trackedList(ctx: Ctx): Promise<Tracked[]> {
  const map = new Map<string, Tracked>()
  const add = (keyword: string, page: string | null, from: string, where?: string) => {
    const k = keyword.toLowerCase().trim()
    if (!k || k.length > 120) return
    const t = map.get(k) ?? { keyword: k, page: null, from: [] }
    if (page && !t.page) t.page = page.split('#')[0]
    if (!t.from.includes(from)) t.from.push(from)
    if (where && !t.where) t.where = where
    map.set(k, t)
  }
  // Work log entries like "Target keyword: ai social media manager → Homepage"
  const log = await listWork(ctx.brandId, { kind: 'seo_keyword', limit: 200 }).catch(() => null) as { entries?: { title: string; url: string | null; how: string | null }[] } | null
  for (const e of log?.entries ?? []) {
    const m = e.title.match(/^\s*(?:target\s+)?keyword\s*:\s*(.+?)(?:\s*(?:→|->|—|-|\bon\b)\s+.*)?$/i)
    if (m) add(m[1].replace(/["“”]/g, ''), e.url, 'work log', e.how ?? undefined)
  }
  for (const t of ctx.search?.tracked ?? []) if (t.status === 'active') add(t.keyword, null, 'Search & AI')
  for (const p of ctx.search?.pages ?? []) if (p.keyword) add(p.keyword, p.url, 'Search & AI page target')
  const rows = await db.select({ keyword: trackedKeywords.keyword }).from(trackedKeywords)
    .where(and(eq(trackedKeywords.brandId, ctx.brandId), inArray(trackedKeywords.status, ['tracking', 'implemented'])))
    .catch(() => [] as { keyword: string }[])
  for (const r of rows) add(r.keyword, null, 'Keywords page')
  return [...map.values()]
}

// ── Search Console and GA4 (free) ─────────────────────────────────────────────

type GscRow = { query?: string; page?: string; clicks: number; impressions: number; ctr_pct: number; position: number }
async function gscRows(brandId: string, dimensions: string[], from: string, to: string, rowLimit = 1000): Promise<{ rows: GscRow[]; error?: string; property?: string }> {
  const r = await gsc(brandId, { request: { dimensions, startDate: from, endDate: to, rowLimit } }) as { rows?: GscRow[]; error?: string; message?: string; property?: string }
  return { rows: r.rows ?? [], error: r.error ?? r.message, property: r.property }
}

type GaRow = { pagePath: string; screenPageViews?: number; activeUsers?: number; engagementRate?: number; averageSessionDuration?: number }
async function gaPages(brandId: string): Promise<{ rows: GaRow[]; error?: string }> {
  const r = await ga4(brandId, { request: { dimensions: ['pagePath'], metrics: ['screenPageViews', 'activeUsers', 'engagementRate', 'averageSessionDuration'], limit: 500 } }) as { rows?: GaRow[]; error?: string; message?: string }
  return { rows: r.rows ?? [], error: r.error ?? r.message }
}

const isBlog = (u: string) => /\/(blog|posts?|articles?|guides?|news|resources|learn)\//i.test(pathOf(u) + '/')

// ── track ────────────────────────────────────────────────────────────────────

export async function track(brandId: string, args: Json = {}) {
  const ctx = await context(brandId, args.country as string | undefined)
  if ('error' in ctx) return ctx
  const now = Date.now()
  // Search Console runs 2-3 days behind
  const end = iso(now - 2 * DAY), start28 = iso(now - 29 * DAY), endPrev = iso(now - 30 * DAY), startPrev = iso(now - 57 * DAY)
  const end45 = end, start45 = iso(now - 46 * DAY), endP45 = iso(now - 47 * DAY), startP45 = iso(now - 92 * DAY)

  const [tracked, cur, prev, pagesNow, pagesBefore, pages90, ga, sitemap] = await Promise.all([
    trackedList(ctx),
    gscRows(brandId, ['query', 'page'], start28, end),
    gscRows(brandId, ['query'], startPrev, endPrev),
    gscRows(brandId, ['page'], start45, end45),
    gscRows(brandId, ['page'], startP45, endP45),
    gscRows(brandId, ['page'], iso(now - 92 * DAY), end),
    gaPages(brandId),
    getSitemap(ctx.site).catch(() => new Map<string, string | null>()),
  ])
  const problems: Record<string, string> = {}
  if (cur.error) problems.search_console = cur.error
  if (ga.error) problems.google_analytics = ga.error

  // Per query: impression-weighted position across pages, and the page shown most
  const byQuery = new Map<string, { clicks: number; impressions: number; posSum: number; page: string; pageImpr: number }>()
  for (const r of cur.rows) {
    const q = (r.query ?? '').toLowerCase()
    const e = byQuery.get(q) ?? { clicks: 0, impressions: 0, posSum: 0, page: '', pageImpr: -1 }
    e.clicks += r.clicks; e.impressions += r.impressions; e.posSum += r.position * r.impressions
    if (r.impressions > e.pageImpr) { e.page = r.page ?? ''; e.pageImpr = r.impressions }
    byQuery.set(q, e)
  }
  const prevQ = new Map(prev.rows.map(r => [(r.query ?? '').toLowerCase(), r]))
  const pos = (e: { posSum: number; impressions: number }) => (e.impressions ? Math.round((e.posSum / e.impressions) * 10) / 10 : null)

  const keywords = tracked.map(t => {
    const e = byQuery.get(t.keyword)
    const p = prevQ.get(t.keyword)
    const now_ = e ? pos(e) : null
    const before = p ? Math.round(p.position * 10) / 10 : null
    return {
      keyword: t.keyword,
      target_page: t.page,
      tracked_in: t.from.join(', '),
      position: now_,
      position_28_days_before: before,
      change: now_ != null && before != null ? Math.round((before - now_) * 10) / 10 : null, // + = moved up
      clicks: e?.clicks ?? 0,
      impressions: e?.impressions ?? 0,
      page_google_shows: e?.page ?? null,
      ...(e && t.page && e.page && !samePage(e.page, t.page) ? { note: `Google shows ${pathOf(e.page)} for this, not the page you aimed it at.` } : {}),
      ...(!e ? { note: 'Not seen in Google for this search in the last 28 days (too new, or not ranking in the top ~100 yet).' } : {}),
    }
  })

  // Searches where the site is #5-#20 with people seeing it: the quickest wins
  const striking = [...byQuery.entries()]
    .map(([query, e]) => ({ query, position: pos(e), impressions: e.impressions, clicks: e.clicks, page: e.page }))
    .filter(r => r.position != null && r.position >= 5 && r.position <= 20 && r.impressions >= 10 && !ctx.isBrand(r.query) && !/(^|\s)-?(site|inurl|intitle):/i.test(r.query))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15)

  // Pages losing clicks: last 45 days vs the 45 before
  const before = new Map(pagesBefore.rows.map(r => [pathOf(r.page ?? ''), r]))
  const losing = pagesNow.rows
    .map(r => ({ page: r.page ?? '', now: r.clicks, b: before.get(pathOf(r.page ?? ''))?.clicks ?? 0 }))
    .concat([...before.entries()].filter(([p]) => !pagesNow.rows.some(r => pathOf(r.page ?? '') === p)).map(([, r]) => ({ page: r.page ?? '', now: 0, b: r.clicks })))
    .filter(x => x.b >= 5 && x.now <= x.b * 0.7)
    .map(x => ({ page: x.page, clicks_last_45_days: x.now, clicks_45_days_before: x.b, change_pct: Math.round(((x.now - x.b) / x.b) * 100), blog: isBlog(x.page) }))
    .sort((a, b) => (a.clicks_last_45_days - a.clicks_45_days_before) - (b.clicks_last_45_days - b.clicks_45_days_before))
    .slice(0, 10)

  // Blog posts: search and visits side by side
  const gaBy = new Map(ga.rows.map(r => [pathOf(r.pagePath).toLowerCase(), r]))
  const gsc90 = new Map(pages90.rows.map(r => [pathOf(r.page ?? '').toLowerCase(), r]))
  const blogUrls = [...new Set([...sitemap.keys(), ...pages90.rows.map(r => r.page ?? '')].filter(u => u && isBlog(u)))]
  const posts = blogUrls.map(u => {
    const g = gsc90.get(pathOf(u).toLowerCase()), a = gaBy.get(pathOf(u).toLowerCase())
    return {
      page: u,
      google_clicks_90d: g?.clicks ?? 0,
      google_impressions_90d: g?.impressions ?? 0,
      google_position_90d: g ? Math.round(g.position * 10) / 10 : null,
      views_28d: a?.screenPageViews ?? 0,
      engagement_rate_pct: a?.engagementRate != null ? Math.round(a.engagementRate * 1000) / 10 : null,
      avg_time_s: a?.averageSessionDuration != null ? Math.round(a.averageSessionDuration) : null,
      last_changed: sitemap.get(u)?.slice(0, 10) ?? null,
    }
  }).sort((a, b) => b.google_clicks_90d - a.google_clicks_90d || b.views_28d - a.views_28d)

  // Posts nobody finds or reads: improve, merge into a stronger post, or remove
  const prune = posts.filter(p => p.google_impressions_90d < 10 && p.views_28d <= 5 && (!p.last_changed || now - Date.parse(p.last_changed) > 90 * DAY))
    .slice(0, 10).map(p => ({ page: p.page, why: `${p.google_impressions_90d} Google view${p.google_impressions_90d === 1 ? '' : 's'} in 90 days and ${p.views_28d} visit${p.views_28d === 1 ? '' : 's'} in 28 days${p.last_changed ? `, last changed ${p.last_changed}` : ''}.` }))

  return {
    site: ctx.site,
    window: { last_28_days: `${start28} to ${end}`, compared_with: `${startPrev} to ${endPrev}` },
    tracked_keywords: keywords,
    ...(tracked.length ? {} : { tracked_note: 'No tracked keywords found. Log them with log_work (kind seo_keyword, title "Target keyword: <keyword> → <page>") or add them in Search & AI.' }),
    striking_distance: striking,
    losing_clicks: losing,
    blog_posts: posts.slice(0, 40),
    merge_or_remove: prune,
    ...(Object.keys(problems).length ? { not_available: problems } : {}),
    how_to_read: 'position = average place on Google (1 = top), change + = moved up. striking_distance = searches at #5-#20 where a better title, a section answering the search, and internal links can lift the page to page 1. losing_clicks = refresh these. merge_or_remove = posts nobody finds: improve, fold into a stronger post with a redirect, or remove. All from Search Console and GA4 (free).',
  }
}

// ── weekly ───────────────────────────────────────────────────────────────────

export async function weekly(brandId: string, args: Json = {}) {
  const t = await track(brandId, args) as Json & { tracked_keywords?: { keyword: string; position: number | null; clicks: number; impressions: number }[]; striking_distance?: Json[]; losing_clicks?: Json[]; merge_or_remove?: Json[] }
  if ('error' in t && !t.tracked_keywords) return t
  const store = await readStore(brandId)
  const last = store.weeks?.at(-1)
  const kws = t.tracked_keywords ?? []
  const vsLastWeek = last ? kws.map(k => {
    const was = last.keywords[k.keyword]
    return { keyword: k.keyword, position: k.position, last_review: was?.position ?? null, moved: k.position != null && was?.position != null ? Math.round((was.position - k.position) * 10) / 10 : null }
  }) : null

  // New ideas from the Search Agent's last research (free): good fits nobody targets and the site doesn't rank for
  const ctx = await context(brandId)
  const known = new Set(kws.map(k => k.keyword))
  const ideas = 'error' in ctx ? [] : (ctx.search?.ideas?.rows ?? [])
    .filter(r => (r.verdict === 'fit' || r.verdict === 'picked') && !known.has(r.keyword.toLowerCase()))
    .slice(0, 6).map(r => ({ keyword: r.keyword, searches_a_month: r.volume, difficulty: r.difficulty || null }))

  const summary = {
    moved_up: (vsLastWeek ?? []).filter(k => (k.moved ?? 0) >= 1).map(k => `${k.keyword} (${k.last_review} → ${k.position})`),
    moved_down: (vsLastWeek ?? []).filter(k => (k.moved ?? 0) <= -1).map(k => `${k.keyword} (${k.last_review} → ${k.position})`),
    top_3_chances: (t.striking_distance ?? []).slice(0, 3),
    refresh_this: (t.losing_clicks ?? [])[0] ?? null,
    new_keyword_ideas: ideas,
  }
  await writeStore(brandId, s => {
    s.weeks = [...(s.weeks ?? []), { at: new Date().toISOString(), keywords: Object.fromEntries(kws.map(k => [k.keyword, { position: k.position, clicks: k.clicks, impressions: k.impressions }])), summary }]
  })
  return {
    week_of: iso(Date.now()),
    since_last_review: last ? { last_review: last.at.slice(0, 10), keywords: vsLastWeek } : 'First review: next week shows what moved.',
    ...summary,
    details: t,
    how_to_read: 'Say what moved and why it might have, then the 3 chances (each with one concrete change: title, a section that answers the search, internal links), the post to refresh, and which new idea to write next. For new ideas, use action discover / evaluate for fresher data (costs a little).',
  }
}

// ── DataForSEO (paid) ─────────────────────────────────────────────────────────

type LabsItem = {
  keyword?: string
  keyword_info?: { search_volume?: number | null; cpc?: number | null; monthly_searches?: Month[] | null; competition_level?: string | null }
  keyword_properties?: { keyword_difficulty?: number | null }
  search_intent_info?: { main_intent?: string | null }
  keyword_data?: LabsItem
  ranked_serp_element?: { serp_item?: { rank_group?: number; url?: string } }
}

async function dfs(path: string, task: Json, meter: UsageMeter): Promise<{ items: LabsItem[] | Json[]; error?: string }> {
  try {
    const r = await dfsRaw(path, [task], meter)
    const t = (r.json as { tasks?: { status_code?: number; status_message?: string; result?: { items?: Json[] | null }[] | null }[] })?.tasks?.[0]
    if (!t || (t.status_code !== 20000 && t.status_code !== 40102)) return { items: [], error: `DataForSEO: ${t?.status_message ?? `HTTP ${r.status}`}` }
    return { items: (t.result?.[0]?.items ?? []) as Json[] }
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export interface KwRow { keyword: string; volume: number; difficulty: number | null; cpc: number | null; intent: string | null; trend: Trend }
const kwRow = (i: LabsItem): KwRow | null => {
  const d = i.keyword_data ?? i
  if (!d.keyword) return null
  return {
    keyword: d.keyword.toLowerCase(),
    volume: d.keyword_info?.search_volume ?? 0,
    difficulty: d.keyword_properties?.keyword_difficulty || null,
    cpc: d.keyword_info?.cpc ?? null,
    intent: d.search_intent_info?.main_intent ?? null,
    trend: trendOf(d.keyword_info?.monthly_searches),
  }
}

const geo = (country: string) => ({ location_code: locationOf(country), language_code: languageOf(country) })

async function finish(brandId: string, meter: UsageMeter) {
  await addUsage(brandId, meter, 'Claude (MCP)').catch(() => {})
  return Math.round(meter.dataforseo * 10000) / 10000
}

async function ourRanks(brandId: string): Promise<Map<string, { position: number; page: string }>> {
  const now = Date.now()
  const r = await gscRows(brandId, ['query', 'page'], iso(now - 29 * DAY), iso(now - 2 * DAY))
  const m = new Map<string, { position: number; page: string; impr: number }>()
  for (const x of r.rows) {
    const q = (x.query ?? '').toLowerCase()
    const e = m.get(q)
    if (!e || x.impressions > e.impr) m.set(q, { position: Math.round(x.position * 10) / 10, page: x.page ?? '', impr: x.impressions })
  }
  return new Map([...m].map(([k, v]) => [k, { position: v.position, page: v.page }]))
}

// ── discover ─────────────────────────────────────────────────────────────────

export async function discover(brandId: string, args: Json = {}) {
  if (!dataForSeoConfigured()) return { error: 'DataForSEO is not set up on this server.' }
  const ctx = await context(brandId, args.country as string | undefined)
  if ('error' in ctx) return ctx
  const given = Array.isArray(args.seeds) ? (args.seeds as unknown[]).map(String).map(s => s.trim().toLowerCase()).filter(Boolean) : []
  const tracked = given.length ? [] : await trackedList(ctx)
  const seeds = (given.length ? given : (ctx.search?.settings.seeds?.length ? ctx.search.settings.seeds : tracked.map(t => t.keyword))).slice(0, 5)
  if (!seeds.length) return { error: 'No seed keywords: pass seeds, or set starting keywords in the Search Agent.' }
  const key = `discover|${ctx.country}|${seeds.join(',')}`
  const hit = await cached(brandId, key, !!args.fresh)
  if (hit) return hit

  const meter = newMeter()
  const [ideas, sug1, sug2, serp, ranks] = await Promise.all([
    dfs('/dataforseo_labs/google/keyword_ideas/live', { ...geo(ctx.country), keywords: seeds, limit: 150 }, meter),
    dfs('/dataforseo_labs/google/keyword_suggestions/live', { ...geo(ctx.country), keyword: seeds[0], limit: 60 }, meter),
    seeds[1] ? dfs('/dataforseo_labs/google/keyword_suggestions/live', { ...geo(ctx.country), keyword: seeds[1], limit: 60 }, meter) : Promise.resolve({ items: [] as LabsItem[] }),
    dfs('/serp/google/organic/live/advanced', { keyword: seeds[0], ...geo(ctx.country), depth: 10, people_also_ask_click_depth: 1 }, meter),
    ourRanks(brandId),
  ])
  const rank = (k: string) => ranks.get(k) ? { you_rank: ranks.get(k)!.position } : {}
  const clean = (rows: (KwRow | null)[]) => rows.filter((r): r is KwRow => !!r && !ctx.isBrand(r.keyword))
  const all = clean((ideas.items as LabsItem[]).map(kwRow)).sort((a, b) => b.volume - a.volume)
  const ltSeen = new Set<string>()
  const longTail = clean([...(sug1.items as LabsItem[]), ...(sug2.items as LabsItem[])].map(kwRow))
    .filter(r => r.keyword.split(/\s+/).length >= 4 && !ltSeen.has(r.keyword) && !!ltSeen.add(r.keyword)).sort((a, b) => b.volume - a.volume)

  // Questions: question-shaped searches, plus Google's "People also ask"
  const paa: string[] = []
  const related: string[] = []
  for (const it of serp.items as { type?: string; items?: { title?: string }[] | string[] }[]) {
    if (it.type === 'people_also_ask') for (const q of (it.items ?? []) as { title?: string }[]) if (q.title) paa.push(q.title)
    if (it.type === 'related_searches') for (const q of (it.items ?? []) as unknown[]) if (typeof q === 'string') related.push(q)
  }
  const seen = new Set<string>()
  const questions = [...all, ...longTail].filter(r => isQuestion(r.keyword) && !seen.has(r.keyword) && !!seen.add(r.keyword)).slice(0, 20)

  const out = {
    country: ctx.country,
    seeds,
    keyword_ideas: all.slice(0, 40).map(r => ({ ...r, ...rank(r.keyword) })),
    long_tail: longTail.filter(r => !all.slice(0, 40).some(a => a.keyword === r.keyword)).slice(0, 20).map(r => ({ ...r, ...rank(r.keyword) })),
    question_searches: questions.map(r => ({ keyword: r.keyword, volume: r.volume, difficulty: r.difficulty, ...rank(r.keyword) })),
    people_also_ask: [...new Set(paa)].slice(0, 10),
    related_searches: [...new Set(related)].slice(0, 10),
    rising: all.filter(r => r.trend.label === 'rising' && r.volume >= 50).slice(0, 8).map(r => ({ keyword: r.keyword, last_3_months: r.trend.last_3_avg, before: r.trend.previous_3_avg })),
    ...([ideas, sug1, serp].some(x => x.error) ? { partial_errors: [ideas.error, sug1.error, serp.error].filter(Boolean) } : {}),
    cost_usd: await finish(brandId, meter),
    next: 'Pick the promising ones and call action evaluate with keywords (or leave keywords out to evaluate these).',
  }
  await writeStore(brandId, s => { s.cache = { ...(s.cache ?? {}), [key]: { at: new Date().toISOString(), data: out }, 'discover|last': { at: new Date().toISOString(), data: out } } })
  return out
}

// ── evaluate ─────────────────────────────────────────────────────────────────

const INTENT_WEIGHT: Record<string, number> = { transactional: 1.4, commercial: 1.3, navigational: 0.5, informational: 1 }

export async function evaluate(brandId: string, args: Json = {}) {
  if (!dataForSeoConfigured()) return { error: 'DataForSEO is not set up on this server.' }
  const ctx = await context(brandId, args.country as string | undefined)
  if ('error' in ctx) return ctx
  let list = Array.isArray(args.keywords) ? (args.keywords as unknown[]).map(String).map(s => s.trim().toLowerCase()).filter(Boolean) : []
  if (!list.length) {
    const last = (await readStore(brandId)).cache?.['discover|last']?.data as { keyword_ideas?: { keyword: string }[]; long_tail?: { keyword: string }[] } | undefined
    list = [...(last?.keyword_ideas ?? []), ...(last?.long_tail ?? [])].map(k => k.keyword).slice(0, 60)
  }
  if (!list.length) return { error: 'No keywords to evaluate: pass keywords, or run action discover first.' }
  list = [...new Set(list)].slice(0, 100)
  const rivals = (Array.isArray(args.competitors) ? (args.competitors as unknown[]).map(String).map(domainOf) : ctx.competitors).filter(Boolean).slice(0, 3)
  const key = `evaluate|${ctx.country}|${[...list].sort().join(',')}|${rivals.join(',')}`
  const hit = await cached(brandId, key, !!args.fresh)
  if (hit) return hit

  const meter = newMeter()
  const [overview, ranks, sitemap, ...rivalRanks] = await Promise.all([
    dfs('/dataforseo_labs/google/keyword_overview/live', { ...geo(ctx.country), keywords: list }, meter),
    ourRanks(brandId),
    getSitemap(ctx.site).catch(() => new Map<string, string | null>()),
    ...rivals.map(d => dfs('/dataforseo_labs/google/ranked_keywords/live', {
      target: d, ...geo(ctx.country), limit: 100,
      filters: [['ranked_serp_element.serp_item.rank_group', '<=', 20]],
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
    }, meter)),
  ])
  const reach = ctx.search ? siteReach(ctx.search, { name: ctx.name, domain: ctx.domain }) : 30

  const rows = new Map<string, KwRow>()
  for (const i of overview.items as LabsItem[]) { const r = kwRow(i); if (r) rows.set(r.keyword, r) }
  const scored = list.map(k => rows.get(k) ?? { keyword: k, volume: 0, difficulty: null, cpc: null, intent: null, trend: trendOf(null) })
    .map(r => {
      const you = ranks.get(r.keyword)
      const fits = r.difficulty == null || r.difficulty <= reach + 10
      const score = Math.round((r.volume * (INTENT_WEIGHT[r.intent ?? ''] ?? 1) * (you && you.position >= 5 && you.position <= 20 ? 1.5 : 1)) / (1 + (r.difficulty ?? 30) / 10))
      return {
        ...r,
        ...(you ? { you_rank: you.position, your_page: you.page } : {}),
        can_win: r.volume < 10 ? 'too few searches' : fits ? 'yes' : `hard (difficulty ${r.difficulty}, your site can win about ${reach})`,
        priority: fits && r.volume >= 10 ? score : 0,
      }
    }).sort((a, b) => b.priority - a.priority)

  // Competitor gap: their page-1/2 searches the site doesn't rank for
  const rivalBrand = rivals.map(d => brandMatcher({ name: d.split('.')[0], domain: d }))
  const gapMap = new Map<string, { keyword: string; volume: number; difficulty: number | null; intent: string | null; competitors: { domain: string; position: number; url: string }[] }>()
  rivalRanks.forEach((res, idx) => {
    for (const i of res.items as LabsItem[]) {
      const r = kwRow(i)
      const p = i.ranked_serp_element?.serp_item
      if (!r || !p || r.volume < 20) continue
      if (ctx.isBrand(r.keyword) || rivalBrand.some(m => m(r.keyword))) continue
      const ours = ranks.get(r.keyword)
      if (ours && ours.position <= 20) continue
      const g = gapMap.get(r.keyword) ?? { keyword: r.keyword, volume: r.volume, difficulty: r.difficulty, intent: r.intent, competitors: [] }
      g.competitors.push({ domain: rivals[idx], position: p.rank_group ?? 0, url: p.url ?? '' })
      gapMap.set(r.keyword, g)
    }
  })
  const gap = [...gapMap.values()].sort((a, b) => (b.competitors.length - a.competitors.length) || (b.volume - a.volume)).slice(0, 30)
    .map(g => ({ ...g, can_win: g.difficulty == null || g.difficulty <= reach + 10 ? 'yes' : 'hard' }))

  // Topic groups, each mapped to the page that should target it
  const pages = [...[...sitemap.keys()].map(url => ({ url })), ...(ctx.search?.pages ?? []).map(p => ({ url: p.url, title: p.title, h1: p.h1 }))]
  const groups = groupKeywords([...scored, ...gap.map(g => ({ ...g, cpc: null, trend: trendOf(null), priority: 0, can_win: g.can_win }))])
    .slice(0, 15).map(g => {
      const shown = g.keywords.map(k => ranks.get(k.keyword)).find(x => x && x.position <= 30)
      const match = bestPage(g.words, pages)
      return {
        main_keyword: g.main.keyword,
        searches_a_month_total: g.keywords.reduce((s, k) => s + k.volume, 0),
        keywords: g.keywords.map(k => k.keyword).slice(0, 12),
        page: shown ? { url: shown.page, why: `Google already shows it at #${shown.position}` } : match ? { url: match.url, why: `matches ${match.shared} main words` } : { url: null, why: 'no page fits: a new post' },
      }
    })

  const out = {
    country: ctx.country,
    your_site_can_win_up_to_difficulty: reach,
    keywords: scored,
    competitor_gap: gap,
    competitors_checked: rivals,
    topic_groups: groups,
    ...([overview, ...rivalRanks].some(x => x.error) ? { partial_errors: [overview, ...rivalRanks].map(x => x.error).filter(Boolean) } : {}),
    cost_usd: await finish(brandId, meter),
    how_to_read: 'priority = searches × intent ÷ difficulty (×1.5 when you already rank #5-#20); 0 = skip for now. intent: informational = a guide or how-to, commercial = a comparison or "best" list, transactional = a feature / pricing page. topic_groups: one page per group, its main keyword in the title and H1, the others as sections. Next: action plan for a keyword.',
  }
  await writeStore(brandId, s => { s.cache = { ...(s.cache ?? {}), [key]: { at: new Date().toISOString(), data: out } } })
  return out
}

// ── plan ─────────────────────────────────────────────────────────────────────

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

export async function pageFacts(url: string, ms = 10_000): Promise<PageFacts> {
  const empty: PageFacts = { url, title: '', meta: '', h1: [], h2: [], h3: [], words: 0, first_100_words: '', image_alts: [], images_without_alt: 0, internal_links: [], text: '' }
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowJinBot/1.0; +https://growjin.com)', Accept: 'text/html' }, signal: AbortSignal.timeout(ms) })
    if (!res.ok) return { ...empty, error: `HTTP ${res.status}` }
    const html = await res.text()
    const $ = cheerio.load(html)
    const base = res.url || url
    const host = new URL(base).hostname.replace(/^www\./, '')
    const links = new Set<string>()
    $('a[href]').each((_, el) => {
      try {
        const u = new URL($(el).attr('href') ?? '', base)
        if (u.hostname.replace(/^www\./, '') === host) links.add(`${u.origin}${u.pathname}`)
      } catch { /* not a link */ }
    })
    const alts = $('img').map((_, el) => tidy($(el).attr('alt') ?? '')).get()
    const facts = {
      url: base,
      title: tidy($('title').first().text()),
      meta: $('meta[name="description"]').attr('content') ?? '',
      h1: $('h1').map((_, el) => tidy($(el).text())).get().filter(Boolean),
      h2: $('h2').map((_, el) => tidy($(el).text())).get().filter(Boolean).slice(0, 30),
      h3: $('h3').map((_, el) => tidy($(el).text())).get().filter(Boolean).slice(0, 30),
      image_alts: alts.filter(Boolean).slice(0, 30),
      images_without_alt: alts.filter(a => !a).length,
      internal_links: [...links].slice(0, 300),
    }
    $('script, style, noscript, svg, iframe, nav, header, footer').remove()
    const text = tidy($('main').text() || $('article').text() || $('body').text())
    const words = text ? text.split(' ').length : 0
    return { ...facts, words, first_100_words: text.split(' ').slice(0, 100).join(' '), text: text.slice(0, 40_000) }
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : 'could not open' }
  }
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  return out
}

export async function plan(brandId: string, args: Json = {}) {
  const keyword = String(args.keyword ?? '').trim().toLowerCase()
  if (!keyword) return { error: 'keyword is required for plan.' }
  const ctx = await context(brandId, args.country as string | undefined)
  if ('error' in ctx) return ctx
  const key = `plan|${ctx.country}|${keyword}|${args.url ?? ''}`
  const hit = await cached(brandId, key, !!args.fresh)
  if (hit) return hit

  const meter = newMeter()
  const [serp, ranks, sitemap] = await Promise.all([
    dataForSeoConfigured()
      ? dfs('/serp/google/organic/live/advanced', { keyword, ...geo(ctx.country), depth: 10, people_also_ask_click_depth: 1 }, meter)
      : Promise.resolve({ items: [] as Json[], error: 'DataForSEO is not set up, so what ranks on Google is left out.' }),
    ourRanks(brandId),
    getSitemap(ctx.site).catch(() => new Map<string, string | null>()),
  ])

  type SerpItem = { type?: string; rank_group?: number; url?: string; domain?: string; title?: string; items?: { title?: string }[] }
  const items = serp.items as SerpItem[]
  const organic = items.filter(i => i.type === 'organic' && i.url).slice(0, 10)
  const features = [...new Set(items.map(i => i.type).filter((t): t is string => !!t && t !== 'organic'))]
  const paa = items.filter(i => i.type === 'people_also_ask').flatMap(i => (i.items ?? []).map(q => q.title ?? '')).filter(Boolean)
  const ourDomain = ctx.domain.replace(/^www\./, '')
  const top3 = organic.filter(o => !(o.domain ?? '').replace(/^www\./, '').endsWith(ourDomain)).slice(0, 3)

  // Which page of ours this is for: given, the one Google shows, or the best match in the sitemap
  const siteUrls = [...sitemap.keys()]
  const shown = ranks.get(keyword)
  const target = typeof args.url === 'string' && args.url ? (/^https?:\/\//.test(args.url) ? args.url : `${ctx.site}${args.url.startsWith('/') ? '' : '/'}${args.url}`)
    : shown?.page || bestPage(tokens(keyword), siteUrls.map(url => ({ url })))?.url || null

  const [rivals, ours] = await Promise.all([
    inBatches(top3, 3, o => pageFacts(o.url!)),
    target ? pageFacts(target) : Promise.resolve(null),
  ])
  const ok = rivals.filter(r => !r.error && r.words > 150)
  const sortedWords = ok.map(r => r.words).sort((a, b) => a - b)
  const typical = sortedWords.length ? sortedWords[Math.floor(sortedWords.length / 2)] : null
  const formats = ok.map(r => formatOf(r))
  const format = formats.sort((a, b) => formats.filter(f => f === b).length - formats.filter(f => f === a).length)[0] ?? null

  // Internal links: pages of ours that talk about this and could link to the target
  const words = tokens(keyword)
  const candidates = siteUrls
    .filter(u => !target || !samePage(u, target))
    .map(u => ({ u, score: slugWords(u).filter(w => words.includes(w)).length + (isBlog(u) ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score).slice(0, 14).map(x => x.u)
  const read = await inBatches(candidates, 7, u => pageFacts(u, 8000))
  const linkFrom = read
    .filter(p => !p.error && (!target || !p.internal_links.some(l => samePage(l, target))))
    .map(p => ({ page: p.url, sentence: anchorIn(p.text, words) }))
    .filter((x): x is { page: string; sentence: string } => !!x.sentence)
    .slice(0, 5)
    .map(x => ({ from_page: x.page, put_the_link_on: x.sentence, link_text: keyword }))
  const linkTo = ours && !ours.error ? read
    .filter(p => !p.error && !ours.internal_links.some(l => samePage(l, p.url)))
    .map(p => ({ page: p.url, shared: tokens(`${p.title} ${p.h1.join(' ')}`).filter(w => words.includes(w)).length, title: p.title }))
    .filter(x => x.shared >= 1).sort((a, b) => b.shared - a.shared).slice(0, 3)
    .map(x => ({ link_to: x.page, about: x.title })) : []

  const out = {
    keyword,
    country: ctx.country,
    google_now: {
      top_results: organic.slice(0, 5).map(o => ({ position: o.rank_group, title: o.title, url: o.url })),
      also_on_the_page: features,
      people_also_ask: [...new Set(paa)].slice(0, 8),
      ...(shown ? { you_rank: shown.position, your_page_shown: shown.page } : { you_rank: null }),
    },
    what_ranks: {
      format,
      typical_words: typical,
      pages: ok.map(r => ({ url: r.url, title: r.title, format: formatOf(r), words: r.words, headings: r.h2.slice(0, 10) })),
    },
    outline_hint: 'Match the format and roughly the length of what ranks. Cover the headings they share, answer the "People also ask" questions in their own sections, and add what only you know (a real example, a number, your view).',
    your_page: ours ? (ours.error ? { url: target, error: ours.error } : { url: ours.url, title: ours.title, ...placement(ours, keyword, typical) })
      : { url: null, note: 'No page targets this yet: write a new post.' },
    internal_links: {
      add_links_to_this_page_from: linkFrom,
      ...(linkTo.length ? { link_out_from_this_page_to: linkTo } : {}),
      ...(target ? {} : { note: 'Once the post is live, add these links pointing to it.' }),
    },
    ...(serp.error ? { partial_error: serp.error } : {}),
    cost_usd: await finish(brandId, meter),
  }
  await writeStore(brandId, s => { s.cache = { ...(s.cache ?? {}), [key]: { at: new Date().toISOString(), data: out } } })
  return out
}

// ── The tool ─────────────────────────────────────────────────────────────────

export async function blogKeywords(brandId: string, args: Json) {
  const action = String(args.action ?? 'weekly')
  if (action === 'track') return track(brandId, args)
  if (action === 'weekly') return weekly(brandId, args)
  if (action === 'discover') return discover(brandId, args)
  if (action === 'evaluate') return evaluate(brandId, args)
  if (action === 'plan') return plan(brandId, args)
  if (action === 'history') {
    const s = await readStore(brandId)
    return { weeks: (s.weeks ?? []).slice().reverse().map(w => ({ at: w.at.slice(0, 10), ...w.summary })), saved_lookups: Object.entries(s.cache ?? {}).map(([k, v]) => ({ key: k.split('|').slice(0, 3).join(' · '), at: v.at.slice(0, 10) })) }
  }
  return { error: 'action must be weekly, track, discover, evaluate, plan or history.' }
}
