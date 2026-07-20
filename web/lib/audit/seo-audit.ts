/**
 * SEO Audit Rule Engine
 *
 * Runs deterministic SEO checks across 6 categories.
 * Requires cheerio (already installed). No extra API keys.
 * Lighthouse checks are optional — used only if CLI is available.
 */

import * as cheerio from 'cheerio'
import { connect as tlsConnect } from 'tls'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { discoverAllUrls, type UrlDiscoveryResult } from './url-discovery'

const execFileAsync = promisify(execFile)

// ── Types ─────────────────────────────────────────────────────────────────────

export type SeoFindingLevel = 'good' | 'ok' | 'bad' | 'info'

export interface SeoFinding {
  key: string
  level: SeoFindingLevel
  text: string
  fix?: string
}

export interface SeoAuditResult {
  url: string
  finalUrl: string
  findings: SeoFinding[]
  discoveredUrls?: UrlDiscoveryResult
}

export interface SeoAuditError {
  error: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function f(key: string, level: SeoFindingLevel, text: string, fix?: string): SeoFinding {
  const out: SeoFinding = { key, level, text }
  if (fix) out.fix = fix
  return out
}

const UA = 'Mozilla/5.0 (compatible; GrowJinBot/1.0; +https://growthhacker.app)'

// ── SSL check ─────────────────────────────────────────────────────────────────

function checkSSL(hostname: string): Promise<{ valid: boolean; daysRemaining: number }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { socket.destroy(); resolve({ valid: false, daysRemaining: 0 }) }, 5000)
    const socket = tlsConnect({ host: hostname, port: 443, servername: hostname }, () => {
      clearTimeout(timer)
      const cert = socket.getPeerCertificate()
      const daysRemaining = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000)
      const valid = !socket.authorizationError && daysRemaining > 0
      socket.destroy()
      resolve({ valid, daysRemaining })
    })
    socket.on('error', () => { clearTimeout(timer); resolve({ valid: false, daysRemaining: 0 }) })
  })
}

// ── Lightweight HEAD request ───────────────────────────────────────────────────

async function headRequest(url: string): Promise<{ status: number; contentType: string; contentLength: number } | null> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(5000),
      redirect: 'follow',
    })
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      contentLength: parseInt(res.headers.get('content-length') ?? '0', 10),
    }
  } catch {
    return null
  }
}

// ── Optional Lighthouse ────────────────────────────────────────────────────────

async function lighthouseAvailable(): Promise<boolean> {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    await execFileAsync(cmd, ['lighthouse'])
    return true
  } catch { return false }
}

async function runLighthouse(url: string): Promise<Record<string, number> | null> {
  try {
    const { stdout } = await execFileAsync('lighthouse', [
      url, '--output=json', '--output-path=stdout',
      '--only-categories=performance', '--chrome-flags=--headless --no-sandbox', '--quiet',
    ], { maxBuffer: 10 * 1024 * 1024 })
    const report = JSON.parse(stdout) as {
      categories: { performance: { score: number } }
      audits: Record<string, { numericValue?: number }>
    }
    return {
      performance: Math.round((report.categories.performance.score ?? 0) * 100),
      lcp: Math.round(report.audits['largest-contentful-paint']?.numericValue ?? 0),
      cls: report.audits['cumulative-layout-shift']?.numericValue ?? 0,
      fid: Math.round(report.audits['total-blocking-time']?.numericValue ?? 0),
    }
  } catch { return null }
}

// ── 1. Meta Tags ──────────────────────────────────────────────────────────────

