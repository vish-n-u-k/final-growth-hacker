import * as cheerio from 'cheerio'

export interface FoundationExtracted {
  title: string
  metaRobots: string
  metaViewport: string
  metaDescription: string
  favicon: string
  gscVerification: string
  ga4Id: string
  gtmId: string
  hasAnalyticsScript: boolean
  h1: string
  h2s: string[]
  bodyTextSnippet: string
  footerLinks: { text: string; href: string }[]
  navLinks: { text: string; href: string }[]
  allLinks: { text: string; href: string }[]
  ctaTexts: string[]
  socialLinks: Record<string, string>
}

const SOCIAL_DETECTORS: { key: string; test: (href: string) => boolean }[] = [
  {
    key: 'instagram',
    test: (h) => h.includes('instagram.com/') && !/instagram\.com\/(p\/|reel\/|stories\/|explore\/|accounts\/)/.test(h),
  },
  {
    key: 'linkedin',
    test: (h) => /linkedin\.com\/(company|in|school)\//.test(h),
  },
  {
    key: 'twitter',
    test: (h) =>
      /(twitter\.com\/|x\.com\/)/.test(h) &&
      !/(twitter|x)\.com\/(home|search|login|signup|intent|share|i\/)/.test(h),
  },
  {
    key: 'facebook',
    test: (h) =>
      h.includes('facebook.com/') &&
      !/facebook\.com\/(login|dialog|sharer|share|events\/)/.test(h),
  },
  {
    key: 'youtube',
    test: (h) => /youtube\.com\/(channel\/|c\/|@|user\/)/.test(h),
  },
  {
    key: 'tiktok',
    test: (h) => h.includes('tiktok.com/@'),
  },
  {
    key: 'pinterest',
    test: (h) => h.includes('pinterest.com/') && !/pinterest\.com\/(pin\/|search\/)/.test(h),
  },
]

function detectSocialLinks(links: { href: string }[]): Record<string, string> {
  const found: Record<string, string> = {}
  for (const { href } of links) {
    const lower = href.toLowerCase()
    for (const { key, test } of SOCIAL_DETECTORS) {
      if (!found[key] && test(lower)) found[key] = href
    }
  }
  return found
}

