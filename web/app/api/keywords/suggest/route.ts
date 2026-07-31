import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleItems, trackedKeywords } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'

export const maxDuration = 60

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  // Load SEO module keyword findings for context
  let keywordContext = ''
  const [seoMod] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(and(eq(modules.brandId, brand.id), eq(modules.type, 'seo')))
    .limit(1)

  if (seoMod) {
    const items = await db
      .select({ slug: moduleItems.slug, label: moduleItems.label, aiDetail: moduleItems.aiDetail })
      .from(moduleItems)
      .where(eq(moduleItems.moduleId, seoMod.id))
    const relevant = items.filter(i => i.slug.startsWith('kw-') || i.slug.startsWith('gsc-'))
    if (relevant.length > 0) {
      keywordContext = '\n\nExisting SEO keyword findings:\n' +
        relevant.map(i => `- ${i.label}: ${i.aiDetail ?? 'no data'}`).join('\n')
    }
  }

  const raw = await callAI({
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1200,
    system: 'You are a keyword strategy expert. Return only valid JSON arrays, no other text.',
    prompt: `Suggest 12–15 high-value keywords for this brand to target in their content and SEO strategy.

Brand: ${brand.name}
Website: ${brand.websiteUrl}${brand.industry ? `\nIndustry: ${brand.industry}` : ''}${brand.targetAudience ? `\nTarget audience: ${brand.targetAudience}` : ''}${brand.usp ? `\nUSP: ${brand.usp}` : ''}${keywordContext}

Return a JSON array. Each item must have:
- "keyword": 2–5 word phrase to target (specific, not a broad head term)
- "intent": one of "informational" | "commercial" | "transactional"
- "reason": one sentence explaining why this keyword matters for this brand

Include a mix of intents. Focus on keywords the brand can realistically rank for.
Return ONLY the JSON array, no other text.`,
  })
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1) {
    return NextResponse.json({ error: 'AI returned no suggestions' }, { status: 500 })
  }

  const parsed: { keyword: string; intent: string; reason: string }[] = JSON.parse(raw.slice(start, end + 1))

  // Fetch existing tracked keywords to avoid overwriting non-suggested statuses
  const existing = await db
    .select({ keyword: trackedKeywords.keyword, status: trackedKeywords.status })
    .from(trackedKeywords)
    .where(eq(trackedKeywords.brandId, brand.id))

  const blocked = new Set(
    existing.filter(e => e.status !== 'suggested').map(e => e.keyword.toLowerCase()),
  )

  const toUpsert = parsed.filter(s => !blocked.has(s.keyword.toLowerCase()))

  if (toUpsert.length > 0) {
    await db.insert(trackedKeywords)
      .values(toUpsert.map(s => ({
        brandId: brand.id,
        keyword: s.keyword,
        status: 'suggested' as const,
        source: 'ai_suggested',
        aiReason: s.reason,
        aiIntent: s.intent,
      })))
      .onConflictDoUpdate({
        target: [trackedKeywords.brandId, trackedKeywords.keyword],
        set: {
          aiReason: sql`EXCLUDED.ai_reason`,
          aiIntent: sql`EXCLUDED.ai_intent`,
        },
      })
  }

  const suggestions = await db
    .select()
    .from(trackedKeywords)
    .where(and(eq(trackedKeywords.brandId, brand.id), eq(trackedKeywords.status, 'suggested')))

  return NextResponse.json({ suggestions })
}
