/**
 * Website Audit Engine
 *
 * Analyzes a URL across 8 categories using rule-based checks.
 * No API keys required. Uses native fetch (Node 18+) + cheerio.
 *
 * Usage:
 *   import { runAudit } from '@/lib/audit/audit'
 *   const result = await runAudit('https://example.com')
 */

import * as cheerio from 'cheerio'
import { connect as tlsConnect } from 'tls'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ── Types ─────────────────────────────────────────────────────────────────────

export type FindingLevel = 'good' | 'ok' | 'bad' | 'info'

export interface Finding {
  key: string
  level: FindingLevel
  text: string
  fix?: string
  code?: string
}

export interface AuditSection {
  name: string
  key: string
  score: number
  findings: Finding[]
}

export interface AuditResult {
  url: string
  final_url: string
  status: number
  timestamp: string
  lighthouse: boolean
  overall: number
  action_count: number
  sections: AuditSection[]
}

export interface AuditError {
  error: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function f(key: string, level: FindingLevel, text: string, fix?: string, code?: string): Finding {
  const out: Finding = { key, level, text }
  if (fix) out.fix = fix
  if (code) out.code = code
  return out
}

function calcScore(findings: Finding[]): number {
  let score = 100
  for (const finding of findings) {
    if (finding.level === 'bad') score -= 25
    else if (finding.level === 'ok') score -= 10
  }
  return Math.max(0, Math.min(100, score))
}

function normalizeUrl(url: string): string {
  return url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ── SSL check (Node tls module) ───────────────────────────────────────────────

function checkSSL(hostname: string): Promise<{ valid: boolean; daysRemaining: number }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.destroy()
      resolve({ valid: false, daysRemaining: 0 })
    }, 5000)

    const socket = tlsConnect({ host: hostname, port: 443, servername: hostname }, () => {
      clearTimeout(timer)
      const cert = socket.getPeerCertificate()
      const expires = new Date(cert.valid_to)
      const daysRemaining = Math.floor((expires.getTime() - Date.now()) / 86_400_000)
      const valid = !socket.authorizationError && daysRemaining > 0
      socket.destroy()
      resolve({ valid, daysRemaining })
    })

    socket.on('error', () => {
      clearTimeout(timer)
      resolve({ valid: false, daysRemaining: 0 })
    })
  })
}

// ── Lighthouse (optional, auto-detected) ──────────────────────────────────────

async function lighthouseAvailable(): Promise<boolean> {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    await execFileAsync(cmd, ['lighthouse'])
    return true
  } catch {
    return false
  }
}

