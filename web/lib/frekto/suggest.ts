import { db } from '@/lib/db'
import { brands, modules, moduleItems, moduleCategories, competitors, modulePageAudit, brandIntegrations, socialSuggestions } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'
import { fetchGscTopQueries } from '@/lib/modules/seo/keyword-fetchers'
import { PUBLISHABLE_PLATFORMS, getPostingContext, avoidTopicsBlock, isRepeatTopic, replaceOpenSuggestions, expireStaleSuggestions, type PostingContext } from '@/lib/frekto/history'

export const PLATFORM_SLOTS: Record<string, { day: number; hour: number }[]> = {
  instagram: [{ day: 2, hour: 10 }, { day: 3, hour: 10 }, { day: 5, hour: 10 }],
  linkedin:  [{ day: 2, hour: 9  }, { day: 3, hour: 9  }, { day: 4, hour: 9  }],
  twitter:   [{ day: 2, hour: 10 }, { day: 3, hour: 10 }, { day: 4, hour: 10 }],
  facebook:  [{ day: 2, hour: 13 }, { day: 3, hour: 13 }, { day: 4, hour: 13 }],
  youtube:   [{ day: 5, hour: 12 }, { day: 6, hour: 12 }],
  tiktok:    [{ day: 2, hour: 18 }, { day: 4, hour: 18 }, { day: 5, hour: 18 }],
}

