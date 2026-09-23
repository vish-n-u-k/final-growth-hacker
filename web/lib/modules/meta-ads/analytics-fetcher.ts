import { createSign } from 'crypto'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GA4TopPage {
  page: string
  sessions: number
  bounceRate: number
  conversions: number
}

export interface GA4Channel {
  channel: string
  sessions: number
  conversions: number
}

export interface GA4Country {
  country: string
  sessions: number
  conversions: number
}

export interface GA4Data {
  topPages: GA4TopPage[]
  channels: GA4Channel[]
  countries: GA4Country[]
  totalSessions: number
  totalConversions: number
}

export interface PostHogEvent {
  event: string
  count: number
}

export interface PostHogData {
  topConversionEvents: PostHogEvent[]
  totalPageviews: number
  uniqueUsers: number
}

export interface AnalyticsData {
  ga4: GA4Data | null
  posthog: PostHogData | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function safeFetch(url: string, options?: RequestInit): Promise<unknown> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(url, { signal: controller.signal, ...options })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ── GA4 ───────────────────────────────────────────────────────────────────────

async function getGA4AccessToken(clientEmail: string, privateKey: string): Promise<string | null> {
  try {
    // Service account JSON files store private_key with literal \n — normalise to real newlines
    const key = privateKey.replace(/\\n/g, '\n')
    const now = Math.floor(Date.now() / 1000)
    const claim = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify(claim)).toString('base64url')
    const message = `${header}.${payload}`
    const sign = createSign('RSA-SHA256')
    sign.update(message)
    const signature = sign.sign(key, 'base64url')
    const jwt = `${message}.${signature}`

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    })
    const data = (await res.json()) as { access_token?: string }
    return data.access_token ?? null
  } catch {
    return null
  }
}

type GA4Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }

function parseGA4Rows<T>(
  raw: unknown,
  mapper: (dims: string[], metrics: number[]) => T,
): T[] {
  const rows = (raw as { rows?: GA4Row[] } | null)?.rows ?? []
  return rows.map((row) => {
    const dims = (row.dimensionValues ?? []).map((d) => d.value)
    const metrics = (row.metricValues ?? []).map((m) => parseFloat(m.value || '0'))
    return mapper(dims, metrics)
  })
}

async function runGA4Report(
  propertyId: string,
  token: string,
  dimensions: string[],
  metrics: string[],
  limit = 10,
): Promise<unknown> {
  return safeFetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
        limit,
      }),
    },
  )
}

export async function fetchGA4Data(
  propertyId: string,
  clientEmail: string,
  privateKey: string,
): Promise<GA4Data | null> {
  if (!propertyId || !clientEmail || !privateKey) return null

  const token = await getGA4AccessToken(clientEmail, privateKey)
  if (!token) return null

  const [pagesRaw, channelsRaw, countriesRaw] = await Promise.all([
    runGA4Report(propertyId, token, ['landingPage'], ['sessions', 'bounceRate', 'conversions'], 10),
    runGA4Report(propertyId, token, ['sessionDefaultChannelGroup'], ['sessions', 'conversions'], 8),
    runGA4Report(propertyId, token, ['country'], ['sessions', 'conversions'], 8),
  ])

  const topPages = parseGA4Rows<GA4TopPage>(pagesRaw, (dims, metrics) => ({
    page: dims[0] ?? '',
    sessions: metrics[0] ?? 0,
    bounceRate: Math.round((metrics[1] ?? 0) * 100) / 100,
    conversions: metrics[2] ?? 0,
  }))

  const channels = parseGA4Rows<GA4Channel>(channelsRaw, (dims, metrics) => ({
    channel: dims[0] ?? '',
    sessions: metrics[0] ?? 0,
    conversions: metrics[1] ?? 0,
  }))

  const countries = parseGA4Rows<GA4Country>(countriesRaw, (dims, metrics) => ({
    country: dims[0] ?? '',
    sessions: metrics[0] ?? 0,
    conversions: metrics[1] ?? 0,
  }))

  if (topPages.length === 0 && channels.length === 0) return null

  return {
    topPages,
    channels,
    countries,
    totalSessions: channels.reduce((s, c) => s + c.sessions, 0),
    totalConversions: topPages.reduce((s, p) => s + p.conversions, 0),
  }
}

// ── PostHog ───────────────────────────────────────────────────────────────────

export async function fetchPostHogData(
  apiKey: string,
  projectId: string,
  host = 'https://app.posthog.com',
): Promise<PostHogData | null> {
  if (!apiKey || !projectId) return null

  const base = host.replace(/\/$/, '')
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

  const [convRaw, pvRaw] = await Promise.all([
    // Custom / conversion events — excludes PostHog's own internal events
    safeFetch(`${base}/api/projects/${projectId}/query/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: `SELECT event, count() as count FROM events WHERE timestamp > now() - interval 30 day AND event NOT IN ('$pageview', '$pageleave', '$autocapture', '$identify', '$set', '$feature_flag_called', '$$heatmap', '$rageclick') GROUP BY event ORDER BY count DESC LIMIT 10`,
        },
      }),
    }),
    // Pageview volume + unique users
    safeFetch(`${base}/api/projects/${projectId}/query/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: `SELECT count() as pageviews, count(distinct distinct_id) as unique_users FROM events WHERE event = '$pageview' AND timestamp > now() - interval 30 day`,
        },
      }),
    }),
  ])

  const convData = convRaw as { results?: [string, number][] } | null
  const pvData = pvRaw as { results?: [number, number][] } | null

  if (!convData?.results && !pvData?.results) return null

  const topConversionEvents: PostHogEvent[] = (convData?.results ?? []).map(([event, count]) => ({
    event,
    count: typeof count === 'number' ? count : parseInt(String(count) || '0'),
  }))

  const pvRow = pvData?.results?.[0]

  return {
    topConversionEvents,
    totalPageviews: pvRow?.[0] ?? 0,
    uniqueUsers: pvRow?.[1] ?? 0,
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function fetchAnalyticsData(
  requirements: Record<string, string>,
): Promise<AnalyticsData> {
  const [ga4, posthog] = await Promise.all([
    fetchGA4Data(
      requirements['ga4_property_id'] ?? '',
      requirements['ga4_client_email'] ?? '',
      requirements['ga4_private_key'] ?? '',
    ),
    fetchPostHogData(
      requirements['posthog_api_key'] ?? '',
      requirements['posthog_project_id'] ?? '',
      requirements['posthog_host'] ?? 'https://app.posthog.com',
    ),
  ])
  return { ga4, posthog }
}