async function runLighthouse(url: string): Promise<Record<string, number> | null> {
  try {
    const { stdout } = await execFileAsync(
      'lighthouse',
      [
        url,
        '--output=json',
        '--output-path=stdout',
        '--only-categories=performance',
        '--chrome-flags=--headless --no-sandbox',
        '--quiet',
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    )
    const report = JSON.parse(stdout) as {
      categories: { performance: { score: number } }
      audits: Record<string, { numericValue?: number }>
    }
    return {
      performance: Math.round((report.categories.performance.score ?? 0) * 100),
      fcp: Math.round(report.audits['first-contentful-paint']?.numericValue ?? 0),
      lcp: Math.round(report.audits['largest-contentful-paint']?.numericValue ?? 0),
      tbt: Math.round(report.audits['total-blocking-time']?.numericValue ?? 0),
      cls: report.audits['cumulative-layout-shift']?.numericValue ?? 0,
    }
  } catch {
    return null
  }
}

// ── Accessibility (Google PageSpeed Insights) ─────────────────────────────────

export interface A11yData {
  accessibilityScore: number
  colorContrastPass: boolean | null
  colorContrastFailCount: number | null
  fontSizePass: boolean | null
  tapTargetsPass: boolean | null
  accessibleNamesPass: boolean | null
}

async function fetchPsiAccessibility(url: string): Promise<A11yData | null> {
  try {
    const key = process.env.GOOGLE_PSI_API_KEY
    const params = new URLSearchParams({ url, strategy: 'mobile' })
    params.append('category', 'accessibility')
    params.append('category', 'seo')
    if (key) params.set('key', key)
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(endpoint, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const json = await res.json() as Record<string, unknown>
    const lhr = json.lighthouseResult as Record<string, unknown> | undefined
    const cats = lhr?.categories as Record<string, { score: number | null }> | undefined
    const audits = lhr?.audits as Record<string, { score: number | null; details?: { items?: unknown[] } }> | undefined

    const auditPass = (id: string): boolean | null => {
      const a = audits?.[id]
      if (!a || a.score === null || a.score === undefined) return null
      return a.score === 1
    }

    const buttonName = auditPass('button-name')
    const linkName = auditPass('link-name')
    const accessibleNamesPass = buttonName === null && linkName === null
      ? null
      : (buttonName ?? true) && (linkName ?? true)

    const colorContrastItems = audits?.['color-contrast']?.details?.items
    const colorContrastFailCount = Array.isArray(colorContrastItems) ? colorContrastItems.length : null

    return {
      accessibilityScore: Math.round((cats?.accessibility?.score ?? 0) * 100),
      colorContrastPass: auditPass('color-contrast'),
      colorContrastFailCount,
      fontSizePass: auditPass('font-size'),
      tapTargetsPass: auditPass('tap-targets'),
      accessibleNamesPass,
    }
  } catch {
    return null
  }
}

// ── 1. UX & UI ────────────────────────────────────────────────────────────────

function auditUX($: cheerio.CheerioAPI, a11yData: A11yData | null): Finding[] {
  const findings: Finding[] = []

  // has-title
  const title = $('title').first().text().trim()
  if (!title) {
    findings.push(f('has-title', 'bad', 'Page has no <title> tag.',
      'Add a unique, descriptive title (50–60 chars) inside <head>.',
      '<title>Your Brand — Short Description</title>'))
  } else if (title.length < 10 || title.length > 70) {
    findings.push(f('has-title', 'ok',
      `Title is ${title.length} chars — ideal range is 50–60 ("${title.slice(0, 50)}${title.length > 50 ? '…' : ''}").`,
      'Update the <title> to be between 50 and 60 characters.'))
  } else {
    findings.push(f('has-title', 'good', `Title is present and well-sized (${title.length} chars).`))
  }

  // has-h1
  const h1Count = $('h1').length
  if (h1Count === 0) {
    findings.push(f('has-h1', 'bad', 'Page has no <h1> heading.',
      'Add a single <h1> that clearly describes the page.',
      '<h1>Your Main Page Heading</h1>'))
  } else if (h1Count > 1) {
    findings.push(f('has-h1', 'ok', `Page has ${h1Count} <h1> tags — only one is recommended.`,
      'Remove extra <h1> tags and keep only the most important one.'))
  } else {
    findings.push(f('has-h1', 'good',
      `Exactly one <h1>: "${$('h1').first().text().trim().slice(0, 60)}".`))
  }

  // viewport-meta
  const viewport = $('meta[name="viewport"]').attr('content') ?? ''
  if (!viewport) {
    findings.push(f('viewport-meta', 'bad', 'No viewport meta tag — page will not render correctly on mobile.',
      'Add a viewport meta tag inside <head>.',
      '<meta name="viewport" content="width=device-width, initial-scale=1">'))
  } else if (!viewport.includes('width=device-width')) {
    findings.push(f('viewport-meta', 'ok', `Viewport tag present but may be misconfigured: "${viewport}".`,
      'Set content to "width=device-width, initial-scale=1".',
      '<meta name="viewport" content="width=device-width, initial-scale=1">'))
  } else {
    findings.push(f('viewport-meta', 'good', 'Viewport meta tag is correctly configured.'))
  }

  // Accessibility (from Google PageSpeed Insights, optional)
  if (a11yData) {
    const { accessibilityScore, colorContrastPass, colorContrastFailCount, fontSizePass, tapTargetsPass, accessibleNamesPass } = a11yData

    if (accessibilityScore >= 90) {
      findings.push(f('accessibility-score', 'good', `Accessibility score is ${accessibilityScore}/100.`))
    } else if (accessibilityScore >= 50) {
      findings.push(f('accessibility-score', 'ok',
        `Accessibility score is ${accessibilityScore}/100 — several issues affect users with disabilities.`,
        'Review the color contrast, font size, tap target, and accessible name findings below and fix the highest-impact ones first.'))
    } else {
      findings.push(f('accessibility-score', 'bad',
        `Accessibility score is ${accessibilityScore}/100 — significant barriers for users with disabilities.`,
        'Prioritise fixing color contrast, accessible names, and tap target sizing.'))
    }

    if (colorContrastPass === false) {
      const countText = colorContrastFailCount && colorContrastFailCount > 0
        ? `${colorContrastFailCount} element${colorContrastFailCount === 1 ? '' : 's'} on this page`
        : 'Some text'
      findings.push(f('color-contrast', 'bad',
        `${countText} do${colorContrastFailCount === 1 ? 'es' : ''} not have sufficient contrast against its background — fails WCAG AA.`,
        'Ensure body text has at least a 4.5:1 contrast ratio (3:1 for large text/18px+ bold) against its background.'))
    } else if (colorContrastPass === true) {
      findings.push(f('color-contrast', 'good', 'Text meets WCAG AA color contrast requirements.'))
    }

    if (fontSizePass === false) {
      findings.push(f('font-size', 'bad',
        'Some text is too small to read comfortably, especially on mobile.',
        'Use a base font size of at least 16px for body text.'))
    } else if (fontSizePass === true) {
      findings.push(f('font-size', 'good', 'Font sizes are legible across the page.'))
    }

    if (tapTargetsPass === false) {
      findings.push(f('tap-targets', 'bad',
        'Some buttons or links are too small or too close together to tap reliably on mobile.',
        'Make tap targets at least 48x48px with adequate spacing between neighbouring targets.'))
    } else if (tapTargetsPass === true) {
      findings.push(f('tap-targets', 'good', 'Tap targets are appropriately sized for mobile use.'))
    }

    if (accessibleNamesPass === false) {
      findings.push(f('accessible-names', 'bad',
        'Some buttons or links have no accessible name, so screen reader users cannot tell what they do.',
        'Add descriptive text, aria-label, or aria-labelledby to every button and link.'))
    } else if (accessibleNamesPass === true) {
      findings.push(f('accessible-names', 'good', 'All buttons and links have accessible names for screen readers.'))
    }
  }

  return findings
}

// ── 2. Navigation & Structure ─────────────────────────────────────────────────

function auditNav($: cheerio.CheerioAPI, pageUrl: string): Finding[] {
  const findings: Finding[] = []
  const hostname = new URL(pageUrl).hostname
  const allLinks = $('a[href]')

  // has-nav-landmark
  const hasNav = $('nav').length > 0 || $('[role="navigation"]').length > 0
  if (!hasNav) {
    findings.push(f('has-nav-landmark', 'bad',
      'No <nav> landmark found — search engines and screen readers cannot identify the navigation.',
      'Wrap your main navigation links in a <nav> element.',
      '<nav aria-label="Main navigation">\n  <a href="/about">About</a>\n  <a href="/contact">Contact</a>\n</nav>'))
  } else {
    findings.push(f('has-nav-landmark', 'good', 'Page has a <nav> landmark.'))
  }

  // internal-links
  let internalCount = 0
  allLinks.each((_, el) => {
    const href = $(el).attr('href') ?? ''
    if (href.startsWith('/') || href.includes(hostname)) internalCount++
  })
  if (internalCount < 2) {
    findings.push(f('internal-links', 'bad',
      `Only ${internalCount} internal link(s) found — pages need internal links for navigation and SEO.`,
      'Add links to key pages (about, services, contact) in your nav or body.'))
  } else {
    findings.push(f('internal-links', 'good', `${internalCount} internal links found.`))
  }

  // descriptive-link-text
  const genericTexts = new Set(['click here', 'read more', 'here', 'more', 'link', 'this', 'learn more', 'details'])
  let genericCount = 0
  allLinks.each((_, el) => {
    if (genericTexts.has($(el).text().trim().toLowerCase())) genericCount++
  })
  const totalLinks = allLinks.length
  if (totalLinks > 0 && genericCount / totalLinks > 0.2) {
    findings.push(f('descriptive-link-text', 'bad',
      `${genericCount} of ${totalLinks} links use generic anchor text like "click here" or "read more".`,
      'Replace generic link text with descriptive text that explains the destination.'))
  } else if (genericCount > 0) {
    findings.push(f('descriptive-link-text', 'ok',
      `${genericCount} link(s) use generic anchor text — consider making them more descriptive.`))
  } else {
    findings.push(f('descriptive-link-text', 'good', 'All links use descriptive anchor text.'))
  }

  // external-link-safety
  let unsafeCount = 0
  allLinks.each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const isExternal = href.startsWith('http') && !href.includes(hostname)
    const opensNewTab = $(el).attr('target') === '_blank'
    const hasNoopener = ($(el).attr('rel') ?? '').includes('noopener')
    if (isExternal && opensNewTab && !hasNoopener) unsafeCount++
  })
  if (unsafeCount > 0) {
    findings.push(f('external-link-safety', 'ok',
      `${unsafeCount} external link(s) open in a new tab without rel="noopener" — minor security risk.`,
      'Add rel="noopener noreferrer" to all external links that open in a new tab.',
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Link text</a>'))
  } else {
    findings.push(f('external-link-safety', 'good', 'External links are safely attributed.'))
  }

  return findings
}

// ── 3. Page Speed ─────────────────────────────────────────────────────────────

function auditSpeed(
  headers: Record<string, string>,
  responseTimeMs: number,
  bodySize: number,
  $: cheerio.CheerioAPI,
  lighthouseData: Record<string, number> | null,
): Finding[] {
  const findings: Finding[] = []

  // response-time
  if (responseTimeMs > 3000) {
    findings.push(f('response-time', 'bad',
      `Server responded in ${(responseTimeMs / 1000).toFixed(1)}s — ideal is under 2s.`,
      'Enable server-side caching, use a CDN, or optimise server response time.'))
  } else if (responseTimeMs > 2000) {
    findings.push(f('response-time', 'ok',
      `Server responded in ${(responseTimeMs / 1000).toFixed(1)}s — target is under 2s.`))
  } else {
    findings.push(f('response-time', 'good', `Server responded in ${(responseTimeMs / 1000).toFixed(1)}s.`))
  }

  // page-size
  const sizeMB = bodySize / 1_048_576
  if (sizeMB > 2) {
    findings.push(f('page-size', 'bad',
      `HTML payload is ${sizeMB.toFixed(1)}MB — very large for a single page.`,
      'Remove unused markup, reduce embedded CSS/JS, and lazy-load images.'))
  } else if (sizeMB > 1) {
    findings.push(f('page-size', 'ok', `HTML payload is ${sizeMB.toFixed(1)}MB — consider optimising.`))
  } else {
    findings.push(f('page-size', 'good', `HTML payload is ${(bodySize / 1024).toFixed(0)}KB.`))
  }

  // compression
  const encoding = headers['content-encoding'] ?? ''
  if (!encoding) {
    findings.push(f('compression', 'bad',
      'Response is not compressed — enabling gzip or Brotli can cut payload size by 60–80%.',
      'Enable gzip or Brotli compression on your web server or CDN.'))
  } else {
    findings.push(f('compression', 'good', `Response is compressed (${encoding}).`))
  }

  // image-dimensions
  const imgs = $('img')
  let missingDimensions = 0
  imgs.each((_, el) => {
    if (!$(el).attr('width') || !$(el).attr('height')) missingDimensions++
  })
  if (imgs.length === 0) {
    findings.push(f('image-dimensions', 'info', 'No images found on the page.'))
  } else if (missingDimensions > 0) {
    findings.push(f('image-dimensions', 'ok',
      `${missingDimensions} of ${imgs.length} images are missing width/height — causes cumulative layout shift.`,
      'Add explicit width and height to all <img> elements.',
      '<img src="photo.jpg" width="800" height="600" alt="Description">'))
  } else {
    findings.push(f('image-dimensions', 'good', `All ${imgs.length} images have explicit dimensions.`))
  }

  // Lighthouse metrics (optional)
  if (lighthouseData) {
    const { lcp, fcp, tbt, cls, performance } = lighthouseData
    if (lcp > 2500) {
      findings.push(f('lcp-score', 'bad',
        `Largest Contentful Paint is ${(lcp / 1000).toFixed(1)}s — Google considers > 2.5s poor.`,
        'Optimise your hero image, reduce server response time, and eliminate render-blocking resources.'))
    } else {
      findings.push(f('lcp-score', 'good', `LCP is ${(lcp / 1000).toFixed(1)}s (good). Performance score: ${performance}/100. FCP: ${(fcp / 1000).toFixed(1)}s, TBT: ${tbt}ms, CLS: ${cls.toFixed(3)}.`))
    }
  }

  return findings
}

// ── 4. Mobile Friendliness ────────────────────────────────────────────────────

function auditMobile($: cheerio.CheerioAPI): Finding[] {
  const findings: Finding[] = []

  // viewport-configured
  const viewport = $('meta[name="viewport"]').attr('content') ?? ''
  if (!viewport.includes('width=device-width')) {
    findings.push(f('viewport-configured', 'bad',
      'Viewport is not configured for mobile — page will appear zoomed out on phones.',
      'Add the correct viewport meta tag inside <head>.',
      '<meta name="viewport" content="width=device-width, initial-scale=1">'))
  } else {
    findings.push(f('viewport-configured', 'good', 'Viewport is correctly configured for mobile.'))
  }

  // no-fixed-width — check inline styles and <table width="">
  let fixedWidthCount = 0
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') ?? ''
    const matches = style.match(/width\s*:\s*(\d+)px/gi) ?? []
    for (const m of matches) {
      const px = parseInt(m.replace(/\D/g, ''))
      if (px > 320) fixedWidthCount++
    }
  })
  $('table[width]').each((_, el) => {
    const w = parseInt($(el).attr('width') ?? '0')
    if (w > 320) fixedWidthCount++
  })
  if (fixedWidthCount > 0) {
    findings.push(f('no-fixed-width', 'bad',
      `${fixedWidthCount} element(s) have fixed pixel widths that may overflow on small screens.`,
      'Replace fixed px widths with max-width or percentage values in CSS.'))
  } else {
    findings.push(f('no-fixed-width', 'good', 'No fixed-width elements detected in inline styles.'))
  }

  // has-media-queries — check inline <style> tags
  let hasMediaQueries = false
  $('style').each((_, el) => {
    if (($(el).html() ?? '').includes('@media')) hasMediaQueries = true
  })
  if (hasMediaQueries) {
    findings.push(f('has-media-queries', 'good', 'Responsive @media queries found in inline styles.'))
  } else {
    findings.push(f('has-media-queries', 'info',
      'No @media queries in inline styles — responsive CSS may be in external files (could not be verified).'))
  }

  return findings
}

