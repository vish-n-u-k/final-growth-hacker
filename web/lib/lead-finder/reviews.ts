// Competitor review readers shared by Lead Finder and the Lead Agent.

import * as cheerio from 'cheerio'

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface RawReview {
  company: string
  reviewText: string
  rating: number
  reviewDate: string | null   // ISO date string e.g. "2024-03-15"
  reviewUrl: string | null
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

export async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    return res.text()
  } catch {
    return null
  }
}

// ── Trustpilot scraper ────────────────────────────────────────────────────────

export async function scrapeTrustpilot(inputUrl: string): Promise<RawReview[]> {
  let tpBase: URL
  try {
    if (inputUrl.includes('trustpilot.com')) {
      tpBase = new URL(inputUrl)
      tpBase.searchParams.delete('stars')
    } else {
      const domain = inputUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
      tpBase = new URL(`https://www.trustpilot.com/review/${domain}`)
    }
  } catch { return [] }

  // Fetch pages 1-3 for Trustpilot (no star filter — Claude will judge fit)
  const pageUrls = [1, 2, 3].map(p => {
    const u = new URL(tpBase.toString())
    u.searchParams.set('page', String(p))
    return u.toString()
  })

  const htmlPages = await Promise.all(pageUrls.map(fetchHtml))
  const reviews: RawReview[] = []

  for (const html of htmlPages) {
    if (!html) continue
    const $ = cheerio.load(html)

    $('[data-review-id]').each((_, el) => {
      const $el = $(el)

      const ratingLabel = $el.find('[aria-label*="out of 5 stars"]').first().attr('aria-label') ?? ''
      const ratingMatch = ratingLabel.match(/^(\d+(?:\.\d+)?)/)
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0

      const reviewText = (
        $el.find('[data-service-review-text-typography]').first().text().trim() ||
        $el.find('[class*="reviewBody"], [class*="review-body"]').first().text().trim() ||
        $el.find('p').map((_, p) => $(p).text().trim()).get().find(t => t.length > 30) ||
        ''
      )
      if (reviewText.length < 20) return

      const reviewer = (
        $el.find('[class*="consumerName"], [class*="consumer-name"]').first().text().trim() ||
        $el.find('a[href*="/users/"]').first().text().trim() ||
        `Reviewer ${reviews.length + 1}`
      )

      const reviewDate = $el.find('time[datetime]').first().attr('datetime')?.slice(0, 10) ?? null
      const reviewId = $el.attr('data-review-id') ?? null
      const reviewUrl = reviewId ? `https://www.trustpilot.com/reviews/${reviewId}` : null

      reviews.push({ company: reviewer, reviewText: reviewText.slice(0, 400), rating, reviewDate, reviewUrl })
    })
  }

  return reviews
}
