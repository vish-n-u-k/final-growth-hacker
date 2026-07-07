import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FunnelStep {
  name: string
  count: number
  conversionRate: number       // % from previous step (100 for first step)
  dropOffRate: number          // 100 - conversionRate
  averageConversionTimeSec: number | null
}

export interface FunnelResult {
  steps: string[]              // event names in order as configured/detected
  data: FunnelStep[]
  overallConversionRate: number  // first step → last step %
  autoDetected: boolean          // true if steps were inferred from top events
}

export interface PostHogFetchResult {
  connected: boolean
  projectId: string | null
  host: string
  brandName: string
  websiteUrl: string
  // Metrics — null means query failed or returned no data
  mau: number | null          // unique persons last 30 days
  dau: number | null          // unique persons last 1 day
  sessions30d: number | null  // unique sessions last 30 days
  newUsers30d: number | null  // persons created in last 30 days
  pageviews30d: number | null // pageview count last 30 days
  topEvents: { event: string; count: number }[]
  weeklyUsers: { week: string; users: number }[] // last 12 weeks
  funnelResult: FunnelResult | null
  fetchErrors: string[]
}

// ── PostHog HogQL helper ──────────────────────────────────────────────────────

interface HogQLResponse {
  results: unknown[][]
  columns: string[]
}

async function runHogQL(
  host: string,
  projectId: string,
  apiKey: string,
  query: string,
): Promise<unknown[][] | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = (await res.json()) as HogQLResponse
    return data.results ?? null
  } catch {
    return null
  }
}

// ── Funnel helpers ────────────────────────────────────────────────────────────

const CONVERSION_EVENT_PATTERNS = [
  'signup', 'sign_up', 'signed_up', 'user_signed_up',
  'register', 'registered', 'onboarding_complete', 'onboarding_completed',
  'activated', 'activation', 'add_payment', 'payment_added',
  'purchase', 'purchased', 'order_completed', 'checkout_completed',
  'subscribed', 'subscription_created', 'upgrade', 'upgraded',
  'trial_started', 'trial_start',
]

function autoDetectFunnelSteps(topEvents: { event: string; count: number }[]): string[] {
  const matches = topEvents.filter((e) =>
    CONVERSION_EVENT_PATTERNS.some((p) => e.event.toLowerCase().includes(p)),
  )
  if (matches.length === 0) return []
  const hasPageview = topEvents.some((e) => e.event === '$pageview')
  const steps = hasPageview
    ? ['$pageview', ...matches.slice(0, 3).map((e) => e.event)]
    : matches.slice(0, 4).map((e) => e.event)
  return steps.slice(0, 4)
}

