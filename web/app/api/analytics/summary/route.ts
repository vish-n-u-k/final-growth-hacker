import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, modules } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createSign } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PostHogSnapshot {
  connected: boolean
  dau: number | null
  newUsers7d: number | null
  sessions7d: number | null
  mau: number | null
}

export interface GscSnapshot {
  connected: boolean
  clicks7d: number | null
  impressions7d: number | null
  avgCtr7d: number | null
  avgPosition7d: number | null
  topQueries: { query: string; clicks: number; impressions: number; position: number }[]
}

export interface Ga4Snapshot {
  connected: boolean
  sessions7d: number | null
  activeUsers7d: number | null
  newUsers7d: number | null
  pageviews7d: number | null
}

export interface PsiSnapshot {
  connected: boolean
  mobileScore: number | null
  desktopScore: number | null
}

export interface ModuleHealth {
  totalModules: number
  analyzedModules: number
  avgScore: number
  lowest: { name: string; score: number } | null
}

export interface AnalyticsSummaryResponse {
  date: string
  posthog: PostHogSnapshot
  gsc: GscSnapshot
  ga4: Ga4Snapshot
  psi: PsiSnapshot
  moduleHealth: ModuleHealth
  brief: string
  action: string
  actionContext: string
}

// ── PostHog ───────────────────────────────────────────────────────────────────

async function runHogQL(
  host: string,
  projectId: string,
  apiKey: string,
  query: string,
): Promise<unknown[][] | null> {
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
  } catch {
    return null
  }
}

function firstNum(rows: unknown[][] | null): number | null {
  const val = rows?.[0]?.[0]
  if (val == null) return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

async function fetchPostHog(
  apiKey: string,
  projectId: string,
  host: string,
): Promise<PostHogSnapshot> {
  const [dauRows, mauRows, new7dRows, sessions7dRows] = await Promise.all([
    runHogQL(host, projectId, apiKey,
      `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 1 DAY`),
    runHogQL(host, projectId, apiKey,
      `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 30 DAY`),
    runHogQL(host, projectId, apiKey,
      `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 7 DAY AND person.created_at > now() - INTERVAL 7 DAY`),
    runHogQL(host, projectId, apiKey,
      `SELECT count(DISTINCT $session_id) FROM events WHERE timestamp > now() - INTERVAL 7 DAY AND $session_id IS NOT NULL AND $session_id != ''`),
  ])
  return {
    connected: true,
    dau: firstNum(dauRows),
    mau: firstNum(mauRows),
    newUsers7d: firstNum(new7dRows),
    sessions7d: firstNum(sessions7dRows),
  }
}

// ── GSC Service Account ───────────────────────────────────────────────────────

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

async function getGscToken(clientEmail: string, privateKey: string): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = base64url(JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }))
    const signingInput = `${header}.${payload}`
    const sign = createSign('RSA-SHA256')
    sign.update(signingInput)
    const signature = sign.sign(privateKey.replace(/\\n/g, '\n'), 'base64url')
    const jwt = `${signingInput}.${signature}`

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token?: string }
    return data.access_token ?? null
  } catch {
    return null
  }
}