export function getNextSlot(platform: string): string {
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

export interface PostSuggestion {
  id?: string // set once saved to social_suggestions
  platform: string
  shouldPost: boolean
  topic: string
  postType: string
  scheduledAt: string
  reason: string
}

const PLATFORMS: readonly string[] = PUBLISHABLE_PLATFORMS

export async function generatePostSuggestions(params: {
  brand: typeof brands.$inferSelect
  moduleId: string
}): Promise<PostSuggestion[]> {
  const { brand, moduleId } = params

  const [items, history, topCompetitors, repurposePages, gscInt, posthogInt, socialStrategyItems] = await Promise.all([
    db.select({ label: moduleItems.label, aiDetail: moduleItems.aiDetail })
      .from(moduleItems)
      .where(and(eq(moduleItems.moduleId, moduleId), eq(moduleItems.aiVerified, false)))
      .limit(15),

    getPostingContext(brand.id),

    db.select({ name: competitors.name, primaryStrength: competitors.primaryStrength, type: competitors.type })
      .from(competitors)
      .where(eq(competitors.brandId, brand.id))
      .limit(3)
      .catch(() => []),

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

    db.select()
      .from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gsc_api'), eq(brandIntegrations.status, 'connected')))
      .limit(1)
      .then(rows => rows[0] ?? null)
      .catch(() => null),

    db.select()
      .from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'posthog'), eq(brandIntegrations.status, 'connected')))
      .limit(1)
      .then(rows => rows[0] ?? null)
      .catch(() => null),

    db.select({ id: modules.id })
      .from(modules)
      .where(and(eq(modules.brandId, brand.id), eq(modules.type, 'social-media'), eq(modules.status, 'complete')))
      .limit(1)
      .then(async ([socialMod]) => {
        if (!socialMod) return []
        const cats = await db.select({ id: moduleCategories.id })
          .from(moduleCategories)
          .where(and(
            eq(moduleCategories.moduleId, socialMod.id),
            inArray(moduleCategories.slug, ['content-strategy', 'growth-playbook']),
          ))
        if (cats.length === 0) return []
        return db.select({ label: moduleItems.label, aiDetail: moduleItems.aiDetail, aiAction: moduleItems.aiAction })
          .from(moduleItems)
          .where(inArray(moduleItems.categoryId, cats.map(c => c.id)))
          .limit(20)
      })
      .catch(() => []),
  ])

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

  const lastByPlatform: Record<string, string> = Object.fromEntries(
    Object.entries(history.lastByPlatform).map(([p, d]) => [p, d.toISOString()]),
  )

  const findingsList = items.length > 0
    ? items.map(i => `- ${i.label}${i.aiDetail ? `: ${i.aiDetail}` : ''}`).join('\n')
    : 'No major issues found — brand appears to be in good standing.'

  const lastPostsStr = PLATFORMS.map(p => {
    const last = lastByPlatform[p]
    const upcoming = history.upcomingByPlatform[p]
    return `- ${p}: ${upcoming ? `already has a post queued for ${upcoming.toDateString()}` : last ? `last posted ${new Date(last).toDateString()}` : 'never posted'}`
  }).join('\n')

  const suggestedTimesStr = PLATFORMS.map(p => `- ${p}: ${getNextSlot(p)}`).join('\n')

  const competitorsSection = topCompetitors.length > 0
    ? `\nTop competitors:\n${topCompetitors.map(c => `- ${c.name ?? 'Unknown'} (${c.type ?? 'competitor'}): main strength = ${c.primaryStrength ?? 'unknown'}`).join('\n')}`
    : ''

  const repurposeSection = repurposePages.length > 0
    ? `\nPages marked for repurposing:\n${repurposePages.map(p => `- ${p.title ?? p.url}`).join('\n')}`
    : ''

  const gscSection = gscPage2Keywords.length > 0
    ? `\nGSC page-2 keywords (positions 8–20):\n${gscPage2Keywords.map(k => `- ${k}`).join('\n')}`
    : ''

  const playbookStr = brand.playbook ? `\nBrand playbook summary: ${JSON.stringify(brand.playbook).slice(0, 400)}` : ''
  const userCountStr = appUserCount !== null ? `\nCurrent app user count: ${appUserCount.toLocaleString()} users` : ''

  const socialStrategySection = socialStrategyItems.length > 0
    ? `\nContent strategy & growth playbook from Social Media Audit:\n${socialStrategyItems.map(i => `- ${i.label}${i.aiDetail ? `: ${i.aiDetail}` : ''}${i.aiAction ? ` → ${i.aiAction}` : ''}`).join('\n')}`
    : ''

  const prompt = `Brand: ${brand.name}
Website: ${brand.websiteUrl}
Industry: ${brand.industry ?? 'infer from website'}
Target audience: ${brand.targetAudience ?? 'infer from brand context'}${brand.usp ? `\nUSP: ${brand.usp}` : ''}${brand.brandVoice ? `\nBrand voice: ${brand.brandVoice}` : ''}${brand.keywords ? `\nCore keywords: ${brand.keywords}` : ''}${userCountStr}${playbookStr}${competitorsSection}${repurposeSection}${gscSection}${socialStrategySection}

Current audit findings (areas to improve):
${findingsList}

Posting history:
${lastPostsStr}${avoidTopicsBlock(history)}

Suggested next posting times (UTC):
${suggestedTimesStr}

Generate ONE post suggestion per platform. For each:
1. shouldPost true/false — is this platform worth the brand's time given their industry and audience?
2. If shouldPost true: a specific, compelling topic tied to the brand's actual industry and audience. If content strategy pillars are listed above, the topic MUST map to one of those pillars — name which pillar it maps to in the reason. Prioritize repurpose pages if listed. Weave in a GSC page-2 keyword if relevant and natural.
3. postType "image" or "video" — video for YouTube/Instagram Reels, image for LinkedIn/Facebook
4. scheduledAt — use the suggested time above
5. reason — one sentence. State which content pillar this maps to (if pillars exist). If a competitor strength is relevant, explain how this post counters it.

Return a JSON array of exactly ${PLATFORMS.length} objects in this order: ${PLATFORMS.join(', ')}

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

  const raw = await callAI({
    system: 'You are a social media strategist. Return only a valid JSON array, no markdown fences, no text outside the array.',
    prompt,
    maxTokens: 1500,
    model: 'claude-haiku-4-5-20251001',
  })

  return applyHistory(parseClaudeJsonArray(raw) as PostSuggestion[], history)
}

// Drop unsupported platforms, and turn off any platform that already has a post coming
// up or whose topic repeats something already posted/rejected.
function applyHistory(suggestions: PostSuggestion[], history: PostingContext): PostSuggestion[] {
  return suggestions
    .filter((s) => PLATFORMS.includes(s.platform))
    .map((s) => {
      if (!s.shouldPost) return s
      const upcoming = history.upcomingByPlatform[s.platform]
      if (upcoming) return { ...s, shouldPost: false, reason: `Already has a post queued for ${upcoming.toDateString()}.` }
      if (isRepeatTopic(s.topic, history)) return { ...s, shouldPost: false, reason: 'Same topic as a post you already made or turned down.' }
      return s
    })
}

// Save a batch so it survives a refresh and can only be scheduled once. Replaces the
// previous unanswered batch. Returns the suggestions with their ids.
export async function savePostSuggestions(brandId: string, suggestions: PostSuggestion[], source: 'studio' | 'auto' = 'studio'): Promise<PostSuggestion[]> {
  await expireStaleSuggestions(brandId)
  if (source === 'studio') await replaceOpenSuggestions(brandId, 'post')
  const toSave = suggestions.filter((s) => s.shouldPost && s.topic?.trim())
  if (toSave.length === 0) return suggestions
  const rows = await db.insert(socialSuggestions).values(toSave.map((s) => ({
    brandId,
    kind: 'post',
    platform: s.platform,
    topic: s.topic.trim().slice(0, 500),
    postType: s.postType === 'video' ? 'video' : 'image',
    suggestedAt: isNaN(Date.parse(s.scheduledAt)) ? null : new Date(s.scheduledAt),
    reason: s.reason ?? null,
    payload: s as unknown as Record<string, unknown>,
    source,
  }))).returning({ id: socialSuggestions.id, platform: socialSuggestions.platform })
  const idByPlatform = new Map(rows.map((r) => [r.platform, r.id]))
  return suggestions.map((s) => (s.shouldPost && idByPlatform.has(s.platform) ? { ...s, id: idByPlatform.get(s.platform) } : s))
}

// Open suggestions to show when Social Studio loads
export async function loadOpenSuggestions(brandId: string) {
  await expireStaleSuggestions(brandId)
  return db.select().from(socialSuggestions)
    .where(and(eq(socialSuggestions.brandId, brandId), inArray(socialSuggestions.status, ['suggested'])))
    .orderBy(socialSuggestions.createdAt)
}
