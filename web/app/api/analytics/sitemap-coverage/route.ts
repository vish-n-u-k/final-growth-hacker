import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UA = 'Mozilla/5.0 (compatible; GrowJinBot/1.0; +https://growthhacker.app)'

async function safeFetch(url: string, ms = 8000): Promise<{ text: string; status: number } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(ms),
      redirect: 'follow',
    })
    const text = await res.text()
    return { text, status: res.status }
  } catch {
    return null
  }
}

function normalize(url: string): string {
  try {
    const u = new URL(url)
    // strip www. so https://www.foo.com/bar === https://foo.com/bar
    const host = u.hostname.replace(/^www\./, '')
    return `${u.protocol}//${host}${u.pathname.replace(/\/$/, '').toLowerCase()}`
  } catch {
    return url.toLowerCase().replace(/\/$/, '')
  }
}

/** Returns the bare hostname without www. for same-site checks */
function bareHost(origin: string): string {
  try { return new URL(origin).hostname.replace(/^www\./, '') } catch { return origin }
}

// Parse all <loc> values — no strict origin check (sitemaps only contain own URLs)
function parseLocs(xml: string): string[] {
  const urls: string[] = []
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi
  let m
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1].replace(/&amp;/g, '&').trim()
    if (raw) urls.push(raw)
  }
  return urls
}

function extractChildSitemaps(indexXml: string): string[] {
  const urls: string[] = []
  const blockRe = /<sitemap>[\s\S]*?<\/sitemap>/gi
  let block
  while ((block = blockRe.exec(indexXml)) !== null) {
    const loc = /<loc>\s*([^<]+)\s*<\/loc>/i.exec(block[0])
    if (loc) {
      const url = loc[1].replace(/&amp;/g, '&').trim()
      if (url && !url.endsWith('.gz')) urls.push(url)
    }
  }
  return urls
}

async function fetchSitemapUrls(
  origin: string,
): Promise<{ urls: string[]; status: number }> {
  const result = await safeFetch(`${origin}/sitemap.xml`)
  if (!result) return { urls: [], status: 0 }
  if (result.status !== 200) return { urls: [], status: result.status }

  const xml = result.text

  if (/<sitemapindex/i.test(xml)) {
    const children = extractChildSitemaps(xml).slice(0, 5)
    const childResults = await Promise.all(children.map(u => safeFetch(u, 5000)))
    const all: string[] = []
    for (const cr of childResults) {
      if (cr?.status === 200) all.push(...parseLocs(cr.text))
      if (all.length >= 500) break
    }
    return { urls: all.slice(0, 500), status: 200 }
  }

  return { urls: parseLocs(xml).slice(0, 500), status: 200 }
}

const SKIP_EXTS = new Set(['jpg','jpeg','png','gif','svg','webp','ico','pdf','zip','css','js','xml','json','woff','woff2','ttf','mp4','mp3','mov'])

function extractInternalLinks(html: string, origin: string): string[] {
  const seen = new Set<string>()
  const host = bareHost(origin)
  const re = /href=["']([^"']+)["']/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim()
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue
    try {
      const resolved = new URL(href, origin + '/')
      // Accept same bare host (handles www <-> non-www)
      if (bareHost(resolved.origin) !== host) continue
      const ext = resolved.pathname.split('.').pop()?.toLowerCase() ?? ''
      if (SKIP_EXTS.has(ext)) continue
      resolved.search = ''
      resolved.hash = ''
      const norm = resolved.href.replace(/\/$/, '') || origin
      seen.add(norm)
    } catch { /* skip */ }
  }
  return Array.from(seen)
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandIdParam = request.nextUrl.searchParams.get('brandId')
  const [brand] = brandIdParam
    ? await db.select().from(brands).where(and(eq(brands.id, brandIdParam), eq(brands.userId, user.id))).limit(1)
    : await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const websiteUrl = brand.websiteUrl
  let origin: string
  try {
    origin = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`).origin
  } catch {
    return NextResponse.json({ error: 'Invalid website URL' }, { status: 400 })
  }

  const [homepageResult, { urls: sitemapUrls, status: sitemapStatus }] = await Promise.all([
    safeFetch(origin, 10000),
    fetchSitemapUrls(origin),
  ])

  const internalLinks = homepageResult?.status === 200
    ? extractInternalLinks(homepageResult.text, origin)
    : []

  const sitemapSet = new Set(sitemapUrls.map(normalize))

  const missing: string[] = []
  const covered: string[] = []
  for (const link of internalLinks) {
    if (sitemapSet.has(normalize(link))) covered.push(link)
    else missing.push(link)
  }

  return NextResponse.json({
    websiteUrl,
    sitemapStatus,
    sitemapCount: sitemapUrls.length,
    internalLinkCount: internalLinks.length,
    missing,
    covered,
    sitemapUrls,
  })
}
