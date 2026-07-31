import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, keywordSnapshots, trackedKeywords } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'
import * as cheerio from 'cheerio'

export const maxDuration = 90

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  // Gate: SEO module must have been analyzed at least once
  const [seoMod] = await db
    .select({ lastAnalyzedAt: modules.lastAnalyzedAt })
    .from(modules)
    .where(and(eq(modules.brandId, brand.id), eq(modules.type, 'seo')))
    .limit(1)

  if (!seoMod?.lastAnalyzedAt) {
    return NextResponse.json(
      { error: 'Run the SEO audit first — keyword scan needs the SEO analysis to have been completed.' },
      { status: 400 },
    )
  }

  // Fetch the live page directly — get raw title, H1, headings, meta description
  const siteUrl = brand.websiteUrl.startsWith('http') ? brand.websiteUrl : `https://${brand.websiteUrl}`
  let title = ''
  let metaDesc = ''
  let h1 = ''
  let h2s: string[] = []
  let h3s: string[] = []

  try {
    const res = await fetch(siteUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowJinBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      const html = await res.text()
      const $ = cheerio.load(html)
      title = $('title').text().trim()
      metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? ''
      h1 = $('h1').first().text().trim()
      h2s = $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 15)
      h3s = $('h3').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 10)
    }
  } catch {
    // If page fetch fails, fall through to GSC-only path
  }

  let aiKeywords: { keyword: string; intent: string; reason: string }[] = []

  if (title || h1 || h2s.length > 0) {
    // Build factual, unambiguous input — only raw strings, no interpretive text
    const pageContent = [
      title      && `Title tag: "${title}"`,
      metaDesc   && `Meta description: "${metaDesc}"`,
      h1         && `H1: "${h1}"`,
      h2s.length  && `H2 headings: ${h2s.map(h => `"${h}"`).join(' · ')}`,
      h3s.length  && `H3 headings: ${h3s.map(h => `"${h}"`).join(' · ')}`,
    ].filter(Boolean).join('\n')

    const raw = await callAI({
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 600,
      system: 'Extract search keyword phrases from web page elements. Return only valid JSON arrays, nothing else.',
      prompt: `Extract the search keyword phrases this website is already targeting based on its actual page content below.

${pageContent}

Rules:
- Extract 2–6 word keyword phrases that a user would type into Google
- Draw only from the title, H1, and key H2/H3 headings above — do not invent keywords
- Shorten long headings to their core keyword phrase (e.g. "How to schedule social media posts in 5 minutes" → "schedule social media posts")
- Skip generic headings that are section labels, not search queries (e.g. "Features", "Get started", "FAQ")
- Each keyword phrase must be clearly present in the content above

Return JSON array: [{"keyword": "...", "intent": "informational|commercial|transactional", "reason": "found in title|H1|H2|H3"}]
Return ONLY the JSON array.`,
    })

    const start = raw.indexOf('[')
    const end = raw.lastIndexOf(']')
    if (start !== -1 && end !== -1) {
      try {
        aiKeywords = JSON.parse(raw.slice(start, end + 1))
      } catch { /* fall through to GSC-only */ }
    }
  }

  // Also pull from the latest GSC snapshot — real queries people searched and found the site
  const allSnapshots = await db
    .select()
    .from(keywordSnapshots)
    .where(eq(keywordSnapshots.brandId, brand.id))
    .orderBy(asc(keywordSnapshots.fetchedAt))

  let latestBatch: typeof allSnapshots = []
  if (allSnapshots.length > 0) {
    const latestTime = allSnapshots[allSnapshots.length - 1].fetchedAt.toISOString()
    latestBatch = allSnapshots.filter(s => s.fetchedAt.toISOString() === latestTime)
  }

  const gscKeywords = latestBatch
    .filter(s => s.position >= 1 && s.position <= 50)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 30)
    .map(s => ({
      keyword: s.keyword,
      intent: s.position <= 10 ? 'transactional' as const : 'informational' as const,
      reason: `Ranking position ${s.position.toFixed(0)} in GSC with ${s.impressions.toLocaleString()} impressions.`,
    }))

  // Merge — GSC first (lower priority), page extraction overwrites on conflict
  const merged = new Map<string, { keyword: string; intent: string; reason: string }>()
  for (const kw of gscKeywords) {
    merged.set(kw.keyword.toLowerCase(), kw)
  }
  for (const kw of aiKeywords) {
    if (kw.keyword && kw.keyword.trim().length > 3) {
      merged.set(kw.keyword.toLowerCase(), { keyword: kw.keyword, intent: kw.intent, reason: kw.reason })
    }
  }

  const allKeywords = Array.from(merged.values())
  if (allKeywords.length === 0) {
    return NextResponse.json({ count: 0, keywords: [] })
  }

  // Skip keywords already actively tracked or implemented
  const existing = await db
    .select({ keyword: trackedKeywords.keyword, status: trackedKeywords.status })
    .from(trackedKeywords)
    .where(eq(trackedKeywords.brandId, brand.id))

  const alreadyTracked = new Set(
    existing
      .filter(e => e.status === 'tracking' || e.status === 'implemented')
      .map(e => e.keyword.toLowerCase()),
  )

  const toUpsert = allKeywords.filter(k => !alreadyTracked.has(k.keyword.toLowerCase()))
  if (toUpsert.length === 0) {
    return NextResponse.json({ count: 0, keywords: [] })
  }

  const now = new Date()
  await db
    .insert(trackedKeywords)
    .values(toUpsert.map(k => ({
      brandId: brand.id,
      keyword: k.keyword,
      status: 'tracking' as const,
      source: 'site_scan',
      aiReason: k.reason,
      aiIntent: k.intent,
      trackingStartedAt: now,
    })))
    .onConflictDoUpdate({
      target: [trackedKeywords.brandId, trackedKeywords.keyword],
      set: {
        status: 'tracking',
        source: 'site_scan',
        aiReason: sql`EXCLUDED.ai_reason`,
        aiIntent: sql`EXCLUDED.ai_intent`,
        trackingStartedAt: now,
      },
    })

  return NextResponse.json({ count: toUpsert.length, keywords: toUpsert.map(k => k.keyword) })
}
