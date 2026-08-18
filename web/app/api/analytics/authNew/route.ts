import { NextRequest, NextResponse } from 'next/server'
import { createSign } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 55

// ── JWT / Google auth ───────────────────────────────────────────────────────

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

// ── PostHog helpers ─────────────────────────────────────────────────────────

async function hogqlRows(host: string, projectId: string, apiKey: string, query: string): Promise<unknown[][] | null> {
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const data = await res.json() as { results?: unknown[][] }
    return data.results ?? null
  } catch { return null }
}

// ── GSC helpers ─────────────────────────────────────────────────────────────

async function gscQuery(
  token: string, siteUrl: string, body: object,
): Promise<{ rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] } | null> {
  const url    = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`
  const host   = new URL(url).hostname
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

// ── GA4 helpers ─────────────────────────────────────────────────────────────

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

type GA4Row = { dimensionValues?: { value: string }[]; metricValues: { value: string }[] }
type GA4Report = { rows?: GA4Row[] }

// ── Path normalization ──────────────────────────────────────────────────────

function extractPath(rawUrl: string): string {
  if (!rawUrl || rawUrl === 'null') return '/'
  try {
    const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https://x.com${rawUrl}`)
    return u.pathname || '/'
  } catch { return rawUrl.split('?')[0] || '/' }
}

function normalizeChannel(ch: string): string {
  return (ch || 'unknown').toLowerCase().replace(/\s+/g, '_')
}

function normalizeSource(utmSource: string, referringDomain: string): string {
  const src = (utmSource || referringDomain || '').toLowerCase()
  if (!src || src === '(direct)' || src === 'direct') return 'Direct'
  if (src.includes('google')) return 'Google'
  if (src.includes('facebook') || src.includes('fb')) return 'Facebook'
  if (src.includes('instagram')) return 'Instagram'
  if (src.includes('linkedin')) return 'LinkedIn'
  if (src.includes('twitter') || src.includes('t.co') || src === 'x') return 'Twitter/X'
  if (src.includes('youtube')) return 'YouTube'
  if (src.includes('tiktok')) return 'TikTok'
  const domain = referringDomain.replace(/^www\./, '').split('/')[0]
  return domain || utmSource || 'Direct'
}

function getStatus(lastSeenIso: string | null): 'active' | 'dormant' | 'churned' | 'new' {
  if (!lastSeenIso) return 'new'
  const diffDays = (Date.now() - new Date(lastSeenIso).getTime()) / 86_400_000
  if (diffDays <= 7)  return 'active'
  if (diffDays <= 30) return 'dormant'
  return 'churned'
}

function relativeTime(isoStr: string): string {
  const diffMs  = Date.now() - new Date(isoStr).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 60)  return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)   return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 30)   return `${diffD}d ago`
  return `${Math.floor(diffD / 30)}mo ago`
}