// ── 5. Trust Signals ──────────────────────────────────────────────────────────

async function auditTrust(
  pageUrl: string,
  headers: Record<string, string>,
  $: cheerio.CheerioAPI,
): Promise<Finding[]> {
  const findings: Finding[] = []
  const isHttps = pageUrl.startsWith('https://')

  // uses-https
  if (!isHttps) {
    findings.push(f('uses-https', 'bad',
      'Site is served over HTTP — browsers mark this as "Not Secure".',
      'Install an SSL certificate and redirect all HTTP traffic to HTTPS.'))
  } else {
    findings.push(f('uses-https', 'good', 'Site is served over HTTPS.'))
  }

  // ssl-valid
  if (isHttps) {
    const hostname = new URL(pageUrl).hostname
    const ssl = await checkSSL(hostname)
    if (!ssl.valid) {
      findings.push(f('ssl-valid', 'bad', 'SSL certificate is invalid or expired.',
        'Renew your SSL certificate immediately.'))
    } else if (ssl.daysRemaining < 30) {
      findings.push(f('ssl-valid', 'ok',
        `SSL certificate expires in ${ssl.daysRemaining} days — renew soon.`,
        'Renew your SSL certificate before it expires.'))
    } else {
      findings.push(f('ssl-valid', 'good', `SSL certificate is valid (expires in ${ssl.daysRemaining} days).`))
    }
  } else {
    findings.push(f('ssl-valid', 'bad', 'No SSL — site is not using HTTPS.'))
  }

  // security-headers
  const wantedHeaders = ['x-frame-options', 'x-content-type-options', 'referrer-policy']
  const presentHeaders = wantedHeaders.filter((h) => headers[h])
  const missingHeaders = wantedHeaders.filter((h) => !headers[h])
  if (presentHeaders.length === 0) {
    findings.push(f('security-headers', 'bad',
      'No security headers present (X-Frame-Options, X-Content-Type-Options, Referrer-Policy).',
      'Add security headers in your server or CDN configuration.',
      '# Nginx example\nadd_header X-Frame-Options "SAMEORIGIN";\nadd_header X-Content-Type-Options "nosniff";\nadd_header Referrer-Policy "strict-origin-when-cross-origin";'))
  } else if (missingHeaders.length > 0) {
    findings.push(f('security-headers', 'ok',
      `${presentHeaders.length}/${wantedHeaders.length} security headers present. Missing: ${missingHeaders.join(', ')}.`,
      `Add the missing headers: ${missingHeaders.join(', ')}.`))
  } else {
    findings.push(f('security-headers', 'good', 'All recommended security headers are set.'))
  }

  // has-privacy-page
  const hasPrivacy = $('a').toArray().some((el) => {
    const href = ($(el).attr('href') ?? '').toLowerCase()
    const text = $(el).text().toLowerCase()
    return href.includes('privacy') || text.includes('privacy')
  })
  if (!hasPrivacy) {
    findings.push(f('has-privacy-page', 'bad',
      'No privacy policy link found — required by GDPR, CCPA, and most ad platforms.',
      'Create a privacy policy page and link to it in the footer.',
      '<a href="/privacy-policy">Privacy Policy</a>'))
  } else {
    findings.push(f('has-privacy-page', 'good', 'Privacy policy link found.'))
  }

  // has-contact-page
  const hasContact = $('a').toArray().some((el) => {
    const href = ($(el).attr('href') ?? '').toLowerCase()
    const text = $(el).text().toLowerCase()
    return href.includes('contact') || text.includes('contact')
  })
  if (!hasContact) {
    findings.push(f('has-contact-page', 'ok',
      'No contact page link found — visitors have no clear way to reach you.',
      'Add a contact page and link to it in your navigation or footer.',
      '<a href="/contact">Contact Us</a>'))
  } else {
    findings.push(f('has-contact-page', 'good', 'Contact page link found.'))
  }

  return findings
}