async function fetchGsc(
  clientEmail: string,
  privateKey: string,
  siteUrl: string,
): Promise<GscSnapshot> {
  const base: GscSnapshot = { connected: true, clicks7d: null, impressions7d: null, avgCtr7d: null, avgPosition7d: null, topQueries: [] }

  const token = await getGscToken(clientEmail, privateKey)
  if (!token) return base

  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const url = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`
  const hostname = new URL(url).hostname

  // Try URL-prefix property first, then sc-domain
  const propertyUrls = [url.replace(/\/$/, '') + '/', `sc-domain:${hostname}`]

  for (const property of propertyUrls) {
    try {
      // Fetch aggregate totals (no dimensions) + per-query rows in parallel
      const gscFetch = (body: object) => fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(12000),
        },
      )

      const [aggRes, queryRes] = await Promise.all([
        gscFetch({ startDate, endDate, rowLimit: 1 }),
        gscFetch({ startDate, endDate, dimensions: ['query'], rowLimit: 10 }),
      ])

      // Aggregate response tells us if this property is valid
      if (!aggRes.ok) continue

      type GscRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }
      const aggData = await aggRes.json() as { rows?: GscRow[] }
      const aggRows = aggData.rows ?? []

      // Property exists but zero data in this window — still mark as found with zeros
      base.clicks7d = aggRows[0]?.clicks ?? 0
      base.impressions7d = aggRows[0]?.impressions ?? 0
      base.avgCtr7d = aggRows[0] ? Math.round((aggRows[0].ctr ?? 0) * 1000) / 10 : 0
      base.avgPosition7d = aggRows[0] ? Math.round((aggRows[0].position ?? 0) * 10) / 10 : null

      // Per-query rows for top queries list
      if (queryRes.ok) {
        const queryData = await queryRes.json() as { rows?: GscRow[] }
        const rows = queryData.rows ?? []
        base.topQueries = rows.slice(0, 5).map((r) => ({
          query: r.keys?.[0] ?? '',
          clicks: r.clicks,
          impressions: r.impressions,
          position: Math.round(r.position * 10) / 10,
        }))
      }

      break
    } catch {
      continue
    }
  }

  return base
}

// ── PageSpeed Insights ────────────────────────────────────────────────────────

async function fetchPsi(apiKey: string, siteUrl: string): Promise<PsiSnapshot> {
  const base: PsiSnapshot = { connected: true, mobileScore: null, desktopScore: null }
  const url = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`
  try {
    const [mobileRes, desktopRes] = await Promise.all([
      fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&key=${apiKey}&category=performance`, { signal: AbortSignal.timeout(25000) }),
      fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=desktop&key=${apiKey}&category=performance`, { signal: AbortSignal.timeout(25000) }),
    ])
    if (mobileRes.ok) {
      const data = await mobileRes.json() as { lighthouseResult?: { categories?: { performance?: { score?: number } } } }
      const score = data.lighthouseResult?.categories?.performance?.score
      if (score != null) base.mobileScore = Math.round(score * 100)
    }
    if (desktopRes.ok) {
      const data = await desktopRes.json() as { lighthouseResult?: { categories?: { performance?: { score?: number } } } }
      const score = data.lighthouseResult?.categories?.performance?.score
      if (score != null) base.desktopScore = Math.round(score * 100)
    }
  } catch {
    // silently fail
  }
  return base
}

// ── Google Analytics Data API ─────────────────────────────────────────────────

async function getGa4Token(clientEmail: string, privateKey: string): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = base64url(JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }))
    const signingInput = `${header}.${payload}`
    const sign = createSign('RSA-SHA256')
    sign.update(signingInput)
    const signature = sign.sign(privateKey.replace(/\\n/g, '\n'), 'base64url')
    const jwt = `${signingInput}.${signature}`

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token?: string }
    return data.access_token ?? null
  } catch {
    return null
  }
}

async function fetchGa4(
  clientEmail: string,
  privateKey: string,
  propertyId: string,
): Promise<Ga4Snapshot> {
  const base: Ga4Snapshot = { connected: true, sessions7d: null, activeUsers7d: null, newUsers7d: null, pageviews7d: null }

  const token = await getGa4Token(clientEmail, privateKey)
  if (!token) return base

  // Strip "properties/" prefix if user included it
  const pid = propertyId.replace(/^properties\//, '')

  try {
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
          metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'newUsers' },
            { name: 'screenPageViews' },
          ],
        }),
        signal: AbortSignal.timeout(12000),
      },
    )
    if (!res.ok) return base

    const data = await res.json() as {
      rows?: { metricValues: { value: string }[] }[]
    }
    const row = data.rows?.[0]
    if (row) {
      base.sessions7d    = parseInt(row.metricValues[0]?.value ?? '0', 10)
      base.activeUsers7d = parseInt(row.metricValues[1]?.value ?? '0', 10)
      base.newUsers7d    = parseInt(row.metricValues[2]?.value ?? '0', 10)
      base.pageviews7d   = parseInt(row.metricValues[3]?.value ?? '0', 10)
    }
  } catch {
    // silently fail
  }

  return base
}

// ── Claude brief ──────────────────────────────────────────────────────────────

