import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createSign } from 'crypto'

export const dynamic  = 'force-dynamic'
export const maxDuration = 60

const resend = new Resend(process.env.RESEND_API_KEY)

// ── Auth guard ─────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // dev: allow if not set
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${secret}`
}

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
  'Direct': 'Direct', 'Organic Search': 'Organic search', 'Organic Social': 'Social',
  'Paid Search': 'Paid search', 'Paid Social': 'Paid social', 'Email': 'Email',
  'Referral': 'Referral', 'Organic Video': 'Video', 'Unassigned': 'Other', '(Other)': 'Other',
}

interface Ga4Summary {
  visits: number; visitsPrior: number
  channels: { name: string; sessions: number }[]
  topPage: { page: string; sessions: number; engagementRate: number } | null
}

async function fetchGA4(clientEmail: string, privateKey: string, propertyId: string): Promise<Ga4Summary | null> {
  const token = await googleToken(clientEmail, privateKey, 'https://www.googleapis.com/auth/analytics.readonly')
  if (!token) return null
  const pid = propertyId.replace(/^properties\//, '')

  const [yRows, pRows, chRows, pgRows] = await Promise.all([
    ga4Report(token, pid, { dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }], metrics: [{ name: 'sessions' }] }),
    ga4Report(token, pid, { dateRanges: [{ startDate: '2daysAgo', endDate: '2daysAgo' }],   metrics: [{ name: 'sessions' }] }),
    ga4Report(token, pid, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8,
    }),
    ga4Report(token, pid, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'sessions' }, { name: 'engagementRate' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 1,
    }),
  ])

  return {
    visits: gn(yRows[0], 0), visitsPrior: gn(pRows[0], 0),
    channels: chRows.map(r => ({ name: CHANNEL_DISPLAY[r.dimensionValues?.[0]?.value ?? ''] ?? (r.dimensionValues?.[0]?.value ?? 'Other'), sessions: gn(r, 0) })),
    topPage: pgRows[0] ? { page: pgRows[0].dimensionValues?.[0]?.value ?? '/', sessions: gn(pgRows[0], 0), engagementRate: Math.round(gf(pgRows[0], 1) * 100) } : null,
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
  const v = rows?.[0]?.[0]; if (v == null) return 0; const n = Number(v); return isNaN(n) ? 0 : n
}

interface PhSummary {
  signups: number; signupsPrior: number
  signins: number; signinsPrior: number
  becamePro: number; becameProPrior: number
  unsubscribed: number
  dau: number; dauPrior: number
  dauTrend: { date: string; dau: number }[]
}

async function fetchPostHog(host: string, pid: string, key: string): Promise<PhSummary> {
  const PRO    = `'subscription_upgraded','became_pro','upgrade','plan_upgraded','checkout_completed'`
  const CANCEL = `'subscription_cancelled','unsubscribed','cancel_subscription','account_deleted','user_deleted'`
  const y = `toDate(now()) - 1`
  const db2 = `toDate(now()) - 2`

  const [sn, sp, in_, ip, pn, pp, cn, dn, dp, tr] = await Promise.all([
    hogql(host, pid, key, `SELECT count() FROM persons WHERE toDate(created_at) = ${y}`),
    hogql(host, pid, key, `SELECT count() FROM persons WHERE toDate(created_at) = ${db2}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE event = '$identify' AND toDate(timestamp) = ${y}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE event = '$identify' AND toDate(timestamp) = ${db2}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE event IN (${PRO}) AND toDate(timestamp) = ${y}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE event IN (${PRO}) AND toDate(timestamp) = ${db2}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE event IN (${CANCEL}) AND toDate(timestamp) = ${y}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE toDate(timestamp) = ${y}`),
    hogql(host, pid, key, `SELECT count(DISTINCT person_id) FROM events WHERE toDate(timestamp) = ${db2}`),
    hogql(host, pid, key, `SELECT toDate(timestamp) as day, count(DISTINCT person_id) as dau FROM events WHERE toDate(timestamp) >= toDate(now()) - 8 AND toDate(timestamp) < toDate(now()) GROUP BY day ORDER BY day ASC`),
  ])

  return {
    signups: num(sn), signupsPrior: num(sp),
    signins: num(in_), signinsPrior: num(ip),
    becamePro: num(pn), becameProPrior: num(pp),
    unsubscribed: num(cn),
    dau: num(dn), dauPrior: num(dp),
    dauTrend: (tr ?? []).map(r => ({ date: String(r[0] ?? ''), dau: Number(r[1] ?? 0) })),
  }
}

// ── Flag computation (matches daily-summary route rules) ─────────────────────

function computeFlags(ga4: Ga4Summary | null, ph: PhSummary | null): string[] {
  const candidates: { severity: number; msg: string }[] = []
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  if (ph) {
    if (ph.unsubscribed > 0) {
      candidates.push({ severity: 3, msg: `${ph.unsubscribed} user${ph.unsubscribed > 1 ? 's' : ''} unsubscribed yesterday — worth reviewing offboarding feedback.` })
    }
    if (ph.signups === 0 && ph.signupsPrior === 0) {
      candidates.push({ severity: 2, msg: 'No new signups in the past two days — check if the signup flow or top-of-funnel traffic has dropped.' })
    }
    if (ph.dauPrior > 0) {
      const delta = Math.round(((ph.dau - ph.dauPrior) / ph.dauPrior) * 100)
      if (delta <= -25) {
        const priorDays = ph.dauTrend.slice(0, -1)
        const peak = priorDays.length ? priorDays.reduce((m, d) => d.dau > m.dau ? d : m, priorDays[0]) : null
        const msg = (peak && peak.dau > ph.dau + 2)
          ? (() => { const d = new Date(peak.date); return `DAU dropped sharply after the ${mo[d.getUTCMonth()]} ${d.getUTCDate()} peak — worth checking what drove that spike and why it didn't hold.` })()
          : `DAU dropped ${Math.abs(delta)}% vs the prior day — worth investigating what changed.`
        candidates.push({ severity: 2, msg })
      }
    }
  }
  if (ga4 && ga4.visitsPrior > 0) {
    const delta = Math.round(((ga4.visits - ga4.visitsPrior) / ga4.visitsPrior) * 100)
    if (delta <= -25) {
      candidates.push({ severity: 1, msg: `Website traffic dropped ${Math.abs(delta)}% vs the prior day — check if any campaigns paused or a source dried up.` })
    }
  }
  return candidates.sort((a, b) => b.severity - a.severity).slice(0, 2).map(f => f.msg)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deltaHtml(current: number, prior: number): string {
  if (prior === 0) return `<span style="font-size:12px;color:#888780;">→</span>`
  const pct = Math.round(((current - prior) / prior) * 100)
  if (pct === 0) return `<span style="font-size:12px;color:#888780;">→ 0%</span>`
  const color = pct > 0 ? '#3b6d11' : '#a32d2d'
  const arrow = pct > 0 ? '&#8593;' : '&#8595;'
  return `<span style="font-size:12px;color:${color};font-weight:600;">${arrow} ${Math.abs(pct)}%</span>`
}