async function checkMetaTags(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  canonicalHref: string | null,
): Promise<SeoFinding[]> {
  const findings: SeoFinding[] = []
  const hostname = new URL(pageUrl).hostname
  const domainParts = hostname.replace('www.', '').split('.')
  const brand = domainParts[0] ?? ''

  // Derive likely primary keyword from H1 (first 4 words, stripped)
  const h1Text = $('h1').first().text().trim().toLowerCase()
  const primaryKeyword = h1Text.split(/\s+/).slice(0, 4).join(' ')

  // ── Title ──
  const title = $('title').first().text().trim()

  findings.push(title
    ? f('title.present', 'good', `Title tag found: "${title.slice(0, 70)}${title.length > 70 ? '…' : ''}"`)
    : f('title.present', 'bad', 'No <title> tag found — search engines and browser tabs will show nothing.',
        'Add a descriptive <title> tag (50–60 chars) inside <head>.'))

  if (title) {
    const len = title.length
    if (len >= 50 && len <= 60) {
      findings.push(f('title.length', 'good', `Title is ${len} chars — within ideal range of 50–60.`))
    } else if (len >= 30 && len < 50) {
      findings.push(f('title.length', 'ok', `Title is ${len} chars — slightly short; ideal is 50–60.`,
        'Expand the title to 50–60 characters, adding the primary keyword if not already present.'))
    } else if (len > 60 && len <= 70) {
      findings.push(f('title.length', 'ok', `Title is ${len} chars — slightly over the 60-char ideal; may be truncated in search results.`,
        'Shorten the title to 50–60 characters.'))
    } else {
      findings.push(f('title.length', 'bad', `Title is ${len} chars — ${len < 30 ? 'too short' : 'too long; will be truncated in SERPs'}.`,
        'Rewrite the title to be 50–60 characters.'))
    }

    // title.keyword
    if (primaryKeyword && title.toLowerCase().includes(primaryKeyword.split(' ')[0])) {
      findings.push(f('title.keyword', 'good', `Primary keyword ("${primaryKeyword.split(' ')[0]}") appears in title.`))
    } else if (primaryKeyword) {
      findings.push(f('title.keyword', 'ok', `Primary keyword ("${primaryKeyword.split(' ')[0]}") not detected in title tag.`,
        'Naturally include your primary keyword near the start of the title.'))
    } else {
      findings.push(f('title.keyword', 'info', 'Could not determine primary keyword — check manually that title includes your target term.'))
    }

    // title.unique (needs full crawl)
    findings.push(f('title.unique', 'info', 'Duplicate title check requires a full site crawl — run with a crawler for multi-page analysis.'))

    // title.brand
    const titleLower = title.toLowerCase()
    if (titleLower.includes(brand.toLowerCase())) {
      const hasSeparator = /[|\-–—:]/.test(title)
      const brandAtEnd = titleLower.lastIndexOf(brand.toLowerCase()) > title.length / 2
      if (hasSeparator && brandAtEnd) {
        findings.push(f('title.brand', 'good', `Brand "${brand}" appears at end of title with proper separator.`))
      } else {
        findings.push(f('title.brand', 'ok', `Brand found in title but may be poorly positioned — ideal is "Page Topic | Brand" format.`,
          'Move brand to end of title with a separator: "Your Page Title | Brand Name".'))
      }
    } else {
      findings.push(f('title.brand', 'ok', `Brand name ("${brand}") not found in title — homepage and key pages should include it.`,
        'Append your brand name at the end: "Your Page Title | Brand Name".'))
    }
  } else {
    // No title — mark dependent checks as info
    findings.push(f('title.length', 'info', 'Cannot check title length — no title found.'))
    findings.push(f('title.keyword', 'info', 'Cannot check title keyword — no title found.'))
    findings.push(f('title.unique', 'info', 'Cannot check title uniqueness — no title found.'))
    findings.push(f('title.brand', 'info', 'Cannot check title brand — no title found.'))
  }

  // ── Meta Description ──
  const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? ''

  findings.push(metaDesc
    ? f('description.present', 'good', `Meta description found (${metaDesc.length} chars).`)
    : f('description.present', 'bad', 'No meta description — search engines auto-generate unhelpful snippets.',
        'Add a meta description of 140–155 characters.\n<meta name="description" content="Your description here.">'))

  if (metaDesc) {
    const len = metaDesc.length
    if (len >= 140 && len <= 155) {
      findings.push(f('description.length', 'good', `Meta description is ${len} chars — within ideal 140–155 range.`))
    } else if (len >= 120 && len < 140) {
      findings.push(f('description.length', 'ok', `Meta description is ${len} chars — slightly short; ideal is 140–155.`,
        'Expand the meta description to 140–155 characters.'))
    } else if (len > 155 && len <= 170) {
      findings.push(f('description.length', 'ok', `Meta description is ${len} chars — slightly over ideal; may be truncated.`,
        'Trim to 140–155 characters.'))
    } else {
      findings.push(f('description.length', 'bad', `Meta description is ${len} chars — ${len < 120 ? 'too short to be effective' : 'too long and will be truncated'}.`,
        'Rewrite to 140–155 characters.'))
    }

    // description.keyword
    if (primaryKeyword && metaDesc.toLowerCase().includes(primaryKeyword.split(' ')[0])) {
      findings.push(f('description.keyword', 'good', `Primary keyword found in meta description.`))
    } else {
      findings.push(f('description.keyword', 'ok', 'Primary keyword not detected in meta description — include it naturally.',
        'Rewrite the meta description to naturally include your primary keyword.'))
    }

    // description.cta
    const ctaWords = /\b(learn|discover|get|start|try|sign up|join|download|see|find|explore|book|shop)\b/i
    findings.push(ctaWords.test(metaDesc)
      ? f('description.cta', 'good', 'Meta description contains action-oriented language.')
      : f('description.cta', 'ok', 'Meta description lacks a call to action — action language improves click-through rate.',
          'End the description with an action phrase like "Learn more", "Get started free", or "See how it works".'))

    findings.push(f('description.unique', 'info', 'Duplicate description check requires full site crawl.'))
  } else {
    findings.push(f('description.length', 'info', 'Cannot check description length — none found.'))
    findings.push(f('description.keyword', 'info', 'Cannot check description keyword — none found.'))
    findings.push(f('description.cta', 'info', 'Cannot check description CTA — none found.'))
    findings.push(f('description.unique', 'info', 'Cannot check description uniqueness — none found.'))
  }

  // ── Canonical ──
  const canonical = $('link[rel="canonical"]').attr('href')?.trim() ?? null

  findings.push(canonical
    ? f('canonical.present', 'good', `Canonical tag set: ${canonical}`)
    : f('canonical.present', 'bad', 'No canonical tag — search engines may index duplicate versions of this URL.',
        'Add <link rel="canonical" href="https://yourdomain.com/page"> inside <head>.'))

  if (canonical) {
    // canonical.same_domain
    try {
      const canonDomain = new URL(canonical).hostname
      if (canonDomain === hostname || canonDomain === `www.${hostname}` || `www.${canonDomain}` === hostname) {
        findings.push(f('canonical.same_domain', 'good', `Canonical is same domain (${canonDomain}).`))
      } else {
        findings.push(f('canonical.same_domain', 'bad', `Canonical points to different domain (${canonDomain}) — can leak authority.`,
          `Update canonical to point to your own domain: https://${hostname}/...`))
      }
    } catch {
      findings.push(f('canonical.same_domain', 'bad', `Canonical URL appears malformed: "${canonical}".`,
        'Fix the canonical href to be a valid absolute URL.'))
    }

    // canonical.self — compare canonical to page URL
    try {
      const canonPath = new URL(canonical).pathname.replace(/\/$/, '')
      const pagePath = new URL(pageUrl).pathname.replace(/\/$/, '')
      if (canonPath === pagePath) {
        findings.push(f('canonical.self', 'good', 'Canonical is self-referencing (points to current page).'))
      } else {
        findings.push(f('canonical.self', 'ok', `Canonical (${canonPath}) differs from page URL (${pagePath}) — ensure this is intentional.`,
          'If consolidating duplicate pages, this is correct. Otherwise update canonical to match page URL.'))
      }
    } catch {
      findings.push(f('canonical.self', 'info', 'Could not compare canonical to page URL.'))
    }

    // canonical.resolves — HEAD request to check it returns 200
    const canonCheck = await headRequest(canonical)
    if (!canonCheck) {
      findings.push(f('canonical.resolves', 'ok', `Could not verify canonical URL is accessible (timeout or network error).`,
        'Manually confirm the canonical URL returns HTTP 200.'))
    } else if (canonCheck.status === 200) {
      findings.push(f('canonical.resolves', 'good', `Canonical URL resolves correctly (HTTP ${canonCheck.status}).`))
    } else {
      findings.push(f('canonical.resolves', 'bad', `Canonical URL returns HTTP ${canonCheck.status} — search engines will not use it.`,
        `Fix the canonical URL to point to a page that returns 200 OK.`))
    }
  } else {
    findings.push(f('canonical.same_domain', 'info', 'No canonical to check domain for.'))
    findings.push(f('canonical.self', 'info', 'No canonical to check self-reference for.'))
    findings.push(f('canonical.resolves', 'info', 'No canonical URL to resolve.'))
  }

  // robots.noindex
  const robotsMeta = $('meta[name="robots"]').attr('content')?.toLowerCase() ?? ''
  const xRobotsNoindex = false // Would need response headers — checked in technical section
  if (robotsMeta.includes('noindex')) {
    findings.push(f('robots.noindex', 'bad', `Page has <meta name="robots" content="${$('meta[name="robots"]').attr('content')}"> — this page will not be indexed.`,
      'Remove the noindex directive unless this page is intentionally excluded from search.'))
  } else {
    findings.push(f('robots.noindex', 'good', 'No noindex meta tag — page is indexable.'))
  }

  // ── Open Graph ──
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim()
  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim()
  const ogImage = $('meta[property="og:image"]').attr('content')?.trim()
  const ogUrl = $('meta[property="og:url"]').attr('content')?.trim()
  const ogType = $('meta[property="og:type"]').attr('content')?.trim()

  findings.push(ogTitle
    ? f('og.title', 'good', `og:title present: "${ogTitle.slice(0, 60)}${ogTitle.length > 60 ? '…' : ''}"`)
    : f('og.title', 'ok', 'og:title missing — social shares will fall back to page title.',
        '<meta property="og:title" content="Your Page Title">'))

  findings.push(ogDesc
    ? f('og.description', 'good', 'og:description present.')
    : f('og.description', 'ok', 'og:description missing — social shares will show no description.',
        '<meta property="og:description" content="Your page description.">'))

  if (ogImage) {
    const imgCheck = await headRequest(ogImage)
    if (imgCheck && imgCheck.status === 200 && imgCheck.contentType.startsWith('image/')) {
      findings.push(f('og.image', 'good', `og:image present and loads correctly (${imgCheck.contentType}).`))
    } else if (imgCheck && imgCheck.status !== 200) {
      findings.push(f('og.image', 'bad', `og:image URL returns HTTP ${imgCheck.status} — social shares will have no image.`,
        'Fix or replace the og:image URL.'))
    } else {
      findings.push(f('og.image', 'ok', 'og:image present but could not be verified (may be inaccessible).'))
    }
  } else {
    findings.push(f('og.image', 'ok', 'og:image missing — social shares will show no preview image.',
      '<meta property="og:image" content="https://yourdomain.com/og-image.jpg">'))
  }

  if (ogUrl) {
    const canonOrPage = canonicalHref ?? pageUrl
    try {
      const ogUrlPath = new URL(ogUrl).pathname
      const canonPath = new URL(canonOrPage).pathname
      findings.push(ogUrlPath === canonPath
        ? f('og.url', 'good', 'og:url matches canonical URL.')
        : f('og.url', 'ok', `og:url (${ogUrlPath}) differs from canonical (${canonPath}).`,
            'Set og:url to match your canonical URL.'))
    } catch {
      findings.push(f('og.url', 'ok', 'og:url present but could not be verified against canonical.'))
    }
  } else {
    findings.push(f('og.url', 'bad', 'og:url missing — social shares may use incorrect URL.',
      '<meta property="og:url" content="https://yourdomain.com/current-page">'))
  }

  findings.push(ogType
    ? f('og.type', 'good', `og:type set to "${ogType}".`)
    : f('og.type', 'ok', 'og:type missing — defaults to "website" which may not be optimal.',
        '<meta property="og:type" content="website">'))

  return findings
}

