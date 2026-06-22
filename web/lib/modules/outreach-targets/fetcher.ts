import { load } from 'cheerio'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExternalLink {
  url: string
  domain: string
  anchorText: string
  surroundingText: string  // nearest heading + paragraph text
  sectionHint: string      // 'press' | 'partners' | 'blog' | 'footer' | 'other'
  foundOn: string          // competitor URL where this link was found
}

export interface OutreachTargetsFetchResult {
  userUrl: string
  brandName: string
  links: ExternalLink[]
  competitorsFetched: string[]
  competitorsFailed: string[]
}

// ── Noise filter ──────────────────────────────────────────────────────────────

// Domains that are utility/infrastructure — not outreach targets
const NOISE_DOMAINS = new Set([
  'google.com', 'google.co', 'googleapis.com', 'gstatic.com', 'doubleclick.net',
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
  'youtube.com', 'tiktok.com', 'pinterest.com', 'reddit.com',
  'cloudflare.com', 'amazonaws.com', 'fastly.net', 'cdn.jsdelivr.net',
  'jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com',
  'hotjar.com', 'segment.io', 'segment.com', 'mixpanel.com',
  'intercom.io', 'intercom.com', 'crisp.chat', 'zendesk.com',
  'hubspot.com', 'mailchimp.com', 'sendgrid.net',
  'apple.com', 'microsoft.com', 'github.com', 'gitlab.com',
  'slack.com', 'notion.so', 'airtable.com',
  'stripe.com', 'paypal.com', 'paddle.com', 'lemonsqueezy.com',
  'unsplash.com', 'pexels.com', 'shutterstock.com',
  'w3.org', 'schema.org', 'iana.org',
  'fonts.googleapis.com', 'fonts.gstatic.com',
  'vimeo.com', 'loom.com', 'wistia.com',
  'typeform.com', 'calendly.com', 'cal.com',
  'sentry.io', 'datadog.com', 'newrelic.com',
])

// Section keywords that hint at the type of link
const PRESS_HINTS = /press|media|news|featured|coverage|mention|award|recogni/i
const PARTNER_HINTS = /partner|integrat|ecosystem|works.with|built.on|powered.by|sponsor/i
const BLOG_HINTS = /blog|article|post|tutorial|guide|resource|learn|doc/i
const FOOTER_HINTS = /footer/i

// ── Helpers ───────────────────────────────────────────────────────────────────

async function safeFetch(url: string, timeoutMs = 10000): Promise<string | null> {
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

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function isNoiseDomain(domain: string): boolean {
  if (!domain) return true
  // Check exact match and suffix match (e.g. sub.google.com)
  for (const noise of NOISE_DOMAINS) {
    if (domain === noise || domain.endsWith(`.${noise}`)) return true
  }
  return false
}

function getSectionHint(sectionClass: string, sectionText: string): string {
  const combined = `${sectionClass} ${sectionText}`.toLowerCase()
  if (PRESS_HINTS.test(combined)) return 'press'
  if (PARTNER_HINTS.test(combined)) return 'partners'
  if (FOOTER_HINTS.test(combined)) return 'footer'
  if (BLOG_HINTS.test(combined)) return 'blog'
  return 'other'
}

function extractLinksFromHtml(
  html: string,
  competitorUrl: string,
  userDomain: string,
): ExternalLink[] {
  const $ = load(html)
  const competitorDomain = extractDomain(competitorUrl)
  const links: ExternalLink[] = []
  const seenDomains = new Set<string>()

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''

    // Must be an absolute URL pointing to an external site
    if (!href.startsWith('http')) return
    const domain = extractDomain(href)
    if (!domain) return
    if (domain === competitorDomain) return
    if (domain === userDomain) return
    if (isNoiseDomain(domain)) return
    // One link per domain per page — no duplicates
    if (seenDomains.has(domain)) return
    seenDomains.add(domain)

    const anchorText = $(el).text().trim().slice(0, 120)

    // Walk up the DOM to find meaningful context
    let sectionClass = ''
    let nearestHeading = ''
    let surroundingText = ''

    const parents = $(el).parents().toArray()
    for (const parent of parents) {
      const cls = ($(parent).attr('class') ?? '') + ' ' + ($(parent).attr('id') ?? '')
      if (cls.trim()) { sectionClass = cls.trim().slice(0, 200); break }
    }

    // Find nearest heading above this element
    const allHeadings = $('h1, h2, h3, h4').toArray()
    for (let i = allHeadings.length - 1; i >= 0; i--) {
      const heading = allHeadings[i]
      if ($(heading).index() < $(el).index()) {
        nearestHeading = $(heading).text().trim().slice(0, 100)
        break
      }
    }

    // Get surrounding paragraph text
    const parentParagraph = $(el).closest('p, li, div').first()
    surroundingText = parentParagraph.text().replace(/\s+/g, ' ').trim().slice(0, 200)

    const sectionHint = getSectionHint(sectionClass, `${nearestHeading} ${surroundingText}`)

    links.push({
      url: href.slice(0, 300),
      domain,
      anchorText: anchorText || domain,
      surroundingText: [nearestHeading, surroundingText].filter(Boolean).join(' — ').slice(0, 250),
      sectionHint,
      foundOn: competitorUrl,
    })
  })

  return links
}

// ── Sub-pages to try per competitor ──────────────────────────────────────────

const SUB_PAGES = ['/press', '/media', '/about', '/partners', '/integrations', '/blog']

// ── Main export ───────────────────────────────────────────────────────────────

export async function fetchOutreachTargetsData(
  requirements: Record<string, string>,
): Promise<OutreachTargetsFetchResult> {
  const userUrl = requirements['website_url'] ?? ''
  const brandName = requirements['brand_name'] ?? ''
  const userDomain = extractDomain(userUrl)

  const rawUrls = requirements['competitor_urls'] ?? ''
  const competitorUrls = rawUrls
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, 5) // cap at 5 competitors

  const allLinks: ExternalLink[] = []
  const competitorsFetched: string[] = []
  const competitorsFailed: string[] = []

  await Promise.all(
    competitorUrls.map(async (competitorUrl) => {
      const base = competitorUrl.startsWith('http') ? competitorUrl : `https://${competitorUrl}`
      const baseOrigin = new URL(base).origin

      // Fetch homepage first
      const homeHtml = await safeFetch(base)
      if (!homeHtml) {
        competitorsFailed.push(competitorUrl)
        return
      }
      competitorsFetched.push(competitorUrl)
      allLinks.push(...extractLinksFromHtml(homeHtml, base, userDomain))

      // Try sub-pages in parallel — skip ones that 404
      const subHtmls = await Promise.all(
        SUB_PAGES.map((path) => safeFetch(`${baseOrigin}${path}`)),
      )
      subHtmls.forEach((html, i) => {
        if (html) {
          allLinks.push(...extractLinksFromHtml(html, `${baseOrigin}${SUB_PAGES[i]}`, userDomain))
        }
      })
    }),
  )

  // Deduplicate across all competitors — keep first occurrence
  const seenDomains = new Set<string>()
  const dedupedLinks = allLinks.filter((link) => {
    if (seenDomains.has(link.domain)) return false
    seenDomains.add(link.domain)
    return true
  })

  // Cap at 60 links to keep the Claude prompt manageable
  const links = dedupedLinks.slice(0, 60)

  return { userUrl, brandName, links, competitorsFetched, competitorsFailed }
}
