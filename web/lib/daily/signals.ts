// ── Signal Detection Engine ────────────────────────────────────────────────────
// Pure rule-based engine — no AI calls. Takes pre-fetched data, returns
// up to 3 prioritised ActionCards. Called from both /api/today/signals and
// the daily-email cron.

export type ActionCardType = 'outreach' | 'social' | 'seo' | 'content' | 'module-item' | 'all-good'

export interface ActionCard {
  id: string
  type: ActionCardType
  priority: number
  headline: string
  reason: string
  cta: string
  ctaUrl: string
  sourceModule?: string
  data?: Record<string, unknown>
}

export interface SignalInput {
  ga4?: {
    visits: number          // yesterday sessions
    visitsPrior: number     // day-before sessions
    weekSessions?: number[] // oldest→newest, 7 values (optional)
  } | null
  ph?: {
    dau: number
    dauPrior: number
    dauTrend: { date: string; dau: number }[]
  } | null
  frekto?: {
    lastSentAt: Date | null       // most recent status='done' post
    activePlatform: string | null // platform of that post
    hasAnyPosts: boolean          // brand has ever scheduled a post
  } | null
  keywords?: {
    recentAvgPosition: number  // avg position last 3 days
    olderAvgPosition: number   // avg position days 4-7 ago
  } | null
  seoModule?: { id: string; score: number } | null
  uncheckedCriticalItems?: {
    id: string
    slug: string
    label: string
    moduleId: string
    moduleType: string
  }[]
  pageAuditItems?: {
    title: string | null
    url: string
    verdict: string
  }[]
}

export function detectSignals(input: SignalInput, maxCards = 3): ActionCard[] {
  const candidates: ActionCard[] = []

  // ── Rule 1: No / low traffic ──────────────────────────────────────────────
  if (input.ga4) {
    const { visits, visitsPrior, weekSessions } = input.ga4

    const last3 = weekSessions ? weekSessions.slice(-3) : [visitsPrior, visitsPrior, visits]
    const consecutiveLow = last3.every(s => s < 10)

    const weekAvg = weekSessions
      ? weekSessions.reduce((a, b) => a + b, 0) / weekSessions.length
      : visitsPrior || 1
    const dropped40 = weekAvg > 0 && visits < weekAvg * 0.6

    if (consecutiveLow || dropped40) {
      const reason = consecutiveLow
        ? 'Fewer than 10 sessions/day for 3 consecutive days'
        : `Traffic dropped ${Math.round((1 - visits / weekAvg) * 100)}% vs 7-day average`
      candidates.push({
        id: 'low-traffic',
        type: 'outreach',
        priority: 1,
        headline: 'Send outreach emails to prospects',
        reason,
        cta: 'Open Gmail Hub',
        ctaUrl: '/gmail-hub',
      })
    }
  }

  // ── Rule 2: DAU declining 3+ consecutive days ─────────────────────────────
  if (input.ph) {
    const trend = input.ph.dauTrend
    if (trend.length >= 3) {
      const last3 = trend.slice(-3)
      const declining = last3[0].dau > last3[1].dau && last3[1].dau > last3[2].dau && last3[0].dau > 0
      if (declining) {
        candidates.push({
          id: 'dau-declining',
          type: 'outreach',
          priority: 2,
          headline: 'Re-engage users — send outreach email',
          reason: `Daily active users declined for 3 consecutive days (${last3[0].dau} → ${last3[2].dau})`,
          cta: 'Open Gmail Hub',
          ctaUrl: '/gmail-hub',
        })
      }
    }
  }

  // ── Rule 3: No recent social post ─────────────────────────────────────────
  if (input.frekto?.hasAnyPosts) {
    const { lastSentAt, activePlatform } = input.frekto
    const daysSince = lastSentAt
      ? Math.floor((Date.now() - lastSentAt.getTime()) / 864e5)
      : 999
    if (daysSince >= 5) {
      const platform = activePlatform ?? 'social media'
      const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1)
      candidates.push({
        id: 'no-social-post',
        type: 'social',
        priority: 3,
        headline: `Post on ${platformLabel} today`,
        reason: daysSince === 999 ? 'No posts sent yet' : `No posts in ${daysSince} day${daysSince === 1 ? '' : 's'}`,
        cta: 'Open Engagement Hub',
        ctaUrl: '/engagement-hub',
        data: { platform, daysSince },
      })
    }
  }

  // ── Rule 4: SEO position drop ─────────────────────────────────────────────
  if (input.keywords) {
    const { recentAvgPosition, olderAvgPosition } = input.keywords
    if (olderAvgPosition > 0 && recentAvgPosition > olderAvgPosition + 3) {
      candidates.push({
        id: 'seo-position-drop',
        type: 'seo',
        priority: 4,
        headline: 'Review SEO keyword positions',
        reason: `Average position worsened by ${(recentAvgPosition - olderAvgPosition).toFixed(1)} spots over 7 days`,
        cta: 'Open SEO Module',
        ctaUrl: input.seoModule ? `/dashboard/${input.seoModule.id}` : '/dashboard',
        sourceModule: input.seoModule?.id,
      })
    }
  }

  // ── Rule 5: Content gaps (Remove/Refresh audit verdicts) ──────────────────
  if (input.pageAuditItems && input.pageAuditItems.length > 0) {
    const page = input.pageAuditItems[0]
    candidates.push({
      id: 'content-gap',
      type: 'content',
      priority: 5,
      headline: `Refresh: ${page.title ?? page.url}`,
      reason: `Page marked for ${page.verdict.toLowerCase()} in content audit`,
      cta: 'View Content Audit',
      ctaUrl: '/dashboard',
    })
  }

  // ── Rule 6: Uncompleted high-weight items ─────────────────────────────────
  if (input.uncheckedCriticalItems && input.uncheckedCriticalItems.length > 0) {
    const item = input.uncheckedCriticalItems[0]
    candidates.push({
      id: `module-item-${item.slug}`,
      type: 'module-item',
      priority: 6,
      headline: `Complete: ${item.label}`,
      reason: `Critical item not yet verified in ${item.moduleType} module`,
      cta: 'Go to module',
      ctaUrl: `/dashboard/${item.moduleId}`,
      sourceModule: item.moduleId,
    })
  }

  // Deduplicate by type (only highest-priority per type), cap at maxCards
  const seen = new Set<string>()
  return candidates
    .sort((a, b) => a.priority - b.priority)
    .filter(c => {
      if (seen.has(c.type)) return false
      seen.add(c.type)
      return true
    })
    .slice(0, maxCards)
}
