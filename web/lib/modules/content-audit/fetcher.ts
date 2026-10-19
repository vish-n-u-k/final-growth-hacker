import * as cheerio from 'cheerio'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isJsShell } from '@/lib/audit/js-shell'
import { detectBlock, type BlockInfo } from '@/lib/audit/blocked'

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * What a page is for. Only `post` and `page` are content: home, legal and utility pages (contact,
 * pricing, sign-in…) are short by design and are never judged on length.
 */
export type PageKind = 'home' | 'post' | 'page' | 'legal' | 'utility'

export interface PageSummary {
  url: string
  kind: PageKind
  title: string | null
  metaDescription: string | null
  h1: string | null
  bodyExcerpt: string       // first 300 chars of the main copy
  wordCount: number         // main copy only (no menus or footer)
  imageCount: number
  bodyLinks: number         // links to your own pages from inside the main copy (not menus or footer)
  hasCta: boolean           // the main copy points readers to sign up, try, buy, book or pricing
  published: string | null  // ISO date: the page's own date, else the sitemap's last-modified date
  fetchError: string | null
}

export interface ContentAuditFetchResult {
  websiteUrl: string
  brandName: string
  industry: string | null
  targetAudience: string | null
  usp: string | null
  homepageBlocked: BlockInfo | null
  homepageIsJsShell: boolean
  pages: PageSummary[]
  totalPagesFound: number   // in the sitemap (or linked from the homepage), before filtering and capping
  postsFound: number        // blog/article URLs found, before capping
  newestPostDate: string | null   // across every post URL found (sitemap dates), not just the ones read
  postsLast90Days: number | null  // null = no dates to go on
}

// ── Constants ─────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (compatible; GrowJinBot/1.0; +https://growjin.com)'
const PAGE_TIMEOUT_MS = 8000
const MAX_PAGES = 40
const MAX_KEY_PAGES = 10  // marketing pages read before the posts

// App/system routes, archives and files: never content
const EXCLUDED = /^\/(api|auth|login|logout|signin|sign-in|signup|sign-up|register|dashboard|app|account|profile|settings|admin|checkout|cart|order|payment|portal|wp-admin|wp-json|\.well-known)(\/|$)|\/(tag|tags|category|categories|author|authors|page|feed)\/|\.(xml|json|pdf|jpe?g|png|gif|svg|webp|zip|csv|txt|js|css|ico|woff2?)$/i

const POST_PATH = /^\/(blog|articles?|posts?|news|insights|resources|guides?|learn|journal|stories|academy|library)\/[^/]+/i
const LEGAL_PATH = /^\/(privacy|terms|tos|legal|cookies?|cookie-policy|gdpr|dpa|refund|refunds|returns|imprint|disclaimer|acceptable-use|security)(\/|$|-)/i
const UTILITY_PATH = /^\/(contact|contact-us|pricing|plans|about|about-us|team|careers|jobs|faq|faqs|help|support|changelog|status|demo|book|get-started|start|thank-you|thanks|404|search|sitemap|partners|affiliates|press|brand|media-kit)(\/|$)/i
const KEY_PATH = /^\/(pricing|plans|about|features?|services|solutions|product|products|use-cases?|customers|case-stud|why|how-it-works|compare|alternatives?)/i

const CTA_TEXT = /\b(start|try|sign ?up|get started|free trial|book|schedule a|request a demo|demo|buy|shop|subscribe|join|create (your|an) account|see pricing|view pricing)\b/i
const CTA_HREF = /\/(signup|sign-up|register|start|trial|get-started|pricing|plans|demo|book|checkout|app)(\/|$|\?)/i

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchPage(url: string, timeoutMs = PAGE_TIMEOUT_MS): Promise<{ html: string; block: BlockInfo | null } | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
    const body = await res.text().catch(() => '')
    const block = detectBlock(res.status, res.headers, body)
    if (block) return { html: '', block }
    return res.ok ? { html: body, block: null } : null
  } catch {
    return null
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
    u.hash = ''
    u.search = ''
    return u.href
  } catch {
    return url
  }
}

