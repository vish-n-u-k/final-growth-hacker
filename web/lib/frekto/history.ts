// ── What the brand has already posted / queued / turned down ─────────────────
// Fed into every suggestion prompt so GrowJin never suggests a topic twice, and
// used to skip platforms that already have something coming up.

import { db } from '@/lib/db'
import { frektoScheduledPosts, socialSuggestions } from '@/lib/db/schema'
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm'

// Platforms Frekto can actually publish to (its schedule_post accepts these, plus pinterest)
export const PUBLISHABLE_PLATFORMS = ['instagram', 'linkedin', 'facebook', 'youtube'] as const

const HISTORY_DAYS = 60
const SUGGESTION_TTL_DAYS = 7
const UPCOMING_WINDOW_MS = 48 * 3600_000 // a platform with a post due in the next 48h gets no new one

// Statuses that mean "this went out or is going out"
export const LIVE_STATUSES = ['scheduled', 'done']

export interface PostingContext {
  lastByPlatform: Record<string, Date>          // newest live post per platform (past or future)
  upcomingByPlatform: Record<string, Date>      // earliest live post due within the window
  usedTopics: string[]                          // posted, queued or drafted recently
  dismissedTopics: string[]                     // the user said "not interested"
}

export async function getPostingContext(brandId: string): Promise<PostingContext> {
  const since = new Date(Date.now() - HISTORY_DAYS * 864e5)
  const [posts, dismissed] = await Promise.all([
    db.select({ platform: frektoScheduledPosts.platform, topic: frektoScheduledPosts.topic, status: frektoScheduledPosts.status, scheduledAt: frektoScheduledPosts.scheduledAt })
      .from(frektoScheduledPosts)
      .where(and(eq(frektoScheduledPosts.brandId, brandId), gte(frektoScheduledPosts.scheduledAt, since)))
      .orderBy(desc(frektoScheduledPosts.scheduledAt))
      .catch(() => []),
    db.select({ topic: socialSuggestions.topic })
      .from(socialSuggestions)
      .where(and(eq(socialSuggestions.brandId, brandId), eq(socialSuggestions.status, 'dismissed'), gte(socialSuggestions.updatedAt, since)))
      .limit(30)
      .catch(() => []),
  ])

  const now = Date.now()
  const lastByPlatform: Record<string, Date> = {}
  const upcomingByPlatform: Record<string, Date> = {}
  for (const p of posts) {
    if (!LIVE_STATUSES.includes(p.status)) continue
    if (!lastByPlatform[p.platform]) lastByPlatform[p.platform] = p.scheduledAt
    const t = p.scheduledAt.getTime()
    if (t >= now && t - now <= UPCOMING_WINDOW_MS) {
      if (!upcomingByPlatform[p.platform] || t < upcomingByPlatform[p.platform].getTime()) upcomingByPlatform[p.platform] = p.scheduledAt
    }
  }

  const usedTopics = [...new Set(posts.filter((p) => p.status !== 'cancelled' && p.status !== 'failed').map((p) => p.topic))].slice(0, 40)
  return { lastByPlatform, upcomingByPlatform, usedTopics, dismissedTopics: [...new Set(dismissed.map((d) => d.topic))] }
}

// Prompt block telling the model what not to repeat
export function avoidTopicsBlock(ctx: PostingContext): string {
  const parts: string[] = []
  if (ctx.usedTopics.length) parts.push(`Topics ALREADY posted or queued in the last ${HISTORY_DAYS} days — do NOT suggest these again or close variations of them:\n${ctx.usedTopics.map((t) => `- ${t}`).join('\n')}`)
  if (ctx.dismissedTopics.length) parts.push(`Topics the user REJECTED — avoid these and anything similar:\n${ctx.dismissedTopics.map((t) => `- ${t}`).join('\n')}`)
  return parts.length ? `\n\n${parts.join('\n\n')}` : ''
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Safety net in case the model repeats anyway
export function isRepeatTopic(topic: string, ctx: PostingContext): boolean {
  const t = normalize(topic)
  if (!t) return false
  return [...ctx.usedTopics, ...ctx.dismissedTopics].some((u) => normalize(u) === t)
}

// Old unanswered suggestions stop showing after a week
export async function expireStaleSuggestions(brandId: string) {
  await db.update(socialSuggestions)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(
      eq(socialSuggestions.brandId, brandId),
      eq(socialSuggestions.status, 'suggested'),
      lt(socialSuggestions.createdAt, new Date(Date.now() - SUGGESTION_TTL_DAYS * 864e5)),
    ))
    .catch(() => {})
}

// A fresh batch replaces the previous unanswered batch of the same kind
export async function replaceOpenSuggestions(brandId: string, kind: 'post' | 'series') {
  await db.update(socialSuggestions)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(eq(socialSuggestions.brandId, brandId), eq(socialSuggestions.kind, kind), inArray(socialSuggestions.status, ['suggested'])))
}
