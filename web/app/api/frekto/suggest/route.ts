import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleItems, frektoScheduledPosts, competitors, modulePageAudit, brandIntegrations } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'
import { fetchGscTopQueries } from '@/lib/modules/seo/keyword-fetchers'

export const maxDuration = 90

const PLATFORMS = ['instagram', 'linkedin', 'twitter', 'facebook', 'youtube', 'tiktok']

const PLATFORM_SLOTS: Record<string, { day: number; hour: number }[]> = {
  instagram: [{ day: 2, hour: 10 }, { day: 3, hour: 10 }, { day: 5, hour: 10 }],
  linkedin:  [{ day: 2, hour: 9  }, { day: 3, hour: 9  }, { day: 4, hour: 9  }],
  twitter:   [{ day: 2, hour: 10 }, { day: 3, hour: 10 }, { day: 4, hour: 10 }],
  facebook:  [{ day: 2, hour: 13 }, { day: 3, hour: 13 }, { day: 4, hour: 13 }],
  youtube:   [{ day: 5, hour: 12 }, { day: 6, hour: 12 }],
  tiktok:    [{ day: 2, hour: 18 }, { day: 4, hour: 18 }, { day: 5, hour: 18 }],
}

function getNextSlot(platform: string): string {
  const now = new Date()
  const slots = PLATFORM_SLOTS[platform] ?? [{ day: 2, hour: 10 }]
  for (let i = 0; i < 14; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    const slot = slots.find(s => s.day === d.getDay())
    if (slot) {
      d.setHours(slot.hour, 0, 0, 0)
      if (d > now) return d.toISOString()
    }
  }
  const fallback = new Date(now)
  fallback.setDate(fallback.getDate() + 1)
  fallback.setHours(10, 0, 0, 0)
  return fallback.toISOString()
}

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
  const [items, allScheduled, topCompetitors, repurposePages, gscInt] = await Promise.all([
    // Failing audit items
    db.select({ label: moduleItems.label, aiDetail: moduleItems.aiDetail })
      .from(moduleItems)
      .where(and(eq(moduleItems.moduleId, moduleId), eq(moduleItems.aiVerified, false)))
      .limit(15),

    // Last scheduled post per platform
    db.select({ platform: frektoScheduledPosts.platform, scheduledAt: frektoScheduledPosts.scheduledAt })
      .from(frektoScheduledPosts)
      .where(eq(frektoScheduledPosts.brandId, brand.id))
      .orderBy(desc(frektoScheduledPosts.scheduledAt)),

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

  // Fetch GSC page-2 keywords if connected (positions 8–20 = quick wins)
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

  const lastByPlatform: Record<string, string> = {}
  for (const row of allScheduled) {
    if (!lastByPlatform[row.platform] && row.scheduledAt) {
      lastByPlatform[row.platform] = row.scheduledAt.toISOString()
    }
  }

  const findingsList = items.length > 0
    ? items.map(i => `- ${i.label}${i.aiDetail ? `: ${i.aiDetail}` : ''}`).join('\n')
    : 'No major issues found — brand appears to be in good standing.'

  const lastPostsStr = PLATFORMS.map(p => {
    const last = lastByPlatform[p]
    return `- ${p}: ${last ? `last posted ${new Date(last).toDateString()}` : 'never posted'}`
  }).join('\n')

  const suggestedTimesStr = PLATFORMS.map(p => `- ${p}: ${getNextSlot(p)}`).join('\n')

  const competitorsSection = topCompetitors.length > 0
    ? `\nTop competitors:\n${topCompetitors.map(c => `- ${c.name ?? 'Unknown'} (${c.type ?? 'competitor'}): main strength = ${c.primaryStrength ?? 'unknown'}`).join('\n')}`
    : ''

  const repurposeSection = repurposePages.length > 0
    ? `\nPages marked for repurposing (prioritize turning these into social posts):\n${repurposePages.map(p => `- ${p.title ?? p.url}`).join('\n')}`
    : ''

  const gscSection = gscPage2Keywords.length > 0
    ? `\nGSC page-2 keywords (high opportunity — ranking positions 8–20):\n${gscPage2Keywords.map(k => `- ${k}`).join('\n')}`
    : ''

  const playbookStr = brand.playbook ? `\nBrand playbook summary: ${JSON.stringify(brand.playbook).slice(0, 400)}` : ''

  const prompt = `Brand: ${brand.name}
Website: ${brand.websiteUrl}
Industry: ${brand.industry ?? 'infer from website'}
Target audience: ${brand.targetAudience ?? 'infer from brand context'}${brand.usp ? `\nUSP: ${brand.usp}` : ''}${brand.brandVoice ? `\nBrand voice: ${brand.brandVoice}` : ''}${brand.keywords ? `\nCore keywords: ${brand.keywords}` : ''}${playbookStr}${competitorsSection}${repurposeSection}${gscSection}

Current audit findings (areas to improve):
${findingsList}

Posting history:
${lastPostsStr}

Suggested next posting times (UTC):
${suggestedTimesStr}

Generate ONE post suggestion per platform. For each:
1. shouldPost true/false — is this platform worth the brand's time given their industry and audience?
2. If shouldPost true: a specific, compelling topic tied to the brand's actual industry and audience. Prioritize repurpose pages if listed. Weave in a GSC page-2 keyword if relevant and natural.
3. postType "image" or "video" — video for TikTok/YouTube/Reels, image for LinkedIn/Facebook
4. scheduledAt — use the suggested time above
5. reason — one sentence. If a competitor strength is relevant, explain how this post counters it. If brand voice is defined, the topic should reflect it.

Return a JSON array of exactly 6 objects in this order: instagram, linkedin, twitter, facebook, youtube, tiktok

[
  {
    "platform": "instagram",
    "shouldPost": true,
    "topic": "specific compelling topic here",
    "postType": "video",
    "scheduledAt": "2026-07-16T10:00:00.000Z",
    "reason": "one sentence reason"
  }
]`

  let raw: string
  try {
    raw = await callAI({
      system: 'You are a social media strategist. Return only a valid JSON array, no markdown fences, no text outside the array.',
      prompt,
      maxTokens: 1500,
      model: 'claude-haiku-4-5-20251001',
    })
  } catch (e) {
    console.error('[suggest] callAI failed:', e)
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