// ── 2. Headings ───────────────────────────────────────────────────────────────

function checkHeadings($: cheerio.CheerioAPI, title: string): SeoFinding[] {
  const findings: SeoFinding[] = []

  const h1s = $('h1').toArray().map((el) => $(el).text().trim())
  const allHeadings = $('h1, h2, h3, h4, h5, h6').toArray().map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: $(el).text().trim(),
  }))

  // Primary keyword from H1
  const primaryKeyword = h1s[0]?.split(/\s+/).slice(0, 3).join(' ').toLowerCase() ?? ''

  // h1.exists
  findings.push(h1s.length > 0
    ? f('h1.exists', 'good', `H1 found: "${h1s[0].slice(0, 70)}${h1s[0].length > 70 ? '…' : ''}"`)
    : f('h1.exists', 'bad', 'No H1 tag found — every page needs exactly one H1 as the primary heading.',
        'Add a single <h1> tag that clearly describes this page\'s main topic.'))

  // h1.single
  if (h1s.length === 0) {
    findings.push(f('h1.single', 'info', 'Cannot check H1 count — none found.'))
  } else if (h1s.length === 1) {
    findings.push(f('h1.single', 'good', 'Exactly one H1 tag on the page.'))
  } else {
    findings.push(f('h1.single', 'bad', `${h1s.length} H1 tags found — only one should exist per page.`,
      'Remove extra H1 tags. Demote secondary headings to H2.'))
  }

  // h1.keyword — compare H1 to title
  if (h1s.length > 0 && title) {
    const h1Lower = h1s[0].toLowerCase()
    const titleWords = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    const overlapCount = titleWords.filter((w) => h1Lower.includes(w)).length
    if (overlapCount >= 2) {
      findings.push(f('h1.keyword', 'good', 'H1 shares keyword context with the title tag.'))
    } else {
      findings.push(f('h1.keyword', 'ok', 'H1 and title tag share few common keywords — ensure they cover the same topic.',
        'Rewrite the H1 to naturally include your primary keyword.'))
    }
  } else {
    findings.push(f('h1.keyword', 'info', 'Cannot check H1 keyword match — H1 or title missing.'))
  }

  // h1.length
  if (h1s.length > 0) {
    const len = h1s[0].length
    if (len >= 20 && len <= 70) {
      findings.push(f('h1.length', 'good', `H1 is ${len} chars — within ideal range (20–70).`))
    } else if (len > 0 && len < 20) {
      findings.push(f('h1.length', 'ok', `H1 is ${len} chars — too short to be descriptive.`,
        'Expand the H1 to at least 20 characters.'))
    } else if (len > 70 && len <= 100) {
      findings.push(f('h1.length', 'ok', `H1 is ${len} chars — slightly long; aim for under 70.`,
        'Shorten the H1 to 20–70 characters.'))
    } else if (len > 100) {
      findings.push(f('h1.length', 'bad', `H1 is ${len} chars — too long; reads more like a paragraph.`,
        'Shorten the H1 to 20–70 characters.'))
    } else {
      findings.push(f('h1.length', 'bad', 'H1 appears empty.', 'Add descriptive text to the H1.'))
    }
  } else {
    findings.push(f('h1.length', 'info', 'Cannot check H1 length — none found.'))
  }

  // h1.title_match
  if (h1s.length > 0 && title) {
    const h1Normalized = h1s[0].toLowerCase().trim()
    const titleNormalized = title.toLowerCase().trim()
    if (h1Normalized === titleNormalized) {
      findings.push(f('h1.title_match', 'ok', 'H1 and title tag are identical — differentiate them to cover more keyword variations.',
        'Rewrite the H1 or title to use different wording while staying on the same topic.'))
    } else {
      findings.push(f('h1.title_match', 'good', 'H1 and title are complementary (different wording, same topic) — good SEO practice.'))
    }
  } else {
    findings.push(f('h1.title_match', 'info', 'Cannot compare H1 to title — one or both are missing.'))
  }

  // hierarchy.skipped — check for level jumps
  let skipped = false
  const tagOrder = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
  let prevLevel = 0
  for (const heading of allHeadings) {
    const level = parseInt(heading.tag[1])
    if (prevLevel > 0 && level > prevLevel + 1) { skipped = true; break }
    prevLevel = level
  }
  findings.push(skipped
    ? f('hierarchy.skipped', 'bad', 'Heading levels are skipped (e.g., H1 → H3 with no H2) — breaks document outline.',
        'Ensure headings follow sequential order: H1 → H2 → H3, never skipping a level.')
    : f('hierarchy.skipped', 'good', 'Heading hierarchy has no skipped levels.'))

  // hierarchy.h2_exists
  const bodyText = $('body').text()
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length
  const h2Count = $('h2').length
  if (wordCount > 300 && h2Count === 0) {
    findings.push(f('hierarchy.h2_exists', 'bad', `Page has ~${wordCount} words but no H2 headings — long content needs H2s to structure it.`,
      'Break content into sections with H2 headings every 200–300 words.'))
  } else if (wordCount <= 300 && h2Count === 0) {
    findings.push(f('hierarchy.h2_exists', 'info', 'No H2 headings found — acceptable for short pages.'))
  } else {
    findings.push(f('hierarchy.h2_exists', 'good', `${h2Count} H2 heading(s) found to structure content.`))
  }

  // hierarchy.descriptive
  const genericHeadingTexts = new Set(['click here', 'read more', 'more', 'info', 'information', 'content', 'text', 'section', 'title', ''])
  const genericHeadings = allHeadings.filter((h) => genericHeadingTexts.has(h.text.toLowerCase()))
  findings.push(genericHeadings.length > 0
    ? f('hierarchy.descriptive', 'bad', `${genericHeadings.length} heading(s) have generic or empty text: "${genericHeadings[0].text}".`,
        'Replace generic heading text with descriptive phrases that describe the section content.')
    : f('hierarchy.descriptive', 'good', 'All headings have descriptive, specific text.'))

  // hierarchy.nesting — semantic judgment
  findings.push(f('hierarchy.nesting', 'info', 'Heading content nesting requires manual review — ensure H2 sections are followed by relevant content before the next H2.'))

  // outline.coverage — semantic
  findings.push(f('outline.coverage', 'info', 'Topic coverage check requires semantic analysis — verify headings cover main subtopics of your target keyword.'))

  // outline.questions — check for question-based headings
  const questionHeadings = allHeadings.filter((h) =>
    /^(how|what|why|when|where|who|which|can|is|does|do|should|will|are)\b/i.test(h.text))
  if (allHeadings.length >= 3) {
    const questionPct = questionHeadings.length / allHeadings.length
    findings.push(questionPct >= 0.3
      ? f('outline.questions', 'good', `${questionHeadings.length} of ${allHeadings.length} headings are question-based — good for informational content.`)
      : f('outline.questions', 'ok', `Only ${questionHeadings.length} of ${allHeadings.length} headings are question-based.`,
          'For informational content (guides, blog posts), phrase more headings as questions your audience asks.'))
  } else {
    findings.push(f('outline.questions', 'info', 'Too few headings to evaluate question coverage.'))
  }

  // outline.lsi — semantic
  findings.push(f('outline.lsi', 'info', 'LSI/semantic keyword check requires manual review — ensure headings include related terms beyond the primary keyword.'))

  // outline.length_balance
  const longHeadings = allHeadings.filter((h) => h.text.length > 120)
  findings.push(longHeadings.length > 0
    ? f('outline.length_balance', 'bad', `${longHeadings.length} heading(s) exceed 120 chars — too long for a heading, reads like body copy.`,
        'Shorten headings to under 80 characters each.')
    : f('outline.length_balance', 'good', 'All headings are within acceptable length.'))

  return findings
}

