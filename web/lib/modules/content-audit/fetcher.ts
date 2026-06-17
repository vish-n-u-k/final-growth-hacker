import * as cheerio from 'cheerio'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageSummary {
  url: string
  title: string | null
  metaDescription: string | null
  h1: string | null
  bodyExcerpt: string       // first 500 chars of cleaned body text
  wordCount: number
  imageCount: number
  internalLinkCount: number
  externalLinkCount: number
  fetchError: string | null
}

export interface ContentAuditFetchResult {
  websiteUrl: string
  brandName: string
  targetAudience: string | null
  businessGoals: string | null
  hasCompetitors: boolean
  pages: PageSummary[]
  competitorPages: PageSummary[]
  techStack: string | null
  isCsr: boolean
  totalPagesFound: number   // before filtering and capping
  pagesAudited: number      // successfully fetched after filtering
}

// ── Constants ─────────────────────────────────────────────────────────────────

const UA = 'GrowthHackerBot/1.0 (Content Audit)'
const PAGE_TIMEOUT_MS = 8000
const DEFAULT_MAX_PAGES = 30
const MAX_PAGES_HARD_LIMIT = 50

// Paths to skip — app/system/non-content routes
const EXCLUDED_PREFIXES = [
  '/api/', '/auth/', '/login', '/logout', '/signup', '/sign-up',
  '/register', '/dashboard', '/app/', '/account', '/profile',
  '/settings', '/admin', '/checkout', '/cart', '/order',
  '/payment', '/portal', '/wp-admin', '/wp-json', '/.well-known',
]

// Path segments that indicate non-content pages
const EXCLUDED_SEGMENTS = [
  '/tag/', '/tags/', '/category/', '/categories/',
  '/author/', '/authors/', '/page/', '/feed/',
]

// File extensions to skip
const EXCLUDED_EXTENSIONS = [
  '.xml', '.json', '.pdf', '.jpg', '.jpeg', '.png',
  '.gif', '.svg', '.webp', '.zip', '.csv', '.txt',
  '.js', '.css', '.ico', '.woff', '.woff2',
]

// Key marketing pages — fetched first when capping at max_pages
const HIGH_PRIORITY_SEGMENTS = [
  '/pricing', '/about', '/about-us', '/features', '/feature',
  '/services', '/solutions', '/contact', '/faq', '/why',
  '/product', '/products', '/case-stud', '/customers',
]

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function safeFetch(
  url: string,
  timeoutMs = PAGE_TIMEOUT_MS,
): Promise<{ html: string; headers: Record<string, string> } | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const html = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k] = v })
    return { html, headers }
  } catch {
    return null
  }
}

// ── Tech stack detection ───────────────────────────────────────────────────────

function detectTechStack(html: string, headers: Record<string, string>): string | null {
  if (html.includes('__NEXT_DATA__'))                        return 'Next.js'
  if (html.includes('wp-content') || html.includes('wp-includes')) return 'WordPress'
  if (html.includes('cdn.shopify.com'))                      return 'Shopify'
  if (html.includes('webflow.com') || html.includes('data-wf-site')) return 'Webflow'
  if (html.includes('cdn.wix.com'))                          return 'Wix'
  if (html.includes('squarespace.com'))                      return 'Squarespace'
  if (html.includes('ghost-url') || html.includes('content="Ghost')) return 'Ghost'
  if (html.includes('nuxt') || html.includes('__NUXT__'))    return 'Nuxt.js'
  const powered = (headers['x-powered-by'] ?? '').toLowerCase()
  if (powered.includes('next'))      return 'Next.js'
  if (powered.includes('wordpress')) return 'WordPress'
  return null
}

function detectCsr(html: string): boolean {
  // CSR apps have an empty mounting div and very little body text
  const hasCsrMount = (
    /<div[^>]+id=["']root["'][^>]*>\s*<\/div>/i.test(html) ||
    /<div[^>]+id=["']app["'][^>]*>\s*<\/div>/i.test(html) ||
    /<app-root[^>]*>\s*<\/app-root>/i.test(html)
  )
  if (!hasCsrMount) return false
  // Strip all tags and check if meaningful body text exists
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? ''
  const visibleText = bodyMatch.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return visibleText.length < 400
}

// ── URL filtering ─────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    // Remove trailing slash (except root)
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1)
    }
    // Strip fragment and query string
    u.hash = ''
    u.search = ''
    return u.href
  } catch {
    return url
  }
}

