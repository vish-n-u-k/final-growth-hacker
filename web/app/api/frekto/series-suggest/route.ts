import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleItems, competitors, modulePageAudit, brandIntegrations, frektoScheduledPosts } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
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
  const [items, lastPostsByPlatform, topCompetitors, repurposePages, gscInt, posthogInt] = await Promise.all([
    // Failing audit items
    db.select({ label: moduleItems.label, aiDetail: moduleItems.aiDetail })
      .from(moduleItems)
      .where(and(eq(moduleItems.moduleId, moduleId), eq(moduleItems.aiVerified, false)))
      .limit(15),

    // Last scheduled post per platform
    db.select({ platform: frektoScheduledPosts.platform, scheduledAt: frektoScheduledPosts.scheduledAt })
      .from(frektoScheduledPosts)
      .where(eq(frektoScheduledPosts.brandId, brand.id))
      .orderBy(desc(frektoScheduledPosts.scheduledAt))
      .catch(() => []),

    // Top 3 competitors (table may not exist yet — fail gracefully)
    db.select({ name: competitors.name, primaryStrength: competitors.primaryStrength, type: competitors.type })
      .from(competitors)
      .where(eq(competitors.brandId, brand.id))
      .limit(3)
      .catch(() => []),

    // Content audit "Repurpose" pages (module may not be complete — fail gracefully)
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
      })
      .catch(() => []),

    // GSC API integration
    db.select()
      .from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gsc_api'), eq(brandIntegrations.status, 'connected')))
      .limit(1)
      .then(rows => rows[0] ?? null)
      .catch(() => null),

    // PostHog integration
    db.select()
      .from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'posthog'), eq(brandIntegrations.status, 'connected')))
      .limit(1)
      .then(rows => rows[0] ?? null)
      .catch(() => null),
  ])

  // Fetch PostHog user count if connected
  let appUserCount: number | null = null
  if (posthogInt?.apiKey) {
    try {
      const meta = (posthogInt.metadata as Record<string, string> | null) ?? {}
      const projectId = meta['project_id']
      const host = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')
      if (projectId) {
        const res = await fetch(`${host}/api/projects/${projectId}/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${posthogInt.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: { kind: 'HogQLQuery', query: 'SELECT count() FROM persons' } }),
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          const data = await res.json() as { results?: number[][] }
          appUserCount = data.results?.[0]?.[0] ?? null
        }
      }
    } catch { /* fail silently */ }
  }

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

  // Compute last scheduled date per platform
  const lastDateByPlatform: Record<string, Date> = {}
  for (const row of lastPostsByPlatform) {
    if (!lastDateByPlatform[row.platform] && row.scheduledAt) {
      lastDateByPlatform[row.platform] = row.scheduledAt
    }
  }

  // Cadence → valid weekdays (0=Sun … 6=Sat)
  const cadenceDays: Record<string, number[]> = {
    mwf:      [1, 3, 5],
    linkedin: [2, 3, 4],
    weekdays: [1, 2, 3, 4, 5],
    daily:    [0, 1, 2, 3, 4, 5, 6],
    weekly:   [5], // Friday
  }
  const platformCadence: Record<string, string> = {
    instagram: 'mwf',
    linkedin:  'linkedin',
    twitter:   'weekdays',
    facebook:  'mwf',
    youtube:   'weekly',
    tiktok:    'daily',
  }
  const platformFormat: Record<string, { cadence: string; format: string; outputFormat: string }> = {
    instagram: { cadence: 'mwf',      format: '4:5', outputFormat: 'mp4' },
    linkedin:  { cadence: 'linkedin', format: '1:1', outputFormat: 'png' },
    twitter:   { cadence: 'weekdays', format: '1:1', outputFormat: 'png' },
    facebook:  { cadence: 'mwf',      format: '1:1', outputFormat: 'png' },
    youtube:   { cadence: 'weekly',   format: '16:9', outputFormat: 'mp4' },
    tiktok:    { cadence: 'daily',    format: '9:16', outputFormat: 'mp4' },
  }

  const ALL_PLATFORMS = ['instagram', 'linkedin', 'twitter', 'facebook', 'youtube', 'tiktok']

  function nextCadenceDate(platform: string): string {
    const cadence = platformCadence[platform] ?? 'mwf'
    const days = cadenceDays[cadence] ?? [1, 3, 5]
    const base = lastDateByPlatform[platform]
      ? new Date(Math.max(Date.now(), lastDateByPlatform[platform].getTime()))
      : new Date()
    const d = new Date(base)
    d.setDate(d.getDate() + 1)
    for (let i = 0; i < 14; i++) {
      if (days.includes(d.getDay())) return d.toISOString().slice(0, 10)
      d.setDate(d.getDate() + 1)
    }
    return d.toISOString().slice(0, 10)
  }

  const startDates = Object.fromEntries(ALL_PLATFORMS.map(p => [p, nextCadenceDate(p)]))

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
  const userCountStr = appUserCount !== null ? `\nCurrent app user count: ${appUserCount.toLocaleString()} users` : ''

  const prompt = `Brand: ${brand.name}
Website: ${brand.websiteUrl}
Industry: ${brand.industry ?? 'infer from website'}
Target audience: ${brand.targetAudience ?? 'infer from brand context'}${brand.usp ? `\nUSP: ${brand.usp}` : ''}${brand.brandVoice ? `\nBrand voice: ${brand.brandVoice}` : ''}${brand.keywords ? `\nCore keywords: ${brand.keywords}` : ''}${userCountStr}${playbookStr}${competitorsSection}${repurposeSection}${gscSection}

Current audit findings (areas to improve):
${findingsList}

Evaluate all 6 platforms for this brand and decide which ones are worth posting on based on their industry, audience, and stage.

Platform specs and suggested start dates:
- instagram:  cadence=mwf,      format=4:5,  output=mp4, startDate=${startDates.instagram}
- linkedin:   cadence=linkedin, format=1:1,  output=png, startDate=${startDates.linkedin}
- twitter:    cadence=weekdays, format=1:1,  output=png, startDate=${startDates.twitter}
- facebook:   cadence=mwf,      format=1:1,  output=png, startDate=${startDates.facebook}
- youtube:    cadence=weekly,   format=16:9, output=mp4, startDate=${startDates.youtube}
- tiktok:     cadence=daily,    format=9:16, output=mp4, startDate=${startDates.tiktok}

For each platform return:
1. shouldPost — true/false. Set false if the platform clearly doesn't suit this brand's industry or audience.
2. If shouldPost true:
   - instruction — compelling 1-2 sentence series brief (max 400 chars). Prioritise repurpose pages, GSC keywords, competitor gaps, brand voice.
   - count — recommended posts: 2-5
   - cadence, format, outputFormat, startDate — use the values above exactly
   - reason — array of exactly 3 bullet strings:
     "**Platform:** <why this platform suits the brand — max 12 words>"
     "**Posts:** <why this count and cadence — max 12 words>"
     "**Brief:** <why this content direction, cite data sources — max 15 words>"
     Each must start with the bold label (double asterisks).
3. If shouldPost false: set instruction="", count=0, cadence="", format="", outputFormat="", startDate="", reason=[]

Return a JSON array of exactly 6 objects in this order: instagram, linkedin, twitter, facebook, youtube, tiktok

[
  {
    "platform": "instagram",
    "shouldPost": true,
    "instruction": "series brief here",
    "count": 3,
    "cadence": "mwf",
    "format": "4:5",
    "outputFormat": "mp4",
    "startDate": "${startDates.instagram}",
    "reason": ["**Platform:** reason here", "**Posts:** reason here", "**Brief:** reason here"]
  }
]`

  let raw: string
  try {
    raw = await callAI({
      system: 'You are a social media strategist. Return only a valid JSON array, no markdown fences, no text outside the array.',
      prompt,
      maxTokens: 2500,
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