function buildDataFallback(
  posthog: PostHogSnapshot,
  ga4: Ga4Snapshot,
  gsc: GscSnapshot,
  moduleHealth: ModuleHealth,
): { brief: string; action: string; actionContext: string } {
  const parts: string[] = []

  if (posthog.connected && posthog.dau != null) {
    parts.push(`${posthog.dau} active users today (MAU: ${posthog.mau ?? '—'}, new this week: ${posthog.newUsers7d ?? '—'})`)
  }
  if (ga4.connected && ga4.sessions7d != null) {
    parts.push(`${ga4.sessions7d} GA4 sessions this week (${ga4.activeUsers7d ?? 0} active users, ${ga4.newUsers7d ?? 0} new)`)
  }
  if (gsc.connected && gsc.impressions7d != null) {
    parts.push(`${gsc.impressions7d} search impressions and ${gsc.clicks7d ?? 0} clicks in the last 7 days`)
  }
  if (moduleHealth.analyzedModules > 0) {
    parts.push(`${moduleHealth.analyzedModules}/${moduleHealth.totalModules} growth modules analysed, average score ${moduleHealth.avgScore}%`)
  }

  const brief = parts.length > 0
    ? parts.join('. ') + '.'
    : 'No data available yet — connect PostHog or GA4 API to see your daily snapshot.'

  const action = moduleHealth.lowest
    ? `Improve ${moduleHealth.lowest.name} module score (currently ${moduleHealth.lowest.score}%)`
    : posthog.connected && (posthog.newUsers7d ?? 0) < 5
      ? 'Focus on top-of-funnel — new user signups are low this week'
      : 'Review module health and run any pending analyses'

  const actionContext = moduleHealth.lowest
    ? `${moduleHealth.lowest.name} is your weakest growth area. Fixing the flagged items there will move the needle most.`
    : 'Keep pushing — connect more data sources for richer daily insights.'

  return { brief, action, actionContext }
}

