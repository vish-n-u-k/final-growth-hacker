/**
 * URL Discovery
 *
 * Discovers all pages on a site via:
 *  1. Sitemap.xml (primary) — handles sitemap indexes + child sitemaps
 *  2. BFS link crawl (fallback when sitemap returns < crawlFallbackThreshold URLs)
 */

const UA = 'Mozilla/5.0 (compatible; GrowJinBot/1.0; +https://growthhacker.app)'

export interface DiscoveredUrl {
  url: string
  source: 'sitemap' | 'crawl'
  depth?: number        // crawl only — click depth from homepage
  sitemapName?: string  // sitemap only — which child sitemap this came from
  title?: string        // page <title> (populated by enrichUrlsWithMeta)
  metaDescription?: string // <meta name="description"> content
  h1?: string           // first <h1> text
}

export interface UrlDiscoveryResult {
  urls: DiscoveredUrl[]
  sitemapFound: boolean
  sitemapCount: number         // number of sitemap files parsed (1 for standard, N for index)
  crawlUsed: boolean
  totalDiscovered: number
  urlsByPrefix: Record<string, number> // e.g. { '/blog': 42, '/products': 15 }
}

// ── Page meta extraction ──────────────────────────────────────────────────────

function extractPageMeta(html: string): { title: string; metaDescription: string; h1: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch?.[1]?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() ?? ''

  const metaMatch =
    /<meta\s[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html) ??
    /<meta\s[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html)
  const metaDescription = metaMatch?.[1]?.trim() ?? ''

  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  const h1 = h1Match?.[1]?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() ?? ''

  return { title, metaDescription, h1 }
}

/**
 * Enrich a sample of discovered URLs with their page-level metadata (title, meta description, h1).
 * Samples one URL per top-level path prefix for variety, up to maxEnrich total.
 */
