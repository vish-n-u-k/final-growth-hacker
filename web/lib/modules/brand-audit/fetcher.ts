import * as cheerio from 'cheerio'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isJsShell } from '@/lib/audit/js-shell'
import { detectBlock, type BlockInfo } from '@/lib/audit/blocked'
import { getCompetitors } from '@/lib/modules/competitor-registry'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BrandAuditFetchResult {
  websiteUrl: string
  brandName: string
  websiteType: string
  // From the brand profile (Settings → Brand); the module's own setup values are the fallback
  industry: string | null
  targetAudience: string | null
  usp: string | null
  brandVoice: string | null

  homepageLoaded: boolean
  homepageIsJsShell: boolean
  homepageBlocked: BlockInfo | null

  h1: string
  topText: string                  // what a visitor reads first: the headline and the copy right after it
  copySample: string               // the homepage copy, for the ideas
  headings: string[]               // h1–h3 text, in page order

  proof: {
    testimonials: string | null    // what we found ("a "What our customers say" section"), null = none
    logos: string | null
    numbers: string[]              // "2,000+ businesses", "4.8/5"
    reviewSites: { name: string; url: string }[]
    caseStudies: string | null
  }
  pricing: { link: string | null; pricesOnPage: boolean }
  riskFree: string | null          // the phrase we found ("7-day free trial", "no credit card")
  whyUs: string | null             // the heading that explains why you over the alternatives
  competitors: { name: string; url: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (compatible; GrowJinBot/1.0; +https://growjin.com)'
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

export async function fetchPage(url: string): Promise<{ html: string; block: BlockInfo | null }> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
    const body = await res.text().catch(() => '')
    const block = detectBlock(res.status, res.headers, body)
    return { html: res.ok && !block ? body : '', block }
  } catch {
    return { html: '', block: null }
  }
}

const REVIEW_SITES: [RegExp, string][] = [
  [/(^|\.)g2\.com$/i, 'G2'], [/(^|\.)capterra\.[a-z.]+$/i, 'Capterra'], [/(^|\.)trustpilot\.com$/i, 'Trustpilot'],
  [/(^|\.)producthunt\.com$/i, 'Product Hunt'], [/(^|\.)getapp\.com$/i, 'GetApp'], [/(^|\.)softwareadvice\.com$/i, 'Software Advice'],
  [/(^|\.)appsumo\.com$/i, 'AppSumo'], [/(^|\.)reviews\.io$/i, 'Reviews.io'], [/(^|\.)yelp\.[a-z.]+$/i, 'Yelp'],
  [/(^|\.)tripadvisor\.[a-z.]+$/i, 'Tripadvisor'], [/^g\.page$/i, 'Google reviews'], [/^apps\.apple\.com$/i, 'App Store'],
  [/^play\.google\.com$/i, 'Google Play'], [/^chromewebstore\.google\.com$/i, 'Chrome Web Store'],
]

function reviewSiteOf(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base)
    if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && /^\/maps/.test(u.pathname)) return 'Google reviews'
    return REVIEW_SITES.find(([re]) => re.test(u.hostname))?.[1] ?? null
  } catch {
    return null
  }
}

// Same family of phrases the Website Audit's "Social proof signals" check uses, split by kind
const TESTIMONIAL_HEADING = /\btestimonials?\b|what (our |real )?(customers|clients|users|people|founders|members|teams|creators) (say|are saying|think)|wall of love|\bloved by\b|hear (it )?from (our )?(customers|clients|users)|\b(customer|user|client|our) reviews\b|^reviews$/i
const LOGO_PHRASE = /\b(trusted|used|loved|chosen|backed) by\b|\bas (seen|featured) (in|on)\b|\bfeatured (in|on)\b|\bour (customers|clients|partners)\b|\bcompanies (using|that use|that trust)\b/i
const NUMBER_CLAIM = /\b(?!(19|20)\d\d\b)\d[\d,.]*\s*(k|m)?\+?\s*((?!(for|to|in|with|of|and|the|per|a|an)\b)[a-z-]+ ){0,2}?(users|customers|clients|businesses|companies|teams|founders|creators|brands|agencies|members|downloads|students|shops|stores|sellers|merchants|marketers|restaurants|owners|posts (created|made|published))\b/gi
const RATING = /\b[1-5]\.\d\s*(\/\s*5|out of 5|stars?)\b|\b[1-5]\s*(\/\s*5|out of 5)\b|★(\s*★){2,}/gi
// A review / testimonial card's class ("review-card", "testimonials", "customer_review"), not "preview"
const REVIEW_CLASS = /(^|[\s_-])(testimonials?|reviews?)([\s_-]|$)/i
// Small section labels above a heading ("What customers say"), which sites style instead of using a heading
const LABEL_SEL = '[class*="eyebrow" i], [class*="kicker" i], [class*="overline" i], [class*="tagline" i], [class*="label" i], [class*="subtitle" i], [class*="badge" i]'
const CASE_STUDY = /case.?stud|success.?stor|customer.?stor/i
const RISK_FREE = /\b\d+[- ]day free trial\b|\bfree trial\b|\bstart (for )?free\b|\btry (it )?(for )?free\b|\bfree (plan|forever|tier)\b|\bno credit card\b|\bno card (required|needed)\b|\bcancel any ?time\b|\bmoney[- ]back\b|\bfull refund\b|\b\d+[- ]day (money[- ]back )?guarantee\b|\bfree (returns|shipping)\b|\bbook a (free )?(demo|call)\b|\bfree (consultation|quote)\b/i
const WHY_US = /\bwhy (choose|use|pick|switch to|(teams|people|founders|businesses|agencies|brands) (choose|love|pick|use)) \w+|^why [\w .'-]{1,30}\?$|\bwhat makes (us|\w+) different\b|\bhow (we|\w+)('re| are| is)? different\b|\bunlike (other|most|traditional)\b|\bvs\.?\s|\bcompared (to|with)\b|\bthe (only|first) \w+|\balternative to\b/i
const PRICE = /(\$|€|£|₹)\s?\d|\b\d+(\.\d+)?\s?(usd|eur|gbp|inr)\b|\/\s?(mo|month)\b/i

