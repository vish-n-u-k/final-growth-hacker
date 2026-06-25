import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

// ── Types ─────────────────────────────────────────────────────────────────────

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

  return base
}