// ── Email HTML builder (table-based, inline hex — Outlook safe) ───────────────

function buildHtml(brandName: string, date: string, ga4: Ga4Summary | null, ph: PhSummary | null): string {
  const flags = computeFlags(ga4, ph)
  const dashUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.growjin.com'}/analytics/daily`

  const metricRow = (label: string, value: number, prior: number | null) => `
    <tr>
      <td style="padding:5px 0;font-size:14px;color:#1a1a18;">${label}</td>
      <td style="padding:5px 0;text-align:right;font-size:14px;font-weight:600;color:#1a1a18;">
        ${value}&nbsp;${prior !== null ? deltaHtml(value, prior) : ''}
      </td>
    </tr>`

  const channelRows = (ga4?.channels ?? []).map(ch =>
    `<tr>
      <td style="padding:2px 0 2px 16px;font-size:13px;color:#5f5e5a;">&bull; ${ch.name}</td>
      <td style="padding:2px 0;text-align:right;font-size:13px;color:#5f5e5a;">${ch.sessions}</td>
    </tr>`
  ).join('')

  const trafficBlock = ga4 ? `
    <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#5f5e5a;letter-spacing:0.02em;">&#127760; TRAFFIC</p>
    <p style="margin:0 0 6px;font-size:14px;color:#1a1a18;">
      <strong>${ga4.visits} visits</strong>&nbsp;${deltaHtml(ga4.visits, ga4.visitsPrior)} vs prior day
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;">${channelRows}</table>` : ''

  const usersBlock = ph ? `
    <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#5f5e5a;letter-spacing:0.02em;">&#128101; USERS</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;">
      ${metricRow('New signups', ph.signups, ph.signupsPrior)}
      ${metricRow('Sign-ins', ph.signins, ph.signinsPrior)}
      ${metricRow('Became PRO', ph.becamePro, ph.becameProPrior)}
      ${metricRow('Unsubscribed', ph.unsubscribed, null)}
    </table>` : ''

  const engagementBlock = ph ? `
    <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#5f5e5a;letter-spacing:0.02em;">&#128200; ENGAGEMENT</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;">
      ${metricRow('Daily active users', ph.dau, ph.dauPrior)}
      ${ga4?.topPage ? `<tr><td style="padding:5px 0;font-size:14px;color:#5f5e5a;">&#128293; Top landing page</td><td style="padding:5px 0;text-align:right;font-size:13px;color:#5f5e5a;">${ga4.topPage.page} (${ga4.topPage.sessions} sessions, ${ga4.topPage.engagementRate}% engagement)</td></tr>` : ''}
    </table>` : ''

  const flagsBlock = flags.length ? flags.slice(0, 2).map(f => `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 8px;">
      <tr><td style="background:#faeeda;border-radius:8px;padding:10px 14px;font-size:13px;color:#854f0b;">
        &#9888; ${f}
      </td></tr>
    </table>`).join('') : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:24px;background:#f7f6f2;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border:1px solid #e5e5e0;">
        <tr><td style="padding:28px 32px;">

          <p style="margin:0 0 4px;font-size:14px;color:#1a1a18;">Hey team,</p>
          <p style="margin:0 0 20px;font-size:14px;color:#5f5e5a;">
            Here's what happened yesterday on <strong>${brandName}</strong>:
          </p>

          ${trafficBlock}
          ${usersBlock}
          ${engagementBlock}
          ${flagsBlock}

          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                 style="border-top:1px solid #e5e5e0;margin-top:20px;">
            <tr><td style="padding-top:14px;font-size:13px;">
              &#128279; <a href="${dashUrl}" style="color:#185fa5;text-decoration:underline;">Full dashboard</a>
            </td></tr>
          </table>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!adminEmails.length) {
    return NextResponse.json({ error: 'No ADMIN_EMAILS configured' }, { status: 400 })
  }

  // Only brands where the user has opted in to daily email
  const allBrands = await db.select().from(brands).where(eq(brands.dailyEmailEnabled, true))
  const results: { brandName: string; sent: boolean; error?: string }[] = []

  for (const brand of allBrands) {
    const integrations = await db.select().from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.status, 'connected')))

    const intMap = new Map(integrations.map(i => [i.provider, i]))
    const ga4Int = intMap.get('ga4_api')
    const phInt  = intMap.get('posthog')

    // Skip brands with no relevant integrations
    if (!ga4Int && !phInt) continue

    const ga4Meta = (ga4Int?.metadata as Record<string, string> | null) ?? {}
    const phMeta  = (phInt?.metadata  as Record<string, string> | null) ?? {}

    const [ga4Data, phData] = await Promise.all([
      (ga4Int && ga4Meta.client_email && ga4Meta.private_key && ga4Meta.property_id)
        ? fetchGA4(ga4Meta.client_email, ga4Meta.private_key, ga4Meta.property_id)
        : Promise.resolve(null),
      (phInt?.apiKey && phMeta.project_id)
        ? fetchPostHog(
            (phMeta.posthog_host ?? 'https://us.posthog.com').replace(/\/$/, ''),
            phMeta.project_id,
            phInt.apiKey,
          )
        : Promise.resolve(null),
    ])

    // Date label (yesterday UTC)
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 1)
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const dateLabel = `${mo[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`

    const html = buildHtml(brand.name, dateLabel, ga4Data, phData)

    try {
      await resend.emails.send({
        from: 'GrowJin <onboarding@resend.dev>',
        to: adminEmails,
        subject: `${brand.name} daily summary — ${dateLabel}`,
        html,
      })
      results.push({ brandName: brand.name, sent: true })
    } catch (e) {
      results.push({ brandName: brand.name, sent: false, error: String(e) })
    }
  }

  return NextResponse.json({ ok: true, results })
}
