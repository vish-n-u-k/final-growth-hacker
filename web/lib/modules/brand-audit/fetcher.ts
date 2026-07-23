import { load } from 'cheerio'
import { TfIdf } from 'natural'
import Sentiment from 'sentiment'
import { discoverAllUrls, type UrlDiscoveryResult } from '@/lib/audit/url-discovery'

const sentimentAnalyzer = new Sentiment()

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrustSignals {
  hasHttps: boolean
  testimonialCount: number
  socialProofCount: number
  clientLogoCount: number
  hasCaseStudyLink: boolean
  hasReviewWidget: boolean
  hasTeamPage: boolean
  hasPrivacyPage: boolean
  hasTermsPage: boolean
}

export interface SocialProfileResult {
  handle: string
  url: string
  bio: string
  sentimentScore: number
  fetchFailed: boolean
}

export interface BrandAuditFetchResult {
  websiteUrl: string
  brandName: string
  industry: string
  targetAudience: string
  usp: string
  brandVoice: string
  // Page metadata
  title: string
  metaDescription: string
  ogTitle: string
  ogDescription: string
  h1: string
  firstParagraph: string
  heroCopy: string
  bodyCopy: string
  // NLP signals
  topKeywords: string[]
  readabilityScore: number
  readabilityLabel: string
  websiteSentimentScore: number
  // Language analysis
  benefitCount: number
  featureCount: number
  ctaTexts: string[]
  audienceMentionCount: number
  // Trust
  trustSignals: TrustSignals
  // Schema
  schemaTypes: string[]
  // Discovery
  wikidataFound: boolean
  hasComparisonPage: boolean
  // Social profiles (if handles provided)
  socialProfiles: SocialProfileResult[]
  avgSocialSentiment: number | null
  toneDelta: number | null
  // Brand name consistency
  titleHasBrandName: boolean
  ogTitleHasBrandName: boolean
  // Site structure (same as website module)
  robotsTxt: string
  sitemapStatus: number
  urlDiscovery: UrlDiscoveryResult
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Flesch Reading Ease — pure math, no package needed
function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '')
  if (cleaned.length <= 3) return 1
  return Math.max(1, (cleaned.match(/[aeiouy]+/g) ?? []).length)
}

function fleschReadingEase(text: string): number {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 3)
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0 || sentences.length === 0) return 0
  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0)
  const score = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (totalSyllables / words.length)
  return Math.round(Math.min(100, Math.max(0, score)))
}

function readabilityLabel(score: number): string {
  if (score >= 70) return 'Easy — plain English'
  if (score >= 50) return 'Moderate'
  if (score >= 30) return 'Difficult'
  return 'Very difficult'
}

// Normalize sentiment comparative (-3..+3) to -1..+1
function normalizeSentiment(text: string): number {
  if (!text.trim()) return 0
  const result = sentimentAnalyzer.analyze(text)
  return Math.max(-1, Math.min(1, result.comparative / 3))
}

// Schema type extraction from JSON-LD
function extractSchemaTypes(rawHtml: string): string[] {
  const $ = load(rawHtml)
  const types: string[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text()) as { '@type'?: string; '@graph'?: { '@type'?: string }[] }
      if (json['@type']) types.push(String(json['@type']))
      if (Array.isArray(json['@graph'])) {
        for (const item of json['@graph']) {
          if (item['@type']) types.push(String(item['@type']))
        }
      }
    } catch { /* malformed JSON-LD — skip */ }
  })
  return [...new Set(types)]
}

// Trust signal detection via cheerio + regex
function extractTrustSignals(rawHtml: string, url: string): TrustSignals {
  const $ = load(rawHtml)
  const allText = rawHtml.toLowerCase()
  const allLinks = $('a[href]').toArray()

  const testimonialCount = Math.min(
    $('[class*="testimonial"], [class*="review"], [class*="quote"], blockquote').length,
    50,
  )

  const socialProofCount = Math.min(
    $('[class*="social-proof"], [class*="trust"], [class*="stat"], [class*="counter"]').length +
    (allText.match(/\d[\d,]+\+?\s*(customers?|users?|clients?|companies|businesses|teams?)/g) ?? []).length,
    50,
  )

  const clientLogoCount = Math.min(
    $('[class*="logo-grid"], [class*="client"], [class*="partner"], [class*="brand-wall"]')
      .filter((_, el) => $(el).find('img').length > 0).length,
    50,
  )

  const hasCaseStudyLink = allLinks.some(a =>
    /case.?stud|success.?stor|customer.?stor/i.test($(a).attr('href') ?? ''),
  )

  const hasReviewWidget = /g2\.com|capterra\.com|trustpilot\.com|reviews\.io|getapp\.com/i.test(allText)

  const hasTeamPage = allLinks.some(a => /\/(team|people|crew|staff)(\/|$)/i.test($(a).attr('href') ?? ''))
  const hasPrivacyPage = allLinks.some(a => /\/privacy/i.test($(a).attr('href') ?? ''))
  const hasTermsPage = allLinks.some(a => /\/(terms|tos|legal)(\/|$)/i.test($(a).attr('href') ?? ''))

  return {
    hasHttps: url.startsWith('https://'),
    testimonialCount,
    socialProofCount,
    clientLogoCount,
    hasCaseStudyLink,
    hasReviewWidget,
    hasTeamPage,
    hasPrivacyPage,
    hasTermsPage,
  }
}