// ── Route ───────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = request.nextUrl.searchParams.get('brandId')
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 })

  const [brand] = await db.select().from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id))).limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const integrations = await db.select().from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.status, 'connected')))

  const intMap = new Map(integrations.map(i => [i.provider, i]))
  const phInt  = intMap.get('posthog')
  const gscInt = intMap.get('gsc_api')
  const ga4Int = intMap.get('ga4_api')

  // ── Parallel fetch from all three sources ───────────────────────────────

  const [phResult, gscResult, ga4Result] = await Promise.all([
    // ── PostHog ──────────────────────────────────────────────────────────
    (async () => {
      if (!phInt?.apiKey) return null
      const meta      = (phInt.metadata as Record<string, string> | null) ?? {}
      const projectId = meta['project_id']
      const host      = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')
      if (!projectId) return null
      const key = phInt.apiKey

      const [
        personRows,
        activityRows,
        sessionRows,
        signupsBySourceRows,
        signupsByChannelRows,
        activeBySourceRows,
        signupsByPathRows,
        signupsByDeviceRows,
        signupsByCountryRows,
      ] = await Promise.all([
        // User list (300 most recent identified users)
        hogqlRows(host, projectId, key, `
          SELECT
            id,
            coalesce(
              nullIf(toString(properties.$email), ''),
              nullIf(toString(properties.email), ''),
              nullIf(toString(properties.Email), ''),
              ''
            ),
            coalesce(
              nullIf(toString(properties.$name), ''),
              nullIf(toString(properties.name), ''),
              nullIf(toString(properties.full_name), ''),
              nullIf(toString(properties.username), ''),
              ''
            ),
            toString(created_at),
            coalesce(toString(properties.$initial_referring_domain), ''),
            coalesce(toString(properties.$initial_utm_source), ''),
            coalesce(toString(properties.$initial_utm_medium), ''),
            coalesce(toString(properties.$geoip_country_name), ''),
            coalesce(toString(properties.$initial_current_url), '')
          FROM persons
          WHERE is_identified = 1
          ORDER BY created_at DESC
          LIMIT 300
        `),
        // Per-person activity (90d)
        hogqlRows(host, projectId, key, `
          SELECT
            person_id,
            count() as total_events,
            countIf(event = '$pageview') as pageviews,
            toString(max(timestamp)) as last_seen
          FROM events
          WHERE person_id IN (SELECT id FROM persons WHERE is_identified = 1)
            AND timestamp >= now() - interval 90 day
          GROUP BY person_id
        `),
        // Per-person session stats (90d)
        hogqlRows(host, projectId, key, `
          SELECT
            person_id,
            round(sum($session_duration)) as total_session_secs,
            count(DISTINCT $session_id) as session_count
          FROM sessions
          WHERE $start_timestamp >= now() - interval 90 day
            AND person_id IN (SELECT id FROM persons WHERE is_identified = 1)
          GROUP BY person_id
        `),
        // Signups per source (30d)
        hogqlRows(host, projectId, key, `
          SELECT
            coalesce(toString(properties.$initial_utm_source), ''),
            coalesce(toString(properties.$initial_referring_domain), ''),
            count()
          FROM persons
          WHERE is_identified = 1
            AND created_at >= now() - interval 30 day
          GROUP BY 1, 2
          ORDER BY 3 DESC
          LIMIT 20
        `),
        // Signups by channel_type (30d)
        hogqlRows(host, projectId, key, `
          SELECT
            coalesce(toString(properties.$initial_channel_type), 'Unknown'),
            count()
          FROM persons
          WHERE is_identified = 1
            AND created_at >= now() - interval 30 day
          GROUP BY 1
          ORDER BY 2 DESC
        `),
        // Active users per source (7d)
        hogqlRows(host, projectId, key, `
          SELECT
            coalesce(toString(p.properties.$initial_utm_source), ''),
            coalesce(toString(p.properties.$initial_referring_domain), ''),
            count(DISTINCT e.person_id)
          FROM events e
          JOIN persons p ON e.person_id = p.id
          WHERE e.timestamp >= now() - interval 7 day
            AND p.is_identified = 1
          GROUP BY 1, 2
          ORDER BY 3 DESC
          LIMIT 20
        `),
        // Signups by initial landing path (30d)
        hogqlRows(host, projectId, key, `
          SELECT
            coalesce(toString(properties.$initial_current_url), ''),
            count()
          FROM persons
          WHERE is_identified = 1
            AND created_at >= now() - interval 30 day
          GROUP BY 1
          ORDER BY 2 DESC
          LIMIT 20
        `),
        // Signups by device type (30d)
        hogqlRows(host, projectId, key, `
          SELECT
            coalesce(
              nullIf(toString(properties.$initial_device_type), ''),
              'Unknown'
            ),
            count()
          FROM persons
          WHERE is_identified = 1
            AND created_at >= now() - interval 30 day
          GROUP BY 1
          ORDER BY 2 DESC
        `),
        // Signups by country (30d)
        hogqlRows(host, projectId, key, `
          SELECT
            coalesce(
              nullIf(toString(properties.$geoip_country_name), ''),
              'Unknown'
            ),
            count()
          FROM persons
          WHERE is_identified = 1
            AND created_at >= now() - interval 30 day
          GROUP BY 1
          ORDER BY 2 DESC
          LIMIT 10
        `),
      ])

      // Build maps
      const activityMap = new Map<string, { totalEvents: number; pageviews: number; lastSeen: string }>()
      for (const r of activityRows ?? []) {
        activityMap.set(String(r[0]), {
          totalEvents: Number(r[1]),
          pageviews:   Number(r[2]),
          lastSeen:    String(r[3]),
        })
      }

      const sessionMap = new Map<string, { totalSecs: number; sessionCount: number }>()
      for (const r of sessionRows ?? []) {
        sessionMap.set(String(r[0]), {
          totalSecs:    Number(r[1]),
          sessionCount: Number(r[2]),
        })
      }

      // User list
      const users = (personRows ?? []).map(r => {
        const userId        = String(r[0])
        const email         = String(r[1])
        const name          = String(r[2])
        const signedUpAt    = String(r[3])
        const referringDomain = String(r[4])
        const utmSource     = String(r[5])
        const utmMedium     = String(r[6])
        const country       = String(r[7])
        const initialUrl    = String(r[8])
        const activity      = activityMap.get(userId)
        const session       = sessionMap.get(userId)
        const lastSeen      = activity?.lastSeen ?? null
        const source        = normalizeSource(utmSource, referringDomain)
        const status        = getStatus(lastSeen)
        const sessionCount  = session?.sessionCount ?? 0
        const totalSessionTimeSecs = session?.totalSecs ?? 0
        return {
          userId, email, name, signedUpAt,
          signedUpRel:    relativeTime(signedUpAt),
          source, utmMedium, country, initialUrl,
          lastSeen,
          lastSeenRel:    lastSeen ? relativeTime(lastSeen) : null,
          status,
          totalEvents:    activity?.totalEvents ?? 0,
          pageviews:      activity?.pageviews ?? 0,
          totalSessionTimeSecs,
          sessionCount,
          avgSessionTimeSecs: sessionCount > 0 ? Math.round(totalSessionTimeSecs / sessionCount) : 0,
        }
      })

      // Signups by source (deduplicated)
      const signupSourceMap = new Map<string, { signups: number; activeUsers: number }>()
      for (const r of signupsBySourceRows ?? []) {
        const src = normalizeSource(String(r[0]), String(r[1]))
        const existing = signupSourceMap.get(src) ?? { signups: 0, activeUsers: 0 }
        existing.signups += Number(r[2])
        signupSourceMap.set(src, existing)
      }
      for (const r of activeBySourceRows ?? []) {
        const src = normalizeSource(String(r[0]), String(r[1]))
        const existing = signupSourceMap.get(src) ?? { signups: 0, activeUsers: 0 }
        existing.activeUsers += Number(r[2])
        signupSourceMap.set(src, existing)
      }
      const signupsBySource = Array.from(signupSourceMap.entries())
        .map(([source, d]) => ({ source, signups: d.signups, activeUsers: d.activeUsers }))
        .sort((a, b) => b.signups - a.signups)

      // Signups by channel type
      const signupsByChannel = (signupsByChannelRows ?? []).map(r => ({
        channel: String(r[0]),
        signups: Number(r[1]),
      }))

      // Signups by landing path
      const signupsByPath = (signupsByPathRows ?? []).map(r => ({
        path: extractPath(String(r[0])),
        signups: Number(r[1]),
      }))

      // Signups by device
      const signupsByDevice = (signupsByDeviceRows ?? []).map(r => ({
        device: String(r[0]),
        signups: Number(r[1]),
      }))

      // Signups by country
      const signupsByCountry = (signupsByCountryRows ?? []).map(r => ({
        country: String(r[0]),
        signups: Number(r[1]),
      }))

      // Total signups (30d)
      const totalSignups30d = signupsBySource.reduce((s, r) => s + r.signups, 0)
      // Active users (7d)
      const totalActive7d = signupsBySource.reduce((s, r) => s + r.activeUsers, 0)

      return {
        connected: true,
        users,
        signupsBySource,
        signupsByChannel,
        signupsByPath,
        signupsByDevice,
        signupsByCountry,
        totalSignups30d,
        totalActive7d,
      }
    })(),

    // ── GSC ───────────────────────────────────────────────────────────────
    (async () => {
      if (!gscInt) return null
      const meta = (gscInt.metadata as Record<string, string> | null) ?? {}
      if (!meta.client_email || !meta.private_key) return null

      const token = await getServiceToken(
        meta.client_email, meta.private_key,
        'https://www.googleapis.com/auth/webmasters.readonly',
      )
      if (!token) return null

      const end30   = new Date().toISOString().split('T')[0]
      const start30 = new Date(Date.now() - 29 * 86400_000).toISOString().split('T')[0]
      const siteUrl = brand.websiteUrl

      const [agg, topQueries, topPages] = await Promise.all([
        gscQuery(token, siteUrl, { startDate: start30, endDate: end30, rowLimit: 1 }),
        gscQuery(token, siteUrl, {
          startDate: start30, endDate: end30,
          dimensions: ['query'], rowLimit: 10,
          orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
        }),
        gscQuery(token, siteUrl, {
          startDate: start30, endDate: end30,
          dimensions: ['page'], rowLimit: 15,
          orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
        }),
      ])

      const aggRow = agg?.rows?.[0]
      return {
        connected: true,
        impressions30d: aggRow ? Math.round(aggRow.impressions) : null,
        clicks30d:      aggRow ? Math.round(aggRow.clicks)      : null,
        avgCtr30d:      aggRow ? Math.round(aggRow.ctr * 100)   : null,
        avgPosition30d: aggRow ? Math.round(aggRow.position * 10) / 10 : null,
        topQueries: (topQueries?.rows ?? []).map(r => ({
          query:       r.keys[0] ?? '',
          clicks:      Math.round(r.clicks),
          impressions: Math.round(r.impressions),
          position:    Math.round(r.position * 10) / 10,
        })),
        topPages: (topPages?.rows ?? []).map(r => ({
          page:        extractPath(r.keys[0] ?? ''),
          clicks:      Math.round(r.clicks),
          impressions: Math.round(r.impressions),
        })),
      }
    })(),

    // ── GA4 ───────────────────────────────────────────────────────────────
    (async () => {
      if (!ga4Int) return null
      const meta = (ga4Int.metadata as Record<string, string> | null) ?? {}
      if (!meta.client_email || !meta.private_key || !meta.property_id) return null

      const token = await getServiceToken(
        meta.client_email, meta.private_key,
        'https://www.googleapis.com/auth/analytics.readonly',
      )
      if (!token) return null

      const [channelReport, landingReport] = await Promise.all([
        ga4Report(token, meta.property_id, {
          dateRanges: [{ startDate: '29daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics:    [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'engagedSessions' }],
          orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 20,
        }) as Promise<GA4Report | null>,
        ga4Report(token, meta.property_id, {
          dateRanges: [{ startDate: '29daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'landingPage' }],
          metrics:    [{ name: 'sessions' }, { name: 'newUsers' }],
          orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 20,
        }) as Promise<GA4Report | null>,
      ])

      const totalSessions = (channelReport?.rows ?? []).reduce(
        (s, r) => s + parseInt(r.metricValues[0]?.value ?? '0', 10), 0,
      )

      const channels = (channelReport?.rows ?? []).map(r => ({
        channel:        r.dimensionValues?.[0]?.value ?? 'Unknown',
        channelKey:     normalizeChannel(r.dimensionValues?.[0]?.value ?? ''),
        sessions:       parseInt(r.metricValues[0]?.value ?? '0', 10),
        newUsers:       parseInt(r.metricValues[1]?.value ?? '0', 10),
        engagedSessions:parseInt(r.metricValues[2]?.value ?? '0', 10),
      }))

      const landingPages = (landingReport?.rows ?? []).map(r => ({
        path:     extractPath(r.dimensionValues?.[0]?.value ?? '/'),
        sessions: parseInt(r.metricValues[0]?.value ?? '0', 10),
        newUsers: parseInt(r.metricValues[1]?.value ?? '0', 10),
      }))

      return { connected: true, totalSessions30d: totalSessions, channels, landingPages }
    })(),
  ])

  // ── Build funnel ─────────────────────────────────────────────────────────

  const impressions = gscResult?.impressions30d ?? null
  const gscClicks   = gscResult?.clicks30d ?? null
  const ga4Sessions = ga4Result?.totalSessions30d ?? null
  const phSignups   = phResult?.totalSignups30d ?? null
  const phActive    = phResult?.totalActive7d ?? null

  const funnel = {
    impressions,
    clicks:     gscClicks,
    sessions:   ga4Sessions,
    signups:    phSignups,
    activeUsers:phActive,
    clickThroughRate:    impressions && gscClicks ? Math.round((gscClicks / impressions) * 100 * 10) / 10 : null,
    sessionToSignupRate: ga4Sessions && phSignups  ? Math.round((phSignups / ga4Sessions) * 100 * 10) / 10 : null,
    signupToActiveRate:  phSignups && phActive     ? Math.round((phActive  / phSignups)  * 100 * 10) / 10 : null,
  }

  // ── Channel quality matrix ───────────────────────────────────────────────

  const channelMap = new Map<string, {
    channel: string; ga4Sessions: number; phSignups: number; phActiveUsers: number; gscClicks: number
  }>()

  for (const ch of ga4Result?.channels ?? []) {
    channelMap.set(ch.channelKey, {
      channel: ch.channel, ga4Sessions: ch.sessions, phSignups: 0, phActiveUsers: 0, gscClicks: 0,
    })
  }

  // Map PostHog channel types onto GA4 channels
  for (const ch of phResult?.signupsByChannel ?? []) {
    const key = normalizeChannel(ch.channel)
    const existing = channelMap.get(key)
    if (existing) {
      existing.phSignups = ch.signups
    } else {
      channelMap.set(key, { channel: ch.channel, ga4Sessions: 0, phSignups: ch.signups, phActiveUsers: 0, gscClicks: 0 })
    }
  }

  // GSC clicks onto organic search row
  if (gscResult?.clicks30d) {
    for (const key of ['organic_search', 'organic search']) {
      const row = channelMap.get(key)
      if (row) { row.gscClicks = gscResult.clicks30d; break }
    }
  }

  const channelMatrix = Array.from(channelMap.values())
    .map(row => ({
      ...row,
      retentionPct: row.phSignups > 0
        ? Math.round((row.phActiveUsers / row.phSignups) * 100)
        : null,
    }))
    .sort((a, b) => (b.ga4Sessions + b.phSignups) - (a.ga4Sessions + a.phSignups))

  // ── Enriched landing pages ───────────────────────────────────────────────

  const pageMap = new Map<string, { path: string; gscClicks: number; ga4Sessions: number; phSignups: number }>()

  const ensurePage = (path: string) => {
    if (!pageMap.has(path)) pageMap.set(path, { path, gscClicks: 0, ga4Sessions: 0, phSignups: 0 })
    return pageMap.get(path)!
  }

  for (const p of gscResult?.topPages ?? []) {
    ensurePage(p.page).gscClicks += p.clicks
  }
  for (const p of ga4Result?.landingPages ?? []) {
    ensurePage(p.path).ga4Sessions += p.sessions
  }
  for (const p of phResult?.signupsByPath ?? []) {
    ensurePage(p.path).phSignups += p.signups
  }

  const enrichedLandingPages = Array.from(pageMap.values())
    .sort((a, b) => (b.gscClicks + b.ga4Sessions + b.phSignups) - (a.gscClicks + a.ga4Sessions + a.phSignups))
    .slice(0, 15)

  return NextResponse.json({
    funnel,
    channelMatrix,
    enrichedLandingPages,
    gsc: {
      connected:  !!gscResult,
      topQueries: gscResult?.topQueries ?? [],
      topPages:   gscResult?.topPages   ?? [],
      impressions30d: gscResult?.impressions30d ?? null,
      clicks30d:      gscResult?.clicks30d      ?? null,
      avgCtr30d:      gscResult?.avgCtr30d      ?? null,
      avgPosition30d: gscResult?.avgPosition30d ?? null,
    },
    ga4: {
      connected: !!ga4Result,
    },
    posthog: {
      connected:        !!phResult,
      signupsBySource:  phResult?.signupsBySource  ?? [],
      signupsByDevice:  phResult?.signupsByDevice  ?? [],
      signupsByCountry: phResult?.signupsByCountry ?? [],
      users:            phResult?.users ?? [],
    },
  })
}
