export interface SitemapPageMeta {
  url: string
  path: string
  title: string
  metaDescription: string
  h1: string
}

export interface GeoFetchData {
  url: string
  html: string
  robotsTxt: string
  llmsTxt: string | null       // null = 404 / unreachable
  aiTxt: string | null         // /.well-known/ai.txt
  aiSummaryJson: string | null // /ai/summary.json
  aiFaqJson: string | null     // /ai/faq.json
  aiServiceJson: string | null // /ai/service.json
  sitemapUrls: string[]        // <loc> URLs extracted from /sitemap.xml
  sitemapPageMeta: SitemapPageMeta[] // title/meta/h1 for sampled sitemap pages
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowJinBot/1.0)' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

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

async function fetchSitemapPageMeta(sitemapUrls: string[], origin: string, max = 20): Promise<SitemapPageMeta[]> {
  // Sample one URL per top-level path prefix for variety
  const byPrefix = new Map<string, string>()
  const overflow: string[] = []
  for (const url of sitemapUrls) {
    try {
      const prefix = new URL(url).pathname.split('/').filter(Boolean)[0] ?? ''
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, url)
      else overflow.push(url)
    } catch {
      overflow.push(url)
    }
  }
  const sample = [...byPrefix.values(), ...overflow].slice(0, max)

  const results = await Promise.all(
    sample.map(async (url) => {
      const html = await fetchText(url, 4000)
      if (!html) return null
      const { title, metaDescription, h1 } = extractPageMeta(html)
      if (!title && !metaDescription && !h1) return null
      const path = (() => { try { return new URL(url).pathname || '/' } catch { return url } })()
      return { url, path, title, metaDescription, h1 }
    }),
  )

  return results.filter((r): r is SitemapPageMeta => r !== null)
}

export async function fetchGeoData(
  requirements: Record<string, string>,
): Promise<GeoFetchData | { error: string }> {
  const rawUrl = requirements['website_url']
  if (!rawUrl) return { error: 'Website URL is required.' }

  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return { error: `Invalid URL: ${rawUrl}` }
  }

  const [html, robotsTxt, llmsTxt, aiTxt, aiSummaryJson, aiFaqJson, aiServiceJson, sitemapXml] = await Promise.all([
    fetchText(url, 12000),
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/llms.txt`),
    fetchText(`${origin}/.well-known/ai.txt`),
    fetchText(`${origin}/ai/summary.json`),
    fetchText(`${origin}/ai/faq.json`),
    fetchText(`${origin}/ai/service.json`),
    fetchText(`${origin}/sitemap.xml`),
  ])

  if (!html) return { error: `Could not fetch ${url}` }

  const sitemapUrls = sitemapXml
    ? [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1].trim()).slice(0, 200)
    : []

  const sitemapPageMeta = sitemapUrls.length > 0
    ? await fetchSitemapPageMeta(sitemapUrls, origin, 20)
    : []

  return {
    url,
    html,
    robotsTxt: robotsTxt ?? '',
    llmsTxt,
    aiTxt,
    aiSummaryJson,
    aiFaqJson,
    aiServiceJson,
    sitemapUrls,
    sitemapPageMeta,
  }
}