export async function enrichUrlsWithMeta(
  urls: DiscoveredUrl[],
  maxEnrich = 20,
): Promise<DiscoveredUrl[]> {
  // Pick one URL per top-level prefix first for variety, then fill remaining slots
  const byPrefix = new Map<string, DiscoveredUrl>()
  const overflow: DiscoveredUrl[] = []
  for (const item of urls) {
    try {
      const prefix = new URL(item.url).pathname.split('/').filter(Boolean)[0] ?? ''
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, item)
      else overflow.push(item)
    } catch {
      overflow.push(item)
    }
  }
  const sample = [...byPrefix.values(), ...overflow].slice(0, maxEnrich)

  const enriched = await Promise.all(
    sample.map(async (item) => {
      const html = await safeFetchText(item.url, 4000)
      if (!html) return item
      const { title, metaDescription, h1 } = extractPageMeta(html)
      const extra: Partial<DiscoveredUrl> = {}
      if (title) extra.title = title
      if (metaDescription) extra.metaDescription = metaDescription
      if (h1) extra.h1 = h1
      return { ...item, ...extra }
    }),
  )

  const enrichedMap = new Map(enriched.map(u => [u.url, u]))
  return urls.map(u => enrichedMap.get(u.url) ?? u)
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function safeFetchText(url: string, timeoutMs = 7000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

function parseSitemapLocs(xml: string, origin: string, sitemapName?: string): DiscoveredUrl[] {
  const urls: DiscoveredUrl[] = []
  const locRegex = /<loc>\s*([^<]+)\s*<\/loc>/gi
  let m
  while ((m = locRegex.exec(xml)) !== null) {
    const raw = m[1].replace(/&amp;/g, '&').trim()
    try {
      const u = new URL(raw)
      if (u.origin === origin) {
        urls.push({ url: raw, source: 'sitemap', ...(sitemapName ? { sitemapName } : {}) })
      }
    } catch { /* skip malformed URL */ }
  }
  return urls
}

function extractChildSitemapUrls(indexXml: string): string[] {
  const urls: string[] = []
  const blockRegex = /<sitemap>[\s\S]*?<\/sitemap>/gi
  let block
  while ((block = blockRegex.exec(indexXml)) !== null) {
    const locMatch = /<loc>\s*([^<]+)\s*<\/loc>/i.exec(block[0])
    if (locMatch) {
      const url = locMatch[1].replace(/&amp;/g, '&').trim()
      // Skip gzipped sitemaps (requires decompression)
      if (url && !url.endsWith('.gz')) urls.push(url)
    }
  }
  return urls
}

async function discoverFromSitemap(
  origin: string,
  maxUrls: number,
): Promise<{ urls: DiscoveredUrl[]; found: boolean; sitemapCount: number }> {
  const xml = await safeFetchText(`${origin}/sitemap.xml`)
  if (!xml) return { urls: [], found: false, sitemapCount: 0 }

  // Sitemap index — fetch all child sitemaps in parallel
  if (/<sitemapindex/i.test(xml)) {
    const childUrls = extractChildSitemapUrls(xml).slice(0, 10)
    const childXmls = await Promise.all(childUrls.map(u => safeFetchText(u, 5000)))
    const allUrls: DiscoveredUrl[] = []
    for (let i = 0; i < childUrls.length; i++) {
      const childXml = childXmls[i]
      if (!childXml) continue
      const name = new URL(childUrls[i]).pathname.split('/').pop() ?? childUrls[i]
      allUrls.push(...parseSitemapLocs(childXml, origin, name))
      if (allUrls.length >= maxUrls) break
    }
    return { urls: allUrls.slice(0, maxUrls), found: true, sitemapCount: childUrls.length }
  }

  // Standard sitemap
  const urls = parseSitemapLocs(xml, origin, 'sitemap.xml').slice(0, maxUrls)
  return { urls, found: true, sitemapCount: 1 }
}

function extractInternalLinks(html: string, baseUrl: string, origin: string): string[] {
  const seen = new Set<string>()
  const skipExts = new Set([
    'jpg','jpeg','png','gif','svg','webp','ico','pdf','zip',
    'css','js','xml','json','woff','woff2','ttf','mp4','mp3','mov','avi',
  ])
  const hrefRegex = /href=["']([^"']+)["']/gi
  let m
  while ((m = hrefRegex.exec(html)) !== null) {
    const href = m[1].trim()
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue
    try {
      const resolved = new URL(href, baseUrl)
      if (resolved.origin !== origin) continue
      const ext = resolved.pathname.split('.').pop()?.toLowerCase() ?? ''
      if (skipExts.has(ext)) continue
      resolved.search = ''
      resolved.hash = ''
      const normalized = resolved.href.replace(/\/$/, '') || origin
      seen.add(normalized)
    } catch { /* skip */ }
  }
  return Array.from(seen)
}

async function crawlSite(
  origin: string,
  homepageHtml: string,
  maxUrls: number,
  maxDepth: number,
): Promise<DiscoveredUrl[]> {
  const discovered = new Map<string, DiscoveredUrl>()
  const queue: Array<{ url: string; depth: number }> = []

  const homepageLinks = extractInternalLinks(homepageHtml, `${origin}/`, origin)
  for (const link of homepageLinks) {
    if (discovered.size >= maxUrls) break
    discovered.set(link, { url: link, source: 'crawl', depth: 1 })
    if (maxDepth > 1) queue.push({ url: link, depth: 1 })
  }

  while (queue.length > 0 && discovered.size < maxUrls) {
    const batch = queue.splice(0, 8)
    const htmls = await Promise.all(batch.map(({ url }) => safeFetchText(url, 5000)))
    for (let i = 0; i < batch.length; i++) {
      const { url, depth } = batch[i]
      const html = htmls[i]
      if (!html || depth >= maxDepth) continue
      const links = extractInternalLinks(html, url, origin)
      for (const link of links) {
        if (!discovered.has(link) && discovered.size < maxUrls) {
          discovered.set(link, { url: link, source: 'crawl', depth: depth + 1 })
          if (depth + 1 < maxDepth) queue.push({ url: link, depth: depth + 1 })
        }
      }
    }
  }

  return Array.from(discovered.values())
}

function buildUrlsByPrefix(urls: DiscoveredUrl[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const { url } of urls) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean)
      const prefix = parts.length > 0 ? `/${parts[0]}` : '/'
      counts[prefix] = (counts[prefix] ?? 0) + 1
    } catch { /* skip */ }
  }
  return counts
}

