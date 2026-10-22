// Competitor Leads, one step at a time:
//   reviews  → Shopify App Store pages are read directly; Trustpilot comes from DataForSEO (Trustpilot
//              blocks servers), else a direct read that says plainly when it was blocked
// Then, only for a review the user picks (app/(shell)/lead-finder/review/[id]):
//   score    → Claude checks how well the brand fits that reviewer
//   contact  → the reviewer's store website, then an email (Hunter, else the site's own pages)
//   draft    → a short personal email

import * as cheerio from 'cheerio'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brands, brainContext } from '@/lib/db/schema'
import { callAI } from '@/lib/ai/client'
import { UA, fetchHtml, type RawReview } from '@/lib/lead-finder/reviews'
import { dataForSeoConfigured, trustpilotReviewsResult, trustpilotReviewsTask } from '@/lib/agents/dataforseo'
import { findEmail, hunterConfigured } from '@/lib/agents/hunter'
import { agentsDemo } from '@/lib/agents/demo'
import { emailFromWebsite } from '@/lib/agents/lead-agent'
import { newMeter } from '@/lib/agents/store'

export type Platform = 'shopify' | 'trustpilot'

export interface ScoredReview extends RawReview {
  fitScore: number
  fitReason: string
  painPoints: string[]
}

// ── Brand context for scoring ─────────────────────────────────────────────────

export async function brandContextFor(userId: string): Promise<{ brandId: string; name: string; context: string } | null> {
  const [brand] = await db.select().from(brands).where(eq(brands.userId, userId)).limit(1)
  if (!brand) return null
  const [brain] = await db.select().from(brainContext).where(eq(brainContext.brandId, brand.id)).limit(1)
  const context = [
    `Brand: ${brand.name}`,
    `Website: ${brand.websiteUrl ?? ''}`,
    brain?.summary ? `What we do: ${brain.summary}` : null,
    brain?.facts ? `Key details: ${JSON.stringify(brain.facts).slice(0, 600)}` : null,
    brain?.limitations ? `What we do NOT offer (automatically disqualify leads whose complaint matches any item here): ${brain.limitations}` : null,
  ].filter(Boolean).join('\n')
  return { brandId: brand.id, name: brand.name, context }
}

// ── Step 1: reviews ───────────────────────────────────────────────────────────

function extractShopifyReviews(html: string): RawReview[] {
  const $ = cheerio.load(html)
  const reviews: RawReview[] = []
  $('[data-merchant-review]').each((_, el) => {
    const $el = $(el)
    const ratingLabel = $el.find('[role="img"][aria-label*="out of 5 stars"]').first().attr('aria-label') ?? ''
    const rating = parseFloat(ratingLabel.match(/^(\d+(?:\.\d+)?)/)?.[1] ?? '0')
    const reviewText = (
      $el.find('[data-truncate-content-copy] p').first().text().trim() ||
      $el.find('p.tw-break-words').first().text().trim() ||
      $el.find('p').map((_, p) => $(p).text().trim()).get().find(t => t.length > 20) ||
      ''
    )
    if (reviewText.length < 15) return
    const company = $el.find('span[title]').first().attr('title')?.trim() || $el.find('[class*="tw-text-heading"] span').first().text().trim() || ''
    if (!company) return
    const reviewDate = $el.find('time[datetime]').first().attr('datetime')?.slice(0, 10) ?? null
    reviews.push({ company, reviewText: reviewText.slice(0, 400), rating, reviewDate, reviewUrl: null })
  })
  return reviews
}

export function normalizeShopifyUrl(input: string): string {
  try {
    const u = new URL(input.startsWith('http') ? input : `https://${input}`)
    const clean = `https://apps.shopify.com${u.pathname.replace(/\/$/, '')}`
    return clean.endsWith('/reviews') ? clean : `${clean}/reviews`
  } catch {
    const clean = input.split('?')[0].replace(/\/$/, '')
    return clean.endsWith('/reviews') ? clean : `${clean}/reviews`
  }
}

/** Shopify App Store: pages 1-5 (about 50 reviews). Throws a plain message when nothing could be read. */
export async function shopifyReviews(input: string): Promise<RawReview[]> {
  const base = normalizeShopifyUrl(input.trim())
  const pages = await Promise.all([1, 2, 3, 4, 5].map(p => fetchHtml(`${base}?page=${p}`)))
  if (!pages[0]) throw new Error('Couldn’t open that Shopify App Store page. Check the link (it should look like apps.shopify.com/app-name).')
  const all: RawReview[] = []
  for (const html of pages) {
    if (!html) continue
    const batch = extractShopifyReviews(html)
    if (!batch.length) break
    all.push(...batch)
  }
  return all
}