const pathOf = (url: string) => { try { return new URL(url).pathname.toLowerCase() } catch { return '' } }

export function kindOf(url: string, homeUrl: string): PageKind {
  const p = pathOf(url)
  if (p === '/' || normalizeUrl(url) === normalizeUrl(homeUrl)) return 'home'
  if (POST_PATH.test(p)) return 'post'
  if (LEGAL_PATH.test(p)) return 'legal'
  if (UTILITY_PATH.test(p)) return 'utility'
  return 'page'
}

// ── Sitemap (with last-modified dates) ────────────────────────────────────────

export async function getSitemap(origin: string): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>()

  async function parse(sitemapUrl: string, depth = 0): Promise<void> {
    if (depth > 2) return
    const res = await fetchPage(sitemapUrl, 12000)
    if (!res?.html) return
    const xml = res.html
    const nested = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*(.*?)\s*<\/loc>/gi)]
    if (nested.length > 0) {
      await Promise.all(nested.slice(0, 8).map(m => parse(m[1].trim(), depth + 1)))
      return
    }
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
      const loc = /<loc>\s*(.*?)\s*<\/loc>/i.exec(m[1])?.[1]?.trim()
      const mod = /<lastmod>\s*(.*?)\s*<\/lastmod>/i.exec(m[1])?.[1]?.trim() ?? null
      if (loc?.startsWith('http')) found.set(normalizeUrl(loc.replace(/&amp;/g, '&')), mod && Number.isFinite(Date.parse(mod)) ? new Date(mod).toISOString() : null)
    }
  }

  await Promise.all([parse(`${origin}/sitemap.xml`), parse(`${origin}/sitemap_index.xml`)])
  return found
}

function linksIn(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html)
  const host = new URL(baseUrl).hostname
  const out = new Set<string>()
  $('a[href]').each((_, el) => {
    try {
      const u = new URL($(el).attr('href') ?? '', baseUrl)
      if (u.hostname === host) out.add(normalizeUrl(u.href))
    } catch { /* skip */ }
  })
  return [...out]
}

// ── Per-page summary ──────────────────────────────────────────────────────────

function pageDate($: cheerio.CheerioAPI): string | null {
  const candidates = [
    $('meta[property="article:published_time"]').attr('content'),
    $('meta[name="date"], meta[name="publish-date"], meta[itemprop="datePublished"]').attr('content'),
    $('time[datetime]').first().attr('datetime'),
    /"datePublished"\s*:\s*"([^"]+)"/.exec($('script[type="application/ld+json"]').text())?.[1],
  ]
  const d = candidates.find(c => c && Number.isFinite(Date.parse(c)))
  return d ? new Date(d).toISOString() : null
}

export function summarize(url: string, html: string, kind: PageKind, sitemapDate: string | null): PageSummary {
  const $ = cheerio.load(html)
  const host = new URL(url).hostname
  const title = $('title').first().text().replace(/\s+/g, ' ').trim() || null
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || null
  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim() || null
  const published = pageDate($) ?? sitemapDate

  // The main copy: <article> or <main> if there is one, without menus, header and footer
  $('script, style, noscript, template, svg, nav, header, footer, aside, form').remove()
  const main = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body')
  // A space between neighbouring tags, so words in separate blocks don't run together
  const text = cheerio.load((main.html() ?? '').replace(/></g, '> <')).text().replace(/\s+/g, ' ').trim()

  let bodyLinks = 0
  let hasCta = false
  main.find('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    if (!href || href.startsWith('#') || /^(mailto|tel):/i.test(href)) return
    try {
      const u = new URL(href, url)
      if (u.hostname === host) bodyLinks++
      if ((u.hostname === host && CTA_HREF.test(u.pathname)) || CTA_TEXT.test($(el).text())) hasCta = true
    } catch { /* skip */ }
  })
  if (!hasCta) main.find('button').each((_, el) => { if (CTA_TEXT.test($(el).text())) hasCta = true })

  return {
    url, kind, title, metaDescription, h1,
    bodyExcerpt: text.slice(0, 300),
    wordCount: text ? text.split(' ').length : 0,
    imageCount: main.find('img').length,
    bodyLinks, hasCta, published, fetchError: null,
  }
}