/**
 * Discover all pages on a site.
 *
 * @param baseUrl       The website URL (with or without https://)
 * @param homepageHtml  Optional — if provided and sitemap is sparse, falls back to BFS crawl
 * @param opts          maxUrls (default 300), maxCrawlDepth (default 2), crawlFallbackThreshold (default 5)
 */
export async function discoverAllUrls(
  baseUrl: string,
  homepageHtml?: string,
  opts?: {
    maxUrls?: number
    maxCrawlDepth?: number
    crawlFallbackThreshold?: number
    enrichMeta?: boolean | number // fetch title/meta/h1 for a sample of discovered URLs
  },
): Promise<UrlDiscoveryResult> {
  const maxUrls = opts?.maxUrls ?? 300
  const maxCrawlDepth = opts?.maxCrawlDepth ?? 2
  const crawlThreshold = opts?.crawlFallbackThreshold ?? 5

  const normalized = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
  let origin: string
  try {
    origin = new URL(normalized).origin
  } catch {
    return { urls: [], sitemapFound: false, sitemapCount: 0, crawlUsed: false, totalDiscovered: 0, urlsByPrefix: {} }
  }

  const { urls: sitemapUrls, found: sitemapFound, sitemapCount } = await discoverFromSitemap(origin, maxUrls)

  let crawlUsed = false
  let finalUrls = sitemapUrls

  if (sitemapUrls.length < crawlThreshold && homepageHtml) {
    crawlUsed = true
    finalUrls = await crawlSite(origin, homepageHtml, maxUrls, maxCrawlDepth)
  }

  let capped = finalUrls.slice(0, maxUrls)

  const enrichCount = typeof opts?.enrichMeta === 'number'
    ? opts.enrichMeta
    : opts?.enrichMeta ? 20 : 0
  if (enrichCount > 0) {
    capped = await enrichUrlsWithMeta(capped, enrichCount)
  }

  return {
    urls: capped,
    sitemapFound,
    sitemapCount,
    crawlUsed,
    totalDiscovered: capped.length,
    urlsByPrefix: buildUrlsByPrefix(capped),
  }
}

/**
 * Format URL discovery data as a text block for AI prompts.
 */
export function formatUrlProfile(discovery: UrlDiscoveryResult, label = 'Site'): string {
  if (discovery.totalDiscovered === 0) return `${label} pages: Could not discover (no sitemap, crawl not available)`

  const source = discovery.crawlUsed ? 'crawl' : `sitemap${discovery.sitemapCount > 1 ? ` (${discovery.sitemapCount} files)` : ''}`
  const prefixes = Object.entries(discovery.urlsByPrefix)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([p, n]) => `${p} (${n})`)
    .join(', ')

  const lines = [
    `${label} pages discovered: ${discovery.totalDiscovered} (via ${source})`,
    prefixes ? `Content distribution: ${prefixes}` : '',
  ]

  const withMeta = discovery.urls.filter(u => u.title || u.metaDescription || u.h1)
  if (withMeta.length > 0) {
    lines.push('Page metadata (sample):')
    for (const u of withMeta) {
      const path = (() => { try { return new URL(u.url).pathname || '/' } catch { return u.url } })()
      const parts: string[] = []
      if (u.title) parts.push(`title: "${u.title}"`)
      if (u.h1 && u.h1 !== u.title) parts.push(`h1: "${u.h1}"`)
      if (u.metaDescription) parts.push(`meta: "${u.metaDescription.length > 120 ? u.metaDescription.slice(0, 120) + '…' : u.metaDescription}"`)
      lines.push(`  ${path} — ${parts.join(' | ')}`)
    }
  } else {
    const sampleUrls = discovery.urls
      .slice(0, 12)
      .map(u => { try { return new URL(u.url).pathname } catch { return u.url } })
      .join(', ')
    if (sampleUrls) lines.push(`Sample paths: ${sampleUrls}`)
  }

  return lines.filter(Boolean).join('\n')
}