export const trustpilotDomain = (input: string) => {
  const s = input.trim()
  const m = s.match(/trustpilot\.com\/review\/([^/?#]+)/i)
  return (m ? m[1] : s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0]).toLowerCase()
}

/** Trustpilot pages 1-3 read directly. Trustpilot's bot protection usually refuses servers. */
async function trustpilotDirect(domain: string): Promise<RawReview[]> {
  const pages = await Promise.all([1, 2, 3].map(async p => {
    const res = await fetch(`https://www.trustpilot.com/review/${domain}?page=${p}`, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null)
    if (!res) return { blocked: false, html: null as string | null }
    if (res.status === 403 || res.status === 429) return { blocked: true, html: null }
    return { blocked: false, html: res.ok ? await res.text() : null }
  }))
  if (pages[0].blocked) throw new Error('BLOCKED')
  const reviews: RawReview[] = []
  for (const { html } of pages) {
    if (!html) continue
    const $ = cheerio.load(html)
    $('[data-review-id]').each((_, el) => {
      const $el = $(el)
      const rating = parseFloat(($el.find('[aria-label*="out of 5 stars"]').first().attr('aria-label') ?? '').match(/^(\d+(?:\.\d+)?)/)?.[1] ?? '0')
      const text = $el.find('[data-service-review-text-typography]').first().text().trim() || $el.find('p').map((_, x) => $(x).text().trim()).get().find(t => t.length > 30) || ''
      if (text.length < 20) return
      const name = $el.find('[class*="consumerName"], [class*="consumer-name"]').first().text().trim() || 'Trustpilot reviewer'
      const id = $el.attr('data-review-id')
      reviews.push({ company: name, reviewText: text.slice(0, 400), rating, reviewDate: $el.find('time[datetime]').first().attr('datetime')?.slice(0, 10) ?? null, reviewUrl: id ? `https://www.trustpilot.com/reviews/${id}` : null })
    })
  }
  return reviews
}

export type ReviewsStep =
  | { reviews: RawReview[]; source: string; cost?: number }
  | { pending: string; source: string; cost?: number }   // DataForSEO task id: poll with trustpilotPoll

export async function startReviews(platform: Platform, input: string): Promise<ReviewsStep> {
  if (platform === 'shopify') return { reviews: await shopifyReviews(input), source: 'Shopify App Store' }
  const domain = trustpilotDomain(input)
  if (!domain || !domain.includes('.')) throw new Error('Enter the competitor’s website (like buffer.com) or their Trustpilot link.')
  if (dataForSeoConfigured()) {
    const meter = newMeter()
    return { pending: await trustpilotReviewsTask(domain, meter), source: 'Trustpilot', cost: meter.dataforseo }
  }
  try {
    return { reviews: await trustpilotDirect(domain), source: 'Trustpilot' }
  } catch (e) {
    if (e instanceof Error && e.message === 'BLOCKED') {
      throw new Error('Trustpilot blocked the request, so no reviews could be read. Reading Trustpilot reliably needs DataForSEO set up; the Shopify App Store works without it.')
    }
    throw e
  }
}

export async function trustpilotPoll(taskId: string): Promise<RawReview[] | null> {
  const r = await trustpilotReviewsResult(taskId)
  return r && r.map(x => ({ company: x.name, reviewText: x.text, rating: x.rating, reviewDate: x.date, reviewUrl: x.url }))
}

// ── Step 3: fit scoring (small batches, so the page can show progress) ────────

export async function scoreBatch(reviews: RawReview[], brandContext: string): Promise<ScoredReview[]> {
  if (!reviews.length) return []
  const list = reviews.map((r, i) => `[${i}] Reviewer: "${r.company}" | Stars: ${r.rating}/5 | Review: "${r.reviewText}"`).join('\n\n')
  const raw = await callAI({
    feature: 'lead-finder',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1500,
    system: 'You are a sales qualification expert. Evaluate leads based on product-market fit. Return only a raw JSON array.',
    prompt: `OUR PRODUCT:
${brandContext}

STEP 1 — Before scoring anything, list to yourself the top 5 specific problems our product solves, based only on the description above. Be concrete.

STEP 2 — Score each review below 1-10 by whether the reviewer's complaint directly matches one of those problems:
- 8-10: their complaint maps directly to a specific problem our product solves
- 5-7: partial overlap, not a direct match
- 1-4: no match, even if we "might" help
Default to 1-4 when in doubt; many things a competitor lacks we lack too. Don't factor in the star rating.

COMPETITOR REVIEWS:
${list}

Return ONLY a raw JSON array with one entry per review:
[{"i":0,"score":8,"reason":"One plain sentence a non-technical person understands: their problem and why our product helps","painPoints":["2-4 word complaint","another"]}]`,
  })
  const start = raw.indexOf('['), end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const scored = JSON.parse(raw.slice(start, end + 1)) as { i: number; score: number; reason?: string; painPoints?: string[] }[]
    return scored
      .filter(s => typeof s.i === 'number' && s.i >= 0 && s.i < reviews.length && typeof s.score === 'number')
      .map(s => ({ ...reviews[s.i], fitScore: s.score, fitReason: s.reason ?? '', painPoints: (s.painPoints ?? []).slice(0, 4) }))
  } catch {
    return []
  }
}

// ── Step 4: contact ───────────────────────────────────────────────────────────

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-')

/** A Shopify merchant's store: name.myshopify.com, following its redirect to the real domain. */
async function shopifyStoreDomain(store: string): Promise<string | null> {
  const s = slug(store)
  if (!s) return null
  const res = await fetch(`https://${s}.myshopify.com`, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(4000), redirect: 'manual' }).catch(() => null)
  if (!res || res.status >= 400) return null
  const loc = res.headers.get('location')
  const host = loc ? (() => { try { return new URL(loc, `https://${s}.myshopify.com`).hostname } catch { return null } })() : null
  return (host ?? `${s}.myshopify.com`).replace(/^www\./, '')
}

