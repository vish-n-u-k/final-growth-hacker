import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createSign } from 'crypto'
import { getValidAdminGmailToken, getAdminGmailAddress } from '@/lib/gmail/admin-token'

export const dynamic  = 'force-dynamic'
export const maxDuration = 60

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

function deltaBadge(current: number, prior: number): string {
  if (prior === 0) return `<span style="display:inline-block;font-size:11px;font-weight:600;color:#6b7280;background:#f3f4f6;border-radius:99px;padding:2px 8px;">—</span>`
  const pct = Math.round(((current - prior) / prior) * 100)
  if (pct === 0) return `<span style="display:inline-block;font-size:11px;font-weight:600;color:#6b7280;background:#f3f4f6;border-radius:99px;padding:2px 8px;">0%</span>`
  const [bg, color, arrow] = pct > 0 ? ['#f0fdf4', '#15803d', '&#8593;'] : ['#fef2f2', '#dc2626', '&#8595;']
  return `<span style="display:inline-block;font-size:11px;font-weight:600;color:${color};background:${bg};border-radius:99px;padding:2px 8px;">${arrow} ${Math.abs(pct)}%</span>`
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

// ── Email HTML builder (table-based, inline hex — Outlook safe) ───────────────

function buildHtml(brandName: string, date: string, ga4: Ga4Summary | null, ph: PhSummary | null): string {
  const flags = computeFlags(ga4, ph)
  const dashUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.growjin.com'}/authAnalytics`

  // ── Traffic section ──────────────────────────────────────────────────────────
  const maxSessions = Math.max(...(ga4?.channels ?? []).map(c => c.sessions), 1)

  const channelRows = (ga4?.channels ?? []).slice(0, 6).map(ch => {
    const barPct = Math.round((ch.sessions / maxSessions) * 100)
    return `
    <tr>
      <td style="padding:5px 0 5px 0;width:110px;font-size:13px;color:#374151;">${ch.name}</td>
      <td style="padding:5px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
          <tr>
            <td style="background:#e5e7eb;border-radius:4px;height:6px;width:100%;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:${barPct}%;">
                <tr><td style="background:#16a34a;border-radius:4px;height:6px;font-size:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
      <td style="padding:5px 0;text-align:right;font-size:13px;font-weight:600;color:#111827;white-space:nowrap;">${ch.sessions}</td>
    </tr>`
  }).join('')

  const trafficBlock = ga4 ? `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 4px;">
    <tr>
      <td>
        <p style="margin:0 0 2px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#9ca3af;">Website Traffic</p>
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:32px;font-weight:700;color:#111827;line-height:1;">${fmt(ga4.visits)}</td>
            <td style="padding:0 0 4px 10px;vertical-align:bottom;">${deltaBadge(ga4.visits, ga4.visitsPrior)}&nbsp;<span style="font-size:12px;color:#9ca3af;">vs prior day</span></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:12px 0 0;">
    ${channelRows}
  </table>` : ''

  // ── User metrics 2×2 grid ────────────────────────────────────────────────────
  const metricCard = (label: string, value: number, prior: number | null, accent?: string) => `
  <td style="width:50%;padding:0;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr><td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#9ca3af;">${label}</p>
        <p style="margin:0 0 6px;font-size:28px;font-weight:700;color:${accent ?? '#111827'};line-height:1;">${fmt(value)}</p>
        ${prior !== null ? `<p style="margin:0;">${deltaBadge(value, prior)}</p>` : '<p style="margin:0;height:20px;"></p>'}
      </td></tr>
    </table>
  </td>`

  const usersBlock = ph ? `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      ${metricCard('New signups', ph.signups, ph.signupsPrior)}
      <td style="width:12px;"></td>
      ${metricCard('Sign-ins', ph.signins, ph.signinsPrior)}
    </tr>
    <tr><td colspan="3" style="height:10px;"></td></tr>
    <tr>
      ${metricCard('Became PRO', ph.becamePro, ph.becameProPrior, ph.becamePro > 0 ? '#15803d' : '#111827')}
      <td style="width:12px;"></td>
      ${metricCard('Unsubscribed', ph.unsubscribed, null, ph.unsubscribed > 0 ? '#dc2626' : '#111827')}
    </tr>
  </table>` : ''

  // ── Engagement row ───────────────────────────────────────────────────────────
  const engagementBlock = ph ? `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td style="padding:4px 0;">
        <p style="margin:0 0 2px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#9ca3af;">Daily Active Users</p>
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:28px;font-weight:700;color:#111827;line-height:1;">${fmt(ph.dau)}</td>
            <td style="padding:0 0 4px 10px;vertical-align:bottom;">${deltaBadge(ph.dau, ph.dauPrior)}</td>
          </tr>
        </table>
      </td>
    </tr>
    ${ga4?.topPage ? `
    <tr><td style="padding:10px 0 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;">
          <p style="margin:0 0 2px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#9ca3af;">Top Landing Page</p>
          <p style="margin:0;font-size:13px;font-weight:600;color:#111827;">${ga4.topPage.page}</p>
          <p style="margin:2px 0 0;font-size:12px;color:#6b7280;">${ga4.topPage.sessions} sessions &middot; ${ga4.topPage.engagementRate}% engagement</p>
        </td></tr>
      </table>
    </td></tr>` : ''}
  </table>` : ''

  // ── Flag cards ───────────────────────────────────────────────────────────────
  const flagsBlock = flags.map(f => `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 8px;">
    <tr><td style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td style="width:20px;vertical-align:top;font-size:14px;color:#d97706;">&#9888;</td>
          <td style="font-size:13px;color:#92400e;line-height:1.5;">${f}</td>
        </tr>
      </table>
    </td></tr>
  </table>`).join('')

  // ── Section divider ──────────────────────────────────────────────────────────
  const divider = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;"><tr><td style="border-top:1px solid #e5e7eb;font-size:0;">&nbsp;</td></tr></table>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${brandName} daily summary</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 16px;">

  <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

    <!-- Header -->
    <tr><td style="background:#0d2218;border-radius:12px 12px 0 0;padding:22px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td style="font-size:16px;font-weight:700;color:#4ade80;letter-spacing:-0.3px;">GrowJin</td>
          <td style="text-align:right;font-size:12px;color:#6ee7b7;">${date}</td>
        </tr>
      </table>
      <p style="margin:10px 0 0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">
        ${brandName} &mdash; latest summary
      </p>
    </td></tr>

    <!-- Body -->
    <tr><td style="background:#ffffff;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;padding:28px 32px;">

      ${flags.length ? flagsBlock + divider : ''}

      ${ga4 ? trafficBlock + divider : ''}

      ${ph ? `
      <p style="margin:0 0 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#9ca3af;">Users</p>
      ${usersBlock}
      ${divider}` : ''}

      ${ph || ga4?.topPage ? engagementBlock : ''}

    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:16px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td style="font-size:12px;color:#6b7280;">
            <a href="${dashUrl}" style="color:#16a34a;text-decoration:none;font-weight:600;">View full dashboard &#8594;</a>
          </td>
          <td style="text-align:right;font-size:11px;color:#9ca3af;">GrowJin &middot; Daily digest</td>
        </tr>
      </table>
    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`
}

// ── Gmail send ────────────────────────────────────────────────────────────────

async function sendViaGmail(
  accessToken: string, from: string, to: string, subject: string, html: string,
): Promise<boolean> {
  const message = [
    `From: GrowJin <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
  ].join('\r\n')

  const encoded = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded }),
  })
  return res.ok
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get admin Gmail token — same account used across the app
  let accessToken: string
  let fromEmail: string | null
  try {
    accessToken = await getValidAdminGmailToken()
    fromEmail   = await getAdminGmailAddress()
  } catch (e) {
    return NextResponse.json({ error: `Gmail not connected: ${String(e)}` }, { status: 500 })
  }
  if (!fromEmail) return NextResponse.json({ error: 'Admin Gmail address not found' }, { status: 500 })

  // Only brands opted in AND with a notification email stored
  const allBrands = await db.select().from(brands).where(eq(brands.dailyEmailEnabled, true))
  const results: { brandName: string; to: string; sent: boolean; error?: string }[] = []

  // Date label (yesterday UTC)
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dateLabel = `${mo[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`

  for (const brand of allBrands) {
    const toEmail = brand.notificationEmail
    if (!toEmail) continue // no email stored — user never properly opted in

    const integrations = await db.select().from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.status, 'connected')))

    const intMap = new Map(integrations.map(i => [i.provider, i]))
    const ga4Int = intMap.get('ga4_api')
    const phInt  = intMap.get('posthog')

    // Skip if neither integration is connected
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

    const html = buildHtml(brand.name, dateLabel, ga4Data, phData)
    const subject = `${brand.name} daily summary - ${dateLabel}`

    try {
      const sent = await sendViaGmail(accessToken, fromEmail, toEmail, subject, html)
      results.push({ brandName: brand.name, to: toEmail, sent })
    } catch (e) {
      results.push({ brandName: brand.name, to: toEmail, sent: false, error: String(e) })
    }
  }

  return NextResponse.json({ ok: true, results })
}
