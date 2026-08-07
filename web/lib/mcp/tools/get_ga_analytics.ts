import { createSign } from 'crypto'
import { db } from '@/lib/db'
import { brandIntegrations, brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const NOT_CONNECTED = {
  connected: false,
  message: 'Google Analytics (GA4 API) is not connected. Go to Settings → Integrations → Google Analytics Data API to add your Service Account credentials.',
}

async function getToken(email: string, key: string): Promise<string | null> {
  try {
    const buf = (s: string) => Buffer.from(s).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const h = buf(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const p = buf(JSON.stringify({ iss: email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
    const input = `${h}.${p}`
    const sign = createSign('RSA-SHA256')
    sign.update(input)
    const sig = sign.sign(key.replace(/\\n/g, '\n'), 'base64url')
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${sig}` }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    return ((await res.json()) as { access_token?: string }).access_token ?? null
  } catch { return null }
}

type Row = { dimensionValues?: { value: string }[]; metricValues: { value: string }[] }

async function report(token: string, pid: string, body: object): Promise<Row[]> {
  try {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return []
    return ((await res.json()) as { rows?: Row[] }).rows ?? []
  } catch { return [] }
}

function ni(row: Row | undefined, i: number) {
  return row ? parseInt(row.metricValues[i]?.value ?? '0', 10) : 0
}
function dim(row: Row, i: number) {
  return row.dimensionValues?.[i]?.value ?? ''
}

export async function getGaAnalytics(brandId: string, period = '30d') {
  const [integration] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'ga4_api'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!integration) return NOT_CONNECTED

  const meta = (integration.metadata as Record<string, string> | null) ?? {}
  if (!meta.client_email || !meta.private_key || !meta.property_id) return NOT_CONNECTED

  const token = await getToken(meta.client_email, meta.private_key)
  if (!token) return { connected: true, error: 'GA4 authentication failed. Check your Service Account credentials.' }

  const pid = meta.property_id.replace(/^properties\//, '')
  const days = period === '7d' ? 6 : period === '90d' ? 89 : 29
  const dateRange = { startDate: `${days}daysAgo`, endDate: 'today' }

  const [overviewRows, channelRows, landingRows, pageRows] = await Promise.all([
    report(token, pid, {
      dateRanges: [dateRange],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'engagedSessions' },
        { name: 'averageSessionDuration' },
        { name: 'conversions' },
      ],
    }),
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagedSessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 8,
    }),
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'conversions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    }),
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'conversions' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10,
    }),
  ])

  const r = overviewRows[0]
  const overview = {
    sessions: ni(r, 0),
    activeUsers: ni(r, 1),
    newUsers: ni(r, 2),
    engagedSessions: ni(r, 3),
    avgEngagementTimeSec: Math.round(parseFloat(r?.metricValues[4]?.value ?? '0')),
    conversions: ni(r, 5),
  }

  const totalChannelSessions = channelRows.reduce((s, row) => s + ni(row, 0), 0) || 1
  const channels = channelRows.map(row => ({
    channel: dim(row, 0),
    sessions: ni(row, 0),
    users: ni(row, 1),
    engagedSessions: ni(row, 2),
    pct: Math.round((ni(row, 0) / totalChannelSessions) * 100),
  }))

  const landingPages = landingRows.map(row => ({
    page: dim(row, 0) || '/',
    sessions: ni(row, 0),
    newUsers: ni(row, 1),
    conversions: ni(row, 2),
  }))

  const topPages = pageRows.map(row => ({
    page: dim(row, 0) || '/',
    views: ni(row, 0),
    users: ni(row, 1),
    conversions: ni(row, 2),
  }))

  return {
    connected: true,
    period,
    overview,
    channels,
    landingPages,
    topPages,
  }
}
