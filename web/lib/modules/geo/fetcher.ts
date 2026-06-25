export interface GeoFetchData {
  url: string
  html: string
  robotsTxt: string
  llmsTxt: string | null       // null = 404 / unreachable
  aiTxt: string | null         // /.well-known/ai.txt
  aiSummaryJson: string | null // /ai/summary.json
  aiFaqJson: string | null     // /ai/faq.json
  aiServiceJson: string | null // /ai/service.json
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthHackerBot/1.0)' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
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

  const [html, robotsTxt, llmsTxt, aiTxt, aiSummaryJson, aiFaqJson, aiServiceJson] = await Promise.all([
    fetchText(url, 12000),
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/llms.txt`),
    fetchText(`${origin}/.well-known/ai.txt`),
    fetchText(`${origin}/ai/summary.json`),
    fetchText(`${origin}/ai/faq.json`),
    fetchText(`${origin}/ai/service.json`),
  ])

  if (!html) return { error: `Could not fetch ${url}` }

  return {
    url,
    html,
    robotsTxt: robotsTxt ?? '',
    llmsTxt,
    aiTxt,
    aiSummaryJson,
    aiFaqJson,
    aiServiceJson,
  }
}