// ── 6. Conversion (CRO) ───────────────────────────────────────────────────────

function auditCRO($: cheerio.CheerioAPI, html: string): Finding[] {
  const findings: Finding[] = []

  const actionPattern = /\b(get|start|try|sign up|signup|join|buy|shop|order|book|download|subscribe|claim|access|request|schedule|apply|register)\b/i
  const strongPattern = /\b(get started|start free|try free|sign up free|book a demo|schedule a call|claim your|download free|start your free)\b/i

  const ctaEls = $('a, button').toArray().filter((el) => {
    const text = $(el).text().trim()
    return text.length > 0 && text.length < 60 && actionPattern.test(text)
  })

  // has-cta
  if (ctaEls.length === 0) {
    findings.push(f('has-cta', 'bad',
      'No call-to-action buttons or links found — visitors have no obvious next step.',
      'Add at least one prominent CTA button with action-oriented text.',
      '<a href="/signup" class="btn-primary">Start Free Trial</a>'))
  } else {
    findings.push(f('has-cta', 'good', `${ctaEls.length} CTA element(s) found.`))
  }

  // cta-action-language
  if (ctaEls.length > 0) {
    const hasStrong = ctaEls.some((el) => strongPattern.test($(el).text()))
    if (!hasStrong) {
      findings.push(f('cta-action-language', 'ok',
        'CTAs exist but use weak language — high-converting CTAs are specific and benefit-led.',
        'Replace generic CTAs ("Submit", "Click here") with benefit-led copy.',
        '<a href="/start">Start Your Free 14-Day Trial</a>'))
    } else {
      findings.push(f('cta-action-language', 'good', 'CTAs use strong, benefit-led action language.'))
    }
  } else {
    findings.push(f('cta-action-language', 'info', 'No CTAs found to evaluate.'))
  }

  // above-fold-cta — proxy: check if action language appears in first 6000 chars of HTML
  const aboveFold = html.slice(0, 6000)
  if (!actionPattern.test(aboveFold)) {
    findings.push(f('above-fold-cta', 'ok',
      'No CTA detected in the first section of the page — visitors may miss it without scrolling.',
      'Place at least one CTA button in the hero section, above the fold.'))
  } else {
    findings.push(f('above-fold-cta', 'good', 'A CTA is present early in the page (likely above the fold).'))
  }

  // social-proof
  const bodyText = $('body').text().toLowerCase()
  const proofPatterns = [
    /testimonial/, /review/, /trusted by/, /rated/,
    /\d[\d,]+\s*(users|clients|customers|businesses|companies)/,
    /case stud/, /stars?/, /award/,
  ]
  const hasProof = proofPatterns.some((p) => p.test(bodyText))
  if (!hasProof) {
    findings.push(f('social-proof', 'bad',
      'No social proof signals detected (testimonials, reviews, customer counts, ratings).',
      'Add testimonials, a customer count, or trust badges to build credibility.'))
  } else {
    findings.push(f('social-proof', 'good', 'Social proof signals found (reviews, testimonials, or customer numbers).'))
  }

  return findings
}

