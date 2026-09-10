// ── Signal Detection Engine ────────────────────────────────────────────────────
// Pure rule-based engine — no AI calls. Takes pre-fetched data, returns
// up to 3 prioritised ActionCards. Called from both /api/today/signals and
// the daily-email cron.

export type ActionCardType = 'outreach' | 'social' | 'seo' | 'content' | 'module-item' | 'all-good' | 'blog'

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
        cta: 'Send emails to prospects',
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
        cta: 'Generate a post now',
        ctaUrl: '/engagement-hub',
        data: { platform, daysSince },
      })
    }
  }

  // ── Rule 3.5: Weekly blog due ─────────────────────────────────────────────
  if (input.blogWeekly?.weeklyDue) {
    const daysSinceBlog = input.blogWeekly.lastBlogAt
      ? Math.floor((Date.now() - input.blogWeekly.lastBlogAt.getTime()) / 864e5)
      : null
    candidates.push({
      id: 'blog-weekly',
      type: 'blog',
      priority: 3.5,
      headline: 'Write this week\'s SEO blog post',
      reason: daysSinceBlog !== null
        ? `Last blog was ${daysSinceBlog} day${daysSinceBlog === 1 ? '' : 's'} ago — weekly cadence keeps content fresh`
        : 'No blogs generated yet — a blog section drives organic traffic',
      cta: 'Generate blog',
      ctaUrl: '/today#blog',
    })
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

  // ── Rule 4.5: SEO module stale (> 14 days since last analysis) ───────────
  if (input.seoStale) {
    const { moduleId, daysSince } = input.seoStale
    candidates.push({
      id: 'seo-stale',
      type: 'seo',
      priority: 4.5,
      headline: `Re-analyze your SEO — last checked ${daysSince} day${daysSince === 1 ? '' : 's'} ago`,
      reason: `SEO factors change as competitors update pages and Google refreshes its index. Running a fresh analysis ensures your recommendations are current.`,
      cta: 'Re-analyze SEO',
      ctaUrl: `/dashboard/${moduleId}`,
      sourceModule: moduleId,
    })
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

  // ── Rule 5.5: Blog / content section missing ──────────────────────────────
  if (input.blogSuggestion) {
    const { moduleId, score, analyzed } = input.blogSuggestion
    candidates.push({
      id: 'blog-missing',
      type: 'content',
      priority: 5.5,
      headline: analyzed
        ? `Add a blog or resources section (content score: ${score}%)`
        : 'Run the Content Audit to check your blog coverage',
      reason: analyzed
        ? `Your content score is low — sites without a blog or resource section miss a major source of organic traffic and domain authority.`
        : `The Content Audit checks whether your site has a blog, sufficient page depth, and the right content types. Run it to find gaps.`,
      cta: analyzed ? 'Open Content Audit' : 'Run Content Audit',
      ctaUrl: `/dashboard/${moduleId}`,
      sourceModule: moduleId,
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

  // ── Rule 6.5: GEO module stale (> 14 days since last analysis) ───────────
  if (input.geoStale) {
    const { moduleId, daysSince } = input.geoStale
    candidates.push({
      id: 'geo-stale',
      type: 'module-item',
      priority: 6.5,
      headline: `Re-analyze GEO — last checked ${daysSince} day${daysSince === 1 ? '' : 's'} ago`,
      reason: `AI search visibility changes as new LLMs update their training data and discovery signals. Re-running ensures your GEO score reflects the current state.`,
      cta: 'Re-analyze GEO',
      ctaUrl: `/dashboard/${moduleId}`,
      sourceModule: moduleId,
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
