import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url } = await req.json() as { url: string }

  let cleanPath: string
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    cleanPath = `https://apps.shopify.com${u.pathname.replace(/\/$/, '')}`
  } catch {
    cleanPath = url.split('?')[0].replace(/\/$/, '')
  }
  const reviewsUrl = cleanPath.endsWith('/reviews') ? cleanPath : `${cleanPath}/reviews`

  let status = 0
  let html = ''
  try {
    const res = await fetch(reviewsUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    })
    status = res.status
    html = await res.text()
  } catch (e) {
    return NextResponse.json({ error: String(e), reviewsUrl })
  }

  const hasNextData = html.includes('__NEXT_DATA__')
  const htmlLength = html.length

  // Extract __NEXT_DATA__ if present
  let nextDataSample: unknown = null
  if (hasNextData) {
    try {
      const scriptStart = html.indexOf('<script id="__NEXT_DATA__"')
      const jsonStart = html.indexOf('{', scriptStart)
      const scriptEnd = html.indexOf('</script>', scriptStart)
      const jsonEnd = html.lastIndexOf('}', scriptEnd)
      const raw = html.slice(jsonStart, jsonEnd + 1)
      const parsed = JSON.parse(raw) as Record<string, unknown>
      // Return just the top-level keys + pageProps keys
      const pageProps = (parsed?.props as Record<string, unknown>)?.pageProps ?? {}
      nextDataSample = {
        topKeys: Object.keys(parsed),
        pagePropsKeys: Object.keys(pageProps as object),
        // First review-like object if found
        sample: JSON.stringify(pageProps).slice(0, 3000),
      }
    } catch (e) {
      nextDataSample = { parseError: String(e) }
    }
  }

  // Extract full first review block — find data-merchant-review and grab until next one
  const firstReviewIdx = html.indexOf('data-merchant-review')
  const secondReviewIdx = html.indexOf('data-merchant-review', firstReviewIdx + 1)
  const firstReviewBlock = firstReviewIdx > 0
    ? html.slice(firstReviewIdx - 50, secondReviewIdx > 0 ? secondReviewIdx : firstReviewIdx + 5000)
    : ''

  // Find script tags with JSON data
  const scriptJsonSamples: string[] = []
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = scriptRe.exec(html)) !== null) {
    const content = m[1].trim()
    if (content.startsWith('{') || content.startsWith('[') || content.includes('"reviews"') || content.includes('"rating"')) {
      scriptJsonSamples.push(content.slice(0, 500))
    }
  }

  // Find indices of key review-related strings in the HTML
  const markers = ['review', 'rating', 'starRating', 'star_rating', 'body', 'shop_domain', 'myshopify']
  const markerPositions: Record<string, number> = {}
  for (const marker of markers) {
    markerPositions[marker] = html.indexOf(marker)
  }

  // Extract a 3000-char chunk around where reviews appear
  const reviewIdx = html.toLowerCase().indexOf('review')
  const htmlMidSample = reviewIdx > 0 ? html.slice(reviewIdx, reviewIdx + 3000) : ''

  // Look for any aria-label with star info
  const ariaStarMatches = [...html.matchAll(/aria-label="[^"]*star[^"]*"/gi)].slice(0, 5).map(m => m[0])

  // Count potential review containers
  const dataReviewCount = (html.match(/data-review/gi) ?? []).length
  const reviewListingCount = (html.match(/review-listing/gi) ?? []).length
  const reviewCardCount = (html.match(/review.?card/gi) ?? []).length

  return NextResponse.json({
    reviewsUrl,
    status,
    htmlLength,
    dataReviewCount,
    ariaStarMatches,
    firstReviewBlock,
  })
}