// ── 7. Forms & CTAs ───────────────────────────────────────────────────────────

function auditForms($: cheerio.CheerioAPI): Finding[] {
  const findings: Finding[] = []
  const forms = $('form')

  if (forms.length === 0) {
    findings.push(f('form-labels', 'info', 'No forms found on the page.'))
    findings.push(f('form-not-too-long', 'info', 'No forms found on the page.'))
    findings.push(f('submit-button', 'info', 'No forms found on the page.'))
    findings.push(f('placeholder-not-label', 'info', 'No forms found on the page.'))
    return findings
  }

  let unlabeledInputs = 0
  let totalInputs = 0
  let maxFieldCount = 0
  let formsWithoutSubmit = 0
  let placeholderOnlyInputs = 0

  forms.each((_, form) => {
    const inputs = $(form).find(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select',
    )
    if (inputs.length > maxFieldCount) maxFieldCount = inputs.length

    const hasSubmit =
      $(form).find('[type="submit"]').length > 0 ||
      $(form).find('button:not([type="button"]):not([type="reset"])').length > 0
    if (!hasSubmit) formsWithoutSubmit++

    inputs.each((_, input) => {
      totalInputs++
      const id = $(input).attr('id')
      const ariaLabel = $(input).attr('aria-label')
      const ariaLabelledBy = $(input).attr('aria-labelledby')
      const hasLabel = id ? $(`label[for="${id}"]`).length > 0 : false
      if (!hasLabel && !ariaLabel && !ariaLabelledBy) {
        unlabeledInputs++
        if ($(input).attr('placeholder')) placeholderOnlyInputs++
      }
    })
  })

  // form-labels
  if (unlabeledInputs > 0) {
    findings.push(f('form-labels', 'bad',
      `${unlabeledInputs} of ${totalInputs} input(s) have no label — inaccessible to screen readers.`,
      'Add a <label for="inputId"> for every form field.',
      '<label for="email">Email address</label>\n<input type="email" id="email" name="email">'))
  } else {
    findings.push(f('form-labels', 'good', `All ${totalInputs} form inputs have labels.`))
  }

  // form-not-too-long
  if (maxFieldCount > 10) {
    findings.push(f('form-not-too-long', 'bad',
      `Longest form has ${maxFieldCount} fields — long forms reduce completion rates significantly.`,
      'Reduce to 5 fields or fewer. Collect extra info after signup.'))
  } else if (maxFieldCount > 6) {
    findings.push(f('form-not-too-long', 'ok',
      `Longest form has ${maxFieldCount} fields — consider trimming to improve conversion.`))
  } else {
    findings.push(f('form-not-too-long', 'good', `Form length is good (max ${maxFieldCount} fields).`))
  }

  // submit-button
  if (formsWithoutSubmit > 0) {
    findings.push(f('submit-button', 'bad',
      `${formsWithoutSubmit} form(s) have no submit button — users cannot submit them.`,
      'Add a submit button to every form.',
      '<button type="submit">Send Message</button>'))
  } else {
    findings.push(f('submit-button', 'good', 'All forms have a submit button.'))
  }

  // placeholder-not-label
  if (placeholderOnlyInputs > 0) {
    findings.push(f('placeholder-not-label', 'ok',
      `${placeholderOnlyInputs} input(s) use placeholder text as the only label — disappears on focus.`,
      'Add a visible <label> above each input. Placeholder can remain as a hint.'))
  } else {
    findings.push(f('placeholder-not-label', 'good', 'No inputs rely on placeholder as a label substitute.'))
  }

  return findings
}

