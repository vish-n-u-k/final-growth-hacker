// Search & AI page: read the brand's homepage and main pages (title, H1, H2s, description), work out the
// search each page targets, and spot title / H1 changes since the last check (each becomes a test).
// Also writes new wording for a page on request.

import * as cheerio from 'cheerio'
import { fetchHtml } from '@/lib/lead-finder/reviews'
import { callAI } from '@/lib/ai/client'
import { parseJsonLoose, type BrandContext } from '@/lib/agents/context'
import type { SearchAgentData, SiteChange, SitePage, UsageMeter } from '@/lib/agents/store'
import { keywordVolumes } from '@/lib/agents/dataforseo'
import { kwKey } from './verdict'

export const MAX_PAGES = 10
// Pages that never target a search: legal, account, cart, feeds, files
const SKIP = /\/(privacy|terms|legal|cookie|cookies|gdpr|imprint|impressum|login|log-in|signin|sign-in|signup|sign-up|register|account|cart|checkout|admin|wp-admin|wp-login|feed|rss|tag|tags|category|author|search)(\/|$)|\.(pdf|jpe?g|png|gif|svg|webp|zip|xml|txt|css|js)$/i
const clean = (t: string) => t.replace(/\s+/g, ' ').trim()

function sameSite(href: string, origin: URL): URL | null {
  try {
    const u = new URL(href, origin)
    if (u.hostname.replace(/^www\./, '') !== origin.hostname.replace(/^www\./, '')) return null
    if (!/^https?:$/.test(u.protocol)) return null
    u.hash = ''; u.search = ''
    return u
  } catch { return null }
}

function readPage(url: string, html: string): Omit<SitePage, 'keyword' | 'readAt'> {
  const $ = cheerio.load(html)
  const u = new URL(url)
  return {
    url,
    path: u.pathname.replace(/\/+$/, '') || '/',
    title: clean($('title').first().text()).slice(0, 200),
    h1: clean($('h1').first().text()).slice(0, 200),
    h2s: $('h2').map((_, e) => clean($(e).text())).get().filter(Boolean).slice(0, 6).map(t => t.slice(0, 140)),
    meta: clean($('meta[name="description"]').attr('content') ?? $('meta[property="og:description"]').attr('content') ?? '').slice(0, 300),
  }
}

/** The homepage plus up to 9 main pages: links in the menu and header first, then the footer, then the sitemap. */
async function mainPageUrls(home: string, html: string): Promise<string[]> {
  const origin = new URL(home)
  const $ = cheerio.load(html)
  const seen = new Set<string>([origin.pathname.replace(/\/+$/, '') || '/'])
  const out: string[] = []
  const take = (href: string | undefined) => {
    if (!href || out.length >= MAX_PAGES - 1) return
    const u = sameSite(href, origin)
    if (!u) return
    const path = u.pathname.replace(/\/+$/, '') || '/'
    if (seen.has(path) || SKIP.test(path) || path.split('/').length > 4) return
    seen.add(path)
    out.push(u.toString().replace(/\/+$/, ''))
  }
  $('nav a[href], header a[href]').each((_, e) => take($(e).attr('href')))
  $('main a[href]').slice(0, 40).each((_, e) => take($(e).attr('href')))
  $('footer a[href]').each((_, e) => take($(e).attr('href')))
  if (out.length < MAX_PAGES - 1) {
    const xml = await fetchHtml(new URL('/sitemap.xml', origin).toString())
    const locs = xml ? [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]).filter(l => !/\.xml$/i.test(l)) : []
    // Shortest paths first: those are the main pages
    locs.sort((a, b) => a.length - b.length).forEach(take)
  }
  return out
}

/** The search each page targets, worked out once per wording (cached on the page as keyFor). */
async function pageKeywords(b: BrandContext, pages: SitePage[]): Promise<void> {
  const keyOf = (p: SitePage) => `${p.title}|${p.h1}|${p.h2s.join('|')}`
  const todo = pages.filter(p => p.keywordBy !== 'user' && p.keyFor !== keyOf(p))
  if (!todo.length) return
  const raw = await callAI({
    feature: 'search-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1500,
    system: 'You are an SEO expert. You read a page\'s title and headings and name the one Google search it is trying to rank for. Return only raw JSON.',
    prompt: `Business: ${b.name} (${b.domain}). ${b.usp ?? b.summary ?? ''}

For each page below, give the one search (2-6 words, lower case, the way a buyer would type it into Google) that the page's title, H1 and headings are clearly aiming at. Use null for pages that don't aim at a search: about, contact, team, careers, legal, login, a blog index.
Don't invent a search the page doesn't support. Don't use the brand name unless the page only makes sense for people who already know it (like pricing).

${todo.map((p, i) => `[${i}] ${p.path}\nTitle: ${p.title}\nH1: ${p.h1}\nH2s: ${p.h2s.join(' · ')}\nDescription: ${p.meta}`).join('\n\n')}

Return [{"i":0,"keyword":"..." or null}]`,
  }).catch(() => null)
  const arr = raw === null ? null : parseJsonLoose<{ i: number; keyword?: string | null }[]>(raw, 'array')
  if (!Array.isArray(arr)) return
  for (const x of arr) {
    const p = todo[x?.i]
    if (!p) continue
    p.keyword = typeof x.keyword === 'string' && x.keyword.trim() ? kwKey(x.keyword).slice(0, 80) : null
    p.keyFor = keyOf(p)
  }
}