// Benefit vs feature language counts
const BENEFIT_REGEX = /\b(save|grow|boost|increase|reduce|improve|earn|achieve|faster|easier|eliminate|scale|simplify|unlock|maximize|revenue|roi|profit|time|cost|results?|outcome)\b/gi
const FEATURE_REGEX = /\b(dashboard|api|integration|plugin|widget|module|interface|platform|sync|workflow|built-in|automated|algorithm|database|sdk|endpoint|webhook|feature)\b/gi

function countLanguage(text: string) {
  return {
    benefitCount: (text.match(BENEFIT_REGEX) ?? []).length,
    featureCount: (text.match(FEATURE_REGEX) ?? []).length,
  }
}

// CTA text extraction from buttons and action links
function extractCtaTexts(rawHtml: string): string[] {
  const $ = load(rawHtml)
  const ctas: string[] = []
  $('a, button').each((_, el) => {
    const text = $(el).text().trim()
    if (text.length > 2 && text.length < 60 &&
      /\b(get|start|try|sign|join|request|book|schedule|buy|shop|learn|see|watch|download|access|claim|grab|free)\b/i.test(text)) {
      ctas.push(text)
    }
  })
  return [...new Set(ctas)].slice(0, 10)
}

// Wikidata Knowledge Graph check — no API key needed
async function checkWikidata(brandName: string): Promise<boolean> {
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(brandName)}&language=en&format=json&limit=5`
    const raw = await safeFetch(url, 8000)
    if (!raw) return false
    const json = JSON.parse(raw) as { search?: { label?: string }[] }
    const results = json.search ?? []
    if (!results.length) return false
    // Loose match: any result label overlaps with brand name
    return results.some(r => {
      const label = (r.label ?? '').toLowerCase()
      const brand = brandName.toLowerCase()
      return label.includes(brand) || brand.includes(label)
    })
  } catch {
    return false
  }
}

// Social profile fetch — extracts bio from meta description (SSR-available on LinkedIn/YouTube)
async function fetchSocialProfile(handle: string): Promise<SocialProfileResult> {
  const url = handle.startsWith('http') ? handle : `https://${handle}`
  const raw = await safeFetch(url, 8000)
  if (!raw) return { handle, url, bio: '', sentimentScore: 0, fetchFailed: true }
  const $ = load(raw)
  const bio =
    $('meta[name="description"]').attr('content')?.trim() ??
    $('meta[property="og:description"]').attr('content')?.trim() ??
    ''
  return { handle, url, bio, sentimentScore: normalizeSentiment(bio), fetchFailed: false }
}

// Count how many times audience terms appear in copy
function countAudienceMentions(text: string, targetAudience: string): number {
  if (!targetAudience.trim()) return 0
  const terms = targetAudience.toLowerCase().split(/[\s,/()]+/).filter(t => t.length > 3)
  const lowerText = text.toLowerCase()
  return terms.reduce((count, term) => {
    return count + (lowerText.match(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) ?? []).length
  }, 0)
}

