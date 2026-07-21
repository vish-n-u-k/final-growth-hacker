import { NextRequest, NextResponse } from 'next/server'
import { createSign } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

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

async function hogqlRows(host: string, projectId: string, apiKey: string, query: string): Promise<unknown[][] | null> {
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const data = await res.json() as { results?: unknown[][] }
    return data.results ?? null
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
  const base = { connected: true, error: false, clicks7d: null as number | null, impressions7d: null as number | null, avgCtr7d: null as number | null, avgPosition7d: null as number | null, topQueries: [] as { query: string; clicks: number; impressions: number; position: number }[], topPages: [] as { page: string; clicks: number; impressions: number }[], clickTrend: [] as { date: string; clicks: number }[] }
  const token = await getServiceToken(clientEmail, privateKey, 'https://www.googleapis.com/auth/webmasters.readonly')
  if (!token) return { ...base, error: true }

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
  const base = { connected: true, error: false, sessions7d: null as number | null, activeUsers7d: null as number | null, newUsers7d: null as number | null, pageviews7d: null as number | null, engagementRate7d: null as number | null, trafficSources: [] as { channel: string; sessions: number }[], topPages: [] as { page: string; sessions: number; newUsers: number; engagementRate: number }[], dailyTrend: [] as { date: string; newUsers: number; sessions: number }[] }
  const token = await getServiceToken(clientEmail, privateKey, 'https://www.googleapis.com/auth/analytics.readonly')
  if (!token) return { ...base, error: true }

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

  const force = request.nextUrl.searchParams.get('force') === 'true'

  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Return cached snapshot if available and not forced refresh
  if (!force && brand.analyticsSnapshot && brand.analyticsSnapshotAt) {
    return NextResponse.json({
      ...(brand.analyticsSnapshot as object),
      snapshotAt: brand.analyticsSnapshotAt.toISOString(),
    })
  }

  const integrations = await db
    .select()
    .from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.status, 'connected')))

  const intMap = new Map(integrations.map(i => [i.provider, i]))
  const phInt  = intMap.get('posthog')
  const gscInt = intMap.get('gsc_api')
  const ga4Int = intMap.get('ga4_api')

  // ── PostHog ────────────────────────────────────────────────────────────────

  type WebAnalytics = {
    visitors: { current: number; prior: number }
    pageviews: { current: number; prior: number }
    sessions: { current: number; prior: number }
    avgDurationSecs: number | null; avgDurationSecsPrior: number | null
    bounceRate: number | null; bounceRatePrior: number | null
    visitorsChart: { date: string; visitors: number }[]
    topPaths: { path: string; visitors: number; views: number }[]
    channels: { channel: string; visitors: number; views: number }[]
    devices: { device: string; visitors: number; views: number }[]
    countries: { country: string; visitors: number }[]
    activeHours: { dow: number; hour: number; users: number }[]
  }

  let posthogData: {
    posthogConnected: boolean; signups24h: number; signins24h: number
    dau: number; mau: number; deletedAccounts24h: number
    retention: { day: string; rate: number }[] | null
    funnel: { stage: string; value: number }[] | null
    webAnalytics: WebAnalytics | null
  } = { posthogConnected: false, signups24h: 0, signins24h: 0, dau: 0, mau: 0, deletedAccounts24h: 0, retention: null, funnel: null, webAnalytics: null }

  if (phInt?.apiKey) {
    const meta = (phInt.metadata as Record<string, string> | null) ?? {}
    const projectId = meta['project_id']
    const host = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')

    if (projectId) {
      const key = phInt.apiKey
      const [
        signups24h, signins24h, dau, mau, deletedAccounts24h,
        retentionRaw, funnelRaw,
        coreCurrentRows, corePriorRows,
        sessionCurrentRows, sessionPriorRows,
        visitorsChartRows, topPathsRows,
        channelsRows, devicesRows, countriesRows, activeHoursRows,
      ] = await Promise.all([
        hogql(host, projectId, key, `SELECT count(DISTINCT properties.$email) FROM persons WHERE is_identified = 1 AND isNotNull(properties.$email) AND created_at >= now() - interval 1 day`),
        hogql(host, projectId, key, `SELECT count() FROM events WHERE event = '$identify' AND timestamp >= now() - interval 1 day`),
        hogql(host, projectId, key, `SELECT count(DISTINCT person_id) FROM events WHERE timestamp >= now() - interval 1 day`),
        hogql(host, projectId, key, `SELECT count(DISTINCT person_id) FROM events WHERE timestamp >= now() - interval 30 day`),
        hogql(host, projectId, key, `SELECT count() FROM events WHERE event IN ('account_deleted', 'user_deleted', 'delete_account') AND timestamp >= now() - interval 1 day`),
        phQuery(host, projectId, key, {
          kind: 'RetentionQuery',
          retentionFilter: { retention_type: 'retention_first_time', target_entity: { id: '$pageview', type: 'events' }, returning_entity: { id: '$pageview', type: 'events' }, total_intervals: 7, period: 'Day' },
          dateRange: { date_from: '-30d' },
        }),
        phQuery(host, projectId, key, {
          kind: 'FunnelsQuery',
          series: [{ kind: 'EventsNode', event: '$pageview', name: 'Visited site' }, { kind: 'EventsNode', event: '$identify', name: 'Signed up' }],
          funnelsFilter: { funnel_window_days: 14 },
          dateRange: { date_from: '-30d' },
        }),
        // Web analytics — core metrics (28d current vs prior)
        hogqlRows(host, projectId, key, `SELECT count(DISTINCT person_id), count(), count(DISTINCT $session_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - interval 28 day`),
        hogqlRows(host, projectId, key, `SELECT count(DISTINCT person_id), count(), count(DISTINCT $session_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - interval 56 day AND timestamp < now() - interval 28 day`),
        // Session duration + bounce rate via sessions virtual table
        hogqlRows(host, projectId, key, `SELECT count(), round(avg($session_duration)), round(countIf($pagecount <= 1) * 100.0 / count()) FROM sessions WHERE $start_timestamp >= now() - interval 28 day`),
        hogqlRows(host, projectId, key, `SELECT count(), round(avg($session_duration)), round(countIf($pagecount <= 1) * 100.0 / count()) FROM sessions WHERE $start_timestamp >= now() - interval 56 day AND $start_timestamp < now() - interval 28 day`),
        // Visitors chart (30d daily)
        hogqlRows(host, projectId, key, `SELECT toDate(timestamp), count(DISTINCT person_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - interval 30 day GROUP BY 1 ORDER BY 1 ASC`),
        // Top paths
        hogqlRows(host, projectId, key, `SELECT properties.$pathname, count(DISTINCT person_id), count() FROM events WHERE event = '$pageview' AND timestamp >= now() - interval 28 day AND properties.$pathname IS NOT NULL AND properties.$pathname != '' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
        // Channels
        hogqlRows(host, projectId, key, `SELECT coalesce(properties.$channel_type, 'Unknown'), count(DISTINCT person_id), count() FROM events WHERE event = '$pageview' AND timestamp >= now() - interval 28 day GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
        // Devices
        hogqlRows(host, projectId, key, `SELECT coalesce(properties.$device_type, 'Unknown'), count(DISTINCT person_id), count() FROM events WHERE event = '$pageview' AND timestamp >= now() - interval 28 day GROUP BY 1 ORDER BY 2 DESC`),
        // Countries
        hogqlRows(host, projectId, key, `SELECT coalesce(properties.$geoip_country_name, 'Unknown'), count(DISTINCT person_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - interval 28 day AND properties.$geoip_country_name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
        // Active hours heatmap
        hogqlRows(host, projectId, key, `SELECT toDayOfWeek(timestamp), toHour(timestamp), count(DISTINCT person_id) FROM events WHERE timestamp >= now() - interval 28 day GROUP BY 1, 2 ORDER BY 1, 2`),
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

      const coreC = coreCurrentRows?.[0]
      const coreP = corePriorRows?.[0]
      const sessC = sessionCurrentRows?.[0]
      const sessP = sessionPriorRows?.[0]

      const webAnalytics: WebAnalytics = {
        visitors: { current: Number(coreC?.[0] ?? 0), prior: Number(coreP?.[0] ?? 0) },
        pageviews: { current: Number(coreC?.[1] ?? 0), prior: Number(coreP?.[1] ?? 0) },
        sessions:  { current: Number(coreC?.[2] ?? 0), prior: Number(coreP?.[2] ?? 0) },
        avgDurationSecs:      sessC?.[1] != null ? Number(sessC[1]) : null,
        avgDurationSecsPrior: sessP?.[1] != null ? Number(sessP[1]) : null,
        bounceRate:      sessC?.[2] != null ? Number(sessC[2]) : null,
        bounceRatePrior: sessP?.[2] != null ? Number(sessP[2]) : null,
        visitorsChart: (visitorsChartRows ?? []).map(r => ({ date: String(r[0]), visitors: Number(r[1]) })),
        topPaths:  (topPathsRows  ?? []).map(r => ({ path: String(r[0]), visitors: Number(r[1]), views: Number(r[2]) })),
        channels:  (channelsRows  ?? []).map(r => ({ channel: String(r[0]), visitors: Number(r[1]), views: Number(r[2]) })),
        devices:   (devicesRows   ?? []).map(r => ({ device: String(r[0]), visitors: Number(r[1]), views: Number(r[2]) })),
        countries: (countriesRows ?? []).map(r => ({ country: String(r[0]), visitors: Number(r[1]) })),
        activeHours: (activeHoursRows ?? []).map(r => ({ dow: Number(r[0]), hour: Number(r[1]), users: Number(r[2]) })),
      }

      posthogData = { posthogConnected: true, signups24h, signins24h, dau, mau, deletedAccounts24h, retention, funnel, webAnalytics }
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

  const snapshot = {
    ...posthogData,
    gsc: gscData,
    ga4: ga4Data,
  }
  const snapshotAt = new Date()

  // Persist to DB so next load is instant
  await db
    .update(brands)
    .set({ analyticsSnapshot: snapshot, analyticsSnapshotAt: snapshotAt })
    .where(eq(brands.id, brandId))

  return NextResponse.json({ ...snapshot, snapshotAt: snapshotAt.toISOString() })
}