// ── Reading a homepage ────────────────────────────────────────────────────────

export interface HomepageFacts {
  jsShell: boolean
  h1: string
  topText: string
  copySample: string
  headings: string[]
  title: string
  description: string
  proof: BrandAuditFetchResult['proof']
  pricing: BrandAuditFetchResult['pricing']
  riskFree: string | null
  whyUs: string | null
}

/** What a homepage says and shows. Also used by Competitor Analysis, so both modules read sites the same way. */
export function readHomepage(html: string, url: string): HomepageFacts {
  const $ = cheerio.load(html || '<html></html>')
  const jsShell = !!html && isJsShell($)

  // Facts read from the raw page (before nav/footer are stripped): links, scripts, structured data
  const links = $('a[href]').toArray().map(a => ({ href: $(a).attr('href') ?? '', text: clean($(a).text()) }))
  const reviewSites = new Map<string, string>()
  for (const l of links) { const n = reviewSiteOf(l.href, url); if (n && !reviewSites.has(n)) reviewSites.set(n, new URL(l.href, url).href) }
  $('script[src], img[src], iframe[src]').each((_, el) => {
    const src = $(el).attr('src') ?? ''
    const n = /trustpilot/i.test(src) ? 'Trustpilot' : /producthunt/i.test(src) ? 'Product Hunt' : /g2(crowd)?\.com/i.test(src) ? 'G2' : /capterra/i.test(src) ? 'Capterra' : null
    if (n && !reviewSites.has(n)) reviewSites.set(n, src)
  })
  let reviewSchema = false
  $('script[type="application/ld+json"]').each((_, el) => { if (/"@type"\s*:\s*"(Review|AggregateRating)"/.test($(el).text())) reviewSchema = true })
  const pricingLink = links.find(l => /\/(pricing|plans|prices)(\/|$|\?|#)/i.test(l.href) || /^(pricing|plans|see pricing|view pricing)$/i.test(l.text))
  const caseLink = links.find(l => CASE_STUDY.test(l.href) || CASE_STUDY.test(l.text))

  // Visible copy, without navigation and footer
  const body = $('body').clone()
  body.find('script, style, noscript, template, svg, nav, footer').remove()
  // A space between neighbouring tags, so "…free trial</a><p>Used by…" doesn't read as "trialUsed by"
  const bodyText = clean(cheerio.load((body.html() ?? '').replace(/></g, '> <')).text())
  const headings = $('h1, h2, h3').toArray().map(h => clean($(h).text())).filter(Boolean)
  const h1 = clean($('h1').first().text())

  // The top of the page: from the headline on (or the start of the copy), about two screens of text
  const at = h1 ? bodyText.indexOf(h1) : -1
  const topText = bodyText.slice(Math.max(0, at), Math.max(0, at) + 900)

  // Testimonials: a testimonials heading or label, review / quote cards, or review markup
  const labels = $(LABEL_SEL).toArray().map(el => clean($(el).text())).filter(t => t && t.length <= 80)
  const testimonialHeading = [...headings, ...labels].find(h => TESTIMONIAL_HEADING.test(h))
  // Cards: review / testimonial elements of a quote's size, counted by their most repeated class
  // ("review-card" ×5), so the section around them or a name line isn't counted as a quote
  const cardsByClass = new Map<string, number>()
  $('[class]').each((_, el) => {
    const cls = clean($(el).attr('class') ?? '')
    const len = clean($(el).text()).length
    if (REVIEW_CLASS.test(cls) && len >= 40 && len <= 1200) cardsByClass.set(cls, (cardsByClass.get(cls) ?? 0) + 1)
  })
  const cards = Math.max(0, ...cardsByClass.values())
  const quotes = Math.max(cards, $('blockquote').length)
  const testimonials = testimonialHeading
    ? `a "${testimonialHeading.slice(0, 60)}" section${quotes > 0 ? ` with ${quotes} customer quote${quotes > 1 ? 's' : ''}` : ''}`
    : quotes > 0 ? `${quotes} customer quote${quotes > 1 ? 's' : ''}`
    : reviewSchema ? 'review markup on the page' : null

  // Customer logos: a "trusted by" line, or a strip of 3+ logos
  const logoPhrase = LOGO_PHRASE.exec(bodyText)?.[0]
  const logoStrip = $('[class*="logo" i], [class*="client" i], [class*="customer" i], [class*="partner" i], [class*="brands" i]')
    .filter((_, el) => $(el).find('img, svg').length >= 3).length > 0
  const logos = logoPhrase ? `a "${logoPhrase[0].toUpperCase()}${logoPhrase.slice(1)}" line` : logoStrip ? 'a strip of customer logos' : null

  const numbers = [...new Set([...bodyText.matchAll(NUMBER_CLAIM), ...bodyText.matchAll(RATING)].map(m => clean(m[0]).replace(/★\s+/g, '★')))].slice(0, 4)
  const caseHeading = headings.find(h => CASE_STUDY.test(h))
  const caseStudies = caseLink ? `"${(caseLink.text || caseLink.href).slice(0, 60)}"` : caseHeading ? `"${caseHeading.slice(0, 60)}"` : null

  const riskFree = RISK_FREE.exec(bodyText)?.[0] ?? links.map(l => RISK_FREE.exec(l.text)?.[0]).find(Boolean) ?? null
  const whyUs = headings.slice(1).find(h => WHY_US.test(h)) ?? null


  return {
    jsShell, h1, topText, copySample: bodyText.slice(0, 2500), headings: headings.slice(0, 30),
    title: clean($('title').first().text()), description: clean($('meta[name="description"]').attr('content') ?? ''),
    proof: { testimonials, logos, numbers, reviewSites: [...reviewSites].map(([name, u]) => ({ name, url: u })), caseStudies },
    pricing: { link: pricingLink ? new URL(pricingLink.href, url).href : null, pricesOnPage: PRICE.test(bodyText) },
    riskFree: riskFree ? clean(riskFree) : null,
    whyUs,
  }
}

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchBrandAuditData(requirements: Record<string, string>): Promise<BrandAuditFetchResult> {
  const brandId = requirements['brand_id'] ?? ''
  const raw = requirements['website_url'] ?? ''
  const url = raw.startsWith('http') ? raw : `https://${raw}`
  try { new URL(url) } catch { throw new Error(`Invalid URL: ${raw}`) }

  const [[brand], competitors, home] = await Promise.all([
    brandId
      ? db.select({ name: brands.name, industry: brands.industry, targetAudience: brands.targetAudience, usp: brands.usp, brandVoice: brands.brandVoice, websiteType: brands.websiteType })
          .from(brands).where(eq(brands.id, brandId)).limit(1)
      : Promise.resolve([] as never[]),
    brandId ? getCompetitors(brandId).catch(() => []) : Promise.resolve([]),
    fetchPage(url),
  ])
  if (!home.html && !home.block) throw new Error(`Could not fetch ${url}. Check the URL is correct and publicly accessible.`)

  const f = readHomepage(home.html, url)

  return {
    websiteUrl: url,
    brandName: brand?.name || requirements['brand_name'] || '',
    websiteType: brand?.websiteType || requirements['website_type'] || 'saas',
    industry: brand?.industry || requirements['industry'] || null,
    targetAudience: brand?.targetAudience || requirements['target_audience'] || null,
    usp: brand?.usp || requirements['usp'] || null,
    brandVoice: brand?.brandVoice || requirements['brand_voice'] || null,
    homepageLoaded: !!home.html,
    homepageIsJsShell: f.jsShell,
    homepageBlocked: home.block,
    h1: f.h1,
    topText: f.topText,
    copySample: f.copySample,
    headings: f.headings,
    proof: f.proof,
    pricing: f.pricing,
    riskFree: f.riskFree,
    whyUs: f.whyUs,
    competitors: competitors.slice(0, 5).map(c => ({ name: c.name || (() => { try { return new URL(c.url).hostname.replace(/^www\./, '') } catch { return c.url } })(), url: c.url })),
  }
}
