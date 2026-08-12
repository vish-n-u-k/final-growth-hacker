import { NextRequest, NextResponse } from 'next/server'
import { createSign } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function getToken(email: string, key: string): Promise<string | null> {
  try {
    const buf = (s: string | Buffer) => Buffer.from(s).toString('base64url')
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
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: { message: string } }
      console.error('[ga4]', res.status, e?.error?.message)
      return []
    }
    return ((await res.json()) as { rows?: Row[] }).rows ?? []
  } catch (e) { console.error('[ga4]', e); return [] }
}

function n(row: Row | undefined, i: number) {
  return row ? parseInt(row.metricValues[i]?.value ?? '0', 10) : 0
}

function parseStats(rows: Row[]) {
  const r = rows[0]
  return { activeUsers: n(r, 0), newUsers: n(r, 1), returningUsers: Math.max(0, n(r, 0) - n(r, 1)) }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandIdParam = request.nextUrl.searchParams.get('brandId')
  const [brand] = brandIdParam
    ? await db.select().from(brands).where(and(eq(brands.id, brandIdParam), eq(brands.userId, user.id))).limit(1)
    : await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const [ga4Int] = await db.select().from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'ga4_api'), eq(brandIntegrations.status, 'connected')))
    .limit(1)
  if (!ga4Int) return NextResponse.json({ connected: false })

  const meta = (ga4Int.metadata as Record<string, string> | null) ?? {}
  if (!meta.client_email || !meta.private_key || !meta.property_id)
    return NextResponse.json({ connected: false })

  const token = await getToken(meta.client_email, meta.private_key)
  if (!token) return NextResponse.json({ connected: true, error: 'auth_failed' })

  const pid = meta.property_id.replace(/^properties\//, '')
  const periodParam = request.nextUrl.searchParams.get('period') ?? '30d'
  const dateRange =
    periodParam === '1d' ? { startDate: 'today',     endDate: 'today' } :
    periodParam === '7d' ? { startDate: '6daysAgo',  endDate: 'today' } :
                           { startDate: '29daysAgo', endDate: 'today' }

  const metrics = [{ name: 'activeUsers' }, { name: 'newUsers' }]
  const sessionMetrics = [{ name: 'sessions' }]

  // 8 calls — under GA4's 10 concurrent limit
  const [statsRows, trendRows, newVsRetRows, channelRows, landingRows, deviceRows, countryRows, browserRows] = await Promise.all([
    report(token, pid, { dateRanges: [dateRange], metrics }),
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'date' }],
      metrics,
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    }),
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'newVsReturning' }],
      metrics: [{ name: 'activeUsers' }],
    }),
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'sessionSourceMedium' }],
      metrics: sessionMetrics,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 20,
    }),
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'landingPage' }],
      metrics: sessionMetrics,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    }),
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: sessionMetrics,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }),
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'country' }],
      metrics: sessionMetrics,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    }),
    report(token, pid, {
      dateRanges: [dateRange],
      dimensions: [{ name: 'browser' }],
      metrics: sessionMetrics,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 8,
    }),
  ])

  const trend = trendRows.map(r => {
    const raw = r.dimensionValues?.[0]?.value ?? ''
    const date = raw.length === 8 ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}` : raw
    return { date, activeUsers: n(r, 0), newUsers: n(r, 1) }
  })

  const newVsRet = newVsRetRows.map(r => ({
    type: r.dimensionValues?.[0]?.value ?? 'unknown',
    activeUsers: n(r, 0),
  }))

  const totalChannelSessions = channelRows.reduce((s, r) => s + n(r, 0), 0) || 1
  const channels = channelRows.map(r => ({
    channel: r.dimensionValues?.[0]?.value ?? 'Unknown',
    sourceMedium: r.dimensionValues?.[1]?.value ?? '',
    sessions: n(r, 0),
    pct: Math.round((n(r, 0) / totalChannelSessions) * 100),
  }))

  const totalLandingSessions = landingRows.reduce((s, r) => s + n(r, 0), 0) || 1
  const landingPages = landingRows.map(r => ({
    page: r.dimensionValues?.[0]?.value ?? '/',
    sessions: n(r, 0),
    pct: Math.round((n(r, 0) / totalLandingSessions) * 100),
  }))

  const totalDeviceSessions = deviceRows.reduce((s, r) => s + n(r, 0), 0) || 1
  const devices = deviceRows.map(r => ({
    device: r.dimensionValues?.[0]?.value ?? 'unknown',
    sessions: n(r, 0),
    pct: Math.round((n(r, 0) / totalDeviceSessions) * 100),
  }))

  const totalCountrySessions = countryRows.reduce((s, r) => s + n(r, 0), 0) || 1
  const countries = countryRows.map(r => ({
    country: r.dimensionValues?.[0]?.value ?? 'Unknown',
    sessions: n(r, 0),
    pct: Math.round((n(r, 0) / totalCountrySessions) * 100),
  }))

  const totalBrowserSessions = browserRows.reduce((s, r) => s + n(r, 0), 0) || 1
  const browsers = browserRows.map(r => ({
    browser: r.dimensionValues?.[0]?.value ?? 'Unknown',
    sessions: n(r, 0),
    pct: Math.round((n(r, 0) / totalBrowserSessions) * 100),
  }))

  return NextResponse.json({
    connected: true,
    brandName: brand.name,
    propertyId: meta.property_id,
    stats: parseStats(statsRows),
    trend,
    newVsRet,
    channels,
    landingPages,
    devices,
    countries,
    browsers,
  })
}
