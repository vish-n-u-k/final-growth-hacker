import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brainContext } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import * as cheerio from 'cheerio'
import { callAI } from '@/lib/ai/client'

export const maxDuration = 60

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawReview {
  company: string
  reviewText: string
  rating: number
  reviewDate: string | null   // ISO date string e.g. "2024-03-15"
}

export interface ScrapedLead {
  id: string
  company: string
  website: string | null
  email: string | null
  reviewText: string
  rating: number
  reviewDate: string | null
  fitScore: number
  fitReason: string
  platform: string
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string | null> {
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

// ── Review extraction from one HTML page ──────────────────────────────────────

function extractReviewsFromHtml(html: string): RawReview[] {
  const $ = cheerio.load(html)
  const reviews: RawReview[] = []

  $('[data-merchant-review]').each((_, el) => {
    const $el = $(el)

    const ratingLabel = $el.find('[role="img"][aria-label*="out of 5 stars"]').first().attr('aria-label') ?? ''
    const ratingMatch = ratingLabel.match(/^(\d+(?:\.\d+)?)/)
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0

    const reviewText = (
      $el.find('[data-truncate-content-copy] p').first().text().trim() ||
      $el.find('p.tw-break-words').first().text().trim() ||
      $el.find('p').map((_, p) => $(p).text().trim()).get().find(t => t.length > 20) ||
      ''
    )
    if (reviewText.length < 15) return

    const company = (
      $el.find('span[title]').first().attr('title')?.trim() ||
      $el.find('[class*="tw-text-heading"] span').first().text().trim() ||
      ''
    )
    if (!company) return

    const reviewDate = $el.find('time[datetime]').first().attr('datetime')?.slice(0, 10) ?? null

    reviews.push({ company, reviewText: reviewText.slice(0, 400), rating, reviewDate })
  })

  return reviews
}

// ── Scrape all pages in parallel ──────────────────────────────────────────────

async function scrapeAllReviews(baseReviewsUrl: string): Promise<RawReview[]> {
  // Fetch pages 1-5 in parallel (Shopify shows ~10 reviews/page → up to ~50 reviews)
  const pageUrls = [1, 2, 3, 4, 5].map(p => `${baseReviewsUrl}?page=${p}`)
  const htmlPages = await Promise.all(pageUrls.map(fetchHtml))

  const all: RawReview[] = []
  for (const html of htmlPages) {
    if (!html) continue
    const batch = extractReviewsFromHtml(html)
    if (batch.length === 0) break  // No more reviews on this page
    all.push(...batch)
  }

  return all
}

// ── Claude fit evaluation ─────────────────────────────────────────────────────

interface ScoredResult {
  i: number
  score: number
  reason: string
}

async function evaluateFit(
  reviews: RawReview[],
  brandContext: string,
): Promise<Array<RawReview & { fitScore: number; fitReason: string }>> {
  if (!reviews.length) return []

  const reviewList = reviews
    .map((r, i) =>
      `[${i}] Store: "${r.company}" | Stars: ${r.rating}/5 | Review: "${r.reviewText}"`
    )
    .join('\n\n')

  const prompt = `OUR PRODUCT:
${brandContext}

STEP 1 — Before scoring anything, extract the top 5 specific problems our product solves based solely on the description above. Be concrete — not "helps with social media" but "auto-posts short-form video to Instagram and TikTok". Hold this list in mind while scoring.

STEP 2 — For each review below, score 1-10 based on whether the merchant's complaint directly matches one of those 5 problems:
- 8-10: Their complaint maps directly to one of the 5 specific problems our product solves
- 5-7: Their complaint partially overlaps with our capabilities but is not a direct match
- 1-4: Their complaint does not match any of the 5 problems — even if it sounds vague enough that we "might" help

CRITICAL: Default to 1-4 when in doubt. Many things a competitor lacks are also things we lack. Only score high when you can point to a concrete capability from Step 1 that directly addresses the complaint. Do not guess.

Do NOT factor in star rating. A merchant giving 4 stars while complaining about a specific gap can be a better lead than a 1-star reviewer with an unrelated complaint.

COMPETITOR REVIEWS:
${reviewList}

Return ONLY a raw JSON array — no markdown, no code fences:
[{"i":0,"score":8,"reason":"One sentence citing the specific capability that matches their complaint, or why it does not match"}]`

  const raw = await callAI({
    system: 'You are a sales qualification expert. Evaluate leads based on product-market fit. Return only a raw JSON array.',
    prompt,
    maxTokens: 2000,
    model: 'claude-haiku-4-5-20251001',
  })

  try {
    const start = raw.indexOf('[')
    const end = raw.lastIndexOf(']')
    if (start === -1 || end === -1) return []

    const scored = JSON.parse(raw.slice(start, end + 1)) as ScoredResult[]

    return scored
      .filter(s => typeof s.i === 'number' && s.i >= 0 && s.i < reviews.length && s.score >= 4)
      .sort((a, b) => b.score - a.score)
      .map(s => ({
        ...reviews[s.i],
        fitScore: s.score,
        fitReason: s.reason ?? '',
      }))
  } catch {
    return []
  }
}

// ── myshopify URL resolver ────────────────────────────────────────────────────

function toMyshopifySlug(storeName: string): string {
  return storeName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')   // strip special chars
    .trim()
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/-+/g, '-')            // collapse duplicates
}

async function resolveMyshopifyUrl(storeName: string): Promise<string | null> {
  const slug = toMyshopifySlug(storeName)
  if (!slug) return null
  const url = `https://${slug}.myshopify.com`
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(3000),
      redirect: 'manual',
    })
    // Existing stores: 200 (password page) or 301/302 (custom domain redirect)
    // Non-existent stores: typically 404
    return res.status < 400 ? url : null
  } catch {
    return null
  }
}

