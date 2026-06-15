export interface CompetitorData {
  url: string
  html: string | null
  error?: string
}

export interface CompetitorAuditFetchResult {
  competitors: CompetitorData[]
  industryKeywords: string[]
  userUrl: string
  userHtml: string | null
}

async function safeFetch(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GrowthHackerBot/1.0 (Competitor Analyser)' },
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

  // Fetch all competitor pages + user's own site concurrently
  const [competitorResults, userHtmlRaw] = await Promise.all([
    Promise.all(
      rawUrls.map(async (url): Promise<CompetitorData> => {
        const normalized = url.startsWith('http') ? url : `https://${url}`
        const html = await safeFetch(normalized)
        if (!html) {
          return {
            url: normalized,
            html: null,
            error: 'Unable to access — returned no content or timed out',
          }
        }
        return { url: normalized, html: extractContent(html) }
      }),
    ),
    userUrl
      ? safeFetch(userUrl.startsWith('http') ? userUrl : `https://${userUrl}`)
      : Promise.resolve(null),
  ])

  const userHtml = userHtmlRaw ? extractContent(userHtmlRaw, 5000) : null

  return {
    competitors: competitorResults,
    industryKeywords,
    userUrl,
    userHtml,
  }
}
