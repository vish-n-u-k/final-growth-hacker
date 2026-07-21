import { load } from 'cheerio'

export interface BusinessStageFetchResult {
  url: string
  userCount: number | null   // actual count from PostHog (null if not connected)
  // Page basics
  title: string
  metaDescription: string
  h1: string
  h2s: string[]
  bodyCopy: string        // first 4000 chars, scripts/styles stripped
  heroCopy: string        // first section / header area
  // Navigation signals
  navLinks: string[]      // text + href pairs as "text → href"
  hasPricingPage: boolean
  hasBookingFlow: boolean
  hasDemoRequest: boolean
  // Archetype signals
  selfServeKeywords: string[]   // "sign up", "start free", "free trial" etc.
  enterpriseKeywords: string[]  // "enterprise", "compliance", "SOC 2" etc.
  pehKeywords: string[]         // "retreat", "wellness", "healing" etc.
  // Stage proxy signals
  clientLogoCount: number
  testimonialCount: number
  customerClaims: string[]      // "500+ clients", "10,000 users" etc.
  hasTeamPage: boolean
  hasCaseStudyLinks: boolean
  hasPressPage: boolean
  hasBetaOrEarlyAccess: boolean
  // Pricing
  hasPriceAmounts: boolean      // $, ₹, €, /mo, /year visible on homepage
  hasPublicPricing: boolean     // pricing page exists OR prices on homepage
  // Analytics / tracking detected
  hasAnalytics: boolean
  // Social proof
  hasReviewWidget: boolean      // G2, Capterra, Trustpilot etc.
}

const SELF_SERVE_PATTERNS = [
  /\bsign[\s-]?up\b/i,
  /\bstart[\s-]?free\b/i,
  /\bfree[\s-]?trial\b/i,
  /\bget[\s-]?started\b/i,
  /\btry[\s-]?for[\s-]?free\b/i,
  /\bno[\s-]?credit[\s-]?card\b/i,
  /\bself[\s-]?serve\b/i,
  /\bmonthly[\s-]?plan\b/i,
  /\bannual[\s-]?plan\b/i,
]

const ENTERPRISE_PATTERNS = [
  /\benterprise\b/i,
  /\bcompliance\b/i,
  /\bSOC[\s-]?2\b/i,
  /\bISO[\s-]?27001\b/i,
  /\bGDPR\b/i,
  /\bprocurement\b/i,
  /\bMSA\b/i,
  /\brequest[\s-]?demo\b/i,
  /\bcontact[\s-]?sales\b/i,
  /\bcustom[\s-]?pricing\b/i,
  /\btalk[\s-]?to[\s-]?sales\b/i,
  /\bbook[\s-]?a[\s-]?demo\b/i,
]

const PEH_PATTERNS = [
  /\bretreat\b/i,
  /\bwellness\b/i,
  /\bhealing\b/i,
  /\byoga\b/i,
  /\bsanctuary\b/i,
  /\bluxury[\s-]?stay\b/i,
  /\bescape\b/i,
  /\bgetaway\b/i,
  /\bvilla\b/i,
  /\bresort\b/i,
  /\bspa\b/i,
  /\bmeditation\b/i,
  /\bexperience[\s-]?package\b/i,
  /\bavailability\b/i,
  /\bcheck[\s-]?in\b/i,
  /\bcheck[\s-]?out\b/i,
  /\bper[\s-]?night\b/i,
  /\bper[\s-]?person\b/i,
]

const CUSTOMER_CLAIM_REGEX = /(\d[\d,]*\+?\s*(?:customers?|users?|clients?|companies|businesses|teams?|brands?|members?|organizations?))/gi

async function safeFetch(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthAuditBot/1.0)' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

function matchKeywords(text: string, patterns: RegExp[]): string[] {
  const matches = new Set<string>()
  for (const pattern of patterns) {
    const found = text.match(pattern)
    if (found) matches.add(found[0].replace(/\s+/g, ' ').trim())
  }
  return [...matches]
}