// ── 3. Image ALT ──────────────────────────────────────────────────────────────

async function checkImageAlt($: cheerio.CheerioAPI, pageUrl: string): Promise<SeoFinding[]> {
  const findings: SeoFinding[] = []
  const origin = new URL(pageUrl).origin

  interface ImgInfo {
    src: string
    alt: string | undefined
    loading: string | undefined
    width: string | undefined
    height: string | undefined
  }

  const images: ImgInfo[] = $('img').toArray().map((el) => ({
    src: $(el).attr('src') ?? '',
    alt: $(el).attr('alt'),
    loading: $(el).attr('loading'),
    width: $(el).attr('width'),
    height: $(el).attr('height'),
  }))

  if (images.length === 0) {
    const infoMsg = 'No images found on the page.'
    ;['alt.present', 'alt.not_empty', 'alt.decorative', 'alt.filename', 'alt.descriptive',
      'alt.length', 'alt.keyword_stuffing', 'alt.context', 'image.filesize',
      'image.dimensions', 'image.lazyload', 'image.format'].forEach((key) => {
      findings.push(f(key, 'info', infoMsg))
    })
    return findings
  }

  // alt.present
  const missingAlt = images.filter((img) => img.alt === undefined)
  findings.push(missingAlt.length === 0
    ? f('alt.present', 'good', `All ${images.length} images have an alt attribute.`)
    : f('alt.present', 'bad', `${missingAlt.length} of ${images.length} images are missing the alt attribute entirely.`,
        'Add alt="" to decorative images and descriptive alt text to content images.\n<img src="photo.jpg" alt="Description of image">'))

  // alt.not_empty — content images (non-tiny, non-icon) should have non-empty alt
  const likelyContent = images.filter((img) => {
    const src = img.src.toLowerCase()
    const isLikelyIcon = /icon|logo|arrow|bullet|sprite|avatar|thumb/.test(src)
    return !isLikelyIcon
  })
  const emptyAlt = likelyContent.filter((img) => img.alt !== undefined && img.alt.trim() === '')
  if (emptyAlt.length > 0 && emptyAlt.length < likelyContent.length) {
    findings.push(f('alt.not_empty', 'ok', `${emptyAlt.length} content image(s) have empty alt text — check these are truly decorative.`,
      'Add descriptive alt text to content images. Use alt="" only for truly decorative images.'))
  } else if (emptyAlt.length === 0) {
    findings.push(f('alt.not_empty', 'good', 'Content images appear to have non-empty alt text.'))
  } else {
    findings.push(f('alt.not_empty', 'bad', `${emptyAlt.length} content images have empty alt — screen readers and image search will miss them.`,
      'Add descriptive alt text to all content images.'))
  }

  // alt.decorative
  findings.push(f('alt.decorative', 'info', 'Decorative image classification requires visual review — icons and spacers should use alt="".'))

  // alt.filename — check if alt text looks like a filename
  const altsWithAlt = images.filter((img) => img.alt !== undefined && img.alt.trim() !== '')
  const filenamePattern = /^[\w\-]+$/ // looks like a slug/filename
  const filenameAlts = altsWithAlt.filter((img) => filenamePattern.test(img.alt!.trim()) && img.alt!.trim().split(' ').length === 1)
  findings.push(filenameAlts.length > 0
    ? f('alt.filename', 'bad', `${filenameAlts.length} image(s) appear to use filename-style alt text (e.g., "${filenameAlts[0].alt}").`,
        'Replace single-word filename-style alt text with descriptive phrases.')
    : f('alt.filename', 'good', 'No filename-style alt text detected.'))

  // alt.descriptive
  findings.push(f('alt.descriptive', 'info', 'ALT descriptiveness requires visual review — ensure alt text accurately describes what is shown in each image.'))

  // alt.length
  const invalidLength = altsWithAlt.filter((img) => {
    const len = img.alt!.trim().length
    return len < 5 || len > 125
  })
  findings.push(invalidLength.length > 0
    ? f('alt.length', 'ok', `${invalidLength.length} image(s) have alt text outside ideal length (5–125 chars).`,
        'Rewrite alt text to be 5–125 characters — descriptive but concise.')
    : f('alt.length', 'good', 'All alt text is within the ideal 5–125 character range.'))

  // alt.keyword_stuffing
  const stuffedAlts = altsWithAlt.filter((img) => {
    const words = img.alt!.toLowerCase().split(/\s+/)
    const freq: Record<string, number> = {}
    for (const w of words) { freq[w] = (freq[w] ?? 0) + 1 }
    return Object.values(freq).some((count) => count >= 3)
  })
  findings.push(stuffedAlts.length > 0
    ? f('alt.keyword_stuffing', 'bad', `${stuffedAlts.length} image(s) appear to have keyword-stuffed alt text.`,
        'Rewrite alt text to naturally describe the image without repeating keywords.')
    : f('alt.keyword_stuffing', 'good', 'No keyword stuffing detected in alt text.'))

  // alt.context
  findings.push(f('alt.context', 'info', 'Alt text context check requires visual review — ensure alt complements surrounding caption or paragraph text.'))

  // image.filesize — HEAD requests to first 8 images with same-origin or absolute src
  const sampled = images
    .filter((img) => img.src && (img.src.startsWith('http') || img.src.startsWith('/')))
    .slice(0, 8)
  const sizeChecks = await Promise.all(
    sampled.map(async (img) => {
      const url = img.src.startsWith('/') ? `${origin}${img.src}` : img.src
      return headRequest(url)
    }),
  )
  const largImages = sizeChecks.filter((r) => r && r.contentLength > 1_000_000)
  const warnImages = sizeChecks.filter((r) => r && r.contentLength > 500_000 && r.contentLength <= 1_000_000)
  const checkedCount = sizeChecks.filter(Boolean).length
  if (checkedCount === 0) {
    findings.push(f('image.filesize', 'info', 'Could not check image file sizes — images may use relative paths or external CDN.'))
  } else if (largImages.length > 0) {
    findings.push(f('image.filesize', 'bad', `${largImages.length} image(s) over 1MB detected — severely impacts Core Web Vitals.`,
      'Compress images to under 500KB. Use WebP format and serve responsive sizes.'))
  } else if (warnImages.length > 0) {
    findings.push(f('image.filesize', 'ok', `${warnImages.length} image(s) between 500KB–1MB — consider optimising.`,
      'Compress these images to under 200KB using WebP or modern codecs.'))
  } else {
    findings.push(f('image.filesize', 'good', `Image file sizes look reasonable (checked ${checkedCount} images).`))
  }

  // image.dimensions
  const missingDims = images.filter((img) => !img.width || !img.height)
  findings.push(missingDims.length > 0
    ? f('image.dimensions', 'ok', `${missingDims.length} of ${images.length} images missing explicit width/height — causes Cumulative Layout Shift.`,
        'Add width and height attributes to all <img> tags.\n<img src="photo.jpg" width="800" height="600" alt="...">',
    )
    : f('image.dimensions', 'good', `All ${images.length} images have explicit width and height.`))

  // image.lazyload
  const belowFoldImages = images.slice(3) // assume first 3 are above fold
  const withoutLazy = belowFoldImages.filter((img) => img.loading !== 'lazy')
  if (images.length <= 3) {
    findings.push(f('image.lazyload', 'info', 'Too few images to evaluate lazy loading (fewer than 4 images).'))
  } else if (withoutLazy.length > 0) {
    findings.push(f('image.lazyload', 'ok', `${withoutLazy.length} image(s) below the fold lack loading="lazy" — may slow initial page load.`,
      'Add loading="lazy" to images below the fold.\n<img src="..." loading="lazy" alt="...">'))
  } else {
    findings.push(f('image.lazyload', 'good', 'Below-fold images use lazy loading.'))
  }

  // image.format
  const gifPhotos = images.filter((img) => img.src.toLowerCase().endsWith('.gif') && !img.src.toLowerCase().includes('icon'))
  const oldFormat = images.filter((img) => /\.(jpg|jpeg|png)$/i.test(img.src))
  const modernFormat = images.filter((img) => /\.(webp|avif)$/i.test(img.src))
  if (gifPhotos.length > 0) {
    findings.push(f('image.format', 'bad', `${gifPhotos.length} photo(s) use GIF format — highly inefficient; use WebP or video instead.`,
      'Convert animated GIFs to WebP animations or <video> elements.'))
  } else if (modernFormat.length === 0 && oldFormat.length > 0) {
    findings.push(f('image.format', 'ok', `All ${oldFormat.length} images use JPG/PNG — consider converting to WebP for better compression.`,
      'Convert images to WebP format to reduce file size by 25–35%.'))
  } else if (modernFormat.length > 0) {
    findings.push(f('image.format', 'good', `${modernFormat.length} images use modern WebP/AVIF format.`))
  } else {
    findings.push(f('image.format', 'info', 'Could not determine image formats from paths.'))
  }

  return findings
}

