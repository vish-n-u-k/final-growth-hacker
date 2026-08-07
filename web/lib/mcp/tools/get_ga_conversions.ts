import { createSign } from 'crypto'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
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

export async function getGaConversions(brandId: string, period = '30d') {
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

  const [byPageRows, byEventRows, byChannelRows] = await Promise.all([
    // Conversions broken down by page path
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'conversions' }, { name: 'sessions' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          stringFilter: { value: 'conversion', matchType: 'EXACT' },
        },
      },
      orderBys: [{ metric: { metricName: 'conversions' }, desc: true }],
      limit: 15,
    }),
    // Conversions broken down by event name
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'conversions' }],
      orderBys: [{ metric: { metricName: 'conversions' }, desc: true }],
      limit: 15,
    }),
    // Conversions broken down by traffic channel
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'conversions' }, { name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'conversions' }, desc: true }],
      limit: 10,
    }),
  ])

  const totalConversions = byEventRows.reduce((s, r) => s + ni(r, 0), 0) || 0

  const byPage = byPageRows
    .filter(r => ni(r, 0) > 0)
    .map(r => ({
      page: dim(r, 0) || '/',
      conversions: ni(r, 0),
      sessions: ni(r, 1),
      conversionRate: ni(r, 1) > 0 ? Math.round((ni(r, 0) / ni(r, 1)) * 1000) / 10 : 0,
    }))

  const byEvent = byEventRows
    .filter(r => ni(r, 0) > 0)
    .map(r => ({
      event: dim(r, 0),
      conversions: ni(r, 0),
    }))

  const byChannel = byChannelRows
    .filter(r => ni(r, 0) > 0)
    .map(r => ({
      channel: dim(r, 0),
      conversions: ni(r, 0),
      sessions: ni(r, 1),
      conversionRate: ni(r, 1) > 0 ? Math.round((ni(r, 0) / ni(r, 1)) * 1000) / 10 : 0,
    }))

  return {
    connected: true,
    period,
    totalConversions,
    byPage,
    byEvent,
    byChannel,
  }
}
