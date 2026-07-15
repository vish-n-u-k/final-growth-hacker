import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleItems, competitors, modulePageAudit, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'
import { fetchGscTopQueries } from '@/lib/modules/seo/keyword-fetchers'

export const maxDuration = 90

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { moduleId } = await request.json() as { moduleId: string }
  if (!moduleId) return NextResponse.json({ error: 'moduleId is required' }, { status: 400 })

  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId)).limit(1)
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId)).limit(1)
  if (!brand || brand.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Fetch all enrichment data in parallel
  const [items, topCompetitors, repurposePages, gscInt] = await Promise.all([
    // Failing audit items
    db.select({ label: moduleItems.label, aiDetail: moduleItems.aiDetail })
      .from(moduleItems)
      .where(and(eq(moduleItems.moduleId, moduleId), eq(moduleItems.aiVerified, false)))
      .limit(15),

    // Top 3 competitors
    db.select({ name: competitors.name, primaryStrength: competitors.primaryStrength, type: competitors.type })
      .from(competitors)
      .where(eq(competitors.brandId, brand.id))
      .limit(3),

    // Content audit "Repurpose" pages
    db.select({ id: modules.id })
      .from(modules)
      .where(and(eq(modules.brandId, brand.id), eq(modules.type, 'content-audit'), eq(modules.status, 'complete')))
      .limit(1)
      .then(async ([contentMod]) => {
        if (!contentMod) return []
        return db.select({ url: modulePageAudit.url, title: modulePageAudit.title })
          .from(modulePageAudit)
          .where(and(eq(modulePageAudit.moduleId, contentMod.id), eq(modulePageAudit.verdict, 'Repurpose')))
          .limit(5)
      }),

    // GSC API integration
    db.select()
      .from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gsc_api'), eq(brandIntegrations.status, 'connected')))
      .limit(1)
      .then(rows => rows[0] ?? null),
  ])

  // Fetch GSC page-2 keywords if connected
  let gscPage2Keywords: string[] = []
  if (gscInt?.metadata) {
    const meta = gscInt.metadata as Record<string, string>
    if (meta.client_email && meta.private_key) {
      const rows = await fetchGscTopQueries(meta.client_email, meta.private_key, brand.websiteUrl)
      gscPage2Keywords = rows
        .filter(r => r.position >= 8 && r.position <= 20)
        .map(r => `${r.query} (pos ${r.position.toFixed(1)}, ${r.impressions} impressions)`)
        .slice(0, 8)
    }
  }

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  const findingsList = items.length > 0
    ? items.map(i => `- ${i.label}${i.aiDetail ? `: ${i.aiDetail}` : ''}`).join('\n')
    : 'No major issues found — brand appears to be in good standing.'

  const competitorsSection = topCompetitors.length > 0
    ? `\nTop competitors:\n${topCompetitors.map(c => `- ${c.name ?? 'Unknown'} (${c.type ?? 'competitor'}): main strength = ${c.primaryStrength ?? 'unknown'}`).join('\n')}`
    : ''

  const repurposeSection = repurposePages.length > 0
    ? `\nPages marked for repurposing (strong candidates for a content series):\n${repurposePages.map(p => `- ${p.title ?? p.url}`).join('\n')}`
    : ''

  const gscSection = gscPage2Keywords.length > 0
    ? `\nGSC page-2 keywords (positions 8–20 — high-opportunity topics):\n${gscPage2Keywords.map(k => `- ${k}`).join('\n')}`
    : ''

  const playbookStr = brand.playbook ? `\nBrand playbook: ${JSON.stringify(brand.playbook).slice(0, 400)}` : ''

  const prompt = `Brand: ${brand.name}
Website: ${brand.websiteUrl}
Industry: ${brand.industry ?? 'infer from website'}
Target audience: ${brand.targetAudience ?? 'infer from brand context'}${brand.usp ? `\nUSP: ${brand.usp}` : ''}${brand.brandVoice ? `\nBrand voice: ${brand.brandVoice}` : ''}${brand.keywords ? `\nCore keywords: ${brand.keywords}` : ''}${playbookStr}${competitorsSection}${repurposeSection}${gscSection}

Current audit findings (areas to improve):
${findingsList}

Generate a content series brief for each of these 3 platforms: instagram, linkedin, twitter.

For each platform:
1. instruction — a compelling 1-2 sentence brief (max 400 chars) for a content series. If repurpose pages are listed, base one series on repurposing that content. If GSC page-2 keywords exist, weave the most relevant one into the brief. If brand voice is defined, reflect it in the tone. If a competitor's strength is listed, consider a series that counters it.
2. count — recommended number of posts: 2-5
3. cadence — "linkedin" for linkedin, "mwf" for instagram, "weekdays" for twitter
4. format — "4:5" for instagram, "1:1" for linkedin and twitter
5. outputFormat — "mp4" for instagram, "png" for linkedin and twitter
6. startDate — "${tomorrowStr}"

Return a JSON array of exactly 3 objects in this order: instagram, linkedin, twitter

[
  {
    "platform": "instagram",
    "instruction": "series brief here",
    "count": 3,
    "cadence": "mwf",
    "format": "4:5",
    "outputFormat": "mp4",
    "startDate": "${tomorrowStr}"
  }
]`

  let raw: string
  try {
    raw = await callAI({
      system: 'You are a social media strategist. Return only a valid JSON array, no markdown fences, no text outside the array.',
      prompt,
      maxTokens: 1000,
      model: 'claude-haiku-4-5-20251001',
    })
  } catch (e) {
    console.error('[series-suggest] callAI failed:', e)
    return NextResponse.json({ error: `AI call failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }

  let suggestions: unknown[]
  try {
    suggestions = parseClaudeJsonArray(raw)
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI suggestions. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ suggestions })
}