// ── 4. Internal Links ─────────────────────────────────────────────────────────

function checkInternalLinks($: cheerio.CheerioAPI, pageUrl: string, discoveredUrls?: UrlDiscoveryResult): SeoFinding[] {
  const findings: SeoFinding[] = []
  const hostname = new URL(pageUrl).hostname
  const brand = hostname.replace('www.', '').split('.')[0] ?? ''

  const allLinks = $('a[href]').toArray()
  const internalLinks = allLinks.filter((el) => {
    const href = $(el).attr('href') ?? ''
    return href.startsWith('/') || href.includes(hostname)
  })
  const externalLinks = allLinks.filter((el) => {
    const href = $(el).attr('href') ?? ''
    return href.startsWith('http') && !href.includes(hostname)
  })

  // links.orphan
  if (discoveredUrls && discoveredUrls.totalDiscovered > 0) {
    const source = discoveredUrls.crawlUsed ? 'crawl' : 'sitemap'
    findings.push(f(
      'links.orphan', 'info',
      `${discoveredUrls.totalDiscovered} pages discovered via ${source}. True orphan detection (pages with zero inbound links) requires a full crawl with link graph analysis — use Screaming Frog or Ahrefs for definitive results.`,
    ))
  } else {
    findings.push(f('links.orphan', 'info', 'Orphan page check requires a full site crawl — cannot determine inbound links from a single page.'))
  }

  // links.depth
  if (discoveredUrls && discoveredUrls.crawlUsed && discoveredUrls.totalDiscovered > 0) {
    const depthCounts: Record<number, number> = {}
    for (const { depth = 1 } of discoveredUrls.urls) {
      depthCounts[depth] = (depthCounts[depth] ?? 0) + 1
    }
    const maxDepth = Math.max(...Object.keys(depthCounts).map(Number), 1)
    const deepPages = Object.entries(depthCounts)
      .filter(([d]) => Number(d) > 3)
      .reduce((sum, [, c]) => sum + c, 0)
    findings.push(deepPages > 0
      ? f('links.depth', 'ok',
          `${deepPages} page${deepPages > 1 ? 's' : ''} only reachable at click depth >3 — deeply buried pages receive less link equity.`,
          'Add these pages to your navigation or link to them from higher-authority pages to reduce click depth.')
      : f('links.depth', 'good',
          `All ${discoveredUrls.totalDiscovered} discovered pages are within ${maxDepth} click${maxDepth !== 1 ? 's' : ''} of the homepage.`))
  } else if (discoveredUrls && discoveredUrls.sitemapFound && discoveredUrls.totalDiscovered > 0) {
    let deepCount = 0
    for (const { url } of discoveredUrls.urls) {
      try {
        const parts = new URL(url).pathname.split('/').filter(Boolean)
        if (parts.length > 3) deepCount++
      } catch { /* skip */ }
    }
    findings.push(deepCount > 0
      ? f('links.depth', 'ok',
          `${deepCount} URL${deepCount > 1 ? 's' : ''} in your sitemap have a path depth >3 — verify these pages are reachable via navigation.`,
          'Link to deeply nested pages from category pages or your main nav to improve crawl equity.')
      : f('links.depth', 'good',
          `Sitemap URL structure shows all ${discoveredUrls.totalDiscovered} pages within 3 path levels — good for crawl discoverability.`))
  } else {
    findings.push(f('links.depth', 'info', 'Click depth check requires a full site crawl — cannot calculate from homepage alone.'))
  }

  // links.homepage_links
  const internalCount = internalLinks.length
  if (internalCount < 5) {
    findings.push(f('links.homepage_links', 'bad', `Only ${internalCount} internal link(s) found — too few to distribute page authority.`,
      'Add links to your most important pages (product, pricing, about, blog) in navigation or body.'))
  } else if (internalCount > 100) {
    findings.push(f('links.homepage_links', 'ok', `${internalCount} internal links found — may dilute link equity if too many.`,
      'Consider reducing low-value internal links to concentrate authority on important pages.'))
  } else {
    findings.push(f('links.homepage_links', 'good', `${internalCount} internal links — good distribution.`))
  }

  // links.broken (sampling — just check up to 5 internal links is too slow; mark as info)
  findings.push(f('links.broken', 'info', 'Broken link check requires fetching each URL — run a dedicated crawler tool for full link validation.'))

  // anchor.diversity (needs multiple pages)
  findings.push(f('anchor.diversity', 'info', 'Anchor text diversity per target page requires multi-page crawl analysis.'))

  // anchor.descriptive
  const genericTexts = new Set(['click here', 'read more', 'here', 'more', 'link', 'this', 'learn more', 'details', 'more info'])
  const genericLinks = internalLinks.filter((el) => genericTexts.has($(el).text().trim().toLowerCase()))
  findings.push(genericLinks.length === 0
    ? f('anchor.descriptive', 'good', 'All internal links use descriptive anchor text.')
    : genericLinks.length <= 2
    ? f('anchor.descriptive', 'ok', `${genericLinks.length} internal link(s) use generic anchor text ("click here", "read more").`,
        'Replace generic anchor text with descriptive phrases that explain the destination.')
    : f('anchor.descriptive', 'bad', `${genericLinks.length} internal links use generic anchor text — hurts both SEO and accessibility.`,
        'Replace all "click here", "read more", and "here" anchor text with descriptive labels.'))

  // anchor.exact_match (needs multiple pages)
  findings.push(f('anchor.exact_match', 'info', 'Exact-match keyword anchor analysis requires multi-page crawl data.'))

  // anchor.branded
  const brandedLinks = allLinks.filter((el) => $(el).text().toLowerCase().includes(brand.toLowerCase()))
  findings.push(brandedLinks.length > 0
    ? f('anchor.branded', 'good', `Brand name appears in ${brandedLinks.length} link(s).`)
    : f('anchor.branded', 'ok', `Brand name ("${brand}") not found in any link anchor text.`,
        'Include brand name in some internal link anchors, especially in the site header or footer.'))

  // pagerank.deep (needs full crawl)
  findings.push(f('pagerank.deep', 'info', 'Deep page equity check requires full crawl with link graph analysis.'))

  // pagerank.nav — check if key pages are in nav
  const navLinks = $('nav a, header a').toArray()
  const navHrefs = navLinks.map((el) => $(el).attr('href')?.toLowerCase() ?? '')
  const keyPages = ['pricing', 'price', 'product', 'feature', 'about', 'blog', 'contact']
  const missingNav = keyPages.filter((page) => !navHrefs.some((href) => href.includes(page)))
  if (missingNav.length === 0) {
    findings.push(f('pagerank.nav', 'good', 'Navigation links cover all key page types.'))
  } else if (missingNav.length <= 2) {
    findings.push(f('pagerank.nav', 'ok', `Navigation may be missing links to: ${missingNav.join(', ')}.`,
      `Add links to your ${missingNav.join(' and ')} page(s) in the main navigation.`))
  } else {
    findings.push(f('pagerank.nav', 'bad', `Navigation appears sparse — missing common key pages: ${missingNav.slice(0, 3).join(', ')}.`,
      'Ensure your main navigation includes links to Pricing, Features/Product, About, Blog, and Contact.'))
  }

  // pagerank.contextual — count links inside main content area
  const contentSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.post', '.entry']
  let contextualLinks = 0
  for (const sel of contentSelectors) {
    if ($(sel).length > 0) {
      contextualLinks = $(`${sel} a[href]`).length
      break
    }
  }
  if (contextualLinks >= 3) {
    findings.push(f('pagerank.contextual', 'good', `${contextualLinks} contextual link(s) found within main content area.`))
  } else if (contextualLinks > 0) {
    findings.push(f('pagerank.contextual', 'ok', `Only ${contextualLinks} contextual link(s) in main content — add more internal links within body copy.`,
      'Add 3+ internal links within your main content pointing to related pages.'))
  } else {
    findings.push(f('pagerank.contextual', 'info', 'Could not identify main content area to count contextual links — check manually.'))
  }

  // pagerank.injection
  findings.push(f('pagerank.injection', 'info', 'Link injection plan requires review of your existing content — see action suggestions for underlinked pages.'))

  return findings
}

