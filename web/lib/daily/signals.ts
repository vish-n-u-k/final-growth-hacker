// ── /today card types + "what's working" impacts ───────────────────────────────
// Action cards themselves come from lib/daily/today-tasks.ts (tasksToCards), the
// same list the daily email and MCP use. This file keeps the shared card types
// and detectImpacts (positive trends shown under "What's working").

export type ActionCardType = 'outreach' | 'social' | 'seo' | 'content' | 'module-item' | 'all-good' | 'blog' | 'reminder' | 'alert' | 'play'

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
  seoStale?: { moduleId: string; daysSince: number } | null
  geoStale?: { moduleId: string; daysSince: number } | null
  blogSuggestion?: { moduleId: string; score: number; analyzed: boolean } | null
  blogWeekly?: { lastBlogAt: Date | null; weeklyDue: boolean } | null
}

export interface ImpactCard {
  id: string
  type: 'keyword-gain' | 'social-traffic' | 'traffic-growth'
  headline: string
  detail: string
  platform?: string
}

export function detectImpacts(input: SignalInput): ImpactCard[] {
  const impacts: ImpactCard[] = []

  if (input.ga4) {
    const { visits, visitsPrior } = input.ga4
    if (visitsPrior > 0 && visits > visitsPrior * 1.2) {
      const pct = Math.round(((visits - visitsPrior) / visitsPrior) * 100)
      impacts.push({
        id: 'traffic-growth',
        type: 'traffic-growth',
        headline: `Traffic up ${pct}% vs yesterday`,
        detail: `${visits} sessions yesterday vs ${visitsPrior} the day before.`,
      })
    }
  }

  if (input.keywords) {
    const { recentAvgPosition, olderAvgPosition } = input.keywords
    if (olderAvgPosition > 0 && recentAvgPosition < olderAvgPosition - 2) {
      impacts.push({
        id: 'keyword-gain',
        type: 'keyword-gain',
        headline: `Keyword positions improved by ${(olderAvgPosition - recentAvgPosition).toFixed(1)} spots`,
        detail: `Average position moved from ${olderAvgPosition.toFixed(1)} to ${recentAvgPosition.toFixed(1)}.`,
      })
    }
  }

  return impacts
}
