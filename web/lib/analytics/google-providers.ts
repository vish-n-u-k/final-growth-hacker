import { createSign } from 'crypto'

// ── JWT / token ────────────────────────────────────────────────────────────────

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

export async function getServiceToken(clientEmail: string, privateKey: string, scope: string): Promise<string | null> {
  try {
    const now     = Math.floor(Date.now() / 1000)
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

// ── GSC ────────────────────────────────────────────────────────────────────────

type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }
type GscResponse = { rows?: GscRow[] }

async function gscQuery(token: string, siteUrl: string, body: object): Promise<GscResponse | null> {
  const url     = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`
  const host    = new URL(url).hostname
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  for (const siteId of [encodeURIComponent(url), `sc-domain%3A${host}`]) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${siteId}/searchAnalytics/query`,
        { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) },
      )
      if (!res.ok) continue
      const data = await res.json() as GscResponse
      if (data.rows?.length) return data
    } catch { continue }
  }
  return null
}

export interface GscResult {
  connected: boolean
  error: boolean
  clicks: number | null
  impressions: number | null
  avgCtr: number | null
  avgPosition: number | null
  topQueries: { query: string; clicks: number; impressions: number; position: number }[]
  topPages: { page: string; clicks: number; impressions: number }[]
  clickTrend: { date: string; clicks: number }[]
}

/**
 * @param days  Number of days to include in KPI metrics (1 = yesterday, 7 = last 7d, 30 = last 30d).
 *              The click trend chart is always 30d regardless.
 */
export async function fetchGsc(clientEmail: string, privateKey: string, siteUrl: string, days: number): Promise<GscResult> {
  const base: GscResult = { connected: true, error: false, clicks: null, impressions: null, avgCtr: null, avgPosition: null, topQueries: [], topPages: [], clickTrend: [] }
  const token = await getServiceToken(clientEmail, privateKey, 'https://www.googleapis.com/auth/webmasters.readonly')
  if (!token) return { ...base, error: true }

  const endDate   = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().split('T')[0]
  const trendDate = new Date(Date.now() - 29  * 86_400_000).toISOString().split('T')[0]  // always 30d

  const [summary, queries, pages, trend] = await Promise.all([
    gscQuery(token, siteUrl, { startDate, endDate, rowLimit: 1 }),
    gscQuery(token, siteUrl, { startDate, endDate, dimensions: ['query'], rowLimit: 10, orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }] }),
    gscQuery(token, siteUrl, { startDate, endDate, dimensions: ['page'],  rowLimit: 5,  orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }] }),
    gscQuery(token, siteUrl, { startDate: trendDate, endDate, dimensions: ['date'], rowLimit: 30, orderBy: [{ fieldName: 'date', sortOrder: 'ASCENDING' }] }),
  ])

  const agg = summary?.rows?.[0]
  return {
    ...base,
    clicks:      agg ? Math.round(agg.clicks)              : null,
    impressions: agg ? Math.round(agg.impressions)         : null,
    avgCtr:      agg ? Math.round(agg.ctr * 100)           : null,
    avgPosition: agg ? Math.round(agg.position * 10) / 10 : null,
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

type GA4Row    = { dimensionValues?: { value: string }[]; metricValues: { value: string }[] }
type GA4Report = { rows?: GA4Row[] }

async function ga4Report(token: string, propertyId: string, body: object): Promise<GA4Report | null> {
  const pid = propertyId.replace(/^properties\//, '')
  try {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    return await res.json() as GA4Report
  } catch { return null }
}

export interface Ga4Result {
  connected: boolean
  error: boolean
  sessions: number | null
  activeUsers: number | null
  newUsers: number | null
  pageviews: number | null
  engagementRate: number | null
  trafficSources: { channel: string; sessions: number }[]
  topPages: { page: string; sessions: number; newUsers: number; engagementRate: number }[]
  dailyTrend: { date: string; newUsers: number; sessions: number }[]
}

/**
 * @param days  Number of days for KPI window (1 | 7 | 30).
 *              The daily trend chart is always 30d regardless.
 */
export async function fetchGa4(clientEmail: string, privateKey: string, propertyId: string, days: number): Promise<Ga4Result> {
  const base: Ga4Result = { connected: true, error: false, sessions: null, activeUsers: null, newUsers: null, pageviews: null, engagementRate: null, trafficSources: [], topPages: [], dailyTrend: [] }
  const token = await getServiceToken(clientEmail, privateKey, 'https://www.googleapis.com/auth/analytics.readonly')
  if (!token) return { ...base, error: true }

  const ga4Start = days === 1 ? 'yesterday' : `${days}daysAgo`

  const [core, sources, pages, trend] = await Promise.all([
    ga4Report(token, propertyId, {
      dateRanges: [{ startDate: ga4Start, endDate: 'today' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' }, { name: 'screenPageViews' }, { name: 'engagementRate' }],
    }),
    ga4Report(token, propertyId, {
      dateRanges: [{ startDate: ga4Start, endDate: 'today' }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 6,
    }),
    ga4Report(token, propertyId, {
      dateRanges: [{ startDate: ga4Start, endDate: 'today' }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'engagementRate' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 5,
    }),
    // Daily trend always 30d — used for the chart, not affected by range picker
    ga4Report(token, propertyId, {
      dateRanges: [{ startDate: '29daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'newUsers' }, { name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    }),
  ])

  const coreRow = core?.rows?.[0]
  return {
    ...base,
    sessions:      coreRow ? parseInt(coreRow.metricValues[0]?.value ?? '0', 10)                           : null,
    activeUsers:   coreRow ? parseInt(coreRow.metricValues[1]?.value ?? '0', 10)                           : null,
    newUsers:      coreRow ? parseInt(coreRow.metricValues[2]?.value ?? '0', 10)                           : null,
    pageviews:     coreRow ? parseInt(coreRow.metricValues[3]?.value ?? '0', 10)                           : null,
    engagementRate:coreRow ? Math.round(parseFloat(coreRow.metricValues[4]?.value ?? '0') * 100)           : null,
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
      const raw  = r.dimensionValues?.[0]?.value ?? ''
      const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw
      return {
        date,
        newUsers: parseInt(r.metricValues[0]?.value ?? '0', 10),
        sessions: parseInt(r.metricValues[1]?.value ?? '0', 10),
      }
    }),
  }
}
