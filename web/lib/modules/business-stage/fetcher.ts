import { load } from 'cheerio'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { buildPostHogFilter } from '@/lib/posthog/filter'

export interface BusinessStageFetchResult {
  url: string
  userCount: number | null   // actual count from PostHog (null if not connected and not manually entered)
  posthogConnected: boolean
  countSource: 'posthog' | 'manual' | 'unknown'
  phase: 1 | 2 | 3 | 4 | 5
  phaseLabel: string
  nextPhaseLabel: string
  usersToNextPhase: number | null // null if already at Phase 5
  // Brand context
  brandName: string
  industry: string | null
  targetAudience: string | null
  usp: string | null
  brandVoice: string | null
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

// ── Acquisition phase detection ─────────────────────────────────────────────

interface PhaseInfo {
  phase: 1 | 2 | 3 | 4 | 5
  label: string
  nextLabel: string
  nextThreshold: number | null
}

function detectPhase(count: number): PhaseInfo {
  if (count <= 10)  return { phase: 1, label: 'Phase 1 — Zero to First Users (0–10)',  nextLabel: 'Phase 2 — Early Adopters (11–50)',            nextThreshold: 11 }
  if (count <= 50)  return { phase: 2, label: 'Phase 2 — Early Adopters (11–50)',       nextLabel: 'Phase 3 — Organic Traction (51–200)',         nextThreshold: 51 }
  if (count <= 200) return { phase: 3, label: 'Phase 3 — Organic Traction (51–200)',    nextLabel: 'Phase 4 — Scaling Acquisition (201–500)',     nextThreshold: 201 }
  if (count <= 500) return { phase: 4, label: 'Phase 4 — Scaling Acquisition (201–500)', nextLabel: 'Phase 5 — Growth Infrastructure (500+)',     nextThreshold: 501 }
  return { phase: 5, label: 'Phase 5 — Growth Infrastructure (500+)', nextLabel: 'Sustaining growth at scale', nextThreshold: null }
}

async function fetchPosthogCount(brandId: string): Promise<{ count: number; connected: boolean }> {
  const [integration] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'posthog'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!integration?.apiKey) return { count: 0, connected: false }

  const meta = (integration.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host = meta['posthog_host']?.replace(/\/$/, '') || 'https://us.posthog.com'

  if (!projectId) return { count: 0, connected: true }

  const { personsCountQuery } = buildPostHogFilter(meta)

  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${integration.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: personsCountQuery } }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { count: 0, connected: true }
    const data = await res.json() as { results?: number[][] }
    return { count: data.results?.[0]?.[0] ?? 0, connected: true }
  } catch {
    return { count: 0, connected: true }
  }
}

export async function fetchBusinessStageData(
  requirements: Record<string, string>,
): Promise<BusinessStageFetchResult> {
  const rawUrl = requirements['website_url'] ?? ''
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  const brandId = requirements['brand_id'] ?? ''
  const brandName = requirements['brand_name'] ?? ''
  const industry = requirements['industry'] || null
  const targetAudience = requirements['target_audience'] || null
  const usp = requirements['usp'] || null
  const brandVoice = requirements['brand_voice'] || null

  // Manual override in requirements takes priority over a live PostHog fetch
  const manualRaw = requirements['user_count']?.trim()
  const manualCount = manualRaw ? parseInt(manualRaw, 10) : NaN

  let userCount = 0
  let posthogConnected = false
  let countSource: BusinessStageFetchResult['countSource'] = 'unknown'

  if (!isNaN(manualCount) && manualCount >= 0) {
    userCount = manualCount
    countSource = 'manual'
  } else if (brandId) {
    const ph = await fetchPosthogCount(brandId)
    userCount = ph.count
    posthogConnected = ph.connected
    countSource = ph.connected ? 'posthog' : 'unknown'
  }

  const { phase, label: phaseLabel, nextLabel: nextPhaseLabel, nextThreshold } = detectPhase(userCount)
  const usersToNextPhase = nextThreshold !== null ? Math.max(0, nextThreshold - userCount) : null

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
    posthogConnected,
    countSource,
    phase,
    phaseLabel,
    nextPhaseLabel,
    usersToNextPhase,
    brandName,
    industry,
    targetAudience,
    usp,
    brandVoice,
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