// ── 8. Technical Health ───────────────────────────────────────────────────────

function auditTech($: cheerio.CheerioAPI, robotsStatus: number, sitemapStatus: number): Finding[] {
  const findings: Finding[] = []

  // meta-description
  const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? ''
  if (!metaDesc) {
    findings.push(f('meta-description', 'bad', 'No meta description — search engines will auto-generate an unhelpful snippet.',
      'Add a meta description between 150 and 160 characters.',
      '<meta name="description" content="Clear, keyword-rich description of this page (150–160 chars).">'))
  } else if (metaDesc.length < 50 || metaDesc.length > 170) {
    findings.push(f('meta-description', 'ok',
      `Meta description is ${metaDesc.length} chars — ideal is 150–160 chars.`,
      'Update the meta description to be between 150 and 160 characters.'))
  } else {
    findings.push(f('meta-description', 'good', `Meta description is present (${metaDesc.length} chars).`))
  }

  // canonical
  const canonical = $('link[rel="canonical"]').attr('href')
  if (!canonical) {
    findings.push(f('canonical', 'bad',
      'No canonical URL tag — search engines may index duplicate versions of this page.',
      'Add a canonical tag inside <head>.',
      '<link rel="canonical" href="https://yourdomain.com/page">'))
  } else {
    findings.push(f('canonical', 'good', `Canonical URL set: ${canonical}`))
  }

  // og-tags
  const ogTitle = $('meta[property="og:title"]').attr('content')
  const ogDesc = $('meta[property="og:description"]').attr('content')
  const ogImage = $('meta[property="og:image"]').attr('content')
  const ogPresent = [ogTitle, ogDesc, ogImage].filter(Boolean).length
  if (ogPresent === 0) {
    findings.push(f('og-tags', 'bad',
      'No Open Graph tags — links shared on social media will look poor.',
      'Add og:title, og:description, and og:image to <head>.',
      '<meta property="og:title" content="Your Page Title">\n<meta property="og:description" content="Page description">\n<meta property="og:image" content="https://yourdomain.com/og-image.jpg">'))
  } else if (ogPresent < 3) {
    const missing = ['og:title', 'og:description', 'og:image'].filter((_, i) => ![ogTitle, ogDesc, ogImage][i])
    findings.push(f('og-tags', 'ok',
      `${ogPresent}/3 Open Graph tags present. Missing: ${missing.join(', ')}.`,
      `Add the missing OG tags: ${missing.join(', ')}.`))
  } else {
    findings.push(f('og-tags', 'good', 'All essential Open Graph tags are present.'))
  }

  // image-alt-text
  const images = $('img')
  let missingAlt = 0
  images.each((_, el) => {
    if ($(el).attr('alt') === undefined) missingAlt++
  })
  if (images.length === 0) {
    findings.push(f('image-alt-text', 'info', 'No images found on the page.'))
  } else if (missingAlt > 0) {
    const pct = Math.round((missingAlt / images.length) * 100)
    findings.push(f('image-alt-text', pct > 30 ? 'bad' : 'ok',
      `${missingAlt} of ${images.length} images (${pct}%) are missing alt text.`,
      'Add descriptive alt attributes to all content images. Use alt="" for decorative images.',
      '<img src="team.jpg" alt="Our team at the 2024 annual conference">'))
  } else {
    findings.push(f('image-alt-text', 'good', `All ${images.length} images have alt text.`))
  }

  // robots-txt
  if (robotsStatus === 200) {
    findings.push(f('robots-txt', 'good', 'robots.txt is accessible.'))
  } else {
    findings.push(f('robots-txt', 'bad',
      `robots.txt returned ${robotsStatus || 'no response'} — search engines cannot find crawl rules.`,
      'Create a robots.txt file at your domain root.',
      'User-agent: *\nAllow: /\nSitemap: https://yourdomain.com/sitemap.xml'))
  }

  // sitemap-xml
  if (sitemapStatus === 200) {
    findings.push(f('sitemap-xml', 'good', 'sitemap.xml is accessible.'))
  } else {
    findings.push(f('sitemap-xml', 'bad',
      `sitemap.xml returned ${sitemapStatus || 'no response'} — search engines cannot efficiently discover your pages.`,
      'Generate a sitemap.xml and submit it to Google Search Console.',
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://yourdomain.com/</loc></url>\n</urlset>'))
  }

  // structured-data
  const ldJson = $('script[type="application/ld+json"]')
  if (ldJson.length === 0) {
    findings.push(f('structured-data', 'ok',
      'No structured data (JSON-LD) found — adding schema markup can improve search result appearance.',
      'Add JSON-LD structured data for your organisation or page type.',
      '<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Your Brand",\n  "url": "https://yourdomain.com"\n}\n</script>'))
  } else {
    findings.push(f('structured-data', 'good', `${ldJson.length} structured data block(s) found.`))
  }

  // lang-attr
  const lang = $('html').attr('lang')
  if (!lang) {
    findings.push(f('lang-attr', 'bad',
      'The <html> element has no lang attribute — screen readers cannot determine the page language.',
      'Add a lang attribute to the <html> element.',
      '<html lang="en">'))
  } else {
    findings.push(f('lang-attr', 'good', `Page language declared: lang="${lang}".`))
  }

  return findings
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runAudit(url: string): Promise<AuditResult | AuditError> {
  const normalizedUrl = normalizeUrl(url)

  // Fetch main page
  let res: Response
  let html: string
  let finalUrl: string
  let responseTimeMs: number

  try {
    const start = Date.now()
    res = await fetch(normalizedUrl, {
      headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate, br' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    responseTimeMs = Date.now() - start
    finalUrl = res.url
    html = await res.text()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to fetch the page' }
  }

  // Fetch robots.txt and sitemap.xml in parallel
  const origin = new URL(finalUrl).origin
  const [robotsRes, sitemapRes] = await Promise.allSettled([
    fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(5_000) }),
    fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(5_000) }),
  ])
  const robotsStatus = robotsRes.status === 'fulfilled' ? robotsRes.value.status : 0
  const sitemapStatus = sitemapRes.status === 'fulfilled' ? sitemapRes.value.status : 0

  const $ = cheerio.load(html)
  const headers = Object.fromEntries(res.headers.entries())
  const bodySize = Buffer.byteLength(html, 'utf8')

  // Optional: Lighthouse
  const hasLighthouse = await lighthouseAvailable()
  const lighthouseData = hasLighthouse ? await runLighthouse(finalUrl) : null

  // Run all 8 category audits
  const [trustFindings, a11yData] = await Promise.all([
    auditTrust(finalUrl, headers, $),
    fetchPsiAccessibility(finalUrl),
  ])

  const sections: AuditSection[] = [
    { name: 'UX & UI Analysis',      key: 'ux',     findings: auditUX($, a11yData),                               score: 0 },
    { name: 'Navigation & Structure', key: 'nav',    findings: auditNav($, finalUrl),                             score: 0 },
    { name: 'Page Speed',             key: 'speed',  findings: auditSpeed(headers, responseTimeMs, bodySize, $, lighthouseData), score: 0 },
    { name: 'Mobile Friendliness',    key: 'mobile', findings: auditMobile($),                                    score: 0 },
    { name: 'Trust Signals',          key: 'trust',  findings: trustFindings,                                     score: 0 },
    { name: 'Conversion (CRO)',       key: 'cro',    findings: auditCRO($, html),                                 score: 0 },
    { name: 'Forms & CTAs',           key: 'forms',  findings: auditForms($),                                     score: 0 },
    { name: 'Technical Health',       key: 'tech',   findings: auditTech($, robotsStatus, sitemapStatus),         score: 0 },
  ]

  for (const section of sections) {
    section.score = calcScore(section.findings)
  }

  const overall = Math.round(sections.reduce((sum, s) => sum + s.score, 0) / sections.length)
  const actionCount = sections.flatMap((s) => s.findings).filter((fi) => fi.fix).length

  return {
    url: normalizedUrl,
    final_url: finalUrl,
    status: res.status,
    timestamp: new Date().toLocaleString(),
    lighthouse: !!lighthouseData,
    overall,
    action_count: actionCount,
    sections,
  }
}
