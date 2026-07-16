import { NextRequest, NextResponse } from 'next/server'
import { createSign } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const maxDuration = 45

// ── JWT helpers ────────────────────────────────────────────────────────────────

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

async function getServiceToken(clientEmail: string, privateKey: string, scope: string): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = base64url(JSON.stringify({ iss: clientEmail, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
    const signingInput = `${header}.${payload}`
    const sign = createSign('RSA-SHA256')
    sign.update(signingInput)
    const signature = sign.sign(privateKey.replace(/\\n/g, '\n'), 'base64url')
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${signingInput}.${signature}` }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token?: string }
    return data.access_token ?? null
  } catch { return null }
}

// ── PostHog ────────────────────────────────────────────────────────────────────

async function hogql(host: string, projectId: string, apiKey: string, query: string): Promise<number> {
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return 0
    const data = await res.json() as { results?: number[][] }
    return data.results?.[0]?.[0] ?? 0
  } catch { return 0 }
}

async function phQuery(host: string, projectId: string, apiKey: string, query: object): Promise<unknown> {
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

// ── GSC ────────────────────────────────────────────────────────────────────────

async function gscQuery(
  token: string, siteUrl: string, body: object,
): Promise<{ rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] } | null> {
  const url   = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`
  const host  = new URL(url).hostname
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  for (const siteId of [encodeURIComponent(url), `sc-domain%3A${host}`]) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${siteId}/searchAnalytics/query`,
        { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) },
      )
      if (!res.ok) continue
      const data = await res.json() as { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }
      if (data.rows?.length) return data
    } catch { continue }
  }
  return null
}

async function fetchGsc(clientEmail: string, privateKey: string, siteUrl: string) {
  // connected = true as long as credentials exist; data fields may be null if API call fails
  const base = { connected: true, clicks7d: null as number | null, impressions7d: null as number | null, avgCtr7d: null as number | null, avgPosition7d: null as number | null, topQueries: [] as { query: string; clicks: number; impressions: number; position: number }[], topPages: [] as { page: string; clicks: number; impressions: number }[], clickTrend: [] as { date: string; clicks: number }[] }
  const token = await getServiceToken(clientEmail, privateKey, 'https://www.googleapis.com/auth/webmasters.readonly')
  if (!token) return base  // credentials exist but token failed — still "connected"

  const endDate   = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 6  * 86400_000).toISOString().split('T')[0]
  const trendDate = new Date(Date.now() - 29 * 86400_000).toISOString().split('T')[0]

  const [summary, queries, pages, trend] = await Promise.all([
    // Aggregate 7d — no dimension
    gscQuery(token, siteUrl, { startDate, endDate, rowLimit: 1 }),
    // Top queries 7d
    gscQuery(token, siteUrl, { startDate, endDate, dimensions: ['query'], rowLimit: 10, orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }] }),
    // Top pages 7d
    gscQuery(token, siteUrl, { startDate, endDate, dimensions: ['page'], rowLimit: 5, orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }] }),
    // Daily clicks for trend chart (30d)
    gscQuery(token, siteUrl, { startDate: trendDate, endDate, dimensions: ['date'], rowLimit: 30, orderBy: [{ fieldName: 'date', sortOrder: 'ASCENDING' }] }),
  ])

  const agg = summary?.rows?.[0]
  return {
    ...base,
    clicks7d:      agg ? Math.round(agg.clicks)      : null,
    impressions7d: agg ? Math.round(agg.impressions)  : null,
    avgCtr7d:      agg ? Math.round(agg.ctr * 100)    : null,  // percent
    avgPosition7d: agg ? Math.round(agg.position * 10) / 10   : null,
    topQueries: (queries?.rows ?? []).slice(0, 5).map(r => ({
      query:       r.keys[0] ?? '',
      clicks:      Math.round(r.clicks),
      impressions: Math.round(r.impressions),
      position:    Math.round(r.position * 10) / 10,
    })),
    topPages: (pages?.rows ?? []).slice(0, 5).map(r => ({
      page:        r.keys[0] ?? '',
      clicks:      Math.round(r.clicks),
      impressions: Math.round(r.impressions),
    })),
    clickTrend: (trend?.rows ?? []).map(r => ({
      date:   r.keys[0] ?? '',
      clicks: Math.round(r.clicks),
    })),
  }
}

// ── GA4 ────────────────────────────────────────────────────────────────────────

async function ga4Report(token: string, propertyId: string, body: object): Promise<unknown> {
  const pid = propertyId.replace(/^properties\//, '')
  try {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function fetchGa4(clientEmail: string, privateKey: string, propertyId: string) {
  // connected = true as long as credentials exist; data fields may be null if API call fails
  const base = { connected: true, sessions7d: null, activeUsers7d: null, newUsers7d: null, pageviews7d: null, engagementRate7d: null, trafficSources: [] as { channel: string; sessions: number }[], topPages: [] as { page: string; sessions: number; newUsers: number; engagementRate: number }[], dailyTrend: [] as { date: string; newUsers: number; sessions: number }[] }
  const token = await getServiceToken(clientEmail, privateKey, 'https://www.googleapis.com/auth/analytics.readonly')
  if (!token) return base  // credentials exist but token failed — still "connected"

  type GA4Report = { rows?: { dimensionValues?: { value: string }[]; metricValues: { value: string }[] }[] }

  const [core, sources, pages, trend] = await Promise.all([
    // Core 7d metrics
    ga4Report(token, propertyId, {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' }, { name: 'screenPageViews' }, { name: 'engagementRate' }],
    }) as Promise<GA4Report | null>,
    // Traffic sources
    ga4Report(token, propertyId, {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 6,
    }) as Promise<GA4Report | null>,
    // Top landing pages
    ga4Report(token, propertyId, {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'engagementRate' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 5,
    }) as Promise<GA4Report | null>,
    // Daily new users trend (30d)
    ga4Report(token, propertyId, {
      dateRanges: [{ startDate: '29daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'newUsers' }, { name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    }) as Promise<GA4Report | null>,
  ])

  const coreRow = core?.rows?.[0]
  return {
    ...base,
    sessions7d:      coreRow ? parseInt(coreRow.metricValues[0]?.value ?? '0', 10)    : null,
    activeUsers7d:   coreRow ? parseInt(coreRow.metricValues[1]?.value ?? '0', 10)    : null,
    newUsers7d:      coreRow ? parseInt(coreRow.metricValues[2]?.value ?? '0', 10)    : null,
    pageviews7d:     coreRow ? parseInt(coreRow.metricValues[3]?.value ?? '0', 10)    : null,
    engagementRate7d:coreRow ? Math.round(parseFloat(coreRow.metricValues[4]?.value ?? '0') * 100) : null,
    trafficSources: (sources?.rows ?? []).map(r => ({
      channel:  r.dimensionValues?.[0]?.value ?? 'Unknown',
      sessions: parseInt(r.metricValues[0]?.value ?? '0', 10),
    })),
    topPages: (pages?.rows ?? []).map(r => ({
      page:          r.dimensionValues?.[0]?.value ?? '/',
      sessions:      parseInt(r.metricValues[0]?.value ?? '0', 10),
      newUsers:      parseInt(r.metricValues[1]?.value ?? '0', 10),
      engagementRate:Math.round(parseFloat(r.metricValues[2]?.value ?? '0') * 100),
    })),
    dailyTrend: (trend?.rows ?? []).map(r => {
      const raw = r.dimensionValues?.[0]?.value ?? ''
      // GA4 date format YYYYMMDD → YYYY-MM-DD
      const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw
      return {
        date,
        newUsers: parseInt(r.metricValues[0]?.value ?? '0', 10),
        sessions: parseInt(r.metricValues[1]?.value ?? '0', 10),
      }
    }),
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = request.nextUrl.searchParams.get('brandId')
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 })

  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const integrations = await db
    .select()
    .from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.status, 'connected')))

  const intMap = new Map(integrations.map(i => [i.provider, i]))
  const phInt  = intMap.get('posthog')
  const gscInt = intMap.get('gsc_api')
  const ga4Int = intMap.get('ga4_api')

  // ── PostHog ────────────────────────────────────────────────────────────────

  let posthogData = { posthogConnected: false, signups24h: 0, signins24h: 0, dau: 0, mau: 0, deletedAccounts24h: 0, retention: null as null | { day: string; rate: number }[], funnel: null as null | { stage: string; value: number }[] }

  if (phInt?.apiKey) {
    const meta = (phInt.metadata as Record<string, string> | null) ?? {}
    const projectId = meta['project_id']
    const host = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')

    if (projectId) {
      const [signups24h, signins24h, dau, mau, deletedAccounts24h, retentionRaw, funnelRaw] = await Promise.all([
        hogql(host, projectId, phInt.apiKey, `SELECT count() FROM persons WHERE created_at >= now() - interval 1 day`),
        hogql(host, projectId, phInt.apiKey, `SELECT count() FROM events WHERE event = '$identify' AND timestamp >= now() - interval 1 day`),
        hogql(host, projectId, phInt.apiKey, `SELECT count(DISTINCT person_id) FROM events WHERE timestamp >= now() - interval 1 day`),
        hogql(host, projectId, phInt.apiKey, `SELECT count(DISTINCT person_id) FROM events WHERE timestamp >= now() - interval 30 day`),
        hogql(host, projectId, phInt.apiKey, `SELECT count() FROM events WHERE event IN ('account_deleted', 'user_deleted', 'delete_account') AND timestamp >= now() - interval 1 day`),
        phQuery(host, projectId, phInt.apiKey, {
          kind: 'RetentionQuery',
          retentionFilter: { retention_type: 'retention_first_time', target_entity: { id: '$pageview', type: 'events' }, returning_entity: { id: '$pageview', type: 'events' }, total_intervals: 7, period: 'Day' },
          dateRange: { date_from: '-30d' },
        }),
        phQuery(host, projectId, phInt.apiKey, {
          kind: 'FunnelsQuery',
          series: [{ kind: 'EventsNode', event: '$pageview', name: 'Visited site' }, { kind: 'EventsNode', event: '$identify', name: 'Signed up' }],
          funnelsFilter: { funnel_window_days: 14 },
          dateRange: { date_from: '-30d' },
        }),
      ])

      let retention: { day: string; rate: number }[] | null = null
      try {
        const rd = retentionRaw as { results?: Array<{ values: Array<{ count: number }> }> } | null
        const first = rd?.results?.[0]
        if (first?.values.length) {
          const d0 = first.values[0]?.count ?? 1
          retention = [
            { day: 'D0',  rate: 100 },
            { day: 'D1',  rate: Math.round(((first.values[1]?.count ?? 0)  / Math.max(d0, 1)) * 100) },
            { day: 'D3',  rate: Math.round(((first.values[3]?.count ?? 0)  / Math.max(d0, 1)) * 100) },
            { day: 'D7',  rate: Math.round(((first.values[6]?.count ?? 0)  / Math.max(d0, 1)) * 100) },
            { day: 'D14', rate: Math.round(((first.values[6]?.count ?? 0)  / Math.max(d0, 1)) * 100) },
            { day: 'D30', rate: Math.round(((first.values[6]?.count ?? 0)  / Math.max(d0, 1)) * 100) },
          ]
        }
      } catch { /* null */ }

      let funnel: { stage: string; value: number }[] | null = null
      try {
        const fd = funnelRaw as { results?: Array<Array<{ name: string; count: number }>> } | null
        const steps = fd?.results?.[0]
        if (steps?.length) funnel = steps.map(s => ({ stage: s.name, value: s.count }))
      } catch { /* null */ }

      posthogData = { posthogConnected: true, signups24h, signins24h, dau, mau, deletedAccounts24h, retention, funnel }
    }
  }

  // ── GSC ───────────────────────────────────────────────────────────────────

  let gscData = { connected: false, clicks7d: null as number | null, impressions7d: null as number | null, avgCtr7d: null as number | null, avgPosition7d: null as number | null, topQueries: [] as { query: string; clicks: number; impressions: number; position: number }[], topPages: [] as { page: string; clicks: number; impressions: number }[], clickTrend: [] as { date: string; clicks: number }[] }

  if (gscInt) {
    const meta = (gscInt.metadata as Record<string, string> | null) ?? {}
    if (meta.client_email && meta.private_key) {
      gscData = await fetchGsc(meta.client_email, meta.private_key, brand.websiteUrl)
    }
  }

  // ── GA4 ───────────────────────────────────────────────────────────────────

  let ga4Data = { connected: false, sessions7d: null as number | null, activeUsers7d: null as number | null, newUsers7d: null as number | null, pageviews7d: null as number | null, engagementRate7d: null as number | null, trafficSources: [] as { channel: string; sessions: number }[], topPages: [] as { page: string; sessions: number; newUsers: number; engagementRate: number }[], dailyTrend: [] as { date: string; newUsers: number; sessions: number }[] }

  if (ga4Int) {
    const meta = (ga4Int.metadata as Record<string, string> | null) ?? {}
    if (meta.client_email && meta.private_key && meta.property_id) {
      ga4Data = await fetchGa4(meta.client_email, meta.private_key, meta.property_id)
    }
  }

  return NextResponse.json({
    ...posthogData,
    gsc: gscData,
    ga4: ga4Data,
  })
}