const newId = () => Math.random().toString(36).slice(2, 10)

/**
 * Reads the pages again. A title or H1 that changed since the last check starts a test for that
 * page's search (unless one is already running for it). Returns the pages and the new tests.
 */
export async function refreshSitePages(b: BrandContext, d: SearchAgentData, meter?: UsageMeter, now = new Date()): Promise<{ pages: SitePage[]; changes: SiteChange[] }> {
  const home = (b.websiteUrl || `https://${b.domain}`).replace(/\/+$/, '')
  const homeHtml = await fetchHtml(home)
  if (!homeHtml) throw new Error(`Couldn’t read ${b.domain}`)
  const urls = [home, ...(await mainPageUrls(home, homeHtml))]
  const htmls = await Promise.all(urls.map((u, i) => (i === 0 ? Promise.resolve(homeHtml) : fetchHtml(u))))
  const before = new Map((d.pages ?? []).map(p => [p.path, p]))
  const at = now.toISOString()
  const pages: SitePage[] = []
  urls.forEach((u, i) => {
    const html = htmls[i]
    if (!html) return
    const read = readPage(u, html)
    const old = before.get(read.path)
    pages.push({ ...read, keyword: old?.keyword ?? null, keywordBy: old?.keywordBy, keyFor: old?.keyFor, sugg: old?.sugg, volume: old?.volume, difficulty: old?.difficulty, volFor: old?.volFor, readAt: at })
  })
  await pageKeywords(b, pages)
  // Searches a month for each page's search (one DataForSEO call, only for new or changed searches)
  const need = pages.filter(p => p.keyword && p.volFor !== p.keyword).map(p => p.keyword!)
  if (need.length) {
    const vols = await keywordVolumes(need, d.settings.country, meter).catch(() => null)
    if (vols) for (const p of pages) {
      if (!p.keyword || p.volFor === p.keyword) continue
      const v = vols.get(p.keyword)
      p.volume = v?.volume ?? 0
      p.difficulty = v?.difficulty ?? null
      p.volFor = p.keyword
    }
  }

  // A changed title or H1 is a test of that page's search
  const changes: SiteChange[] = []
  const running = new Set((d.changes ?? []).filter(c => c.status === 'testing' && c.area === 'seo').map(c => c.path))
  const lastRank = (k: string) => {
    const snap = [...(d.rankHistory ?? [])].reverse().find(s => k in s.rows)
    return snap ? snap.rows[k].rank : null
  }
  for (const p of pages) {
    const old = before.get(p.path)
    if (!old || !p.keyword || running.has(p.path)) continue
    const what = [old.title !== p.title ? 'title' : null, old.h1 !== p.h1 ? 'H1' : null].filter(Boolean)
    if (!what.length) continue
    changes.push({ id: newId(), area: 'seo', path: p.path, keyword: p.keyword, what: `New ${what.join(' and ')}`, at, by: 'auto', before: lastRank(p.keyword), status: 'testing' })
    p.sugg = undefined
  }
  return { pages, changes }
}

/** New title, H1, up to two H2s and a description for a page, aimed at `keyword`. */
export async function suggestWording(b: BrandContext, page: SitePage, keyword: string, mode: 'change' | 'refresh', why: string): Promise<NonNullable<SitePage['sugg']>['items']> {
  const raw = await callAI({
    feature: 'search-agent',
    maxTokens: 900,
    system: 'You are an SEO copywriter for small businesses. Plain words, no hype. Return only raw JSON.',
    prompt: `Business: ${b.name} (${b.domain}). ${b.usp ?? b.summary ?? ''}
Page: ${page.path}
Now: Title "${page.title}" · H1 "${page.h1}" · H2s: ${page.h2s.join(' · ') || 'none'} · Description "${page.meta}"
Why it needs work: ${why}

${mode === 'change'
    ? `Rewrite the page's title, H1 and description to target the search "${keyword}" instead.`
    : `Keep the search "${keyword}", but bring the page up to date: a better title, and up to two new H2 sections that answer what people searching it want.`}
Rules: the title is under 60 characters and has the search in it, near the start. The H1 reads naturally for a person. The description is 140-155 characters and says what they get. Don't promise what the business doesn't do.

Return [{"tag":"Title"|"H1"|"H2"|"Meta","text":"..."}] with ${mode === 'change' ? 'Title, H1 and Meta' : 'Title and one or two H2'}.`,
  })
  const arr = parseJsonLoose<{ tag?: string; text?: string }[]>(raw, 'array')
  if (!Array.isArray(arr)) throw new Error('Couldn’t write the new wording. Try again.')
  return arr
    .filter(x => (x.tag === 'Title' || x.tag === 'H1' || x.tag === 'H2' || x.tag === 'Meta') && typeof x.text === 'string' && x.text.trim())
    .slice(0, 5)
    .map(x => ({ tag: x.tag as 'Title' | 'H1' | 'H2' | 'Meta', text: clean(x.text!).slice(0, 200) }))
}

export { newId }