// ── Normalize Shopify App Store URL ───────────────────────────────────────────

function normalizeShopifyUrl(inputUrl: string): string {
  try {
    const u = new URL(inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`)
    const clean = `https://apps.shopify.com${u.pathname.replace(/\/$/, '')}`
    return clean.endsWith('/reviews') ? clean : `${clean}/reviews`
  } catch {
    const clean = inputUrl.split('?')[0].replace(/\/$/, '')
    return clean.endsWith('/reviews') ? clean : `${clean}/reviews`
  }
}

// ── Trustpilot scraper ────────────────────────────────────────────────────────

async function scrapeTrustpilot(inputUrl: string): Promise<RawReview[]> {
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

      reviews.push({ company: reviewer, reviewText: reviewText.slice(0, 400), rating, reviewDate })
    })
  }

  return reviews
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { url?: string; platform?: string }
  if (!body.url?.trim()) return NextResponse.json({ error: 'Missing url' }, { status: 400 })
  if (!body.platform) return NextResponse.json({ error: 'Missing platform' }, { status: 400 })

  // Fetch brand + brain context for fit evaluation
  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 404 })

  const [brain] = await db.select().from(brainContext).where(eq(brainContext.brandId, brand.id)).limit(1)

  const brandContextStr = [
    `Brand: ${brand.name}`,
    `Website: ${brand.websiteUrl ?? ''}`,
    brain?.summary ? `What we do: ${brain.summary}` : null,
    brain?.facts ? `Key details: ${JSON.stringify(brain.facts).slice(0, 600)}` : null,
    brain?.limitations ? `What we do NOT offer (automatically disqualify leads whose complaint matches any item here): ${brain.limitations}` : null,
  ].filter(Boolean).join('\n')

  // Scrape all reviews then keep only unhappy merchants (< 4 stars)
  const allReviews = body.platform === 'shopify'
    ? await scrapeAllReviews(normalizeShopifyUrl(body.url.trim()))
    : await scrapeTrustpilot(body.url.trim())

  const rawReviews = allReviews.filter(r => r.rating < 4)

  if (!rawReviews.length) {
    return NextResponse.json({ leads: [], total: allReviews.length })
  }

  // Claude evaluates all reviews for product fit
  const scored = await evaluateFit(rawReviews, brandContextStr)

  // Attempt myshopify URL resolution in parallel for top 15
  const top = scored.slice(0, 15)
  const websites = body.platform === 'shopify'
    ? await Promise.all(top.map(r => resolveMyshopifyUrl(r.company)))
    : top.map(() => null)

  const leads: ScrapedLead[] = top.map((r, i) => ({
    id: `lead-${i}`,
    company: r.company,
    website: websites[i],
    email: null,
    reviewText: r.reviewText,
    rating: r.rating,
    reviewDate: r.reviewDate,
    fitScore: r.fitScore,
    fitReason: r.fitReason,
    platform: body.platform!,
  }))

  return NextResponse.json({ leads, total: allReviews.length })
}
