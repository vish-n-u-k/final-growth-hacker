import { load } from 'cheerio'
import { TfIdf } from 'natural'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedPage {
  title: string
  description: string
  h1: string
  h1Count: number
  h2s: string[]
  firstParagraph: string
  hasSchema: boolean
  social: Record<string, string | null>
  imgCount: number
  imgWithAlt: number
  internalLinks: number
  bodyText: string  // clean text for TF-IDF and content gap analysis
}

export interface PsiScore {
  performance: number  // 0–100
  lcp: number          // ms
  cls: number          // 0–1
  tbt: number          // ms
}

export interface CompetitorData {
  url: string
  parsed: ParsedPage
  pixels: Record<string, boolean>
  topTerms: string[]
  psi: PsiScore | null
  fetchFailed: boolean
}

export interface CompetitorAnalysisFetchResult {
  userUrl: string
  userParsed: ParsedPage
  userPixels: Record<string, boolean>
  userTopTerms: string[]
  userPsi: PsiScore | null
  competitors: CompetitorData[]
  industry: string
  competitorsProvided: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SOCIAL_PATTERNS: Record<string, RegExp> = {
  instagram: /instagram\.com\//i,
  facebook: /facebook\.com\//i,
  linkedin: /linkedin\.com\/(company|in)\//i,
  twitter: /(?:twitter|x)\.com\//i,
  tiktok: /tiktok\.com\/@/i,
  youtube: /youtube\.com\//i,
}

export const AD_PIXEL_PATTERNS: Record<string, RegExp> = {
  gtm: /googletagmanager\.com\/gtm\.js/i,
  google_ads: /googleads\.g\.doubleclick\.net/i,
  facebook_pixel: /connect\.facebook\.net|fbq\s*\(/i,
  linkedin_insight: /snap\.licdn\.com/i,
  tiktok_pixel: /analytics\.tiktok\.com/i,
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

function parsePage(rawHtml: string, maxBodyChars = 6000): ParsedPage {
  if (!rawHtml) {
    return {
      title: '', description: '', h1: '', h1Count: 0, h2s: [], firstParagraph: '',
      hasSchema: false, social: {}, imgCount: 0, imgWithAlt: 0, internalLinks: 0, bodyText: '',
    }
  }

  const $ = load(rawHtml)

  const title = $('title').text().trim()
  const description = $('meta[name="description"]').attr('content')?.trim() ?? ''
  const h1 = $('h1').first().text().trim()
  const h1Count = $('h1').length
  const h2s = $('h2').toArray().map(el => $(el).text().trim()).filter(Boolean).slice(0, 5)
  const hasSchema = $('script[type="application/ld+json"]').length > 0 || $('[itemscope]').length > 0

  // Social links — scan all anchors
  const social: Record<string, string | null> = {}
  const allAnchors = $('a[href]').toArray()
  for (const [platform, pattern] of Object.entries(SOCIAL_PATTERNS)) {
    const el = allAnchors.find(a => pattern.test($(a).attr('href') ?? ''))
    social[platform] = el ? ($(el).attr('href') ?? null) : null
  }

  // Image stats
  const imgs = $('img').toArray()
  const imgCount = imgs.length
  const imgWithAlt = imgs.filter(el => {
    const alt = $(el).attr('alt')
    return alt !== undefined && alt.trim() !== ''
  }).length

  // Internal link count (relative hrefs)
  const internalLinks = allAnchors.filter(a => {
    const href = $(a).attr('href') ?? ''
    return href.startsWith('/') || href.startsWith('#')
  }).length

  // First paragraph before stripping
  const firstParagraph = $('p').first().text().trim().slice(0, 400)

  // Clean body text for TF-IDF and content analysis
  $('script, style, noscript, svg, nav, footer, header').remove()
  const bodyText = ($('body').text() || $('*').text())
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxBodyChars)

  return { title, description, h1, h1Count, h2s, firstParagraph, hasSchema, social, imgCount, imgWithAlt, internalLinks, bodyText }
}

function detectPixels(rawHtml: string): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  for (const [pixel, pattern] of Object.entries(AD_PIXEL_PATTERNS)) {
    result[pixel] = pattern.test(rawHtml)
  }
  return result
}

async function fetchPsi(url: string): Promise<PsiScore | null> {
  try {
    const key = process.env.GOOGLE_PSI_API_KEY
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile${key ? `&key=${key}` : ''}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(endpoint, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const json = await res.json() as Record<string, unknown>
    const cats = json.categories as Record<string, { score: number }> | undefined
    const audits = json.audits as Record<string, { numericValue?: number }> | undefined
    return {
      performance: Math.round((cats?.performance?.score ?? 0) * 100),
      lcp: Math.round(audits?.['largest-contentful-paint']?.numericValue ?? 0),
      cls: audits?.['cumulative-layout-shift']?.numericValue ?? 0,
      tbt: Math.round(audits?.['total-blocking-time']?.numericValue ?? 0),
    }
  } catch {
    return null
  }
}

function extractTopTerms(docIndex: number, tfidf: TfIdf, n = 20): string[] {
  return tfidf
    .listTerms(docIndex)
    .filter(t => t.term.length > 3 && /^[a-zA-Z]+$/.test(t.term))
    .slice(0, n)
    .map(t => t.term)
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function fetchCompetitorAnalysisData(
  requirements: Record<string, string>,
  userWebsiteUrl?: string,
): Promise<CompetitorAnalysisFetchResult> {
  const rawUrls = (requirements['competitor_urls'] ?? '')
    .split(/[,\n]/)
    .map(u => u.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map(u => (u.startsWith('http') ? u : `https://${u}`))

  const industry = requirements['industry'] ?? ''
  const rawUserUrl = (userWebsiteUrl ?? requirements['website_url'] ?? '').trim()
  const userUrl = rawUserUrl.startsWith('http') ? rawUserUrl : `https://${rawUserUrl}`

  // PSI capped at user + top 2 competitors to stay well within 90s maxDuration
  const psiUrls = [userUrl, ...rawUrls.slice(0, 2)]

  // Fetch HTML and PSI in parallel
  const [userRaw, competitorRaws, psiScores] = await Promise.all([
    safeFetch(userUrl, 15000),
    Promise.all(rawUrls.map(u => safeFetch(u, 10000))),
    Promise.all(psiUrls.map(u => fetchPsi(u))),
  ])

  if (!userRaw) {
    throw new Error(`Could not fetch your website at ${userUrl}. Check the URL is correct and publicly accessible.`)
  }

  const userParsed = parsePage(userRaw, 8000)
  const userPixels = detectPixels(userRaw)

  const competitorBase = rawUrls.map((url, i) => {
    const raw = competitorRaws[i]
    if (!raw) {
      return { url, parsed: parsePage('', 0), pixels: {} as Record<string, boolean>, psi: null as PsiScore | null, fetchFailed: true }
    }
    return {
      url,
      parsed: parsePage(raw, 6000),
      pixels: detectPixels(raw),
      psi: (psiScores[i + 1] ?? null),
      fetchFailed: false,
    }
  })

  // Build TF-IDF corpus: user doc first, then each competitor
  const tfidf = new TfIdf()
  tfidf.addDocument(userParsed.bodyText)
  for (const c of competitorBase) {
    tfidf.addDocument(c.fetchFailed ? '' : c.parsed.bodyText)
  }

  const userTopTerms = extractTopTerms(0, tfidf)

  return {
    userUrl,
    userParsed,
    userPixels,
    userTopTerms,
    userPsi: psiScores[0] ?? null,
    competitors: competitorBase.map((c, i) => ({
      ...c,
      topTerms: c.fetchFailed ? [] : extractTopTerms(i + 1, tfidf),
    })),
    industry,
    competitorsProvided: rawUrls.length > 0,
  }
}
