export interface SeoFetchResult {
  html: string
  robotsTxt: string | null
  sitemapXml: string | null
  url: string
}

async function safeFetch(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GrowthHackerBot/1.0 (SEO Analyser)' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

function stripNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function extractContent(html: string, bodyMaxChars = 30000): string {
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i)
  const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i)
  const head = headMatch ? stripNoise(headMatch[0]) : ''
  const body = bodyMatch
    ? stripNoise(bodyMatch[0]).slice(0, bodyMaxChars)
    : stripNoise(html).slice(0, bodyMaxChars)
  return `${head}\n${body}`.trim()
}

export async function fetchSeoData(requirements: Record<string, string>): Promise<SeoFetchResult> {
  const rawUrl = requirements['website_url'] ?? ''
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  const origin = new URL(url).origin

  const [html, robotsTxt, sitemapXml] = await Promise.all([
    safeFetch(url),
    safeFetch(`${origin}/robots.txt`),
    safeFetch(`${origin}/sitemap.xml`),
  ])

  return {
    html: html ? extractContent(html) : '',
    robotsTxt: robotsTxt ? robotsTxt.slice(0, 4000) : null,
    sitemapXml: sitemapXml ? sitemapXml.slice(0, 6000) : null,
    url,
  }
}