async function fetchPostHogFunnel(
  host: string,
  projectId: string,
  apiKey: string,
  steps: string[],
): Promise<FunnelResult | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    const res = await fetch(`${host}/api/projects/${projectId}/insights/funnel/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        insight: 'FUNNELS',
        events: steps.map((id, order) => ({ id, type: 'events', order })),
        date_from: '-30d',
        funnel_window_interval: 14,
        funnel_window_interval_unit: 'day',
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null

    const data = await res.json() as { result?: unknown }
    const raw = data.result
    if (!Array.isArray(raw) || raw.length === 0) return null

    // result can be array-of-steps OR array-of-arrays (breakdowns)
    const stepsData: unknown[] = Array.isArray(raw[0]) ? (raw[0] as unknown[]) : raw
    if (stepsData.length < 2) return null

    const firstCount = Number((stepsData[0] as Record<string, unknown>)?.count ?? 0)
    if (firstCount === 0) return null

    const funnelSteps: FunnelStep[] = stepsData.map((step, idx) => {
      const s = step as Record<string, unknown>
      const count = Number(s.count ?? 0)
      const prevCount = idx === 0 ? firstCount : Number((stepsData[idx - 1] as Record<string, unknown>)?.count ?? 0)
      const conversionRate = idx === 0 ? 100 : prevCount > 0 ? Math.round((count / prevCount) * 1000) / 10 : 0
      const avgTimeSec = s.average_conversion_time != null ? Number(s.average_conversion_time) : null
      return {
        name: String(s.name ?? steps[idx] ?? ''),
        count,
        conversionRate,
        dropOffRate: Math.round((100 - conversionRate) * 10) / 10,
        averageConversionTimeSec: avgTimeSec,
      }
    })

    const lastCount = Number((stepsData[stepsData.length - 1] as Record<string, unknown>)?.count ?? 0)
    return {
      steps,
      data: funnelSteps,
      overallConversionRate: Math.round((lastCount / firstCount) * 1000) / 10,
      autoDetected: false,
    }
  } catch {
    return null
  }
}

function firstNum(rows: unknown[][] | null, col = 0): number | null {
  const val = rows?.[0]?.[col]
  if (val === null || val === undefined) return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

// ── Main fetcher ───────────────────────────────────────────────────────────────

export async function fetchUserAnalyticsData(
  requirements: Record<string, string>,
): Promise<PostHogFetchResult> {
  const brandId = requirements['brand_id'] ?? ''
  const brandName = requirements['brand_name'] ?? ''
  const websiteUrl = requirements['website_url'] ?? ''

  const base: PostHogFetchResult = {
    connected: false,
    projectId: null,
    host: 'https://us.posthog.com',
    brandName,
    websiteUrl,
    mau: null,
    dau: null,
    sessions30d: null,
    newUsers30d: null,
    pageviews30d: null,
    topEvents: [],
    weeklyUsers: [],
    funnelResult: null,
    fetchErrors: [],
  }

  if (!brandId) return base

  const [integration] = await db
    .select()
    .from(brandIntegrations)
    .where(
      and(
        eq(brandIntegrations.brandId, brandId),
        eq(brandIntegrations.provider, 'posthog'),
        eq(brandIntegrations.status, 'connected'),
      ),
    )
    .limit(1)

  if (!integration?.apiKey) return base

  const meta = (integration.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id'] ?? ''
  const host = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')

  if (!projectId) {
    base.fetchErrors.push('PostHog Project ID not set')
    return base
  }

  base.connected = true
  base.projectId = projectId
  base.host = host

  const apiKey = integration.apiKey

  // Run all queries in parallel
  const [
    mauRows,
    dauRows,
    sessionsRows,
    newUsersRows,
    pageviewsRows,
    topEventsRows,
    weeklyUsersRows,
  ] = await Promise.all([
    runHogQL(host, projectId, apiKey,
      `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 30 DAY`),
    runHogQL(host, projectId, apiKey,
      `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 1 DAY`),
    runHogQL(host, projectId, apiKey,
      `SELECT count(DISTINCT $session_id) FROM events WHERE timestamp > now() - INTERVAL 30 DAY AND $session_id IS NOT NULL AND $session_id != ''`),
    runHogQL(host, projectId, apiKey,
      `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 30 DAY AND person.created_at > now() - INTERVAL 30 DAY`),
    runHogQL(host, projectId, apiKey,
      `SELECT count() FROM events WHERE event = '$pageview' AND timestamp > now() - INTERVAL 30 DAY`),
    runHogQL(host, projectId, apiKey,
      `SELECT event, count() as cnt FROM events WHERE timestamp > now() - INTERVAL 30 DAY GROUP BY event ORDER BY cnt DESC LIMIT 20`),
    runHogQL(host, projectId, apiKey,
      `SELECT toStartOfWeek(timestamp) as week, count(DISTINCT person_id) as users FROM events WHERE timestamp > now() - INTERVAL 84 DAY GROUP BY week ORDER BY week`),
  ])

  base.mau = firstNum(mauRows)
  base.dau = firstNum(dauRows)
  base.sessions30d = firstNum(sessionsRows)
  base.newUsers30d = firstNum(newUsersRows)
  base.pageviews30d = firstNum(pageviewsRows)

  if (topEventsRows) {
    base.topEvents = topEventsRows
      .map((row) => ({ event: String(row[0] ?? ''), count: Number(row[1] ?? 0) }))
      .filter((e) => e.event)
  }

  if (weeklyUsersRows) {
    base.weeklyUsers = weeklyUsersRows
      .map((row) => ({ week: String(row[0] ?? ''), users: Number(row[1] ?? 0) }))
      .filter((e) => e.week)
  }

  // ── Funnel analysis ────────────────────────────────────────────────────────
  const rawFunnelSteps = requirements['funnel_steps'] ?? ''
  let funnelSteps: string[] = rawFunnelSteps
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  let autoDetected = false

  if (funnelSteps.length < 2) {
    // Auto-detect from top events if no steps configured
    funnelSteps = autoDetectFunnelSteps(base.topEvents)
    autoDetected = true
  }

  if (funnelSteps.length >= 2) {
    const result = await fetchPostHogFunnel(host, projectId, apiKey, funnelSteps)
    if (result) {
      result.autoDetected = autoDetected
      base.funnelResult = result
    }
  }

  return base
}
