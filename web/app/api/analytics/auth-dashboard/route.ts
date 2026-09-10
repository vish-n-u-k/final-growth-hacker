import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { buildPostHogFilter } from '@/lib/posthog/filter'
import { fetchGsc, fetchGa4 } from '@/lib/analytics/google-providers'

export const dynamic = 'force-dynamic'

export const maxDuration = 45

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

  // Card overrides — always fresh from DB (never cached)
  type CardOverride = { label?: string; events?: string[] }
  const cardOverrides = (brand.analyticsCardOverrides as Record<string, CardOverride> | null) ?? {}

  // Return cached snapshot if available, not forced, and contains new fields
  const snap = brand.analyticsSnapshot as Record<string, unknown> | null
  const snapIsFresh = snap && snap['_v'] === 12 && 'proUsers' in snap
  if (!force && snapIsFresh && brand.analyticsSnapshotAt) {
    return NextResponse.json({
      ...snap,
      snapshotAt: brand.analyticsSnapshotAt.toISOString(),
      cardOverrides,
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
    posthogConnected: boolean
    signups24h: number; signups7d: number; signups30d: number
    signupsPrev24h: number; signupsPrev7d: number; signupsPrev30d: number
    signins24h: number; signins7d: number; signins30d: number
    signinsPrev24h: number; signinsPrev7d: number; signinsPrev30d: number
    dau: number; activeUsers7d: number; mau: number
    dauPrev: number; activeUsersPrev7d: number; mauPrev: number
    deletedAccounts24h: number; deleted7d: number; deleted30d: number
    deletedPrev24h: number; deletedPrev7d: number; deletedPrev30d: number
    totalUsers: number
    proUsers: number
    retention: { day: string; rate: number }[] | null
    funnel: { stage: string; value: number }[] | null
    activationFunnel: { stage: string; value: number }[] | null
    wau: { week: string; users: number }[] | null
    pmf: { event: string; label: string; retainedAvg: number; churnedAvg: number }[] | null
    webAnalytics: WebAnalytics | null
  } = {
    posthogConnected: false,
    signups24h: 0, signups7d: 0, signups30d: 0,
    signupsPrev24h: 0, signupsPrev7d: 0, signupsPrev30d: 0,
    signins24h: 0, signins7d: 0, signins30d: 0,
    signinsPrev24h: 0, signinsPrev7d: 0, signinsPrev30d: 0,
    dau: 0, activeUsers7d: 0, mau: 0,
    dauPrev: 0, activeUsersPrev7d: 0, mauPrev: 0,
    deletedAccounts24h: 0, deleted7d: 0, deleted30d: 0,
    deletedPrev24h: 0, deletedPrev7d: 0, deletedPrev30d: 0,
    totalUsers: 0,
    proUsers: 0,
    retention: null, funnel: null, activationFunnel: null, wau: null, pmf: null, webAnalytics: null,
  }

  if (phInt?.apiKey) {
    const meta = (phInt.metadata as Record<string, string> | null) ?? {}
    const projectId = meta['project_id']
    const host = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')

    if (projectId) {
      const key = phInt.apiKey
      const f = buildPostHogFilter(meta)

      // Build override-aware query strings for Type B cards
      const deletedEvents = cardOverrides['deleted']?.events?.length
        ? cardOverrides['deleted'].events
        : ['account_deleted', 'user_deleted', 'delete_account']
      const deletedIn = deletedEvents.map(e => `'${e.replace(/'/g, "\\'")}'`).join(', ')

      const proEvents = cardOverrides['pro']?.events?.length ? cardOverrides['pro'].events : null
      const proHogQuery = proEvents
        ? `SELECT count() FROM events WHERE event IN (${proEvents.map(e => `'${e.replace(/'/g, "\\'")}'`).join(', ')})`
        : `SELECT count() FROM persons WHERE properties.plan = 'pro'`

      const [
        signupsRows, signinsRows, activeUsersRows, deletedRows,
        retentionRaw, funnelRaw,
        coreCurrentRows, corePriorRows,
        sessionCurrentRows, sessionPriorRows,
        visitorsChartRows, topPathsRows,
        channelsRows, devicesRows, countriesRows, activeHoursRows,
        activationFunnelRaw, wauRows, pmfRetainedRows, pmfChurnedRows,
        totalUsersRows, proUsersCount,
      ] = await Promise.all([
        // Signups: 3 current windows + 3 prior period windows in one query
        hogqlRows(host, projectId, key, `SELECT countIf(created_at >= now() - interval 1 day), countIf(created_at >= now() - interval 7 day), countIf(created_at >= now() - interval 30 day), countIf(created_at >= now() - interval 2 day AND created_at < now() - interval 1 day), countIf(created_at >= now() - interval 14 day AND created_at < now() - interval 7 day), countIf(created_at >= now() - interval 60 day AND created_at < now() - interval 30 day) FROM persons ${f.personWhereClause}`),
        // Sign-ins: 3 current windows + 3 prior period windows in one query
        hogqlRows(host, projectId, key, `SELECT countIf(timestamp >= now() - interval 1 day), countIf(timestamp >= now() - interval 7 day), countIf(timestamp >= now() - interval 30 day), countIf(timestamp >= now() - interval 2 day AND timestamp < now() - interval 1 day), countIf(timestamp >= now() - interval 14 day AND timestamp < now() - interval 7 day), countIf(timestamp >= now() - interval 60 day AND timestamp < now() - interval 30 day) FROM events WHERE event = '$identify' ${f.personSubqueryAndClause}`),
        // Active users: 3 current windows + 3 prior period windows in one query
        hogqlRows(host, projectId, key, `SELECT count(DISTINCT if(timestamp >= now() - interval 1 day, ${f.eventDistinctCol}, null)), count(DISTINCT if(timestamp >= now() - interval 7 day, ${f.eventDistinctCol}, null)), count(DISTINCT if(timestamp >= now() - interval 30 day, ${f.eventDistinctCol}, null)), count(DISTINCT if(timestamp >= now() - interval 2 day AND timestamp < now() - interval 1 day, ${f.eventDistinctCol}, null)), count(DISTINCT if(timestamp >= now() - interval 14 day AND timestamp < now() - interval 7 day, ${f.eventDistinctCol}, null)), count(DISTINCT if(timestamp >= now() - interval 60 day AND timestamp < now() - interval 30 day, ${f.eventDistinctCol}, null)) FROM events WHERE ${f.eventPersonWherePrefix}timestamp >= now() - interval 60 day`),
        // Deleted accounts: 3 current windows + 3 prior period windows (events configurable via cardOverrides)
        hogqlRows(host, projectId, key, `SELECT countIf(timestamp >= now() - interval 1 day), countIf(timestamp >= now() - interval 7 day), countIf(timestamp >= now() - interval 30 day), countIf(timestamp >= now() - interval 2 day AND timestamp < now() - interval 1 day), countIf(timestamp >= now() - interval 14 day AND timestamp < now() - interval 7 day), countIf(timestamp >= now() - interval 60 day AND timestamp < now() - interval 30 day) FROM events WHERE event IN (${deletedIn}) ${f.personSubqueryAndClause}`),
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
        // Activation funnel: signup → brand setup → first post → social → publish
        phQuery(host, projectId, key, {
          kind: 'FunnelsQuery',
          series: [
            { kind: 'EventsNode', event: 'onboarding_started',       name: 'Signed up'       },
            { kind: 'EventsNode', event: 'onboarding_completed',     name: 'Brand setup'     },
            { kind: 'EventsNode', event: 'post_generated',           name: 'First post'      },
            { kind: 'EventsNode', event: 'social_account_connected', name: 'Social connected'},
            { kind: 'EventsNode', event: 'post_shared',              name: 'Published'       },
          ],
          funnelsFilter: { funnel_window_days: 30 },
          dateRange: { date_from: '-90d' },
        }),
        // Daily active users — 30 days
        hogqlRows(host, projectId, key, `SELECT toDate(timestamp) AS day, count(DISTINCT ${f.eventDistinctCol}) FROM events WHERE ${f.eventPersonWherePrefix}timestamp >= now() - interval 30 day GROUP BY day ORDER BY day ASC`),
        // PMF — retained users (active last 28d, never deleted): avg events per user per feature
        hogqlRows(host, projectId, key, `SELECT event, round(count() / count(DISTINCT person_id), 1) FROM events WHERE person_id IN (${f.personSubquery}) AND person_id IN (SELECT DISTINCT person_id FROM events WHERE timestamp >= now() - interval 28 day) AND person_id NOT IN (SELECT DISTINCT person_id FROM events WHERE event = 'account_deleted') AND event IN ('feed_viewed', 'post_generate_started', 'post_generated', 'post_downloaded', 'post_shared', 'post_schedule_started', 'social_account_connected') AND timestamp >= now() - interval 90 day GROUP BY event`),
        // PMF — churned users: avg events per user per feature
        hogqlRows(host, projectId, key, `SELECT event, round(count() / count(DISTINCT person_id), 1) FROM events WHERE person_id IN (${f.personSubquery}) AND person_id IN (SELECT DISTINCT person_id FROM events WHERE event = 'account_deleted') AND event IN ('feed_viewed', 'post_generate_started', 'post_generated', 'post_downloaded', 'post_shared', 'post_schedule_started', 'social_account_connected') AND timestamp >= now() - interval 90 day GROUP BY event`),
        // Total unique users ever
        hogqlRows(host, projectId, key, f.personsCountQuery),
        // Pro users — person property or custom event (configurable via cardOverrides)
        hogql(host, projectId, key, proHogQuery),
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

      let activationFunnel: { stage: string; value: number }[] | null = null
      try {
        const afd = activationFunnelRaw as { results?: Array<Array<{ name: string; count: number }>> } | null
        const steps = afd?.results?.[0]
        if (steps?.length) activationFunnel = steps.map(s => ({ stage: s.name, value: s.count }))
      } catch { /* null */ }

      const wau: { week: string; users: number }[] | null = wauRows
        ? (wauRows as unknown[][]).map(r => ({ week: String(r[0]).split('T')[0].split(' ')[0], users: Number(r[1]) }))
        : null  // 'week' key reused for daily dates

      const PMF_LABELS: Record<string, string> = {
        feed_viewed: 'Feed viewed', post_generate_started: 'Post gen started',
        post_generated: 'Post created', post_downloaded: 'Post downloaded',
        post_shared: 'Post shared', post_schedule_started: 'Post scheduled',
        social_account_connected: 'Social connected',
      }
      let pmf: { event: string; label: string; retainedAvg: number; churnedAvg: number }[] | null = null
      if (pmfRetainedRows && pmfChurnedRows) {
        const retMap = new Map((pmfRetainedRows as unknown[][]).map(r => [String(r[0]), Number(r[1])]))
        const churnMap = new Map((pmfChurnedRows as unknown[][]).map(r => [String(r[0]), Number(r[1])]))
        const allEvents = Array.from(new Set([...retMap.keys(), ...churnMap.keys()]))
        pmf = allEvents.map(ev => ({
          event: ev, label: PMF_LABELS[ev] ?? ev,
          retainedAvg: retMap.get(ev) ?? 0, churnedAvg: churnMap.get(ev) ?? 0,
        })).sort((a, b) => b.retainedAvg - a.retainedAvg)
      }

      // Extract values from combined countIf row queries (current + prior period)
      const [signups24h, signups7d, signups30d, signupsPrev24h, signupsPrev7d, signupsPrev30d] = (signupsRows?.[0] ?? [0,0,0,0,0,0]).map(Number)
      const [signins24h, signins7d, signins30d, signinsPrev24h, signinsPrev7d, signinsPrev30d] = (signinsRows?.[0] ?? [0,0,0,0,0,0]).map(Number)
      const [dau, activeUsers7d, mau, dauPrev, activeUsersPrev7d, mauPrev]                    = (activeUsersRows?.[0] ?? [0,0,0,0,0,0]).map(Number)
      const [deletedAccounts24h, deleted7d, deleted30d, deletedPrev24h, deletedPrev7d, deletedPrev30d] = (deletedRows?.[0] ?? [0,0,0,0,0,0]).map(Number)
      const liveTotal = Number(totalUsersRows?.[0]?.[0] ?? 0)
      // If PostHog returns 0 (transient failure) keep the last known non-zero value from the snapshot
      const cachedTotal = snap && typeof snap['totalUsers'] === 'number' ? (snap['totalUsers'] as number) : 0
      const totalUsers = liveTotal > 0 ? liveTotal : (cachedTotal > 0 ? cachedTotal : 0)
      const proUsers = proUsersCount

      posthogData = {
        posthogConnected: true,
        signups24h, signups7d, signups30d,
        signupsPrev24h, signupsPrev7d, signupsPrev30d,
        signins24h, signins7d, signins30d,
        signinsPrev24h, signinsPrev7d, signinsPrev30d,
        dau, activeUsers7d, mau,
        dauPrev, activeUsersPrev7d, mauPrev,
        deletedAccounts24h, deleted7d, deleted30d,
        deletedPrev24h, deletedPrev7d, deletedPrev30d,
        totalUsers,
        proUsers,
        retention, funnel, activationFunnel, wau, pmf, webAnalytics,
      }
    }
  }

  // ── GSC ───────────────────────────────────────────────────────────────────

  let gscData: Awaited<ReturnType<typeof fetchGsc>> | { connected: false } = { connected: false }

  if (gscInt) {
    const meta = (gscInt.metadata as Record<string, string> | null) ?? {}
    if (meta.client_email && meta.private_key) {
      gscData = await fetchGsc(meta.client_email, meta.private_key, brand.websiteUrl, 7)
    }
  }

  // ── GA4 ───────────────────────────────────────────────────────────────────

  let ga4Data: Awaited<ReturnType<typeof fetchGa4>> | { connected: false } = { connected: false }

  if (ga4Int) {
    const meta = (ga4Int.metadata as Record<string, string> | null) ?? {}
    if (meta.client_email && meta.private_key && meta.property_id) {
      ga4Data = await fetchGa4(meta.client_email, meta.private_key, meta.property_id, 7)
    }
  }

  const snapshot = {
    _v: 12,
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

  return NextResponse.json({ ...snapshot, snapshotAt: snapshotAt.toISOString(), cardOverrides })
}