export interface Contact { website: string | null; email: string | null; verified: boolean; via: 'hunter' | 'website' | null; hunterLookups: number }

export async function findContact(platform: Platform, name: string): Promise<Contact> {
  // Trustpilot reviewers are people, not stores: their website isn't known
  const domain = platform === 'shopify' ? await shopifyStoreDomain(name) : null
  if (!domain) return { website: null, email: null, verified: false, via: null, hunterLookups: 0 }
  const website = `https://${domain}`
  // Hunter only for real: in the agents' demo mode it makes emails up, and this tool has no demo
  if (!domain.endsWith('myshopify.com') && hunterConfigured() && !agentsDemo()) {
    const meter = newMeter()
    const h = await findEmail(domain, undefined, meter).catch(() => null)
    if (h) return { website, email: h.email, verified: h.verified, via: 'hunter', hunterLookups: meter.hunter }
  }
  const site = await emailFromWebsite(domain).catch(() => null)
  return { website, email: site, verified: false, via: site ? 'website' : null, hunterLookups: 0 }
}

// ── Step 5: a short personal email ────────────────────────────────────────────

export async function draftEmail(brand: { name: string; context: string }, lead: { name: string; platform: Platform; painPoints: string[]; fitReason: string }): Promise<{ subject: string; body: string }> {
  const raw = await callAI({
    feature: 'lead-finder',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 600,
    system: 'You write short, honest first-touch sales emails for a small business. Return only a raw JSON object.',
    prompt: `${brand.context}

Write a first email to ${lead.platform === 'shopify' ? `the team behind the store "${lead.name}"` : lead.name}.
What they struggle with: ${lead.painPoints.join(', ') || 'see below'}
Why ${brand.name} fits them: ${lead.fitReason}

Rules: 60-110 words, plain text, no greeting line (we add it), sign off with "${brand.name}".
Speak to their problem naturally. Do NOT mention any review, do NOT name a competitor, do NOT imply you have been watching them.
One clear, low-pressure ask (a short reply, or a free trial/demo). No invented numbers, customers or claims. No em dashes.
Return {"subject":"under 60 characters, specific, no clickbait","body":"..."}`,
  })
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
  const j = start !== -1 && end > start ? (() => { try { return JSON.parse(raw.slice(start, end + 1)) as { subject?: string; body?: string } } catch { return null } })() : null
  if (!j?.subject || !j.body) throw new Error('The writer returned no email. Try again.')
  return { subject: j.subject.trim(), body: j.body.replace(/—/g, ',').trim() }
}
