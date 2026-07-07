import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'

export const maxDuration = 15

export interface SiteCheckResult {
  isJsRendered: boolean
  severity: 'success' | 'warning' | 'info'
  title: string
  message: string
}

async function safeFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'GrowthHackerBot/1.0 (Site Checker)' },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

function detectSite(html: string, url: string): SiteCheckResult {
  const $ = cheerio.load(html)

  // Collect script srcs
  const scriptSrcs: string[] = []
  $('script').each((_, el) => { scriptSrcs.push($(el).attr('src') ?? '') })
  const srcs = scriptSrcs.join(' ')

  const generator = $('meta[name="generator"]').attr('content') ?? ''

  // Measure body content after stripping noise
  $('script, style, svg, noscript').remove()
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
  const linkCount = $('a').length
  const isBodyEmpty = bodyText.length < 150 && linkCount < 8

  // ── Platform detection ────────────────────────────────────────────────────

  // WordPress
  if (generator.toLowerCase().includes('wordpress') || srcs.includes('wp-content/') || srcs.includes('wp-includes/')) {
    return {
      isJsRendered: false,
      severity: 'success',
      title: 'WordPress detected',
      message: 'Full analysis supported. All checks will run accurately.',
    }
  }

  // Shopify
  if (srcs.includes('cdn.shopify.com') || url.includes('.myshopify.com')) {
    return {
      isJsRendered: false,
      severity: 'success',
      title: 'Shopify detected',
      message: 'Full analysis supported. All checks will run accurately.',
    }
  }

  // Squarespace
  if (srcs.includes('squarespace.com') || generator.toLowerCase().includes('squarespace')) {
    return {
      isJsRendered: false,
      severity: 'success',
      title: 'Squarespace detected',
      message: 'Full analysis supported. All checks will run accurately.',
    }
  }

  // Webflow
  if (srcs.includes('webflow.com') || srcs.includes('assets.website-files.com')) {
    return {
      isJsRendered: false,
      severity: 'success',
      title: 'Webflow detected',
      message: 'Full analysis supported. All checks will run accurately.',
    }
  }

  // Wix
  if (srcs.includes('wixstatic.com') || srcs.includes('wix.com')) {
    return {
      isJsRendered: false,
      severity: 'info',
      title: 'Wix detected',
      message: 'Most checks will work. A few page-existence checks may be less accurate due to how Wix renders links.',
    }
  }

  // Framer
  if (srcs.includes('framerusercontent.com') || srcs.includes('events.framer.com')) {
    return {
      isJsRendered: isBodyEmpty,
      severity: isBodyEmpty ? 'warning' : 'info',
      title: 'Framer detected',
      message: isBodyEmpty
        ? 'Framer renders pages via JavaScript. Checks for privacy policy, contact page, and body content may show as missing even if they exist in your UI.'
        : 'Framer detected. Most checks will work correctly.',
    }
  }

  // Angular
  if ($('app-root').length > 0 || srcs.includes('angular')) {
    return {
      isJsRendered: true,
      severity: 'warning',
      title: 'Angular app detected',
      message: 'Angular renders content client-side. Page detection and content quality checks may be inaccurate. Meta tags and analytics will still be read correctly.',
    }
  }

  // Nuxt (Vue SSR)
  if ($('[id="__nuxt"]').length > 0 || srcs.includes('/_nuxt/')) {
    return {
      isJsRendered: isBodyEmpty,
      severity: isBodyEmpty ? 'warning' : 'success',
      title: isBodyEmpty ? 'Nuxt.js (client-only) detected' : 'Nuxt.js detected',
      message: isBodyEmpty
        ? 'Your Nuxt site appears to be client-side rendered. Page detection and content quality checks may be inaccurate.'
        : 'Nuxt.js with server-side rendering detected. Full analysis supported.',
    }
  }

  // Vue CSR
  if ($('[id="app"]').length > 0 && (srcs.includes('vue') || isBodyEmpty)) {
    return {
      isJsRendered: true,
      severity: 'warning',
      title: 'Vue.js app detected',
      message: 'Vue renders content client-side. Page detection and content quality checks may be inaccurate. Meta tags and analytics will still be read correctly.',
    }
  }

  // React CRA
  if ($('[id="root"]').length > 0 && (srcs.includes('/static/js/') || isBodyEmpty)) {
    return {
      isJsRendered: true,
      severity: 'warning',
      title: 'React app detected',
      message: 'React renders content client-side. Page detection and content quality checks may be inaccurate. Meta tags and analytics will still be read correctly.',
    }
  }

  // Next.js — check SSR vs CSR
  if (srcs.includes('/_next/static/') || $('[id="__next"]').length > 0) {
    if (isBodyEmpty) {
      return {
        isJsRendered: true,
        severity: 'warning',
        title: 'Next.js (client-side) detected',
        message: 'Your Next.js site renders content via JavaScript. Checks for privacy policy, contact page, and body content may show as missing even if they exist in your UI.',
      }
    }
    return {
      isJsRendered: false,
      severity: 'success',
      title: 'Next.js (server-rendered) detected',
      message: 'Your site uses server-side rendering. Full analysis supported — all checks will run accurately.',
    }
  }

  // Generic JS-rendered (empty body, no specific framework matched)
  if (isBodyEmpty) {
    return {
      isJsRendered: true,
      severity: 'warning',
      title: 'JavaScript-rendered site detected',
      message: 'Your site renders content via JavaScript. Page detection and content quality checks may be inaccurate. Meta tags and analytics in the <head> will still be read correctly.',
    }
  }

  // Static or SSR — looks good
  return {
    isJsRendered: false,
    severity: 'success',
    title: 'Site looks good',
    message: 'Full analysis supported. All Foundation checks will run accurately.',
  }
}

export async function POST(request: NextRequest) {
  const { websiteUrl } = await request.json() as { websiteUrl: string }
  if (!websiteUrl) return NextResponse.json({ error: 'Missing URL' }, { status: 400 })

  const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  const html = await safeFetch(url)

  if (!html) {
    return NextResponse.json({
      isJsRendered: false,
      severity: 'info',
      title: 'Could not reach site',
      message: 'We could not load your site right now. If it is live, the analysis will still run.',
    } satisfies SiteCheckResult)
  }

  return NextResponse.json(detectSite(html, url) satisfies SiteCheckResult)
}