// TF-IDF keyword extraction — uses `natural` already installed
function extractTopKeywords(text: string, n = 20): string[] {
  const tfidf = new TfIdf()
  tfidf.addDocument(text)
  return tfidf
    .listTerms(0)
    .filter(t => t.term.length > 3 && /^[a-zA-Z]+$/.test(t.term))
    .slice(0, n)
    .map(t => t.term)
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function fetchBrandAuditData(
  requirements: Record<string, string>,
): Promise<BrandAuditFetchResult> {
  const websiteUrl = requirements['website_url'] ?? ''
  const brandName = requirements['brand_name'] ?? ''
  const industry = requirements['industry'] ?? ''
  const targetAudience = requirements['target_audience'] ?? ''
  const usp = requirements['usp'] ?? ''
  const brandVoice = requirements['brand_voice'] ?? ''
  const socialHandles = requirements['social_handles'] ?? ''

  const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    throw new Error(`Invalid URL: ${websiteUrl}`)
  }

  // Fetch homepage + robots.txt + sitemap status + URL discovery in parallel
  const [homeRaw, robotsRes, sitemapRes, urlDiscovery] = await Promise.all([
    safeFetch(url, 15000),
    fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthAuditBot/1.0)' } }).catch(() => null),
    fetch(`${origin}/sitemap.xml`, { method: 'HEAD', signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthAuditBot/1.0)' } }).catch(() => null),
    discoverAllUrls(url, undefined, { maxUrls: 150, enrichMeta: 20 }),
  ])

  if (!homeRaw) {
    throw new Error(`Could not fetch ${url}. Check the URL is correct and publicly accessible.`)
  }

  const robotsTxt = robotsRes?.ok ? await robotsRes.text().catch(() => '') : ''
  const sitemapStatus = sitemapRes?.status ?? 0

  // Parse homepage
  const $ = load(homeRaw)

  const title = $('title').text().trim()
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? ''
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() ?? ''
  const ogDescription = $('meta[property="og:description"]').attr('content')?.trim() ?? ''
  const h1 = $('h1').first().text().trim()
  const firstParagraph = $('p').first().text().trim().slice(0, 500)

  // Hero copy: first section or header area (above the fold approximation)
  const heroCopy = (
    $('section').first().text() ||
    $('header').first().text() ||
    $('[class*="hero"], [class*="banner"], [class*="above-fold"]').first().text() ||
    ''
  ).replace(/\s+/g, ' ').trim().slice(0, 800)

  // Comparison page detection before stripping nav/footer
  const allLinks = $('a[href]').toArray()
  const hasComparisonPage = allLinks.some(a =>
    /\/vs[-/]|\/compare|\/alternatives/i.test($(a).attr('href') ?? ''),
  )

  // Clean body text for NLP
  $('script, style, noscript, svg, nav, footer').remove()
  const bodyCopy = ($('body').text() || $('*').text()).replace(/\s+/g, ' ').trim().slice(0, 8000)

  // Extract signals
  const schemaTypes = extractSchemaTypes(homeRaw)
  const trustSignals = extractTrustSignals(homeRaw, url)
  const { benefitCount, featureCount } = countLanguage(bodyCopy)
  const ctaTexts = extractCtaTexts(homeRaw)
  const topKeywords = extractTopKeywords(bodyCopy)

  // NLP scores (run on first 3k chars to keep it fast)
  const sampleText = bodyCopy.slice(0, 3000)
  const readabilityScore = fleschReadingEase(sampleText)
  const websiteSentimentScore = normalizeSentiment(sampleText)

  // Brand name consistency
  const brandLower = brandName.toLowerCase()
  const titleHasBrandName = !!brandLower && title.toLowerCase().includes(brandLower)
  const ogTitleHasBrandName = !!brandLower && ogTitle.toLowerCase().includes(brandLower)

  // Audience mention count
  const audienceMentionCount = countAudienceMentions(bodyCopy, targetAudience)

  // Wikidata + social profiles in parallel
  const socialHandleList = socialHandles
    .split(/[,\n]/)
    .map(h => h.trim())
    .filter(Boolean)
    .slice(0, 5)

  const [wikidataFound, ...socialResults] = await Promise.all([
    checkWikidata(brandName),
    ...socialHandleList.map(h => fetchSocialProfile(h)),
  ])

  const socialProfiles = socialResults as SocialProfileResult[]
  const socialSentiments = socialProfiles
    .filter(p => !p.fetchFailed && p.bio)
    .map(p => p.sentimentScore)

  const avgSocialSentiment =
    socialSentiments.length > 0
      ? socialSentiments.reduce((a, b) => a + b, 0) / socialSentiments.length
      : null

  const toneDelta =
    avgSocialSentiment !== null ? Math.abs(websiteSentimentScore - avgSocialSentiment) : null

  return {
    websiteUrl: url,
    brandName,
    industry,
    targetAudience,
    usp,
    brandVoice,
    title,
    metaDescription,
    ogTitle,
    ogDescription,
    h1,
    firstParagraph,
    heroCopy,
    bodyCopy,
    topKeywords,
    readabilityScore,
    readabilityLabel: readabilityLabel(readabilityScore),
    websiteSentimentScore,
    benefitCount,
    featureCount,
    ctaTexts,
    audienceMentionCount,
    trustSignals,
    schemaTypes,
    wikidataFound,
    hasComparisonPage,
    socialProfiles,
    avgSocialSentiment,
    toneDelta,
    titleHasBrandName,
    ogTitleHasBrandName,
    robotsTxt: robotsTxt.slice(0, 3000),
    sitemapStatus,
    urlDiscovery,
  }
}