function shouldExclude(url: string, baseHostname: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== baseHostname) return true

    const path = parsed.pathname.toLowerCase()

    for (const prefix of EXCLUDED_PREFIXES) {
      if (path === prefix.replace(/\/$/, '') || path.startsWith(prefix)) return true
    }
    for (const seg of EXCLUDED_SEGMENTS) {
      if (path.includes(seg)) return true
    }
    for (const ext of EXCLUDED_EXTENSIONS) {
      if (path.endsWith(ext)) return true
    }
    // Skip heavily parameterized URLs (more than one param)
    if ((parsed.search.match(/=/g) ?? []).length > 1) return true

    return false
  } catch {
    return true
  }
}

function prioritize(urls: string[], baseUrl: string): string[] {
  return [...urls].sort((a, b) => {
    const pathA = new URL(a).pathname.toLowerCase()
    const pathB = new URL(b).pathname.toLowerCase()

    if (pathA === '/') return -1
    if (pathB === '/') return 1

    const aHigh = HIGH_PRIORITY_SEGMENTS.some(s => pathA.startsWith(s))
    const bHigh = HIGH_PRIORITY_SEGMENTS.some(s => pathB.startsWith(s))
    if (aHigh && !bHigh) return -1
    if (bHigh && !aHigh) return 1

    // Prefer shallower paths (top-level pages over deep blog posts)
    return pathA.split('/').length - pathB.split('/').length
  })
}

// ── Sitemap parsing ───────────────────────────────────────────────────────────

async function getSitemapUrls(origin: string): Promise<string[]> {
  const urls: string[] = []

  async function parseSitemapXml(sitemapUrl: string, depth = 0): Promise<void> {
    if (depth > 2) return
    const result = await safeFetch(sitemapUrl, 12000)
    if (!result) return
    const xml = result.html

    // Sitemap index: contains nested <sitemap><loc>...</loc></sitemap>
    const indexMatches = [...xml.matchAll(/<sitemap[\s\S]*?<loc>\s*(.*?)\s*<\/loc>/gi)]
    if (indexMatches.length > 0) {
      await Promise.all(indexMatches.slice(0, 5).map(m => parseSitemapXml(m[1].trim(), depth + 1)))
      return
    }

    // Regular sitemap: extract <url><loc>...</loc></url> entries
    const locMatches = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)]
    for (const match of locMatches) {
      const loc = match[1].trim()
      if (loc.startsWith('http')) urls.push(loc)
    }
  }

  // Try common sitemap locations
  await parseSitemapXml(`${origin}/sitemap.xml`)
  if (urls.length === 0) await parseSitemapXml(`${origin}/sitemap_index.xml`)

  return [...new Set(urls.map(normalizeUrl))]
}

// Fallback: extract internal links from homepage HTML
function extractInternalLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html)
  const hostname = new URL(baseUrl).hostname
  const urls = new Set<string>()

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    try {
      const resolved = new URL(href, baseUrl)
      if (resolved.hostname === hostname) {
        urls.add(normalizeUrl(resolved.href))
      }
    } catch {
      // skip invalid hrefs
    }
  })

  return [...urls]
}

// ── Per-page data extraction ──────────────────────────────────────────────────

