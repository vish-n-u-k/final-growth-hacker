import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createSign } from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// ── JWT helper ─────────────────────────────────────────────────────────────────

function b64url(s: string) { return Buffer.from(s).toString('base64url') }

async function googleToken(email: string, key: string, scope: string): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const p = b64url(JSON.stringify({ iss: email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
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

// ── GA4 ───────────────────────────────────────────────────────────────────────

type Ga4Row = { dimensionValues?: { value: string }[]; metricValues: { value: string }[] }

async function ga4Report(token: string, pid: string, body: object): Promise<Ga4Row[]> {
  try {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return []
    return ((await res.json()) as { rows?: Ga4Row[] }).rows ?? []
  } catch { return [] }
}

function gn(row: Ga4Row | undefined, i: number) { return row ? parseInt(row.metricValues[i]?.value ?? '0', 10) : 0 }
function gf(row: Ga4Row | undefined, i: number) { return row ? parseFloat(row.metricValues[i]?.value ?? '0') : 0 }

const CHANNEL_DISPLAY: Record<string, string> = {
  'Direct': 'Direct',
  'Organic Search': 'Organic search',
  'Organic Social': 'Social',
  'Paid Search': 'Paid search',
  'Paid Social': 'Paid social',
  'Email': 'Email',
  'Referral': 'Referral',
  'Organic Video': 'Video',
  'Unassigned': 'Other',
  '(Other)': 'Other',
}

async function fetchGA4Daily(clientEmail: string, privateKey: string, propertyId: string) {
  const token = await googleToken(clientEmail, privateKey, 'https://www.googleapis.com/auth/analytics.readonly')
  if (!token) return null

  const pid = propertyId.replace(/^properties\//, '')

  const [yesterdayRows, priorRows, channelRows, pageRows] = await Promise.all([
    ga4Report(token, pid, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
      metrics: [{ name: 'sessions' }],
    }),
    ga4Report(token, pid, {
      dateRanges: [{ startDate: '2daysAgo', endDate: '2daysAgo' }],
      metrics: [{ name: 'sessions' }],
    }),
    ga4Report(token, pid, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 8,
    }),
    ga4Report(token, pid, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'sessions' }, { name: 'engagementRate' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 1,
    }),
  ])

  return {
    visits: gn(yesterdayRows[0], 0),
    visitsPrior: gn(priorRows[0], 0),
    channels: channelRows.map(r => ({
      name: CHANNEL_DISPLAY[r.dimensionValues?.[0]?.value ?? ''] ?? (r.dimensionValues?.[0]?.value ?? 'Other'),
      sessions: gn(r, 0),
    })),
    topPage: pageRows[0] ? {
      page: pageRows[0].dimensionValues?.[0]?.value ?? '/',
      sessions: gn(pageRows[0], 0),
      engagementRate: Math.round(gf(pageRows[0], 1) * 100),
    } : null,
  }
}

// ── PostHog ───────────────────────────────────────────────────────────────────

async function hogql(host: string, pid: string, key: string, query: string): Promise<unknown[][] | null> {
  try {
    const res = await fetch(`${host}/api/projects/${pid}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    return ((await res.json()) as { results?: unknown[][] }).results ?? null
  } catch { return null }
}

function num(rows: unknown[][] | null): number {
  const v = rows?.[0]?.[0]
  if (v == null) return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

async function fetchPostHogDaily(host: string, pid: string, key: string) {
  const PRO = `'subscription_upgraded','became_pro','upgrade','plan_upgraded','checkout_completed'`
  const CANCEL = `'subscription_cancelled','unsubscribed','cancel_subscription','account_deleted','user_deleted'`
  const yesterday = `toDate(now()) - 1`
  const dayBefore = `toDate(now()) - 2`

  const [
    signupsNow, signupsPrior,
    signinsNow, signinsPrior,
    proNow, proPrior,
    cancelNow,
    dauNow, dauPrior,
    trendRows,
  ] = await Promise.all([
    hogql(host, pid, key, `SELECT count() FROM persons WHERE toDate(created_at) = ${yesterday}`),
    hogql(host, pid, key, `SELECT count() FROM persons WHERE toDate(created_at) = ${dayBefore}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE event = '$identify' AND toDate(timestamp) = ${yesterday}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE event = '$identify' AND toDate(timestamp) = ${dayBefore}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE event IN (${PRO}) AND toDate(timestamp) = ${yesterday}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE event IN (${PRO}) AND toDate(timestamp) = ${dayBefore}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE event IN (${CANCEL}) AND toDate(timestamp) = ${yesterday}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE toDate(timestamp) = ${yesterday}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE toDate(timestamp) = ${dayBefore}`),
    hogql(host, pid, key, `SELECT toDate(timestamp) as day, count(DISTINCT person_id) as dau FROM events WHERE toDate(timestamp) >= toDate(now()) - 8 AND toDate(timestamp) < toDate(now()) GROUP BY day ORDER BY day ASC`),
  ])

  return {
    signups: num(signupsNow),
    signupsPrior: num(signupsPrior),
    signins: num(signinsNow),
    signinsPrior: num(signinsPrior),
    becamePro: num(proNow),
    becameProPrior: num(proPrior),
    unsubscribed: num(cancelNow),
    dau: num(dauNow),
    dauPrior: num(dauPrior),
    dauTrend: (trendRows ?? []).map(r => ({ date: String(r[0] ?? ''), dau: Number(r[1] ?? 0) })),
  }
}

// ── Flag computation (spec rules) ─────────────────────────────────────────────
// Rules (ordered by severity):
// 1. unsubscribed > 0 → always flag
// 2. Zero signups two days running → flag
// 3. DAU dropped > 25% day-over-day → flag (with peak context if available)
// 4. Traffic dropped > 25% day-over-day → flag
// Cap at 2 flags shown; log the rest.

interface FlagInput {
  ga4: { visits: number; visitsPrior: number } | null
  ph: {
    dau: number; dauPrior: number
    signups: number; signupsPrior: number
    unsubscribed: number
    dauTrend: { date: string; dau: number }[]
  } | null
}

function computeFlags({ ga4, ph }: FlagInput): string[] {
  const candidates: { severity: number; msg: string }[] = []
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  if (ph) {
    // Rule 1 — unsubscribed > 0
    if (ph.unsubscribed > 0) {
      candidates.push({
        severity: 3,
        msg: `${ph.unsubscribed} user${ph.unsubscribed > 1 ? 's' : ''} unsubscribed yesterday — worth reviewing offboarding feedback.`,
      })
    }

    // Rule 2 — zero signups two days running
    if (ph.signups === 0 && ph.signupsPrior === 0) {
      candidates.push({
        severity: 2,
        msg: 'No new signups in the past two days — check if the signup flow or top-of-funnel traffic has dropped.',
      })
    }

    // Rule 3 — DAU dropped > 25%
    if (ph.dauPrior > 0) {
      const delta = Math.round(((ph.dau - ph.dauPrior) / ph.dauPrior) * 100)
      if (delta <= -25) {
        const priorDays = ph.dauTrend.slice(0, -1)
        const peak = priorDays.length ? priorDays.reduce((m, d) => d.dau > m.dau ? d : m, priorDays[0]) : null
        const msg = (peak && peak.dau > ph.dau + 2)
          ? (() => {
              const d = new Date(peak.date)
              return `DAU dropped sharply after the ${mo[d.getUTCMonth()]} ${d.getUTCDate()} peak — worth checking what drove that spike and why it didn't hold.`
            })()
          : `DAU dropped ${Math.abs(delta)}% vs the prior day — worth investigating what changed.`
        candidates.push({ severity: 2, msg })
      }
    }
  }

  // Rule 4 — traffic dropped > 25%
  if (ga4 && ga4.visitsPrior > 0) {
    const delta = Math.round(((ga4.visits - ga4.visitsPrior) / ga4.visitsPrior) * 100)
    if (delta <= -25) {
      candidates.push({
        severity: 1,
        msg: `Website traffic dropped ${Math.abs(delta)}% vs the prior day — check if any campaigns paused or a source dried up.`,
      })
    }
  }

  // Sort by severity desc, cap at 2
  return candidates.sort((a, b) => b.severity - a.severity).slice(0, 2).map(f => f.msg)
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const integrations = await db.select().from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.status, 'connected')))

  const intMap = new Map(integrations.map(i => [i.provider, i]))
  const ga4Int = intMap.get('ga4_api')
  const phInt  = intMap.get('posthog')

  const ga4Meta = (ga4Int?.metadata as Record<string, string> | null) ?? {}
  const phMeta  = (phInt?.metadata  as Record<string, string> | null) ?? {}

  const ga4Connected = !!(ga4Int && ga4Meta.client_email && ga4Meta.private_key && ga4Meta.property_id)
  const phConnected  = !!(phInt?.apiKey && phMeta.project_id)

  const [ga4Data, phData] = await Promise.all([
    ga4Connected
      ? fetchGA4Daily(ga4Meta.client_email, ga4Meta.private_key, ga4Meta.property_id)
      : Promise.resolve(null),
    phConnected
      ? fetchPostHogDaily(
          (phMeta.posthog_host ?? 'https://us.posthog.com').replace(/\/$/, ''),
          phMeta.project_id,
          phInt!.apiKey!,
        )
      : Promise.resolve(null),
  ])

  // Yesterday's date label (UTC)
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dateLabel = `${mo[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`

  const flags = computeFlags({
    ga4: ga4Data ? { visits: ga4Data.visits, visitsPrior: ga4Data.visitsPrior } : null,
    ph: phData ? { dau: phData.dau, dauPrior: phData.dauPrior, signups: phData.signups, signupsPrior: phData.signupsPrior, unsubscribed: phData.unsubscribed, dauTrend: phData.dauTrend } : null,
  })

  return NextResponse.json({
    date: dateLabel,
    brandName: brand.name,
    ga4Connected,
    phConnected,
    traffic: ga4Data ? {
      visits: ga4Data.visits,
      visitsPrior: ga4Data.visitsPrior,
      channels: ga4Data.channels,
      topPage: ga4Data.topPage,
    } : null,
    users: phData ? {
      signups: phData.signups,
      signupsPrior: phData.signupsPrior,
      signins: phData.signins,
      signinsPrior: phData.signinsPrior,
      becamePro: phData.becamePro,
      becameProPrior: phData.becameProPrior,
      unsubscribed: phData.unsubscribed,
    } : null,
    engagement: phData ? {
      dau: phData.dau,
      dauPrior: phData.dauPrior,
      dauTrend: phData.dauTrend,
    } : null,
    flags,
  })
}
