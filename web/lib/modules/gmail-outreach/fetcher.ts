import * as cheerio from 'cheerio'

export interface GmailOutreachFetchResult {
  url: string
  brandName: string
  title: string
  metaDescription: string
  h1: string
  h2s: string[]
  ctaTexts: string[]
  bodyText: string
}

export async function fetchGmailOutreachData(
  requirements: Record<string, string>,
): Promise<GmailOutreachFetchResult> {
  const url       = requirements['website_url'] ?? ''
  const brandName = requirements['brand_name'] ?? ''

  const result: GmailOutreachFetchResult = {
    url, brandName,
    title: '', metaDescription: '', h1: '', h2s: [], ctaTexts: [], bodyText: '',
  }

  if (!url) return result

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthHackerBot/1.0)' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return result
    const html = await res.text()
    const $ = cheerio.load(html)

    result.title           = $('title').first().text().trim()
    result.metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? ''
    result.h1              = $('h1').first().text().trim()
    result.h2s             = $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 8)
    result.ctaTexts        = $('a, button').map((_, el) => $(el).text().trim()).get()
                               .filter(t => t.length > 2 && t.length < 60).slice(0, 10)

    $('script, style, nav, footer, header').remove()
    result.bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 4000)
  } catch {
    // Return partial result if fetch fails
  }

  return result
}
