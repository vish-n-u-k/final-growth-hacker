import * as cheerio from 'cheerio'

export interface AudienceDiscoveryFetchResult {
  brandName: string
  websiteUrl: string
  title: string
  metaDescription: string
  h1: string
  h2s: string[]
  bodyTextSnippet: string
  navLinks: { text: string; href: string }[]
  ctaTexts: string[]
  fetchFailed: boolean
}

async function safeFetch(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GrowJinBot/1.0 (Site Auditor)' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

function extractPageData(html: string) {
  const $ = cheerio.load(html)

  const title = $('title').first().text().trim()
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? ''
  const h1 = $('h1').first().text().trim()
  const h2s = $('h2').map((_, el) => $(el).text().trim()).get().slice(0, 6)

  const navLinks: { text: string; href: string }[] = []
  $('nav a, header a').each((_, el) => {
    const text = $(el).text().trim()
    const href = $(el).attr('href') ?? ''
    if (text && href) navLinks.push({ text, href })
  })

  $('script, style, svg, noscript').remove()
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
  const bodyTextSnippet = bodyText.slice(0, 1200)

  const ctaTexts: string[] = []
  $('button, [class*="btn"], [class*="cta"], a[class*="button"]').each((_, el) => {
    const text = $(el).text().trim()
    if (text) ctaTexts.push(text)
  })

  return { title, metaDescription, h1, h2s, navLinks, bodyTextSnippet, ctaTexts: ctaTexts.slice(0, 8) }
}

export async function fetchAudienceDiscoveryData(
  requirements: Record<string, string>,
): Promise<AudienceDiscoveryFetchResult> {
  const brandName = requirements['brand_name'] ?? ''
  const rawUrl = requirements['website_url'] ?? ''
  const websiteUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`

  const html = await safeFetch(websiteUrl)
  if (!html) {
    return {
      brandName,
      websiteUrl,
      title: '',
      metaDescription: '',
      h1: '',
      h2s: [],
      bodyTextSnippet: '',
      navLinks: [],
      ctaTexts: [],
      fetchFailed: true,
    }
  }

  const extracted = extractPageData(html)
  return {
    brandName,
    websiteUrl,
    ...extracted,
    fetchFailed: false,
  }
}
