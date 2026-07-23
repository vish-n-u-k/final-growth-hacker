import { discoverAllUrls, formatUrlProfile, type UrlDiscoveryResult } from '@/lib/audit/url-discovery'

export interface CompetitorData {
  url: string
  html: string | null
  error?: string
  urlProfile: string  // pre-formatted for AI prompt
  urlDiscovery: UrlDiscoveryResult
}

export interface CompetitorAuditFetchResult {
  competitors: CompetitorData[]
  industryKeywords: string[]
  userUrl: string
  userHtml: string | null
  userUrlProfile: string
}

async function safeFetch(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GrowJinBot/1.0 (Competitor Analyser)' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

function extractContent(html: string, maxChars = 8000): string {
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  const headMatch = clean.match(/<head[\s\S]*?<\/head>/i)
  const bodyMatch = clean.match(/<body[\s\S]*?<\/body>/i)
  const head = headMatch ? headMatch[0] : ''
  const body = bodyMatch
    ? bodyMatch[0].slice(0, Math.max(0, maxChars - head.length))
    : clean.slice(0, maxChars)
  return `${head}\n${body}`.trim()
}

export async function fetchCompetitorAuditData(
  requirements: Record<string, string>,
  userWebsiteUrl?: string,
): Promise<CompetitorAuditFetchResult> {
  const rawUrls = (requirements['competitor_urls'] ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)

  const industryKeywords = (requirements['industry_keywords'] ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)

  const userUrl = userWebsiteUrl ?? ''

  const normalizedCompetitorUrls = rawUrls.map(u => (u.startsWith('http') ? u : `https://${u}`))
  const normalizedUserUrl = userUrl
    ? (userUrl.startsWith('http') ? userUrl : `https://${userUrl}`)
    : ''

  // Fetch HTML + URL discovery for all sites in parallel
  const [[userHtmlRaw, ...competitorHtmls], [userDiscovery, ...competitorDiscoveries]] = await Promise.all([
    Promise.all([
      normalizedUserUrl ? safeFetch(normalizedUserUrl) : Promise.resolve(null),
      ...normalizedCompetitorUrls.map(u => safeFetch(u)),
    ]),
    Promise.all([
      normalizedUserUrl
        ? discoverAllUrls(normalizedUserUrl, undefined, { maxUrls: 150, enrichMeta: 20 })
        : Promise.resolve({ urls: [], sitemapFound: false, sitemapCount: 0, crawlUsed: false, totalDiscovered: 0, urlsByPrefix: {} } as UrlDiscoveryResult),
      ...normalizedCompetitorUrls.map(u => discoverAllUrls(u, undefined, { maxUrls: 150, enrichMeta: 10 })),
    ]),
  ])

  const userHtml = userHtmlRaw ? extractContent(userHtmlRaw, 5000) : null

  const competitors: CompetitorData[] = normalizedCompetitorUrls.map((url, i) => {
    const rawHtml = competitorHtmls[i] ?? null
    const discovery = competitorDiscoveries[i]
    if (!rawHtml) {
      return {
        url,
        html: null,
        error: 'Unable to access — returned no content or timed out',
        urlProfile: formatUrlProfile(discovery, url),
        urlDiscovery: discovery,
      }
    }
    return {
      url,
      html: extractContent(rawHtml),
      urlProfile: formatUrlProfile(discovery, url),
      urlDiscovery: discovery,
    }
  })

  return {
    competitors,
    industryKeywords,
    userUrl: normalizedUserUrl,
    userHtml,
    userUrlProfile: formatUrlProfile(userDiscovery, normalizedUserUrl || 'Your site'),
  }
}
