/**
 * SEO Audit Rule Engine
 *
 * Runs deterministic SEO checks across 6 categories.
 * Requires cheerio (already installed). No extra API keys.
 * Lighthouse checks are optional — used only if CLI is available.
 */

import * as cheerio from 'cheerio'
import { readPagePreview, type PagePreviewData } from '@/lib/audit/page-preview'
import { isJsShell, JS_SHELL_SKIP } from '@/lib/audit/js-shell'
import { fetchPsiAccessibility, type PsiFieldData } from '@/lib/psi'
import { extractElements, extractScreenshot, type AuditElement, type PageScreenshot } from '@/lib/audit/elements'
import { connect as tlsConnect } from 'tls'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { discoverAllUrls, type UrlDiscoveryResult } from './url-discovery'
import { detectBlock, blockedSkipText, isFirewallRefusal, type BlockInfo } from '@/lib/audit/blocked'

const execFileAsync = promisify(execFile)

// ── Types ─────────────────────────────────────────────────────────────────────

// skip = couldn't check this time (text starts "Couldn't check"): neither passed nor failed
export type SeoFindingLevel = 'good' | 'ok' | 'bad' | 'info' | 'skip'

export interface SeoFinding {
  key: string
  level: SeoFindingLevel
  text: string
  fix?: string
  elements?: { total: number; elements: AuditElement[] } // failing page elements from Google's scan
}

export interface SeoAuditResult {
  url: string
  finalUrl: string
  findings: SeoFinding[]
  discoveredUrls?: UrlDiscoveryResult
  preview?: PagePreviewData // title, description and share tags, for the Google / share previews
  // Lighthouse's full-page phone screenshot; replaced by its saved size once stored (lib/audit/screenshot.ts)
  screenshot?: PageScreenshot | { w: number; h: number; at: string; name?: string } | null
  blocked?: BlockInfo       // a firewall answered instead of the site; page checks are Not checked
}

export interface SeoAuditError {
  error: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export interface SeoAuditOptions {
  brandName?: string     // the brand as saved in GrowJin (better than guessing from the domain)
  brandKeywords?: string // comma-separated main keywords (Settings → Brand)
}

/** The brand to look for in titles / links: the saved name, else the domain's main word. */
function brandOf(pageUrl: string, opts: SeoAuditOptions): { brand: string; hasBrand: (text: string) => boolean } {
  const labels = new URL(pageUrl).hostname.replace(/^www\./, '').split('.')
  const generic = new Set(['app', 'my', 'get', 'try', 'use', 'go', 'join', 'hello'])
  const domainWord = (labels.length > 2 && generic.has(labels[0]) ? labels[1] : labels[0]) ?? ''
  const brand = opts.brandName?.trim() || domainWord
  const terms = [brand, brand.replace(/\s+/g, ''), domainWord].map((t) => t.toLowerCase()).filter((t) => t.length > 1)
  return { brand, hasBrand: (text: string) => { const t = text.toLowerCase(); return terms.some((x) => t.includes(x)) } }
}

function f(key: string, level: SeoFindingLevel, text: string, fix?: string): SeoFinding {
  const out: SeoFinding = { key, level, text }
  if (fix) out.fix = fix
  return out
}

const UA = 'Mozilla/5.0 (compatible; GrowJinBot/1.0; +https://growjin.com)'

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

// ── Redirect tracing ──────────────────────────────────────────────────────────

interface Trace {
  status: number      // the last answer; 0 = no answer (network, DNS or certificate error)
  finalUrl: string
  hops: string[]      // each URL redirected to, in order
  loop?: boolean
  blocked?: boolean   // a firewall answered instead of the site
  html?: string       // the final page's HTML (withBody only)
}

/** Follows redirects one at a time, so the hops can be counted. */
async function traceRedirects(url: string, maxHops = 5, withBody = false): Promise<Trace> {
  const hops: string[] = []
  let current = url
  for (let i = 0; i <= maxHops; i++) {
    let res: Response
    try {
      res = await fetch(current, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(6000) })
    } catch {
      return { status: 0, finalUrl: current, hops }
    }
    if (isFirewallRefusal(res.status, res.headers)) {
      res.body?.cancel().catch(() => {})
      return { status: 0, finalUrl: current, hops, blocked: true }
    }
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) {
      res.body?.cancel().catch(() => {})
      let next: string
      try { next = new URL(loc, current).href } catch { return { status: res.status, finalUrl: current, hops } }
      if (next === url || hops.includes(next)) return { status: res.status, finalUrl: next, hops: [...hops, next], loop: true }
      hops.push(next)
      current = next
      continue
    }
    if (!withBody) {
      res.body?.cancel().catch(() => {})
      return { status: res.status, finalUrl: current, hops }
    }
    const html = await res.text().catch(() => '')
    if (detectBlock(res.status, res.headers, html)) return { status: 0, finalUrl: current, hops, blocked: true }
    return { status: res.status, finalUrl: current, hops, html }
  }
  return { status: 0, finalUrl: current, hops, loop: true }
}