async function generateBrief(
  brand: { name: string; websiteUrl: string },
  posthog: PostHogSnapshot,
  ga4: Ga4Snapshot,
  gsc: GscSnapshot,
  psi: PsiSnapshot,
  moduleHealth: ModuleHealth,
): Promise<{ brief: string; action: string; actionContext: string }> {
  const dataParts: string[] = []

  if (posthog.connected) {
    dataParts.push(`PostHog (last 7 days):
- DAU: ${posthog.dau ?? 'n/a'}
- MAU: ${posthog.mau ?? 'n/a'}
- New users: ${posthog.newUsers7d ?? 'n/a'}
- Sessions: ${posthog.sessions7d ?? 'n/a'}`)
  }

  if (ga4.connected && ga4.sessions7d != null) {
    dataParts.push(`Google Analytics (last 7 days):
- Sessions: ${ga4.sessions7d}
- Active users: ${ga4.activeUsers7d ?? 'n/a'}
- New users: ${ga4.newUsers7d ?? 'n/a'}
- Pageviews: ${ga4.pageviews7d ?? 'n/a'}`)
  }

  if (gsc.connected && gsc.clicks7d != null) {
    dataParts.push(`Google Search Console (last 7 days):
- Clicks: ${gsc.clicks7d}
- Impressions: ${gsc.impressions7d}
- Avg CTR: ${gsc.avgCtr7d}%
- Avg Position: ${gsc.avgPosition7d}
- Top query: "${gsc.topQueries[0]?.query ?? 'n/a'}" (${gsc.topQueries[0]?.clicks ?? 0} clicks)`)
  }

  if (psi.connected && (psi.mobileScore != null || psi.desktopScore != null)) {
    dataParts.push(`PageSpeed Insights:
- Mobile: ${psi.mobileScore ?? 'n/a'}/100
- Desktop: ${psi.desktopScore ?? 'n/a'}/100`)
  }

  dataParts.push(`Growth module health:
- ${moduleHealth.analyzedModules}/${moduleHealth.totalModules} modules analysed
- Average score: ${moduleHealth.avgScore}%
- Lowest scoring module: ${moduleHealth.lowest ? `${moduleHealth.lowest.name} (${moduleHealth.lowest.score}%)` : 'n/a'}`)

  // If no real data to summarise, skip Claude and return data-driven fallback
  if (!posthog.connected && !ga4.connected && !gsc.connected) {
    return buildDataFallback(posthog, ga4, gsc, moduleHealth)
  }


  const prompt = `You are a concise growth advisor reviewing daily metrics for "${brand.name}" (${brand.websiteUrl}).

Here is today's data snapshot:

${dataParts.join('\n\n')}

Respond with exactly this JSON structure (no markdown, no explanation, no code fences):
{"brief":"2-3 sentence summary of overall health and the key signal today","action":"One specific concrete thing to do today (max 12 words)","actionContext":"1-2 sentences explaining why this action matters based on the data"}`

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = (response.content[0] as { type: string; text: string }).text.trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { brief?: string; action?: string; actionContext?: string }
      if (parsed.brief && parsed.action) {
        return {
          brief: parsed.brief,
          action: parsed.action,
          actionContext: parsed.actionContext ?? '',
        }
      }
    }
  } catch {
    // fall through to data-driven fallback
  }

  return buildDataFallback(posthog, ga4, gsc, moduleHealth)
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 404 })

  const [allIntegrations, allModules] = await Promise.all([
    db.select().from(brandIntegrations).where(
      and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.status, 'connected')),
    ),
    db.select({ status: modules.status, score: modules.score, name: modules.name, type: modules.type })
      .from(modules)
      .where(eq(modules.brandId, brand.id)),
  ])

  const integrationMap = new Map(allIntegrations.map((i) => [i.provider, i]))

  // Module health
  const analyzed = allModules.filter((m) => m.status === 'complete' && m.type !== 'business-stage')
  const moduleHealth: ModuleHealth = {
    totalModules: allModules.filter(m => m.type !== 'business-stage').length,
    analyzedModules: analyzed.length,
    avgScore: analyzed.length
      ? Math.round(analyzed.reduce((s, m) => s + (m.score ?? 0), 0) / analyzed.length)
      : 0,
    lowest: analyzed.length
      ? (() => {
          const m = analyzed.reduce((min, cur) => ((cur.score ?? 0) < (min.score ?? 0) ? cur : min), analyzed[0])
          return { name: m.name, score: m.score ?? 0 }
        })()
      : null,
  }

  // Fetch data sources in parallel
  const posthogInt = integrationMap.get('posthog')
  const gscApiInt  = integrationMap.get('gsc_api')
  const ga4ApiInt  = integrationMap.get('ga4_api')
  const psiInt     = integrationMap.get('google_psi')

  const [posthog, gsc, ga4, psi] = await Promise.all([
    posthogInt?.apiKey
      ? fetchPostHog(
          posthogInt.apiKey,
          (posthogInt.metadata as Record<string, string> | null)?.project_id ?? '',
          ((posthogInt.metadata as Record<string, string> | null)?.posthog_host ?? 'https://us.posthog.com').replace(/\/$/, ''),
        )
      : Promise.resolve<PostHogSnapshot>({ connected: false, dau: null, mau: null, newUsers7d: null, sessions7d: null }),

    (gscApiInt?.metadata as Record<string, string> | null)?.client_email &&
    (gscApiInt?.metadata as Record<string, string> | null)?.private_key
      ? fetchGsc(
          (gscApiInt.metadata as Record<string, string>).client_email,
          (gscApiInt.metadata as Record<string, string>).private_key,
          brand.websiteUrl,
        )
      : Promise.resolve<GscSnapshot>({ connected: false, clicks7d: null, impressions7d: null, avgCtr7d: null, avgPosition7d: null, topQueries: [] }),

    (ga4ApiInt?.metadata as Record<string, string> | null)?.client_email &&
    (ga4ApiInt?.metadata as Record<string, string> | null)?.private_key &&
    (ga4ApiInt?.metadata as Record<string, string> | null)?.property_id
      ? fetchGa4(
          (ga4ApiInt.metadata as Record<string, string>).client_email,
          (ga4ApiInt.metadata as Record<string, string>).private_key,
          (ga4ApiInt.metadata as Record<string, string>).property_id,
        )
      : Promise.resolve<Ga4Snapshot>({ connected: false, sessions7d: null, activeUsers7d: null, newUsers7d: null, pageviews7d: null }),

    psiInt?.apiKey
      ? fetchPsi(psiInt.apiKey, brand.websiteUrl)
      : Promise.resolve<PsiSnapshot>({ connected: false, mobileScore: null, desktopScore: null }),
  ])

  const { brief, action, actionContext } = await generateBrief(
    { name: brand.name, websiteUrl: brand.websiteUrl },
    posthog,
    ga4,
    gsc,
    psi,
    moduleHealth,
  )

  const response: AnalyticsSummaryResponse = {
    date: new Date().toISOString(),
    posthog,
    gsc,
    ga4,
    psi,
    moduleHealth,
    brief,
    action,
    actionContext,
  }

  return NextResponse.json(response)
}