// ── 5. Schema / Structured Data ───────────────────────────────────────────────

function checkSchema($: cheerio.CheerioAPI, pageUrl: string): SeoFinding[] {
  const findings: SeoFinding[] = []

  const ldJsonBlocks = $('script[type="application/ld+json"]').toArray().map((el) => $(el).html() ?? '')
  const twitterCard = $('meta[name="twitter:card"]').attr('content')

  // schema.present
  findings.push(ldJsonBlocks.length > 0
    ? f('schema.present', 'good', `${ldJsonBlocks.length} JSON-LD structured data block(s) found.`)
    : f('schema.present', 'ok', 'No JSON-LD structured data found — schema markup helps search engines understand your content.',
        'Add JSON-LD schema appropriate for this page type (Organization, WebSite, Product, Article, etc.)'))

  // schema.valid — parse each block
  let invalidCount = 0
  const parsedSchemas: { type: string; data: Record<string, unknown> }[] = []
  for (const block of ldJsonBlocks) {
    try {
      const parsed = JSON.parse(block) as Record<string, unknown>
      const type = (parsed['@type'] as string) ?? 'Unknown'
      parsedSchemas.push({ type, data: parsed })
    } catch {
      invalidCount++
    }
  }
  if (ldJsonBlocks.length === 0) {
    findings.push(f('schema.valid', 'info', 'No JSON-LD blocks to validate.'))
  } else if (invalidCount > 0) {
    findings.push(f('schema.valid', 'bad', `${invalidCount} JSON-LD block(s) contain invalid JSON — search engines will ignore them.`,
      'Fix the JSON syntax in your schema markup. Validate at https://validator.schema.org'))
  } else {
    findings.push(f('schema.valid', 'good', `All ${ldJsonBlocks.length} JSON-LD block(s) parse as valid JSON.`))
  }

  // schema.type — check if schema type is appropriate for the page
  if (parsedSchemas.length > 0) {
    const types = parsedSchemas.map((s) => s.type).join(', ')
    const path = new URL(pageUrl).pathname.toLowerCase()
    const isBlog = /blog|post|article|news/.test(path)
    const isProduct = /product|shop|item|buy/.test(path)
    const isHomepage = path === '/' || path === ''

    if (isHomepage && parsedSchemas.some((s) => ['Organization', 'WebSite'].includes(s.type))) {
      findings.push(f('schema.type', 'good', `Homepage uses appropriate schema type(s): ${types}.`))
    } else if (isBlog && parsedSchemas.some((s) => s.type === 'Article')) {
      findings.push(f('schema.type', 'good', `Blog page uses Article schema.`))
    } else if (isProduct && parsedSchemas.some((s) => s.type === 'Product')) {
      findings.push(f('schema.type', 'good', `Product page uses Product schema.`))
    } else {
      findings.push(f('schema.type', 'ok', `Schema type(s) found: ${types}. Verify this is the most appropriate type for this page.`,
        'Check schema.org for the correct @type for your page content.'))
    }
  } else {
    findings.push(f('schema.type', 'info', 'No schema types to evaluate — add schema markup first.'))
  }

  // schema.required-fields — check for critical fields
  let missingFields: string[] = []
  for (const schema of parsedSchemas) {
    if (schema.type === 'Organization') {
      if (!schema.data['name']) missingFields.push('Organization.name')
      if (!schema.data['url']) missingFields.push('Organization.url')
    } else if (schema.type === 'WebSite') {
      if (!schema.data['url']) missingFields.push('WebSite.url')
    } else if (schema.type === 'Article') {
      if (!schema.data['headline']) missingFields.push('Article.headline')
      if (!schema.data['author']) missingFields.push('Article.author')
      if (!schema.data['datePublished']) missingFields.push('Article.datePublished')
    } else if (schema.type === 'Product') {
      if (!schema.data['name']) missingFields.push('Product.name')
      if (!schema.data['offers']) missingFields.push('Product.offers')
    }
  }
  if (parsedSchemas.length === 0) {
    findings.push(f('schema.required-fields', 'info', 'No schema to validate fields for.'))
  } else if (missingFields.length > 0) {
    findings.push(f('schema.required-fields', 'bad', `Required schema fields missing: ${missingFields.join(', ')}.`,
      `Add the missing fields to your JSON-LD. Required: ${missingFields.join(', ')}.`))
  } else {
    findings.push(f('schema.required-fields', 'good', 'All detected schema types include their required fields.'))
  }

  // schema.twitter-card
  findings.push(twitterCard
    ? f('schema.twitter-card', 'good', `Twitter Card set to "${twitterCard}".`)
    : f('schema.twitter-card', 'ok', 'Twitter Card meta tags missing — tweets sharing this page will have no card preview.',
        '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="Your Title">\n<meta name="twitter:description" content="Your description">'))

  return findings
}

// ── 6. Technical SEO ──────────────────────────────────────────────────────────