const pathOfUrl = (u: string) => { try { const x = new URL(u); return x.pathname + x.search } catch { return u } }

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
  opts: SeoAuditOptions = {},
  headers: Record<string, string> = {},
): Promise<SeoFinding[]> {
  const findings: SeoFinding[] = []
  const { brand, hasBrand } = brandOf(pageUrl, opts)
  const hostname = new URL(pageUrl).hostname

  // Derive primary keyword from H1 — skip generic stop words and marketing verbs,
  // take first 3 meaningful content words so we don't surface "turn", "get", "build" etc.
  const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
    'your', 'our', 'their', 'its', 'this', 'that', 'these', 'those', 'we', 'you', 'it', 'into',
    // Generic marketing verbs that are never the primary keyword
    'turn', 'get', 'make', 'build', 'grow', 'scale', 'boost', 'drive', 'unlock', 'discover',
    'transform', 'revolutionize', 'empower', 'elevate', 'supercharge', 'accelerate', 'maximize',
    'optimize', 'create', 'start', 'join', 'launch', 'explore', 'achieve', 'take', 'how', 'why',
    'let', 'see', 'try', 'use', 'run', 'help', 'give', 'need', 'want', 'love', 'meet', 'find',
  ])
  const h1Text = $('h1').first().text().trim().toLowerCase()
  const h1Words = h1Text.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  // The brand's own keyword (Settings → Brand) when saved; otherwise a guess from the H1
  const savedKeyword = (opts.brandKeywords ?? '').split(',').map((k) => k.trim().toLowerCase()).find(Boolean) ?? ''
  const primaryKeyword = savedKeyword || h1Words.slice(0, 3).join(' ')
  const kwWords = savedKeyword
    ? savedKeyword.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    : primaryKeyword.split(' ').slice(0, 1)
  // Word stems, so "scheduling" matches "schedule" and "teams" matches "team"
  const stem = (w: string) => w.slice(0, Math.max(4, w.length - 3))
  const hasKeyword = (text: string) => kwWords.length > 0 && kwWords.every((w) => text.toLowerCase().includes(stem(w)))

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
    if (primaryKeyword && hasKeyword(title)) {
      findings.push(f('title.keyword', 'good', `Primary keyword ("${primaryKeyword}") appears in title.`))
    } else if (primaryKeyword) {
      findings.push(f('title.keyword', 'ok', `Primary keyword ("${primaryKeyword}") not detected in title tag.`,
        'Naturally include your primary keyword near the start of the title.'))
    } else {
      findings.push(f('title.keyword', 'skip', 'Couldn\'t check: no target keyword is known. Add your main keywords in Settings → Brand.'))
    }

    // title.unique: checked against the site's other pages in runSeoAudit (checkSitePages)

    // title.brand
    if (hasBrand(title)) {
      // Brand first ("Acme – Social media scheduling") is normal on a homepage; either end is fine
      findings.push(f('title.brand', 'good', `Brand "${brand}" appears in the title.`))
    } else {
      findings.push(f('title.brand', 'ok', `Brand name ("${brand}") not found in title — homepage and key pages should include it.`,
        'Append your brand name at the end: "Your Page Title | Brand Name".'))
    }
  } else {
    // No title — mark dependent checks as info
    findings.push(f('title.length', 'info', 'Cannot check title length — no title found.'))
    findings.push(f('title.keyword', 'info', 'Cannot check title keyword — no title found.'))
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
    if (primaryKeyword && hasKeyword(metaDesc)) {
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

  } else {
    findings.push(f('description.length', 'info', 'Cannot check description length — none found.'))
    findings.push(f('description.keyword', 'info', 'Cannot check description keyword — none found.'))
    findings.push(f('description.cta', 'info', 'Cannot check description CTA — none found.'))
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
      findings.push(f('canonical.self', 'skip', 'Couldn\'t check: the canonical URL couldn\'t be compared with the page URL.'))
    }

    // canonical.resolves — the canonical URL itself answers 200, without redirecting
    // (a canonical that redirects sends Google mixed signals about which URL to index)
    let canonAbs = canonical
    try { canonAbs = new URL(canonical, pageUrl).href } catch { /* checked above */ }
    const canonCheck = await traceRedirects(canonAbs, 5)
    if (canonCheck.blocked || canonCheck.status === 0) {
      findings.push(f('canonical.resolves', 'skip', canonCheck.blocked
        ? 'Couldn\'t check: a firewall answered instead of the canonical URL.'
        : 'Couldn\'t check: the canonical URL didn\'t answer (timeout or network error).'))
    } else if (canonCheck.hops.length > 0) {
      findings.push(f('canonical.resolves', 'bad', `The canonical URL (${canonAbs}) redirects to ${canonCheck.hops[canonCheck.hops.length - 1]}. Google may ignore a canonical that redirects.`,
        `Point the canonical tag at the final URL: <link rel="canonical" href="${canonCheck.hops[canonCheck.hops.length - 1]}">`))
    } else if (canonCheck.status === 200) {
      findings.push(f('canonical.resolves', 'good', 'The canonical URL loads directly (HTTP 200, no redirect).'))
    } else {
      findings.push(f('canonical.resolves', 'bad', `Canonical URL returns HTTP ${canonCheck.status} — search engines will not use it.`,
        'Fix the canonical URL to point to a page that returns 200 OK.'))
    }
  } else {
    findings.push(f('canonical.same_domain', 'info', 'No canonical to check domain for.'))
    findings.push(f('canonical.self', 'info', 'No canonical to check self-reference for.'))
    findings.push(f('canonical.resolves', 'info', 'No canonical URL to resolve.'))
  }

  // robots.noindex
  const robotsMeta = $('meta[name="robots"], meta[name="googlebot"]').toArray().map((el) => $(el).attr('content') ?? '').join(', ').toLowerCase()
  // The same rule can come as an HTTP header (set by the server or CDN, invisible in the HTML)
  const xRobots = (headers['x-robots-tag'] ?? '').toLowerCase()
  const blocks = (v: string) => /\b(noindex|none)\b/.test(v)
  if (blocks(xRobots)) {
    findings.push(f('robots.noindex', 'bad', `The server sends the header "X-Robots-Tag: ${headers['x-robots-tag']}" — Google will not index this page. It's set on the server or CDN, so it doesn't show in the page's HTML.`,
      'Remove noindex from the X-Robots-Tag header in your server, hosting or CDN settings (e.g. vercel.json / netlify.toml headers, nginx add_header).'))
  } else if (blocks(robotsMeta)) {
    findings.push(f('robots.noindex', 'bad', `Page has <meta name="robots" content="${robotsMeta}"> — this page will not be indexed.`,
      'Remove the noindex directive unless this page is intentionally excluded from search.'))
  } else {
    findings.push(f('robots.noindex', 'good', 'No noindex in the page\'s meta tags or the server\'s X-Robots-Tag header — page is indexable.'))
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

  // outline.coverage — semantic


  // outline.lsi — semantic

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

  // alt.filename — check if alt text looks like a filename
  const altsWithAlt = images.filter((img) => img.alt !== undefined && img.alt.trim() !== '')
  const filenamePattern = /^[\w\-]+$/ // looks like a slug/filename
  const filenameAlts = altsWithAlt.filter((img) => filenamePattern.test(img.alt!.trim()) && img.alt!.trim().split(' ').length === 1)
  findings.push(filenameAlts.length > 0
    ? f('alt.filename', 'bad', `${filenameAlts.length} image(s) appear to use filename-style alt text (e.g., "${filenameAlts[0].alt}").`,
        'Replace single-word filename-style alt text with descriptive phrases.')
    : f('alt.filename', 'good', 'No filename-style alt text detected.'))

  // alt.descriptive

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
    findings.push(f('image.filesize', 'skip', 'Couldn\'t check: none of the images\' file sizes could be read.'))
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
    findings.push(f('image.format', 'skip', 'Couldn\'t check: image formats couldn\'t be told from their file names.'))
  }

  return findings
}

// ── 4. Internal Links ─────────────────────────────────────────────────────────

