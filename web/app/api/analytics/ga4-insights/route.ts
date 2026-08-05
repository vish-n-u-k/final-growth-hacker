import { NextRequest, NextResponse } from 'next/server'
import { createSign } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

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
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: { message: string } }
      console.error('[ga4-insights]', res.status, e?.error?.message)
      return []
    }
    return ((await res.json()) as { rows?: Row[] }).rows ?? []
  } catch (e) { console.error('[ga4-insights]', e); return [] }
}

function ni(row: Row | undefined, i: number) {
  return row ? parseInt(row.metricValues[i]?.value ?? '0', 10) : 0
}
function nf(row: Row | undefined, i: number) {
  return row ? parseFloat(row.metricValues[i]?.value ?? '0') : 0
}
function dim(row: Row, i: number) {
  return row.dimensionValues?.[i]?.value ?? ''
}

function dateRanges(period: string) {
  const days = period === '90d' ? 90 : period === '7d' ? 7 : 30
  const curr = { startDate: `${days - 1}daysAgo`, endDate: 'today', name: 'current' }
  const prev = { startDate: `${days * 2 - 1}daysAgo`, endDate: `${days}daysAgo`, name: 'prior' }
  return { curr, prev, days }
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
  const period = request.nextUrl.searchParams.get('period') ?? '30d'
  const { curr, prev } = dateRanges(period)

  const [
    overviewRows,
    trendRows,
    newVsRetRows,
    channelRows,
    referralRows,
    landingRows,
    pageRows,
    geoRows,
    deviceRows,
    eventRows,
    timeRows,
  ] = await Promise.all([
    // 1. Overview — current + prior period in one call
    report(token, pid, {
      dateRanges: [curr, prev],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'engagedSessions' },
        { name: 'averageSessionDuration' },
        { name: 'screenPageViews' },
        { name: 'conversions' },
      ],
    }),
    // 2. Daily trend
    report(token, pid, {
      dateRanges: [curr],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    }),
    // 3. New vs returning
    report(token, pid, {
      dateRanges: [curr],
      dimensions: [{ name: 'newVsReturning' }],
      metrics: [{ name: 'activeUsers' }, { name: 'engagedSessions' }],
    }),
    // 4. Traffic channels
    report(token, pid, {
      dateRanges: [curr],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagedSessions' }, { name: 'conversions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 15,
    }),
    // 5. Referral sites
    report(token, pid, {
      dateRanges: [curr],
      dimensions: [{ name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagedSessions' }],
      dimensionFilter: {
        filter: {
          fieldName: 'sessionMedium',
          stringFilter: { value: 'referral', matchType: 'EXACT' },
        },
      },
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 20,
    }),
    // 6. Landing pages
    report(token, pid, {
      dateRanges: [curr],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'averageSessionDuration' }, { name: 'conversions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 15,
    }),
    // 7. Page performance
    report(token, pid, {
      dateRanges: [curr],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'averageSessionDuration' }, { name: 'conversions' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 20,
    }),
    // 8. Geography
    report(token, pid, {
      dateRanges: [curr],
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'engagedSessions' }, { name: 'conversions' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 10,
    }),
    // 9. Devices
    report(token, pid, {
      dateRanges: [curr],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'engagedSessions' }, { name: 'conversions' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    }),
    // 10. Events
    report(token, pid, {
      dateRanges: [curr],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 20,
    }),
    // 11. Time analysis (dayOfWeek + hour)
    report(token, pid, {
      dateRanges: [curr],
      dimensions: [{ name: 'dayOfWeek' }, { name: 'hour' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ dimension: { dimensionName: 'dayOfWeek' }, desc: false }],
      limit: 200,
    }),
  ])

  // Parse overview — GA4 returns rows with dateRangeName dimension when multiple ranges used
  // When dateRanges has 2 entries, GA4 appends a dateRange dimension to dimensionValues
  // But since we have NO dimensions, rows come back as 2 rows: row[0]=current, row[1]=prior
  function parseOverview(rows: Row[], idx: number) {
    const r = rows[idx]
    if (!r) return { sessions: 0, activeUsers: 0, newUsers: 0, engagedSessions: 0, avgEngagementTime: 0, pageviews: 0, conversions: 0 }
    return {
      sessions: ni(r, 0),
      activeUsers: ni(r, 1),
      newUsers: ni(r, 2),
      engagedSessions: ni(r, 3),
      avgEngagementTime: Math.round(nf(r, 4)),
      pageviews: ni(r, 5),
      conversions: ni(r, 6),
    }
  }

  const overview = {
    current: parseOverview(overviewRows, 0),
    prior: parseOverview(overviewRows, 1),
  }

  const trend = trendRows.map(r => {
    const raw = dim(r, 0)
    const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw
    return { date, activeUsers: ni(r, 0), newUsers: ni(r, 1), sessions: ni(r, 2) }
  })

  const newVsReturning = newVsRetRows.map(r => ({
    type: dim(r, 0),
    users: ni(r, 0),
    engagedSessions: ni(r, 1),
  }))

  const totalChannelSessions = channelRows.reduce((s, r) => s + ni(r, 0), 0) || 1
  const channels = channelRows.map(r => ({
    channel: dim(r, 0),
    sessions: ni(r, 0),
    users: ni(r, 1),
    engagedSessions: ni(r, 2),
    conversions: ni(r, 3),
    pct: Math.round((ni(r, 0) / totalChannelSessions) * 100),
  }))

  const referrals = referralRows.map(r => ({
    source: dim(r, 0),
    sessions: ni(r, 0),
    users: ni(r, 1),
    engagedSessions: ni(r, 2),
  })).filter(r => r.source && r.source !== '(direct)' && r.source !== '(none)')

  const totalLandingSessions = landingRows.reduce((s, r) => s + ni(r, 0), 0) || 1
  const landingPages = landingRows.map(r => ({
    page: dim(r, 0) || '/',
    sessions: ni(r, 0),
    newUsers: ni(r, 1),
    avgEngagementTime: Math.round(nf(r, 2)),
    conversions: ni(r, 3),
    pct: Math.round((ni(r, 0) / totalLandingSessions) * 100),
  }))

  const pagePerformance = pageRows.map(r => ({
    page: dim(r, 0) || '/',
    views: ni(r, 0),
    users: ni(r, 1),
    avgEngagementTime: Math.round(nf(r, 2)),
    conversions: ni(r, 3),
  }))

  const geography = geoRows.map(r => ({
    country: dim(r, 0),
    users: ni(r, 0),
    sessions: ni(r, 1),
    engagedSessions: ni(r, 2),
    conversions: ni(r, 3),
  }))

  const devices = deviceRows.map(r => ({
    device: dim(r, 0),
    users: ni(r, 0),
    sessions: ni(r, 1),
    engagedSessions: ni(r, 2),
    conversions: ni(r, 3),
  }))

  const events = eventRows.map(r => ({
    name: dim(r, 0),
    count: ni(r, 0),
  }))

  // GA4 dayOfWeek: 0=Sunday, 1=Monday, …, 6=Saturday
  const timeAnalysis = timeRows.map(r => ({
    dow: parseInt(dim(r, 0), 10),
    hour: parseInt(dim(r, 1), 10),
    users: ni(r, 0),
  }))

  return NextResponse.json({
    connected: true,
    period,
    propertyId: meta.property_id,
    overview,
    trend,
    newVsReturning,
    channels,
    referrals,
    landingPages,
    pagePerformance,
    geography,
    devices,
    events,
    timeAnalysis,
  })
}