function extractFoundationData(html: string): FoundationExtracted {
  const $ = cheerio.load(html)

  // title
  const title = $('title').first().text().trim()

  // meta tags
  const metaRobots = $('meta[name="robots"]').attr('content') ?? ''
  const metaViewport = $('meta[name="viewport"]').attr('content') ?? ''
  const metaDescription = $('meta[name="description"]').attr('content') ?? ''

  // favicon
  const favicon =
    $('link[rel="icon"]').attr('href') ??
    $('link[rel="shortcut icon"]').attr('href') ??
    ''

  // Google verification
  const gscVerification = $('meta[name="google-site-verification"]').attr('content') ?? ''

  // GA4 / GTM detection — must run BEFORE scripts are stripped
  let ga4Id = ''
  let gtmId = ''
  let hasAnalyticsScript = false
  $('script').each((_, el) => {
    const src = $(el).attr('src') ?? ''
    const inline = $(el).html() ?? ''
    if (src.includes('googletagmanager.com') || src.includes('gtag/js')) hasAnalyticsScript = true
    if (src.includes('gtm.js')) hasAnalyticsScript = true
    const ga4Match = inline.match(/['"]?(G-[A-Z0-9]+)['"]?/) ?? src.match(/[?&]id=(G-[A-Z0-9]+)/)
    if (ga4Match) { ga4Id = ga4Match[1]; hasAnalyticsScript = true }
    const gtmMatch = inline.match(/['"]?(GTM-[A-Z0-9]+)['"]?/) ?? src.match(/[?&]id=(GTM-[A-Z0-9]+)/)
    if (gtmMatch) { gtmId = gtmMatch[1]; hasAnalyticsScript = true }
    if (inline.includes('gtag(') || inline.includes('dataLayer')) hasAnalyticsScript = true
  })

  // remove noise before text extraction
  $('script, style, svg, noscript').remove()

  // headings
  const h1 = $('h1').first().text().trim()
  const h2s = $('h2').map((_, el) => $(el).text().trim()).get().slice(0, 5)

  // body text snippet (first 800 chars of visible text)
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
  const bodyTextSnippet = bodyText.slice(0, 800)

  // nav links
  const navLinks: { text: string; href: string }[] = []
  $('nav a, header a').each((_, el) => {
    const text = $(el).text().trim()
    const href = $(el).attr('href') ?? ''
    if (text && href) navLinks.push({ text, href })
  })

  // footer links
  const footerLinks: { text: string; href: string }[] = []
  $('footer a, [class*="footer"] a, [id*="footer"] a').each((_, el) => {
    const text = $(el).text().trim()
    const href = $(el).attr('href') ?? ''
    if (text && href) footerLinks.push({ text, href })
  })

  // all links (for contact/privacy detection)
  const allLinks: { text: string; href: string }[] = []
  $('a').each((_, el) => {
    const text = $(el).text().trim()
    const href = $(el).attr('href') ?? ''
    if (text || href) allLinks.push({ text, href })
  })

  // CTA detection: buttons and prominent links
  const ctaTexts: string[] = []
  $('button, [class*="btn"], [class*="cta"], a[class*="button"]').each((_, el) => {
    const text = $(el).text().trim()
    if (text) ctaTexts.push(text)
  })

  const socialLinks = detectSocialLinks(allLinks)

  return {
    title,
    metaRobots,
    metaViewport,
    metaDescription,
    favicon,
    gscVerification,
    ga4Id,
    gtmId,
    hasAnalyticsScript,
    h1,
    h2s,
    bodyTextSnippet,
    footerLinks,
    navLinks,
    allLinks: allLinks.slice(0, 50),
    ctaTexts: ctaTexts.slice(0, 10),
    socialLinks,
  }
}

const FREE_HOSTING_DOMAINS: { pattern: RegExp; platform: string }[] = [
  { pattern: /\.vercel\.app$/i,        platform: 'Vercel' },
  { pattern: /\.netlify\.app$/i,       platform: 'Netlify' },
  { pattern: /\.github\.io$/i,         platform: 'GitHub Pages' },
  { pattern: /\.pages\.dev$/i,         platform: 'Cloudflare Pages' },
  { pattern: /\.web\.app$/i,           platform: 'Firebase Hosting' },
  { pattern: /\.firebaseapp\.com$/i,   platform: 'Firebase Hosting' },
  { pattern: /\.herokuapp\.com$/i,     platform: 'Heroku' },
  { pattern: /\.onrender\.com$/i,      platform: 'Render' },
  { pattern: /\.railway\.app$/i,       platform: 'Railway' },
  { pattern: /\.fly\.dev$/i,           platform: 'Fly.io' },
  { pattern: /\.amplifyapp\.com$/i,    platform: 'AWS Amplify' },
  { pattern: /\.azurewebsites\.net$/i, platform: 'Azure App Service' },
  { pattern: /\.wixsite\.com$/i,       platform: 'Wix' },
  { pattern: /\.webflow\.io$/i,        platform: 'Webflow' },
  { pattern: /\.myshopify\.com$/i,     platform: 'Shopify (dev store)' },
  { pattern: /\.glitch\.me$/i,         platform: 'Glitch' },
  { pattern: /\.replit\.dev$/i,        platform: 'Replit' },
  { pattern: /\.repl\.co$/i,           platform: 'Replit' },
  { pattern: /\.surge\.sh$/i,          platform: 'Surge' },
]

function detectFreeHosting(url: string): { customDomain: boolean; hostingPlatform: string | null } {
  try {
    const hostname = new URL(url).hostname
    for (const { pattern, platform } of FREE_HOSTING_DOMAINS) {
      if (pattern.test(hostname)) return { customDomain: false, hostingPlatform: platform }
    }
    return { customDomain: true, hostingPlatform: null }
  } catch {
    return { customDomain: true, hostingPlatform: null }
  }
}

export interface FoundationFetchResult {
  extracted: FoundationExtracted | null
  url: string
  customDomain: boolean
  hostingPlatform: string | null
}

async function safeFetch(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GrowthHackerBot/1.0 (Site Auditor)' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}


export async function fetchFoundationData(requirements: Record<string, string>): Promise<FoundationFetchResult> {
  const rawUrl = requirements['website_url'] ?? ''
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  const [html, { customDomain, hostingPlatform }] = await Promise.all([
    safeFetch(url),
    Promise.resolve(detectFreeHosting(url)),
  ])
  return {
    extracted: html ? extractFoundationData(html) : null,
    url,
    customDomain,
    hostingPlatform,
  }
}