const failed = (url: string, kind: PageKind): PageSummary => ({
  url, kind, title: null, metaDescription: null, h1: null, bodyExcerpt: '', wordCount: 0, imageCount: 0,
  bodyLinks: 0, hasCta: false, published: null, fetchError: 'Failed to fetch',
})

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchContentAuditData(requirements: Record<string, string>): Promise<ContentAuditFetchResult> {
  const rawUrl = requirements['website_url'] ?? ''
  const baseUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  const { origin, hostname } = new URL(baseUrl)
  const brandId = requirements['brand_id'] ?? ''

  const [[brand], home, sitemap] = await Promise.all([
    brandId
      ? db.select({ name: brands.name, industry: brands.industry, targetAudience: brands.targetAudience, usp: brands.usp }).from(brands).where(eq(brands.id, brandId)).limit(1)
      : Promise.resolve([] as never[]),
    fetchPage(baseUrl, 12000),
    getSitemap(origin),
  ])
  const homeHtml = home?.html ?? ''
  const homepageIsJsShell = !!homeHtml && isJsShell(cheerio.load(homeHtml))

  // Every URL we know about: the sitemap, else the homepage's links
  const known = new Map(sitemap)
  if (known.size === 0 && homeHtml) for (const u of linksIn(homeHtml, baseUrl)) known.set(u, null)
  const homeKey = normalizeUrl(baseUrl)
  known.delete(homeKey)
  const totalPagesFound = known.size + 1

  const candidates = [...known.keys()].filter(u => { try { const p = new URL(u); return p.hostname === hostname && !EXCLUDED.test(p.pathname) } catch { return false } })
  const posts = candidates.filter(u => kindOf(u, baseUrl) === 'post')
  const postDates = posts.map(u => known.get(u)).filter((d): d is string => !!d)
  const newestPostDate = postDates.sort().at(-1) ?? null
  const postsLast90Days = postDates.length ? postDates.filter(d => Date.now() - Date.parse(d) <= 90 * 86_400_000).length : null

  // What to read: the homepage, key marketing pages, then the newest posts, then other pages
  const byNewest = (a: string, b: string) => (known.get(b) ?? '').localeCompare(known.get(a) ?? '')
  const keyPages = candidates.filter(u => kindOf(u, baseUrl) !== 'post' && KEY_PATH.test(pathOf(u))).slice(0, MAX_KEY_PAGES)
  const newestPosts = [...posts].sort(byNewest)
  const otherPages = candidates.filter(u => kindOf(u, baseUrl) === 'page' && !keyPages.includes(u))
    .sort((a, b) => pathOf(a).split('/').length - pathOf(b).split('/').length)
  const toRead = [...new Set([...keyPages, ...newestPosts, ...otherPages])].slice(0, MAX_PAGES - 1)

  const read = await Promise.all(toRead.map(async (url): Promise<PageSummary> => {
    const kind = kindOf(url, baseUrl)
    const res = await fetchPage(url)
    return res?.html ? summarize(url, res.html, kind, known.get(url) ?? null) : failed(url, kind)
  }))
  const pages = [homeHtml ? summarize(homeKey, homeHtml, 'home', null) : failed(homeKey, 'home'), ...read]

  return {
    websiteUrl: baseUrl,
    brandName: brand?.name || requirements['brand_name'] || '',
    industry: brand?.industry || requirements['industry'] || null,
    targetAudience: brand?.targetAudience || requirements['target_audience'] || null,
    usp: brand?.usp || requirements['usp'] || null,
    homepageBlocked: home?.block ?? null,
    homepageIsJsShell,
    pages,
    totalPagesFound,
    postsFound: posts.length,
    newestPostDate,
    postsLast90Days,
  }
}
