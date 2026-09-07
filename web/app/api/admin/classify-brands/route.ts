import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules } from '@/lib/db/schema'
import { eq, isNull } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'
import { MODULE_MAP } from '@/lib/modules/registry'

// ── Admin-only endpoint — run once after deploy to classify existing brands ────

const VALID_TYPES = ['saas', 'event', 'ecommerce', 'agency', 'blog', 'local', 'nonprofit', 'portfolio']

async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (BusinessAnalyzerBot/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const $ = cheerio.load(html)
    $('script, style, noscript, svg, iframe, footer, nav').remove()
    const parts: string[] = []
    const title = $('title').first().text().trim()
    if (title) parts.push(`TITLE: ${title}`)
    const metaDesc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || ''
    if (metaDesc) parts.push(`META: ${metaDesc}`)
    $('h1, h2').each((_, el) => {
      const t = $(el).text().trim()
      if (t.length > 3) parts.push(`HEADING: ${t}`)
    })
    $('p').each((_, el) => {
      const t = $(el).text().trim()
      if (t.length > 40) parts.push(t)
    })
    return [...new Set(parts)].join('\n').replace(/\s+/g, ' ').trim().slice(0, 8000)
  } catch {
    return ''
  }
}

async function classifyWebsiteType(url: string): Promise<string> {
  const text = await fetchPageText(url)
  const prompt = text.length > 20
    ? `Website URL: ${url}\n\nEXTRACTED TEXT:\n${text}`
    : `Website URL: ${url}\n\nNo readable text extracted. Infer from URL only.`

  const raw = await callAI({
    system: `You classify websites. Return ONLY one of these slugs (no other text): saas | event | ecommerce | agency | blog | local | nonprofit | portfolio\n\nGuide:\n- saas: software product, SaaS app, developer tool\n- event: conference, summit, hackathon\n- ecommerce: online store, retail, physical products\n- agency: consulting, design/marketing/dev firm\n- blog: blog, newsletter, media/news site\n- local: restaurant, clinic, gym, local service\n- nonprofit: NGO, charity, community org\n- portfolio: personal brand, freelancer, creator`,
    prompt,
    maxTokens: 10,
  })

  const slug = raw.trim().toLowerCase()
  return VALID_TYPES.includes(slug) ? slug : 'saas'
}

export async function POST(request: NextRequest) {
  // Admin auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!adminEmails.includes(user.email ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch all brands without a websiteType
  const unclassified = await db.select().from(brands).where(isNull(brands.websiteType))

  const results: { brandId: string; name: string; websiteType: string; error?: string }[] = []

  for (const brand of unclassified) {
    try {
      const websiteType = await classifyWebsiteType(brand.websiteUrl)
      await db.update(brands).set({ websiteType }).where(eq(brands.id, brand.id))

      // Mark never-analyzed modules as not-applicable if they don't match relevantFor
      const brandModules = await db.select().from(modules).where(eq(modules.brandId, brand.id))
      for (const mod of brandModules) {
        if (mod.lastAnalyzedAt !== null) continue  // don't touch already-run modules
        const def = MODULE_MAP[mod.type]
        if (!def?.relevantFor || def.relevantFor.length === 0) continue
        if (!def.relevantFor.includes(websiteType)) {
          await db.update(modules).set({ status: 'not-applicable' }).where(eq(modules.id, mod.id))
        }
      }

      results.push({ brandId: brand.id, name: brand.name, websiteType })
    } catch (err) {
      results.push({ brandId: brand.id, name: brand.name, websiteType: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ classified: results.length, results })
}