export async function fetchBusinessStageData(
  requirements: Record<string, string>,
): Promise<BusinessStageFetchResult> {
  const rawUrl = requirements['website_url'] ?? ''
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  const userCount = requirements['user_count'] ? parseInt(requirements['user_count'], 10) : null

  const html = await safeFetch(url, 15000)
  if (!html) {
    throw new Error(`Could not fetch ${url}. Check the URL is correct and publicly accessible.`)
  }

  const $ = load(html)

  const title = $('title').text().trim()
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? ''
  const h1 = $('h1').first().text().trim()
  const h2s = $('h2').map((_, el) => $(el).text().trim()).get().slice(0, 6)

  // Hero copy: first section or header
  const heroCopy = (
    $('[class*="hero"], [class*="banner"], [class*="above-fold"]').first().text() ||
    $('section').first().text() ||
    $('header').first().text() ||
    ''
  ).replace(/\s+/g, ' ').trim().slice(0, 1000)

  // Nav links
  const navLinks: string[] = []
  $('nav a, header a').each((_, el) => {
    const text = $(el).text().trim()
    const href = $(el).attr('href') ?? ''
    if (text && href) navLinks.push(`${text} → ${href}`)
  })

  // Navigation intent detection
  const allHrefs = $('a[href]').map((_, el) => $(el).attr('href') ?? '').get()
  const hasPricingPage = allHrefs.some(h => /\/pricing/i.test(h))
  const hasBookingFlow = allHrefs.some(h => /\/book|\/reserve|\/availability|\/schedule/i.test(h))
  const hasDemoRequest = allHrefs.some(h => /\/demo|\/contact|\/request/i.test(h))
  const hasTeamPage = allHrefs.some(h => /\/(team|people|crew|about)(\/|$)/i.test(h))
  const hasCaseStudyLinks = allHrefs.some(h => /case.?stud|success.?stor|customer.?stor/i.test(h))
  const hasPressPage = allHrefs.some(h => /\/(press|media|news)(\/|$)/i.test(h))

  // Analytics detection — before removing scripts
  let hasAnalytics = false
  $('script').each((_, el) => {
    const src = $(el).attr('src') ?? ''
    const inline = $(el).html() ?? ''
    if (
      src.includes('googletagmanager') ||
      src.includes('gtag') ||
      src.includes('analytics') ||
      src.includes('posthog') ||
      src.includes('segment') ||
      inline.includes('gtag(') ||
      inline.includes('analytics') ||
      inline.includes('posthog.init')
    ) hasAnalytics = true
  })

  // Review widget detection
  const rawHtmlLower = html.toLowerCase()
  const hasReviewWidget = /g2\.com|capterra\.com|trustpilot\.com|reviews\.io|getapp\.com/i.test(rawHtmlLower)

  // Beta / early access language
  const hasBetaOrEarlyAccess = /\b(beta|early[\s-]?access|waitlist|wait[\s-]?list|coming[\s-]?soon)\b/i.test(html)

  // Now clean for text extraction
  $('script, style, noscript, svg').remove()
  const bodyCopy = ($('body').text() || '').replace(/\s+/g, ' ').trim().slice(0, 4000)

  // Social proof counts
  const clientLogoCount = Math.min(
    $('[class*="logo-grid"], [class*="client"], [class*="partner"], [class*="brand-wall"]')
      .filter((_, el) => $(el).find('img').length > 0).length,
    50,
  )
  const testimonialCount = Math.min(
    $('[class*="testimonial"], [class*="review"], [class*="quote"], blockquote').length,
    50,
  )

  // Customer volume claims
  const claimsRaw = bodyCopy.match(CUSTOMER_CLAIM_REGEX) ?? []
  const customerClaims = [...new Set(claimsRaw)].slice(0, 10)

  // Pricing signals on homepage
  const hasPriceAmounts = /[\$₹€£]\s*\d|\d+\s*(\/mo|\/month|\/year|per month|per year)/i.test(bodyCopy)
  const hasPublicPricing = hasPricingPage || hasPriceAmounts

  // Keyword matching
  const fullText = `${title} ${metaDescription} ${heroCopy} ${bodyCopy} ${navLinks.join(' ')}`
  const selfServeKeywords = matchKeywords(fullText, SELF_SERVE_PATTERNS)
  const enterpriseKeywords = matchKeywords(fullText, ENTERPRISE_PATTERNS)
  const pehKeywords = matchKeywords(fullText, PEH_PATTERNS)

  return {
    url,
    userCount,
    title,
    metaDescription,
    h1,
    h2s,
    bodyCopy,
    heroCopy,
    navLinks: navLinks.slice(0, 20),
    hasPricingPage,
    hasBookingFlow,
    hasDemoRequest,
    selfServeKeywords,
    enterpriseKeywords,
    pehKeywords,
    clientLogoCount,
    testimonialCount,
    customerClaims,
    hasTeamPage,
    hasCaseStudyLinks,
    hasPressPage,
    hasBetaOrEarlyAccess,
    hasPriceAmounts,
    hasPublicPricing,
    hasAnalytics,
    hasReviewWidget,
  }
}