function checkInternalLinks($: cheerio.CheerioAPI, pageUrl: string, discoveredUrls?: UrlDiscoveryResult, opts: SeoAuditOptions = {}): SeoFinding[] {
  const findings: SeoFinding[] = []
  const hostname = new URL(pageUrl).hostname
  const { brand, hasBrand } = brandOf(pageUrl, opts)

  const allLinks = $('a[href]').toArray()
  const internalLinks = allLinks.filter((el) => {
    const href = $(el).attr('href') ?? ''
    return href.startsWith('/') || href.includes(hostname)
  })
  const externalLinks = allLinks.filter((el) => {
    const href = $(el).attr('href') ?? ''
    return href.startsWith('http') && !href.includes(hostname)
  })

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
    findings.push(f('links.depth', 'skip', 'Couldn\'t check: no other pages were found (no sitemap and the crawl found nothing).'))
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

  // links.broken: the homepage's links are fetched in runSeoAudit (checkBrokenLinks)


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


  // anchor.branded
  const brandedLinks = allLinks.filter((el) => hasBrand($(el).text()) || hasBrand($(el).find('img').attr('alt') ?? ''))
  findings.push(brandedLinks.length > 0
    ? f('anchor.branded', 'good', `Brand name appears in ${brandedLinks.length} link(s).`)
    : f('anchor.branded', 'ok', `Brand name ("${brand}") not found in any link anchor text.`,
        'Include brand name in some internal link anchors, especially in the site header or footer.'))


  // pagerank.nav — check if key pages are in nav
  const navLinks = $('nav a, header a').toArray()
  const navHrefs = navLinks.map((el) => $(el).attr('href')?.toLowerCase() ?? '')
  // About and Contact usually live in the footer, which is fine
  const footerHrefs = $('footer a').toArray().map((el) => $(el).attr('href')?.toLowerCase() ?? '')
  const footerOk = new Set(['about', 'contact'])
  const keyPageGroups: Record<string, string[]> = {
    pricing: ['pricing', 'price', 'plans'],
    'features / product': ['feature', 'product', 'solution', 'how-it-works', 'platform'],
    about: ['about'],
    blog: ['blog', 'resources', 'guides'],
    contact: ['contact', 'support'],
  }
  // Only expect nav links to key pages the site actually has (from its sitemap / crawl)
  const sitePaths = (discoveredUrls?.urls ?? []).map((u) => { try { return new URL(u.url).pathname.toLowerCase() } catch { return '' } })
  const existing = Object.entries(keyPageGroups).filter(([, kws]) => sitePaths.some((p) => kws.some((kw) => p.includes(kw))))
  const missingNav = existing
    .filter(([label, keywords]) => ![...navHrefs, ...(footerOk.has(label) ? footerHrefs : [])].some((href) => keywords.some((kw) => href.includes(kw))))
    .map(([label]) => label)
  if (existing.length === 0) {
    findings.push(f('pagerank.nav', 'skip', 'Couldn\'t check: no key pages (pricing, features, about, blog, contact) were found on the site to compare the navigation with.'))
  } else if (missingNav.length === 0) {
    findings.push(f('pagerank.nav', 'good', 'Navigation links cover all key page types.'))
  } else if (missingNav.length <= 2) {
    findings.push(f('pagerank.nav', 'ok', `Navigation may be missing links to: ${missingNav.join(', ')}.`,
      `Add links to your ${missingNav.join(' and ')} page(s) in the main navigation.`))
  } else {
    findings.push(f('pagerank.nav', 'bad', `Navigation appears sparse — missing common key pages: ${missingNav.slice(0, 3).join(', ')}.`,
      `Link these pages from your main navigation: ${missingNav.join(', ')}.`))
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
  if (contextualLinks >= 2) {
    findings.push(f('pagerank.contextual', 'good', `${contextualLinks} contextual link(s) found within main content area.`))
  } else if (contextualLinks > 0) {
    findings.push(f('pagerank.contextual', 'ok', `Only ${contextualLinks} contextual link(s) in main content — add more internal links within body copy.`,
      'Add a few internal links within your main content pointing to related pages.'))
  } else {
    findings.push(f('pagerank.contextual', 'skip', 'Couldn\'t check: the page has no <main> or <article> area to count links in.'))
  }


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

  // Core Web Vitals: checkVitals, once Google's scan is back

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

  // sitemap.exists + sitemap.robots: /sitemap.xml or any sitemap robots.txt points to
  const sitemaps = discoveredUrls?.sitemaps
  const okMaps = (sitemaps ?? []).filter((m) => m.ok)
  findings.push(sitemaps
    ? okMaps.length > 0
      ? f('sitemap.exists', 'good', `Sitemap found: ${okMaps.map((m) => pathOfUrl(m.url)).join(', ')}.`)
      : f('sitemap.exists', 'ok', `No sitemap found at /sitemap.xml${(discoveredUrls?.robotsSitemaps ?? []).length ? ' or where robots.txt points' : ''}.`,
          'Generate a sitemap.xml (most site builders and frameworks can), list it in robots.txt, and submit it in Google Search Console.')
    : sitemapStatus === 200
    ? f('sitemap.exists', 'good', 'sitemap.xml found and accessible.')
    : f('sitemap.exists', 'ok', 'sitemap.xml not found at /sitemap.xml.',
        'Generate and submit a sitemap.xml to Google Search Console.'))

  const listed = discoveredUrls?.robotsSitemaps
  if (!discoveredUrls || listed === undefined) {
    findings.push(f('sitemap.robots', 'skip', 'Couldn\'t check: the site\'s pages couldn\'t be discovered this time.'))
  } else if (listed === null) {
    findings.push(f('sitemap.robots', 'ok', 'There\'s no robots.txt, so nothing points search engines and AI crawlers to your sitemap.',
      `Create robots.txt with the line: Sitemap: ${okMaps[0]?.url ?? `${new URL(pageUrl).origin}/sitemap.xml`}`))
  } else if (listed.length === 0) {
    findings.push(f('sitemap.robots', 'ok', `robots.txt doesn't list your sitemap${okMaps.length ? '' : ' (and no sitemap was found)'}. Crawlers other than Google look for it there.`,
      `Add this line to robots.txt: Sitemap: ${okMaps[0]?.url ?? `${new URL(pageUrl).origin}/sitemap.xml`}`))
  } else {
    const broken = (sitemaps ?? []).filter((m) => m.fromRobots && !m.ok)
    findings.push(broken.length > 0
      ? f('sitemap.robots', 'bad', `robots.txt points to ${broken.map((m) => m.url).join(', ')}, but ${broken.length === 1 ? 'it doesn\'t' : 'they don\'t'} load as a sitemap.`,
          'Fix the Sitemap: line in robots.txt so it points to your real sitemap URL (it must return XML, not a page).')
      : f('sitemap.robots', 'good', `robots.txt points crawlers to your sitemap (${listed.map(pathOfUrl).join(', ')}).`))
  }

  // Status of a sample of the site's pages (sitemap or crawl): for 404s, 5xx errors and
  // whether the sitemap lists pages that actually load
  const sampleUrls = (discoveredUrls?.urls ?? []).slice(0, 25).map(u => u.url)
  const headResults = await Promise.all(sampleUrls.map(async (u) => {
    const once = async (method: 'HEAD' | 'GET') => {
      const r = await fetch(u, { method, headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000), redirect: 'follow' })
      if (method === 'GET') r.body?.cancel().catch(() => {})
      // Turned away by a firewall: no answer about the page itself (not a 4xx/5xx)
      if (isFirewallRefusal(r.status, r.headers)) return { url: u, status: 0, redirected: false }
      return { url: u, status: r.status, redirected: r.redirected }
    }
    try {
      const r = await once('HEAD')
      // Some servers don't answer HEAD properly: ask again with GET
      return r.status === 405 || r.status === 501 || r.status === 403 ? await once('GET') : r
    } catch {
      return { url: u, status: 0, redirected: false }
    }
  }))
  const checked = headResults.filter(r => r.status > 0)
  const pathOf = (u: string) => { try { return new URL(u).pathname } catch { return u } }

  // sitemap.valid — the sitemap's URLs load directly (no 404s, errors or redirects)
  if (discoveredUrls?.sitemapFound && discoveredUrls.totalDiscovered === 0) {
    findings.push(f('sitemap.valid', 'ok', 'Sitemap found but contains no valid same-origin URLs.',
      'Ensure your sitemap.xml lists absolute URLs matching your domain (e.g. https://yourdomain.com/page).'))
  } else if (discoveredUrls?.sitemapFound && !discoveredUrls.crawlUsed && checked.length > 0) {
    const broken = checked.filter(r => r.status >= 400)
    const moved = checked.filter(r => r.status < 400 && r.redirected)
    findings.push(broken.length > 0
      ? f('sitemap.valid', 'bad', `${broken.length} of ${checked.length} sampled sitemap URLs don't load (e.g. ${broken.slice(0, 3).map(r => `${pathOf(r.url)} → ${r.status}`).join(', ')}).`,
          'Remove dead URLs from the sitemap, or fix / redirect those pages.')
      : moved.length > 0
      ? f('sitemap.valid', 'ok', `${moved.length} of ${checked.length} sampled sitemap URLs redirect (e.g. ${moved.slice(0, 3).map(r => pathOf(r.url)).join(', ')}).`,
          'List the final URLs in the sitemap, not ones that redirect.')
      : f('sitemap.valid', 'good', `All ${checked.length} sampled sitemap URLs load directly (${discoveredUrls.totalDiscovered} URLs listed).`))
  } else if (discoveredUrls?.sitemapFound && discoveredUrls.crawlUsed) {
    findings.push(f('sitemap.valid', 'skip', 'Couldn\'t check: the sitemap lists fewer than 5 pages, so the site\'s pages were found by following its links instead.'))
  } else if (discoveredUrls?.sitemapFound) {
    findings.push(f('sitemap.valid', 'skip', 'Couldn\'t check: none of the sitemap\'s pages answered when we tested them.'))
  } else {
    findings.push(f('sitemap.valid', 'skip', 'Couldn\'t check: no sitemap.xml was found (see "sitemap.xml present").'))
  }

  // http.4xx + http.5xx
  if (checked.length > 0) {
    const notFound = checked.filter(r => r.status === 404 || r.status === 410)
    const serverErrors = checked.filter(r => r.status >= 500)
    findings.push(notFound.length > 0
      ? f('http.4xx', 'bad',
          `${notFound.length} of ${checked.length} sampled pages returned 404 — broken URLs hurt both users and rankings.`,
          `Set up 301 redirects or fix these URLs: ${notFound.slice(0, 3).map(r => pathOf(r.url)).join(', ')}`)
      : f('http.4xx', 'good', `All ${checked.length} sampled pages returned valid status codes — no 404 errors detected.`))
    findings.push(serverErrors.length > 0
      ? f('http.5xx', 'bad',
          `${serverErrors.length} of ${checked.length} sampled pages returned 5xx server errors — search engines stop indexing pages that return errors.`,
          'Check server logs immediately and resolve the underlying errors.')
      : f('http.5xx', 'good', `No 5xx server errors detected across ${checked.length} sampled pages.`))
  } else {
    const why = sampleUrls.length === 0 ? 'no other pages were found to test' : 'none of the sampled pages answered'
    findings.push(f('http.4xx', 'skip', `Couldn't check: ${why}.`))
    findings.push(f('http.5xx', 'skip', `Couldn't check: ${why}.`))
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
  // perf.js_size: measured in runSeoAudit (checkJsSize)

  // perf.ttfb
  findings.push(ttfb < 0
    ? f('perf.ttfb', 'skip', 'Couldn\'t check: the site blocked direct scanning, so response time couldn\'t be measured.')
    : ttfb < 200
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

// ── Descriptive page URLs ───────────────────────────────────────────────────────
// Across the site's pages (sitemap / crawl), not just the homepage, which has no slug.
function checkUrlSlugs(pageUrl: string, discovered?: UrlDiscoveryResult): SeoFinding {
  let origin = ''
  try { origin = new URL(pageUrl).origin } catch { /* keep '' */ }
  const paths = (discovered?.urls ?? [])
    .map((u) => { try { const x = new URL(u.url); return x.origin === origin ? x.pathname + x.search : null } catch { return null } })
    .filter((p): p is string => !!p && p !== '/')
  if (paths.length === 0) {
    return f('links.url_slugs', 'info', 'Only the homepage was found, so there are no page URLs to check yet.')
  }
  // Hard to read for people and search engines: IDs, query strings, underscores, capitals, very long
  const why = (p: string): string | null => {
    if (p.includes('?')) return 'query string'
    const segs = p.split('/').filter(Boolean)
    if (segs.some((s) => /^\d{4,}$/.test(s) || /^[0-9a-f]{12,}$/i.test(s) || /^[0-9a-f-]{32,}$/i.test(s))) return 'ID instead of words'
    if (/_/.test(p)) return 'underscores'
    if (/[A-Z]/.test(p)) return 'capital letters'
    if (p.length > 90) return 'very long'
    return null
  }
  const bad = paths.map((p) => ({ p, r: why(p) })).filter((x): x is { p: string; r: string } => !!x.r)
  const share = bad.length / paths.length
  if (bad.length === 0 || (share < 0.1 && bad.length <= 2)) {
    return f('links.url_slugs', 'good', `${paths.length} page URL${paths.length === 1 ? '' : 's'} checked: readable, descriptive slugs.`)
  }
  const examples = bad.slice(0, 3).map((x) => `${x.p} (${x.r})`).join(', ')
  return f('links.url_slugs', share >= 0.3 ? 'bad' : 'ok',
    `${bad.length} of ${paths.length} page URLs aren't descriptive, e.g. ${examples}.`,
    'Use short, lowercase, hyphenated words that say what the page is (/pricing, /blog/how-to-get-first-users); redirect the old URLs.')
}

// ── Google's page scan: element boxes ───────────────────────────────────────────
// Which Lighthouse audits back which SEO checks. The scan sees the page after JavaScript runs,
// so when it finds problems the HTML check missed, the check fails with the scan's count.
const SCAN_CHECKS: Record<string, { audits: string[]; one?: string; many?: string; fix?: string }> = {
  'hierarchy.skipped': { audits: ['heading-order'], one: 'heading skips a level', many: 'headings skip a level', fix: 'Use headings in order (H1 → H2 → H3); style them with CSS rather than picking a level for its size.' },
  'alt.present': { audits: ['image-alt', 'input-image-alt'], one: 'image has no alt text', many: 'images have no alt text', fix: 'Add a short alt="…" description to each image (alt="" for purely decorative ones).' },
  'links.crawlable': { audits: ['crawlable-anchors'] },
}

/** Attaches the scan's failing elements to findings (adding links.crawlable); returns the screenshot. */
function applyScan(findings: SeoFinding[], lhr: Record<string, unknown>): PageScreenshot | null {
  const audits = lhr.audits as Record<string, { score?: number | null }> | undefined
  let any = false
  for (const [key, spec] of Object.entries(SCAN_CHECKS)) {
    const found = extractElements(lhr, spec.audits)
    const i = findings.findIndex((fi) => fi.key === key)
    if (key === 'links.crawlable') {
      const score = audits?.['crawlable-anchors']?.score
      if (score === null || score === undefined) continue
      findings.push(found
        ? { ...f(key, 'bad', `${found.total} link${found.total === 1 ? '' : 's'} can't be followed by Google (no real href, or a javascript: link), so the pages ${found.total === 1 ? 'it points' : 'they point'} to may never be found.`, 'Use <a href="/real-page"> for navigation; keep JavaScript click handlers for buttons, not links.'), elements: found }
        : f(key, 'good', 'Every link on the page can be followed by Google.'))
      if (found) any = true
      continue
    }
    if (!found || i < 0) continue
    any = true
    const fi = findings[i]
    findings[i] = fi.level === 'bad' || fi.level === 'ok'
      ? { ...fi, elements: found }
      : { ...f(key, 'bad', `${found.total} ${found.total === 1 ? spec.one : spec.many} (found by Google's scan of the rendered page).`, spec.fix), elements: found }
  }
  return any ? extractScreenshot(lhr) : null
}

// ── Checks across the site's pages ──────────────────────────────────────────────

/** Duplicate titles / descriptions among the homepage and the sampled pages (title.unique, description.unique). */
function checkSitePages($: cheerio.CheerioAPI, pageUrl: string, discovered?: UrlDiscoveryResult): SeoFinding[] {
  const home = { url: pageUrl, title: $('title').first().text().trim(), metaDescription: $('meta[name="description"]').attr('content')?.trim() ?? '' }
  const norm = (u: string) => { try { const x = new URL(u); return x.origin + x.pathname.replace(/\/$/, '') } catch { return u } }
  const pages = [home, ...(discovered?.urls ?? []).filter((u) => (u.status ?? 200) < 400 && norm(u.url) !== norm(pageUrl))]
  const sampled = pages.filter((p) => p.title || p.metaDescription)
  const pathOf = (u: string) => { try { return new URL(u).pathname } catch { return u } }
  const dupes = (field: 'title' | 'metaDescription') => {
    const by = new Map<string, string[]>()
    for (const p of sampled) {
      const v = (p[field] ?? '').trim().toLowerCase()
      if (v) by.set(v, [...(by.get(v) ?? []), pathOf(p.url)])
    }
    return [...by.values()].filter((paths) => paths.length > 1)
  }
  const out: SeoFinding[] = []
  for (const [key, field, word] of [['title.unique', 'title', 'title'], ['description.unique', 'metaDescription', 'meta description']] as const) {
    if (sampled.length < 2) {
      out.push(f(key, 'skip', `Couldn't check: only the homepage could be read, so there are no other pages to compare its ${word} with.`))
      continue
    }
    const groups = dupes(field)
    const shared = groups.reduce((n, g) => n + g.length, 0)
    out.push(groups.length === 0
      ? f(key, 'good', `Every one of the ${sampled.length} pages checked has its own ${word}.`)
      : f(key, shared >= 4 ? 'bad' : 'ok',
          `${shared} of ${sampled.length} pages checked share a ${word} (e.g. ${groups[0].slice(0, 3).join(', ')}).`,
          `Give each page its own ${word} that says what that page is about.`))
  }
  return out
}

/** links.broken: the homepage's internal links that don't load (404 / 410 / 5xx). */
async function checkBrokenLinks($: cheerio.CheerioAPI, pageUrl: string): Promise<SeoFinding> {
  const origin = new URL(pageUrl).origin
  const targets = [...new Set($('a[href]').toArray().map((el) => $(el).attr('href') ?? '')
    .filter((h) => h && !/^(#|mailto:|tel:|javascript:)/i.test(h))
    .map((h) => { try { const u = new URL(h, pageUrl); u.hash = ''; return u.origin === origin ? u.href : '' } catch { return '' } })
    .filter(Boolean))].slice(0, 30)
  if (targets.length === 0) return f('links.broken', 'skip', 'Couldn\'t check: the homepage has no internal links to test.')
  const results = await Promise.all(targets.map(async (u) => {
    const r = await headRequest(u)
    if (r && (r.status === 405 || r.status === 501 || r.status === 403)) {
      try {
        const g = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000), redirect: 'follow' })
        g.body?.cancel().catch(() => {})
        return { u, status: g.status }
      } catch { return { u, status: 0 } }
    }
    return { u, status: r?.status ?? 0 }
  }))
  const answered = results.filter((r) => r.status > 0)
  if (answered.length === 0) return f('links.broken', 'skip', 'Couldn\'t check: none of the homepage\'s links answered when we tested them.')
  const broken = answered.filter((r) => r.status === 404 || r.status === 410 || r.status >= 500)
  const pathOf = (u: string) => { try { return new URL(u).pathname } catch { return u } }
  return broken.length === 0
    ? f('links.broken', 'good', `All ${answered.length} internal links on the homepage work.`)
    : f('links.broken', 'bad', `${broken.length} of ${answered.length} internal links on the homepage are broken: ${broken.slice(0, 4).map((r) => `${pathOf(r.u)} (${r.status})`).join(', ')}.`,
        'Fix or remove these links, or redirect the old URLs to the right pages.')
}

/** perf.js_size: total size of the page's script files (from their Content-Length). */
async function checkJsSize($: cheerio.CheerioAPI, pageUrl: string): Promise<SeoFinding> {
  const srcs = [...new Set($('script[src]').toArray().map((el) => $(el).attr('src') ?? '').filter(Boolean)
    .map((s) => { try { return new URL(s, pageUrl).href } catch { return '' } }).filter(Boolean))].slice(0, 20)
  if (srcs.length === 0) return f('perf.js_size', 'good', 'The page loads no external JavaScript files.')
  const sizes = await Promise.all(srcs.map(async (u) => (await headRequest(u))?.contentLength ?? 0))
  const known = sizes.filter((n) => n > 0)
  if (known.length === 0) return f('perf.js_size', 'skip', 'Couldn\'t check: the script files didn\'t report their size.')
  const kb = Math.round(known.reduce((a, b) => a + b, 0) / 1024)
  const of = known.length < srcs.length ? ` (${known.length} of ${srcs.length} files measured)` : ''
  return kb > 1000
    ? f('perf.js_size', 'bad', `${kb} KB of JavaScript${of} — slows the page down on phones.`, 'Split the bundle, lazy-load what isn\'t needed for the first view, and drop unused libraries.')
    : kb > 500
    ? f('perf.js_size', 'ok', `${kb} KB of JavaScript${of} — on the heavy side.`, 'Lazy-load scripts that aren\'t needed for the first view.')
    : f('perf.js_size', 'good', `${kb} KB of JavaScript${of}.`)
}

/** title.sitewide: page titles across the site that Google cuts off (over 60 characters) or that
 *  are very short, and whether a shared ending ("| Acme Inc") is what pushes them over. */
function checkTitlesSitewide($: cheerio.CheerioAPI, pageUrl: string, discovered?: UrlDiscoveryResult): SeoFinding {
  const norm = (u: string) => { try { const x = new URL(u); return x.origin + x.pathname.replace(/\/$/, '') } catch { return u } }
  const titles = [
    $('title').first().text(),
    ...(discovered?.urls ?? []).filter((u) => (u.status ?? 200) < 400 && norm(u.url) !== norm(pageUrl)).map((u) => u.title ?? ''),
  ].map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (titles.length < 3) return f('title.sitewide', 'skip', 'Couldn\'t check: fewer than 3 of the site\'s page titles could be read.')

  // The longest ending most titles share, from a separator on (" | Acme Inc — Best Tools")
  const endingsOf = (t: string) => [...t.matchAll(/\s+[|\-–—·:]\s+/g)].map((m) => t.slice(m.index))
  const counts = new Map<string, number>()
  for (const t of titles) for (const e of new Set(endingsOf(t))) counts.set(e, (counts.get(e) ?? 0) + 1)
  const shared = [...counts.entries()]
    .filter(([e, n]) => n >= Math.max(2, titles.length * 0.5) && e.length < 45)
    .sort((a, b) => b[0].length - a[0].length)[0]?.[0] ?? ''

  const long = titles.filter((t) => t.length > 60)
  const short = titles.filter((t) => t.length < 30)
  const bySuffix = shared ? long.filter((t) => t.endsWith(shared) && t.length - shared.length <= 60) : []

  if (long.length === 0 && short.length / titles.length <= 0.3) {
    return f('title.sitewide', 'good', `All ${titles.length} page titles checked are a good length (under 60 characters, so Google shows them in full).`)
  }
  const parts: string[] = []
  if (long.length) {
    parts.push(`${long.length} of ${titles.length} page titles are over 60 characters, so Google cuts them off (e.g. "${long[0]}")`)
    if (bySuffix.length) parts.push(`in ${bySuffix.length === long.length ? (long.length === 1 ? 'it' : 'all of them') : `${bySuffix.length} of them`} it's the ending "${shared.trim()}" added to every title (${shared.length} characters) that pushes ${bySuffix.length === 1 ? 'it' : 'them'} over`)
  }
  if (short.length / titles.length > 0.3) parts.push(`${short.length} are under 30 characters, too short to say what the page is about`)
  return f('title.sitewide', long.length / titles.length > 0.3 ? 'bad' : 'ok', `${parts.join('; ')}.`,
    bySuffix.length
      ? `Shorten the "${shared.trim()}" ending in your title template (just the brand name is enough), or leave it off long titles.`
      : long.length
        ? 'Keep each page title under 60 characters, with the words people search for first.'
        : 'Make short titles say what the page offers, e.g. "Pricing — Plans from $9/month | Acme".')
}

/** soft404: a made-up page address should answer 404, not 200 or a redirect to the homepage. */
async function checkSoft404(pageUrl: string): Promise<SeoFinding> {
  const origin = new URL(pageUrl).origin
  const probe = `${origin}/growjin-check-${Math.random().toString(36).slice(2, 10)}`
  const r = await traceRedirects(probe, 3, true)
  if (r.blocked) return f('soft404', 'skip', 'Couldn\'t check: a firewall answered instead of the site.')
  if (r.status === 0) return f('soft404', 'skip', 'Couldn\'t check: the site didn\'t answer for a made-up page address.')
  const toHome = r.hops.length > 0 && (() => { try { return new URL(r.finalUrl).pathname === '/' } catch { return false } })()
  if (r.status === 404 || r.status === 410) {
    return r.hops.length === 0
      ? f('soft404', 'good', 'A page that doesn\'t exist correctly answers 404 Not Found.')
      : f('soft404', 'ok', `A page that doesn't exist redirects first (to ${pathOfUrl(r.finalUrl)}) and only then answers ${r.status}.`,
          'Answer 404 straight away at the missing address, without redirecting.')
  }
  if (r.status === 200) {
    return f('soft404', 'bad', toHome
      ? 'Pages that don\'t exist redirect to the homepage. Google treats this as a "soft 404": broken and mistyped links look like duplicates of your homepage.'
      : `A page that doesn't exist (${pathOfUrl(probe)}) answers 200 OK instead of 404. Google calls this a "soft 404": missing pages look real, waste crawl time and can get indexed as empty pages.`,
      'Make the server answer 404 for unknown addresses (keep your friendly "page not found" design, just with a 404 status). Don\'t redirect missing pages to the homepage.')
  }
  return f('soft404', 'ok', `A page that doesn't exist answers ${r.status} instead of 404.`,
    'Make the server answer 404 Not Found for addresses that don\'t exist.')
}

// Links that redirect on purpose (to log in, to the app): not a problem to report
const AUTH_PATH = /\/(log-?in|sign-?in|sign-?up|register|log-?out|sign-?out|account|dashboard|app|auth|cart|checkout)(\/|$|\?)/i

/** redirect.www, redirect.chains, redirect.internal_links: one address for the site, reached in one hop, and links that don't detour. */
async function checkRedirects($: cheerio.CheerioAPI, pageUrl: string): Promise<SeoFinding[]> {
  const page = new URL(pageUrl)
  const host = page.hostname
  const labels = host.split('.')
  const isIp = /^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost'
  const twoPartTld = labels.length === 3 && /^(co|com|org|net|gov|ac|edu)$/.test(labels[1]) && labels[2].length === 2
  const alt = isIp ? null : host.startsWith('www.') ? host.slice(4) : labels.length === 2 || twoPartTld ? `www.${host}` : null
  const onSite = (u: string) => { try { const h = new URL(u).hostname; return h === host || h === alt } catch { return false } }

  // Internal links on the homepage (same site, not log-in / app links)
  const links = [...new Set($('a[href]').toArray().map((el) => $(el).attr('href') ?? '')
    .filter((h) => h && !/^(#|mailto:|tel:|javascript:)/i.test(h))
    .map((h) => { try { const u = new URL(h, pageUrl); u.hash = ''; return u.origin === page.origin ? u.href : '' } catch { return '' } })
    .filter((u) => u && !AUTH_PATH.test(new URL(u).pathname)))].slice(0, 40)

  const [altTrace, httpTrace, httpAltTrace, linkTraces] = await Promise.all([
    alt ? traceRedirects(`${page.protocol}//${alt}/`) : Promise.resolve(null),
    page.protocol === 'https:' ? traceRedirects(`http://${host}/`) : Promise.resolve(null),
    alt && page.protocol === 'https:' ? traceRedirects(`http://${alt}/`) : Promise.resolve(null),
    Promise.all(links.map((u) => traceRedirects(u, 3).then((t) => ({ u, t })))),
  ])
  const out: SeoFinding[] = []

  // redirect.www
  if (!alt || !altTrace) {
    out.push(f('redirect.www', 'info', `Your site is on ${host}, a subdomain, so there's no www / non-www pair to check.`))
  } else if (altTrace.blocked) {
    out.push(f('redirect.www', 'skip', `Couldn't check: a firewall answered for ${alt}.`))
  } else if (altTrace.status === 0 && altTrace.hops.length === 0) {
    out.push(f('redirect.www', 'bad', `${alt} doesn't load (no answer, or a certificate error). Anyone who types it gets an error instead of your site.`,
      `Add a DNS record for ${alt} at your domain provider and redirect it (301) to ${page.protocol}//${host}/. Make sure the SSL certificate covers both.`))
  } else if (altTrace.loop) {
    out.push(f('redirect.www', 'bad', `${alt} is stuck in a redirect loop.`, `Redirect ${alt} straight to ${page.protocol}//${host}/ (one 301).`))
  } else if (altTrace.hops.length === 0 && altTrace.status === 200) {
    out.push(f('redirect.www', 'ok', `Both ${host} and ${alt} show the site without redirecting, so Google sees two copies of every page.`,
      `Redirect ${alt} to ${host} with a 301 (permanent) redirect in your hosting or DNS settings.`))
  } else if (altTrace.status < 400 && onSite(altTrace.finalUrl) && new URL(altTrace.finalUrl).hostname === host) {
    out.push(altTrace.hops.length === 1
      ? f('redirect.www', 'good', `${alt} redirects to ${host} in one step.`)
      : f('redirect.www', 'ok', `${alt} reaches ${host}, but through ${altTrace.hops.length} redirects.`,
          `Redirect ${alt} straight to ${page.protocol}//${host}/ in one 301.`))
  } else {
    out.push(f('redirect.www', 'bad', `${alt} ${altTrace.status >= 400 ? `answers ${altTrace.status}` : `ends up at ${altTrace.finalUrl}`} instead of showing your site.`,
      `Redirect ${alt} to ${page.protocol}//${host}/ with a 301 (permanent) redirect.`))
  }

  // redirect.chains: the usual ways in (http://, www) reach the site in one redirect
  const entries = [
    { from: `http://${host}/`, t: httpTrace },
    { from: `http://${alt}/`, t: httpAltTrace },
    { from: `${page.protocol}//${alt}/`, t: alt ? altTrace : null },
  ].filter((e): e is { from: string; t: Trace } => !!e.t && !e.t.blocked && e.t.hops.length > 0 && (e.t.status > 0 || !!e.t.loop))
  const worst = entries.sort((a, b) => b.t.hops.length - a.t.hops.length)[0]
  if (!worst) {
    out.push(f('redirect.chains', 'skip', 'Couldn\'t check: none of the other addresses for your site (http://, www) redirected anywhere to follow.'))
  } else if (worst.t.loop) {
    out.push(f('redirect.chains', 'bad', `${worst.from} is stuck in a redirect loop — visitors and Google never reach the page.`,
      `Make ${worst.from} redirect once, straight to ${page.protocol}//${host}/.`))
  } else if (worst.t.hops.length >= 2) {
    const chain = [worst.from, ...worst.t.hops].join(' → ')
    out.push(f('redirect.chains', worst.t.hops.length >= 3 ? 'bad' : 'ok', `${worst.from} takes ${worst.t.hops.length} redirects to reach your site: ${chain}. Each hop slows visitors down and leaks a little ranking strength.`,
      `Redirect every variant (http://, www, non-www) straight to ${page.protocol}//${host}/ in a single 301.`))
  } else {
    out.push(f('redirect.chains', 'good', `Every way into the site (${entries.map((e) => e.from.replace(/\/$/, '')).join(', ')}) reaches it in one redirect.`))
  }

  // redirect.internal_links
  const answered = linkTraces.filter(({ t }) => !t.blocked && (t.status > 0 || t.hops.length > 0))
  if (answered.length === 0) {
    out.push(f('redirect.internal_links', 'skip', links.length === 0
      ? 'Couldn\'t check: the homepage has no internal links to test.'
      : 'Couldn\'t check: none of the homepage\'s links answered when we tested them.'))
  } else {
    // Only detours within the site count: a /discord link sending people to discord.gg is on purpose
    const moved = answered.filter(({ t }) => t.hops.length > 0 && onSite(t.finalUrl))
    const strip = (u: string) => u.replace(/\/(\?|$)/, '$1')
    const slashOnly = moved.filter(({ u, t }) => strip(u) === strip(t.hops[0]))
    if (moved.length === 0) {
      out.push(f('redirect.internal_links', 'good', `All ${answered.length} internal links on the homepage point straight at their pages.`))
    } else {
      const eg = moved.slice(0, 3).map(({ u, t }) => `${pathOfUrl(u)} → ${pathOfUrl(t.finalUrl)}`).join(', ')
      out.push(f('redirect.internal_links', moved.length >= 3 && moved.length / answered.length >= 0.3 ? 'bad' : 'ok',
        `${moved.length} of ${answered.length} internal links on the homepage go through a redirect (e.g. ${eg})${slashOnly.length ? `; ${slashOnly.length} of them only because of a missing or extra "/" at the end` : ''}.`,
        slashOnly.length
          ? 'Pick one style (with or without the ending "/") and use it in every link, so links match the final URLs.'
          : 'Update these links to the final URLs, so visitors and Google skip the extra hop.'))
    }
  }
  return out
}

type LabVitals = { lcp: number; cls: number; tbt: number; performance: number }

/** Lab numbers from Google's scan (PageSpeed Insights), when its performance test ran. */
function labFromScan(lhr: Record<string, unknown>): LabVitals | null {
  const audits = lhr.audits as Record<string, { numericValue?: number }> | undefined
  const score = (lhr.categories as Record<string, { score?: number | null }> | undefined)?.performance?.score
  const lcp = audits?.['largest-contentful-paint']?.numericValue
  if (score == null || lcp == null) return null
  return {
    lcp: Math.round(lcp),
    cls: audits?.['cumulative-layout-shift']?.numericValue ?? 0,
    tbt: Math.round(audits?.['total-blocking-time']?.numericValue ?? 0),
    performance: Math.round(score * 100),
  }
}

/** Core Web Vitals: real visitors' numbers from Chrome when Google has them (what rankings use), else the lab test. */
function checkVitals(field: PsiFieldData | null, lab: LabVitals | null): SeoFinding[] {
  const who = field?.scope === 'page' ? 'Real visitors (Chrome data, last 28 days)' : 'Real visitors across your site (Chrome data, last 28 days)'
  const labWho = 'Google\'s lab test on a phone (no real-visitor data yet)'
  const none = 'Couldn\'t check: Google\'s speed test didn\'t finish this time, and Chrome has no real-visitor data for this site yet.'
  const grade = (key: string, v: number, good: number, poor: number, text: string, fixOk: string, fixBad: string) =>
    v <= good ? f(key, 'good', `${text} — good.`)
    : v <= poor ? f(key, 'ok', `${text} — needs improvement.`, fixOk)
    : f(key, 'bad', `${text} — poor; fails Google's Core Web Vitals.`, fixBad)
  const out: SeoFinding[] = []

  const lcpFix = ['Optimise the largest element (usually the hero image): compress it, preload it, and serve it from a CDN.',
    'Find the largest element (usually the hero image or H1), compress it, add a preload hint, and cut server response time.']
  if (field?.lcpMs != null) out.push(grade('cwv.lcp', field.lcpMs / 1000, 2.5, 4, `${who}: the main content appears after ${(field.lcpMs / 1000).toFixed(1)}s (LCP)`, lcpFix[0], lcpFix[1]))
  else if (lab) out.push(grade('cwv.lcp', lab.lcp / 1000, 2.5, 4, `${labWho}: the main content appears after ${(lab.lcp / 1000).toFixed(1)}s (LCP)`, lcpFix[0], lcpFix[1]))
  else out.push(f('cwv.lcp', 'skip', none))

  const clsFix = ['Give images and embeds a width and height, and don\'t insert banners above existing content.',
    'Find what moves while the page loads: images without dimensions, ads, injected banners or late-loading fonts.']
  if (field?.cls != null) out.push(grade('cwv.cls', field.cls, 0.1, 0.25, `${who}: layout shift score ${field.cls.toFixed(2)} (CLS)`, clsFix[0], clsFix[1]))
  else if (lab) out.push(grade('cwv.cls', lab.cls, 0.1, 0.25, `${labWho}: layout shift score ${lab.cls.toFixed(2)} (CLS)`, clsFix[0], clsFix[1]))
  else out.push(f('cwv.cls', 'skip', none))

  const inpFix = ['Split large JavaScript bundles, defer non-critical scripts, and remove unused third-party scripts.',
    'Profile what runs when people tap: break up long JavaScript tasks and defer non-essential scripts.']
  if (field?.inpMs != null) out.push(grade('cwv.fid', field.inpMs, 200, 500, `${who}: the page reacts to taps and clicks in ${field.inpMs}ms (INP)`, inpFix[0], inpFix[1]))
  else if (lab) out.push(grade('cwv.fid', lab.tbt, 200, 600, `${labWho}: JavaScript blocks the page for ${lab.tbt}ms while loading (Total Blocking Time, the lab stand-in for INP)`, inpFix[0], inpFix[1]))
  else out.push(f('cwv.fid', 'skip', none))

  if (!lab) {
    out.push(f('lighthouse.score', 'skip', 'Couldn\'t check: Google\'s speed test didn\'t finish this time.'))
  } else {
    const p = lab.performance
    out.push(p >= 80
      ? f('lighthouse.score', 'good', `Google speed score: ${p}/100.`)
      : p >= 50
      ? f('lighthouse.score', 'ok', `Google speed score: ${p}/100 — room for improvement.`,
          'Focus on the top suggestions in PageSpeed Insights: image size, render-blocking files, server response time.')
      : f('lighthouse.score', 'bad', `Google speed score: ${p}/100 — poor; the page is slow on phones.`,
          'Work through PageSpeed Insights: compress images, remove render-blocking CSS/JS, enable caching.'))
  }
  return out
}

// Checks that read the page's body content: not judgeable on a page built by JavaScript
const BODY_CHECK = /^(h1\.|hierarchy\.|outline\.|alt\.|image\.|anchor\.|pagerank\.|links\.homepage_links$|links\.broken$)/

export async function runSeoAudit(url: string, opts: SeoAuditOptions = {}): Promise<SeoAuditResult | SeoAuditError> {
  const normalizedUrl = url.startsWith('http') ? url : `https://${url}`

  let html = ''
  let finalUrl = normalizedUrl
  let ttfb = -1
  let headers: Record<string, string> = {}
  let status = 200

  try {
    const start = Date.now()
    const res = await fetch(normalizedUrl, {
      headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate, br' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    ttfb = Date.now() - start
    finalUrl = res.url
    html = await res.text()
    headers = Object.fromEntries(res.headers.entries())
    status = res.status
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to fetch the page' }
  }
  const $ = cheerio.load(html)
  const canonicalHref = $('link[rel="canonical"]').attr('href') ?? null

  // Google's page scan (Lighthouse via PageSpeed Insights, shared with the Website Audit and
  // cached for a few minutes): runs alongside everything below, for the checks that box the
  // offending elements on a screenshot of the page.
  const scanPromise = fetchPsiAccessibility(finalUrl).catch(() => null)

  // Fetch robots.txt, sitemap status, and run URL discovery in parallel
  const origin = new URL(finalUrl).origin
  const [robotsTxtResult, sitemapStatusResult, discoveryResult] = await Promise.allSettled([
    fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(5_000) })
      .then(r => r.ok ? r.text() : null),
    fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(5_000) })
      .then(r => r.status),
    // Sample 25 pages' titles, descriptions and status for the site-wide checks
    discoverAllUrls(finalUrl, html, { maxUrls: 300, maxCrawlDepth: 2, enrichMeta: 25 }),
  ])
  const robotsTxt = robotsTxtResult.status === 'fulfilled' ? robotsTxtResult.value : null
  const sitemapStatus = sitemapStatusResult.status === 'fulfilled' ? sitemapStatusResult.value ?? 0 : 0
  const discoveredUrls = discoveryResult.status === 'fulfilled' ? discoveryResult.value : undefined

  // Optional Lighthouse
  const hasLighthouse = await lighthouseAvailable()
  const lighthouseData = hasLighthouse ? await runLighthouse(finalUrl) : null

  // Run all sections in parallel where possible
  const [metaFindings, imageFindings, technicalFindings, brokenLinks, jsSize, soft404, redirectFindings] = await Promise.all([
    checkMetaTags($, finalUrl, canonicalHref, opts, headers),
    checkImageAlt($, finalUrl),
    checkTechnical($, finalUrl, headers, ttfb, robotsTxt, sitemapStatus, Buffer.byteLength(html, 'utf8'), lighthouseData, discoveredUrls),
    checkBrokenLinks($, finalUrl),
    checkJsSize($, finalUrl),
    checkSoft404(finalUrl),
    checkRedirects($, finalUrl),
  ])

  const title = $('title').first().text().trim()
  const headingFindings = checkHeadings($, title)
  const linkFindings = [...checkInternalLinks($, finalUrl, discoveredUrls, opts), checkUrlSlugs(finalUrl, discoveredUrls), brokenLinks]
  const schemaFindings = checkSchema($, finalUrl)

  const findings = [
    ...metaFindings,
    ...headingFindings,
    ...imageFindings,
    ...linkFindings,
    ...schemaFindings,
    ...technicalFindings,
    ...checkSitePages($, finalUrl, discoveredUrls),
    checkTitlesSitewide($, finalUrl, discoveredUrls),
    jsSize,
    soft404,
    ...redirectFindings,
  ]

  // A page whose HTML is an empty shell filled in by JavaScript: say so (AI crawlers and many
  // bots see it empty too), and don't fail body checks we can't see. Google's scan below still
  // overrides with what it finds on the rendered page.
  // A firewall answered instead of the site (e.g. Cloudflare's "Just a moment…"): nothing we read is
  // the real page, so every check made from it is Not checked. Google's scan below still runs.
  const block = detectBlock(status, headers, html)
  if (block) {
    const why = blockedSkipText(block)
    for (let i = 0; i < findings.length; i++) findings[i] = f(findings[i].key, 'skip', why)
  }
  const jsShell = !block && isJsShell($)
  findings.push(block ? f('render.no_js', 'skip', blockedSkipText(block)) : jsShell
    ? f('render.no_js', 'bad', 'The page\'s HTML is nearly empty: its content is built by JavaScript in the browser. Google can usually still render it, but AI assistants (ChatGPT, Perplexity, Claude) and many crawlers read the empty HTML.',
        'Pre-render or server-render the page (SSR / static generation, e.g. Next.js, Astro, or a prerendering service) so the content is in the HTML.')
    : f('render.no_js', 'good', 'The page\'s content is in its HTML, readable without running JavaScript.'))
  if (jsShell) {
    for (let i = 0; i < findings.length; i++) {
      if (BODY_CHECK.test(findings[i].key)) findings[i] = f(findings[i].key, 'skip', JS_SHELL_SKIP)
    }
  }

  const scan = await scanPromise
  const screenshot = scan?.ok ? applyScan(findings, scan.lhr) : null
  // Core Web Vitals from Google (real visitors, else its lab test); the local Lighthouse CLI's lab numbers when installed
  const lab = lighthouseData
    ? { lcp: lighthouseData.lcp, cls: lighthouseData.cls, tbt: lighthouseData.fid, performance: lighthouseData.performance }
    : scan?.ok ? labFromScan(scan.lhr) : null
  findings.push(...checkVitals(scan?.ok ? scan.field : null, lab))

  return {
    url: normalizedUrl,
    finalUrl,
    findings,
    discoveredUrls,
    preview: block ? undefined : readPagePreview($, finalUrl),
    screenshot,
    ...(block ? { blocked: block } : {}),
  }
}