async function checkTechnical(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  headers: Record<string, string>,
  ttfb: number,
  robotsTxt: string | null,
  sitemapStatus: number,
  htmlSize: number,
  lighthouseData: Record<string, number> | null,
  discoveredUrls?: UrlDiscoveryResult,
): Promise<SeoFinding[]> {
  const findings: SeoFinding[] = []
  const isHttps = pageUrl.startsWith('https://')
  const hostname = new URL(pageUrl).hostname

  // ── Core Web Vitals (Lighthouse) ──
  if (lighthouseData) {
    const { lcp, cls, fid, performance } = lighthouseData
    const lcpSec = lcp / 1000
    findings.push(lcpSec <= 2.5
      ? f('cwv.lcp', 'good', `LCP is ${lcpSec.toFixed(1)}s — good (≤2.5s).`)
      : lcpSec <= 4
      ? f('cwv.lcp', 'ok', `LCP is ${lcpSec.toFixed(1)}s — needs improvement (2.5–4s threshold).`,
          'Optimise the largest element (usually hero image): compress it, preload it, and serve from CDN.')
      : f('cwv.lcp', 'bad', `LCP is ${lcpSec.toFixed(1)}s — poor (>4s); Google rates this as failing Core Web Vitals.`,
          'Identify the LCP element (usually hero image or H1), compress it, add preload hints, and minimise server response time.'))

    findings.push(cls <= 0.1
      ? f('cwv.cls', 'good', `CLS is ${cls.toFixed(3)} — good (≤0.1).`)
      : cls <= 0.25
      ? f('cwv.cls', 'ok', `CLS is ${cls.toFixed(3)} — needs improvement.`,
          'Add explicit width/height to images and avoid inserting content above existing content.')
      : f('cwv.cls', 'bad', `CLS is ${cls.toFixed(3)} — poor layout stability; fails Core Web Vitals.`,
          'Identify elements causing layout shift: images without dimensions, ads, injected banners.'))

    findings.push(fid <= 100
      ? f('cwv.fid', 'good', `TBT (proxy for FID) is ${fid}ms — good.`)
      : fid <= 300
      ? f('cwv.fid', 'ok', `TBT is ${fid}ms — reduce JavaScript execution time for better interactivity.`,
          'Split large JS bundles, defer non-critical scripts, and remove unused third-party scripts.')
      : f('cwv.fid', 'bad', `TBT is ${fid}ms — poor; long JavaScript tasks block user interaction.`,
          'Profile and reduce main-thread JavaScript. Use code splitting and defer non-essential scripts.'))

    findings.push(performance >= 80
      ? f('lighthouse.score', 'good', `Lighthouse performance score: ${performance}/100.`)
      : performance >= 50
      ? f('lighthouse.score', 'ok', `Lighthouse performance score: ${performance}/100 — room for improvement.`,
          'Focus on the top Lighthouse opportunities: image optimisation, render-blocking resources, server response time.')
      : f('lighthouse.score', 'bad', `Lighthouse performance score: ${performance}/100 — poor; site is significantly under-optimised.`,
          'Prioritise Lighthouse suggestions: compress images, eliminate render-blocking CSS/JS, enable caching.'))
  } else {
    ;['cwv.lcp', 'cwv.cls', 'cwv.fid', 'lighthouse.score'].forEach((key) =>
      findings.push(f(key, 'info', 'Core Web Vitals require Lighthouse CLI — install it to enable this check (npm i -g lighthouse).')))
  }

  // ── Security & Accessibility ──

  // https.enforced
  if (!isHttps) {
    findings.push(f('https.enforced', 'bad', 'Site is not served over HTTPS — browsers mark it as "Not Secure".',
      'Install an SSL certificate and set up HTTP→HTTPS redirect (301).'))
  } else {
    // Check if http:// redirects to https://
    try {
      const httpUrl = pageUrl.replace('https://', 'http://')
      const httpRes = await fetch(httpUrl, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
      const redirectsToHttps = (httpRes.status === 301 || httpRes.status === 302) &&
        (httpRes.headers.get('location') ?? '').startsWith('https://')
      findings.push(redirectsToHttps
        ? f('https.enforced', 'good', 'HTTPS enforced — HTTP requests redirect to HTTPS.')
        : f('https.enforced', 'ok', 'Site uses HTTPS but HTTP version did not redirect — some users may access insecure version.',
            'Configure a 301 redirect from http:// to https:// on your server or CDN.'))
    } catch {
      findings.push(f('https.enforced', 'good', 'Site is served over HTTPS.'))
    }
  }

  // https.ssl_valid
  if (isHttps) {
    const ssl = await checkSSL(hostname)
    findings.push(!ssl.valid
      ? f('https.ssl_valid', 'bad', 'SSL certificate is invalid or expired — browsers will block access.',
          'Renew your SSL certificate immediately.')
      : ssl.daysRemaining < 30
      ? f('https.ssl_valid', 'ok', `SSL certificate expires in ${ssl.daysRemaining} days — renew soon.`,
          'Renew your SSL certificate before expiry.')
      : f('https.ssl_valid', 'good', `SSL certificate valid — expires in ${ssl.daysRemaining} days.`))
  } else {
    findings.push(f('https.ssl_valid', 'bad', 'Site not using HTTPS — no SSL certificate.'))
  }

  // https.hsts
  const hsts = headers['strict-transport-security']
  if (!isHttps) {
    findings.push(f('https.hsts', 'info', 'HSTS not applicable — site is not on HTTPS.'))
  } else if (!hsts) {
    findings.push(f('https.hsts', 'ok', 'HSTS header (Strict-Transport-Security) not set.',
      'Add Strict-Transport-Security header: max-age=31536000; includeSubDomains'))
  } else {
    const maxAgeMatch = hsts.match(/max-age=(\d+)/i)
    const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 0
    findings.push(maxAge >= 31536000
      ? f('https.hsts', 'good', `HSTS enabled with max-age=${maxAge}s.`)
      : f('https.hsts', 'ok', `HSTS set but max-age=${maxAge}s is less than recommended 31536000s (1 year).`,
          'Update HSTS max-age to at least 31536000.'))
  }

  // mobile.viewport
  const viewport = $('meta[name="viewport"]').attr('content') ?? ''
  findings.push(!viewport
    ? f('mobile.viewport', 'bad', 'No viewport meta tag — page will not render correctly on mobile devices.',
        '<meta name="viewport" content="width=device-width, initial-scale=1">')
    : !viewport.includes('width=device-width')
    ? f('mobile.viewport', 'ok', `Viewport tag present but not mobile-optimised: "${viewport}".`,
        'Update to: <meta name="viewport" content="width=device-width, initial-scale=1">')
    : f('mobile.viewport', 'good', 'Mobile viewport correctly configured.'))

  // ── Crawlability & Indexing ──

  // robots.exists + robots.no_block
  if (!robotsTxt) {
    findings.push(f('robots.exists', 'ok', 'robots.txt not found — search engines crawl without rules.',
      'Create a robots.txt file at your domain root:\nUser-agent: *\nAllow: /\nSitemap: https://yourdomain.com/sitemap.xml'))
    findings.push(f('robots.no_block', 'info', 'No robots.txt to check for blocking rules.'))
  } else {
    findings.push(f('robots.exists', 'good', 'robots.txt is accessible.'))
    const hasCSS = /disallow:\s*\/css/i.test(robotsTxt)
    const hasJS = /disallow:\s*\/js/i.test(robotsTxt)
    const hasImages = /disallow:\s*\/images/i.test(robotsTxt)
    if (hasCSS || hasJS || hasImages) {
      const blocked = [hasCSS && '/css/', hasJS && '/js/', hasImages && '/images/'].filter(Boolean).join(', ')
      findings.push(f('robots.no_block', 'bad', `robots.txt blocks critical directories: ${blocked} — prevents Google from rendering the page.`,
        `Remove Disallow rules for CSS and JS directories from robots.txt.`))
    } else {
      findings.push(f('robots.no_block', 'good', 'robots.txt does not block critical CSS, JS, or image directories.'))
    }
  }

  // sitemap.exists + sitemap.valid
  findings.push(sitemapStatus === 200
    ? f('sitemap.exists', 'good', 'sitemap.xml found and accessible.')
    : f('sitemap.exists', 'ok', 'sitemap.xml not found at /sitemap.xml.',
        'Generate and submit a sitemap.xml to Google Search Console.'))

  // sitemap.valid — real URL count when discovery succeeded
  if (discoveredUrls && discoveredUrls.sitemapFound && discoveredUrls.totalDiscovered > 0) {
    const prefixes = Object.entries(discoveredUrls.urlsByPrefix)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([p, n]) => `${p} (${n})`)
      .join(', ')
    const sitemapLabel = discoveredUrls.sitemapCount > 1
      ? `${discoveredUrls.sitemapCount} child sitemaps`
      : 'sitemap.xml'
    findings.push(f('sitemap.valid', 'good',
      `Sitemap contains ${discoveredUrls.totalDiscovered} URL${discoveredUrls.totalDiscovered !== 1 ? 's' : ''} across ${sitemapLabel}.${prefixes ? ` Top sections: ${prefixes}.` : ''}`))
  } else if (discoveredUrls && discoveredUrls.sitemapFound && discoveredUrls.totalDiscovered === 0) {
    findings.push(f('sitemap.valid', 'ok', 'Sitemap found but contains no valid same-origin URLs.',
      'Ensure your sitemap.xml lists absolute URLs matching your domain (e.g. https://yourdomain.com/page).'))
  } else {
    findings.push(f('sitemap.valid', 'info', 'Sitemap URL validation requires fetching each URL — run a crawler for full sitemap audit.'))
  }

  // http.4xx + http.5xx — HEAD-check a sample of discovered pages
  if (discoveredUrls && discoveredUrls.totalDiscovered > 0) {
    const sampleUrls = discoveredUrls.urls.slice(0, 20).map(u => u.url)
    const headResults = await Promise.all(
      sampleUrls.map(async (u) => {
        try {
          const r = await fetch(u, {
            method: 'HEAD',
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(4000),
            redirect: 'follow',
          })
          return { url: u, status: r.status }
        } catch {
          return { url: u, status: 0 }
        }
      }),
    )
    const checked = headResults.filter(r => r.status > 0)
    const notFound = checked.filter(r => r.status === 404)
    const serverErrors = checked.filter(r => r.status >= 500)

    findings.push(notFound.length > 0
      ? f('http.4xx', 'bad',
          `${notFound.length} of ${checked.length} sampled pages returned 404 — broken URLs hurt both users and rankings.`,
          `Set up 301 redirects or fix these URLs: ${notFound.slice(0, 3).map(r => new URL(r.url).pathname).join(', ')}`)
      : f('http.4xx', 'good', `All ${checked.length} sampled pages returned valid status codes — no 404 errors detected.`))

    findings.push(serverErrors.length > 0
      ? f('http.5xx', 'bad',
          `${serverErrors.length} of ${checked.length} sampled pages returned 5xx server errors — search engines stop indexing pages that return errors.`,
          'Check server logs immediately and resolve the underlying errors.')
      : f('http.5xx', 'good', `No 5xx server errors detected across ${checked.length} sampled pages.`))
  } else {
    findings.push(f('http.4xx', 'info', '4xx error detection requires crawling all internal URLs — use a crawler tool for full analysis.'))
    findings.push(f('http.5xx', 'info', '5xx error detection requires crawling all internal URLs — monitor via server logs or uptime tools.'))
  }

  // ── Performance Analysis ──

  // perf.render_blocking
  const headScripts = $('head script:not([async]):not([defer]):not([type="application/ld+json"])').length
  const headStyles = $('head link[rel="stylesheet"]').length
  const renderBlocking = headScripts + headStyles
  findings.push(renderBlocking <= 3
    ? f('perf.render_blocking', 'good', `${renderBlocking} potentially render-blocking resource(s) in <head>.`)
    : renderBlocking <= 6
    ? f('perf.render_blocking', 'ok', `${renderBlocking} render-blocking resource(s) in <head> — may delay first paint.`,
        'Add async or defer to non-critical scripts. Inline critical CSS and defer stylesheet loads.')
    : f('perf.render_blocking', 'bad', `${renderBlocking} render-blocking resource(s) in <head> — significantly delays page render.`,
        'Audit scripts in <head>: add defer to all non-critical JS and use async for analytics/tracking scripts.'))

  // perf.images
  const hasSrcset = $('img[srcset]').length > 0 || $('picture source').length > 0
  const hasWebP = $('img').toArray().some((el) => /\.webp/i.test($(el).attr('src') ?? ''))
  findings.push(hasSrcset || hasWebP
    ? f('perf.images', 'good', 'Responsive images (srcset) or WebP format detected.')
    : f('perf.images', 'ok', 'No responsive images (srcset) or WebP format detected.',
        'Implement srcset for responsive images and serve WebP format to modern browsers.'))

  // perf.js_size
  findings.push(f('perf.js_size', 'info', 'JavaScript bundle size check requires fetching all JS files — use Lighthouse or WebPageTest for accurate measurement.'))

  // perf.ttfb
  findings.push(ttfb < 200
    ? f('perf.ttfb', 'good', `Server responds in ${ttfb}ms (TTFB) — excellent.`)
    : ttfb < 600
    ? f('perf.ttfb', 'ok', `Server responds in ${ttfb}ms (TTFB) — acceptable, aim for <200ms.`,
        'Enable server-side caching and consider a CDN to reduce Time to First Byte.')
    : f('perf.ttfb', 'bad', `Server responds in ${ttfb}ms (TTFB) — too slow; >600ms significantly impacts rankings.`,
        'Investigate server bottlenecks: enable caching, reduce database queries, or upgrade hosting.'))

  // perf.root_cause
  const issues: string[] = []
  if (ttfb >= 600) issues.push('slow server response')
  if (renderBlocking > 6) issues.push(`${renderBlocking} render-blocking resources`)
  if (lighthouseData && lighthouseData.lcp > 4000) issues.push('slow LCP element')
  findings.push(issues.length > 0
    ? f('perf.root_cause', 'ok', `Performance issues identified: ${issues.join(', ')}.`,
        `Address in priority order: ${issues.join(' → ')}.`)
    : f('perf.root_cause', 'good', 'No obvious performance bottlenecks detected from available data.'))

  return findings
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runSeoAudit(url: string): Promise<SeoAuditResult | SeoAuditError> {
  const normalizedUrl = url.startsWith('http') ? url : `https://${url}`

  let res: Response
  let html: string
  let finalUrl: string
  let ttfb: number

  try {
    const start = Date.now()
    res = await fetch(normalizedUrl, {
      headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate, br' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    ttfb = Date.now() - start
    finalUrl = res.url
    html = await res.text()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to fetch the page' }
  }

  const headers = Object.fromEntries(res.headers.entries())
  const $ = cheerio.load(html)
  const canonicalHref = $('link[rel="canonical"]').attr('href') ?? null

  // Fetch robots.txt, sitemap status, and run URL discovery in parallel
  const origin = new URL(finalUrl).origin
  const [robotsRes, sitemapRes, discoveryResult] = await Promise.allSettled([
    fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(5_000) }),
    fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(5_000) }),
    discoverAllUrls(finalUrl, html, { maxUrls: 300, maxCrawlDepth: 2 }),
  ])
  const robotsTxt = robotsRes.status === 'fulfilled' && robotsRes.value.ok
    ? await robotsRes.value.text()
    : null
  const sitemapStatus = sitemapRes.status === 'fulfilled' ? sitemapRes.value.status : 0
  const discoveredUrls = discoveryResult.status === 'fulfilled' ? discoveryResult.value : undefined

  // Optional Lighthouse
  const hasLighthouse = await lighthouseAvailable()
  const lighthouseData = hasLighthouse ? await runLighthouse(finalUrl) : null

  // Run all sections in parallel where possible
  const [metaFindings, imageFindings, technicalFindings] = await Promise.all([
    checkMetaTags($, finalUrl, canonicalHref),
    checkImageAlt($, finalUrl),
    checkTechnical($, finalUrl, headers, ttfb, robotsTxt, sitemapStatus, Buffer.byteLength(html, 'utf8'), lighthouseData, discoveredUrls),
  ])

  const title = $('title').first().text().trim()
  const headingFindings = checkHeadings($, title)
  const linkFindings = checkInternalLinks($, finalUrl, discoveredUrls)
  const schemaFindings = checkSchema($, finalUrl)

  return {
    url: normalizedUrl,
    finalUrl,
    findings: [
      ...metaFindings,
      ...headingFindings,
      ...imageFindings,
      ...linkFindings,
      ...schemaFindings,
      ...technicalFindings,
    ],
    discoveredUrls,
  }
}
