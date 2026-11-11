import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { getToken } from './get_ga_analytics'
import { connectGsc, gscQuery } from './get_gsc_data'
import { phQuery, posthogConn } from './posthog-common'
import { addDays, channelMoves, compareDay, isoDay, unusualDays, wentQuiet, window, type Unusual } from '@/lib/goal/daily'

// MCP get_daily_numbers: today and yesterday against the 7- and 30-day averages, which channel
// moved, and anything unusual, from GA4 (visits), Search Console (Google clicks) and PostHog
// (sign-ups, active people). Each source is optional; a failing one says why.

const DAYS = 40 // enough for a 30-day average before yesterday, plus the 28-day baseline for spikes
// Landing pages that are the team's own visits, not customers (the dry run found /admin sessions)
const INTERNAL = ['/admin', '/wp-admin']

type Series = Map<string, number>
type Source<T> = { ok: true; data: T } | { ok: false; error: string; connected: boolean }

const gaDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` // 20261109 → 2026-11-09

async function gaReport(token: string, pid: string, body: object) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(`Google Analytics answered ${res.status}: ${e?.error?.message ?? res.statusText}`)
  }
  return ((await res.json()) as { rows?: { dimensionValues?: { value: string }[]; metricValues: { value: string }[] }[] }).rows ?? []
}

async function fromGa(brandId: string): Promise<Source<{ sessions: Series; newUsers: Series; channels: Map<string, Series>; internal: number }>> {
  const [integration] = await db.select().from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'ga4_api'), eq(brandIntegrations.status, 'connected'))).limit(1)
  const meta = (integration?.metadata as Record<string, string> | null) ?? {}
  if (!integration || !meta.client_email || !meta.private_key || !meta.property_id) {
    return { ok: false, connected: false, error: 'Google Analytics isn\'t connected (Settings → Integrations → Google Analytics Data API).' }
  }
  const token = await getToken(meta.client_email, meta.private_key)
  if (!token) return { ok: false, connected: true, error: 'Google rejected the Google Analytics service account key.' }
  const pid = meta.property_id.replace(/^properties\//, '')
  const dateRanges = [{ startDate: `${DAYS}daysAgo`, endDate: 'today' }]
  const notInternal = {
    notExpression: { orGroup: { expressions: INTERNAL.map(p => ({ filter: { fieldName: 'landingPage', stringFilter: { matchType: 'BEGINS_WITH', value: p } } })) } },
  }
  try {
    const [daily, byChannel, internal] = await Promise.all([
      gaReport(token, pid, { dateRanges, dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'newUsers' }], dimensionFilter: notInternal, limit: 100 }),
      gaReport(token, pid, { dateRanges, dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], dimensionFilter: notInternal, limit: 2000 }),
      gaReport(token, pid, { dateRanges, metrics: [{ name: 'sessions' }], dimensionFilter: notInternal.notExpression }),
    ])
    const sessions: Series = new Map(), newUsers: Series = new Map(), channels = new Map<string, Series>()
    for (const r of daily) {
      const d = gaDate(r.dimensionValues?.[0]?.value ?? '')
      sessions.set(d, Number(r.metricValues[0]?.value ?? 0))
      newUsers.set(d, Number(r.metricValues[1]?.value ?? 0))
    }
    for (const r of byChannel) {
      const d = gaDate(r.dimensionValues?.[0]?.value ?? '')
      const ch = r.dimensionValues?.[1]?.value || '(other)'
      if (!channels.has(ch)) channels.set(ch, new Map())
      channels.get(ch)!.set(d, Number(r.metricValues[0]?.value ?? 0))
    }
    return { ok: true, data: { sessions, newUsers, channels, internal: Number(internal[0]?.metricValues[0]?.value ?? 0) } }
  } catch (e) {
    return { ok: false, connected: true, error: e instanceof Error ? e.message : String(e) }
  }
}

async function fromGsc(brandId: string): Promise<Source<{ clicks: Series; impressions: Series }>> {
  const conn = await connectGsc(brandId)
  if (!conn.ok) {
    const a = conn.answer as { connected: boolean; error?: string; message?: string }
    return { ok: false, connected: a.connected, error: a.error ?? a.message ?? 'Search Console isn\'t available.' }
  }
  const r = await gscQuery(conn.token, conn.property, {
    startDate: isoDay(Date.now() - DAYS * 86_400_000), endDate: isoDay(Date.now()), dimensions: ['date'], rowLimit: 100, dataState: 'all',
  })
  if (r.error) return { ok: false, connected: true, error: r.error }
  const clicks: Series = new Map(), impressions: Series = new Map()
  for (const row of r.rows) {
    const d = row.keys?.[0] ?? ''
    clicks.set(d, row.clicks)
    impressions.set(d, row.impressions)
  }
  return { ok: true, data: { clicks, impressions } }
}

async function fromPosthog(brandId: string): Promise<Source<{ signups: Series; active: Series }>> {
  const c = await posthogConn(brandId)
  if (!c) return { ok: false, connected: false, error: 'PostHog isn\'t connected (Settings → Integrations → PostHog).' }
  const who = c.filter.eventDistinctCol
  const pre = c.filter.eventPersonWherePrefix
  const [signups, active] = await Promise.all([
    // Sign-ups = people first seen that day (looking back 180 days), as get_posthog_segments counts new people
    phQuery(c, `SELECT toDate(first_seen) AS d, count() FROM (
        SELECT ${who} AS who, min(timestamp) AS first_seen FROM events
        WHERE ${pre}timestamp > now() - interval 180 day GROUP BY who
      ) WHERE first_seen > now() - interval ${DAYS} day GROUP BY d ORDER BY d`),
    phQuery(c, `SELECT toDate(timestamp) AS d, count(DISTINCT ${who}) FROM events
        WHERE ${pre}timestamp > now() - interval ${DAYS} day GROUP BY d ORDER BY d`),
  ])
  if (!signups.ok && !active.ok) return { ok: false, connected: true, error: signups.error }
  const toSeries = (r: typeof signups): Series => new Map(r.ok ? r.results.map(([d, n]) => [String(d).slice(0, 10), Number(n)]) : [])
  return { ok: true, data: { signups: toSeries(signups), active: toSeries(active) } }
}

export async function getDailyNumbers(brandId: string) {
  const [ga, gsc, ph] = await Promise.all([fromGa(brandId), fromGsc(brandId), fromPosthog(brandId)])
  const today = isoDay(Date.now())
  const yesterday = addDays(today, -1)
  const recent = [yesterday, addDays(today, -2), addDays(today, -3)]
  const unusual: Unusual[] = []
  const out: Record<string, unknown> = { today, compared_with: 'avg_7d = the 7 days before that day; avg_30d = the 30 days before it' }
  const problems: Record<string, string> = {}

  const block = (name: string, s: Series, withToday: boolean) => {
    unusual.push(...unusualDays(name, s, recent))
    const sum = (end: string) => window(s, end, 7).reduce((a, b) => a + b, 0)
    return {
      yesterday: compareDay(s, yesterday),
      last_7d: sum(yesterday),
      previous_7d: sum(addDays(yesterday, -7)),
      ...(withToday ? { today_so_far: s.get(today) ?? 0 } : {}),
      last_14_days: window(s, yesterday, 14).reverse(),
    }
  }

  if (ga.ok) {
    const moves = channelMoves(ga.data.channels, yesterday)
    out.website = {
      visits: block('website visits', ga.data.sessions, true),
      new_visitors: block('new visitors', ga.data.newUsers, true),
      channels_last_7d_vs_previous_7d: moves,
      moved_most: moves[0] ?? null,
      went_quiet: wentQuiet(moves),
      channels_yesterday: [...ga.data.channels.entries()]
        .map(([channel, s]) => ({ channel, visits: s.get(yesterday) ?? 0, avg_28d: Math.round((window(s, addDays(yesterday, -1), 28).reduce((a, b) => a + b, 0) / 28) * 10) / 10 }))
        .filter(c => c.visits || c.avg_28d)
        .sort((a, b) => b.visits - a.visits),
      ...(ga.data.internal ? { left_out: `${ga.data.internal} visits landing on ${INTERNAL.join(' or ')} (your own team) are left out.` } : {}),
    }
  } else problems.website = ga.error

  if (gsc.ok) {
    // Search Console runs about 2-3 days behind: compare its latest day with data
    const days = [...gsc.data.clicks.keys()].sort()
    const last = days.at(-1) ?? null
    if (last) {
      unusual.push(...unusualDays('Google clicks', gsc.data.clicks, [last]), ...unusualDays('Google impressions', gsc.data.impressions, [last]))
      out.google_search = {
        latest_day: last,
        note: 'Search Console data runs 2-3 days behind.',
        clicks: compareDay(gsc.data.clicks, last),
        clicks_last_7d: window(gsc.data.clicks, last, 7).reduce((a, b) => a + b, 0),
        clicks_previous_7d: window(gsc.data.clicks, addDays(last, -7), 7).reduce((a, b) => a + b, 0),
        impressions: compareDay(gsc.data.impressions, last),
        impressions_last_7d: window(gsc.data.impressions, last, 7).reduce((a, b) => a + b, 0),
        impressions_previous_7d: window(gsc.data.impressions, addDays(last, -7), 7).reduce((a, b) => a + b, 0),
        clicks_last_14_days: window(gsc.data.clicks, last, 14).reverse(),
      }
    } else out.google_search = { note: 'Search Console has no search data for the last 40 days.' }
  } else problems.google_search = gsc.error

  if (ph.ok) {
    out.app = {
      signups: block('sign-ups', ph.data.signups, true),
      active_people: block('active people', ph.data.active, true),
      signups_how: 'People first seen in PostHog that day (looking back 180 days), with the app\'s "Count unique users only" setting.',
    }
  } else problems.app = ph.error

  out.unusual = unusual.length
    ? unusual
    : 'Nothing unusual in the last 3 days (a day is flagged when it is far outside the 28 days before it and differs by 5+ and 50%+).'
  if (Object.keys(problems).length) out.not_available = problems
  return out
}