function extractBodyText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function extractPageSummary(url: string, html: string): PageSummary {
  const $ = cheerio.load(html)
  const hostname = new URL(url).hostname

  const title = $('title').first().text().trim() || null
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || null
  const h1 = $('h1').first().text().trim() || null

  const bodyText = extractBodyText(html)
  const wordCount = countWords(bodyText)
  const bodyExcerpt = bodyText.slice(0, 500)
  const imageCount = $('img').length

  let internalLinkCount = 0
  let externalLinkCount = 0

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
    try {
      const resolved = new URL(href, url)
      if (resolved.hostname === hostname) {
        internalLinkCount++
      } else if (resolved.protocol.startsWith('http')) {
        externalLinkCount++
      }
    } catch {
      if (href.startsWith('/') || href.startsWith('./')) internalLinkCount++
    }
  })

  return {
    url,
    title,
    metaDescription,
    h1,
    bodyExcerpt,
    wordCount,
    imageCount,
    internalLinkCount,
    externalLinkCount,
    fetchError: null,
  }
}

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchContentAuditData(
  requirements: Record<string, string>,
): Promise<ContentAuditFetchResult> {
  const rawUrl = requirements['website_url'] ?? ''
  const baseUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  const baseHostname = new URL(baseUrl).hostname

  const brandName = requirements['brand_name'] ?? ''
  const targetAudience = requirements['target_audience'] || null
  const businessGoals = requirements['business_goals'] || null
  const competitorUrlsRaw = requirements['competitor_urls'] || ''
  const maxPages = Math.min(
    parseInt(requirements['max_pages'] ?? String(DEFAULT_MAX_PAGES), 10) || DEFAULT_MAX_PAGES,
    MAX_PAGES_HARD_LIMIT,
  )

  // ── 1. Fetch homepage ──────────────────────────────────────────────────────
  const homepageResult = await safeFetch(baseUrl)
  const homepageHtml = homepageResult?.html ?? ''
  const homepageHeaders = homepageResult?.headers ?? {}

  const techStack = homepageHtml ? detectTechStack(homepageHtml, homepageHeaders) : null
  const isCsr = homepageHtml ? detectCsr(homepageHtml) : false

  // ── 2. Discover URLs ───────────────────────────────────────────────────────
  let allUrls = await getSitemapUrls(new URL(baseUrl).origin)

  if (allUrls.length === 0 && homepageHtml) {
    allUrls = extractInternalLinks(homepageHtml, baseUrl)
  }

  // Always include homepage
  const normalizedBase = normalizeUrl(baseUrl)
  if (!allUrls.includes(normalizedBase)) {
    allUrls.unshift(normalizedBase)
  }

  const totalPagesFound = allUrls.length

  // ── 3. Filter + prioritize + cap ──────────────────────────────────────────
  const filtered = allUrls.filter(u => !shouldExclude(u, baseHostname))
  const ordered = prioritize(filtered, baseUrl)
  const urlsToFetch = ordered.slice(0, maxPages)

  // ── 4. Fetch all content pages in parallel ─────────────────────────────────
  const pageResults = await Promise.allSettled(
    urlsToFetch.map(async (url): Promise<PageSummary> => {
      // Reuse already-fetched homepage
      if (url === normalizedBase && homepageHtml) {
        return extractPageSummary(url, homepageHtml)
      }
      const result = await safeFetch(url)
      if (!result) {
        return {
          url, title: null, metaDescription: null, h1: null,
          bodyExcerpt: '', wordCount: 0, imageCount: 0,
          internalLinkCount: 0, externalLinkCount: 0,
          fetchError: 'Failed to fetch',
        }
      }
      return extractPageSummary(url, result.html)
    }),
  )

  const pages: PageSummary[] = pageResults
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter((p): p is PageSummary => p !== null)

  // ── 5. Fetch competitor pages in parallel ──────────────────────────────────
  const competitorUrls = competitorUrlsRaw
    .split(/[\n,]+/)
    .map(u => u.trim())
    .filter(u => u.startsWith('http'))
    .slice(0, 5)

  const competitorResults = await Promise.allSettled(
    competitorUrls.map(async (url): Promise<PageSummary> => {
      const result = await safeFetch(url)
      if (!result) {
        return {
          url, title: null, metaDescription: null, h1: null,
          bodyExcerpt: '', wordCount: 0, imageCount: 0,
          internalLinkCount: 0, externalLinkCount: 0,
          fetchError: 'Failed to fetch',
        }
      }
      return extractPageSummary(url, result.html)
    }),
  )

  const competitorPages: PageSummary[] = competitorResults
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter((p): p is PageSummary => p !== null)

  return {
    websiteUrl: baseUrl,
    brandName,
    targetAudience,
    businessGoals,
    hasCompetitors: competitorPages.filter(p => !p.fetchError).length > 0,
    pages,
    competitorPages,
    techStack: isCsr && techStack
      ? `${techStack} (client-side rendered — body content may be limited)`
      : isCsr
        ? 'Client-side rendered app (body content may be limited)'
        : techStack,
    isCsr,
    totalPagesFound,
    pagesAudited: pages.filter(p => !p.fetchError).length,
  }
}
