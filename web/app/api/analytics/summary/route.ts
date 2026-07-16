import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, modules, moduleItems, moduleCategories } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createSign } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PostHogSnapshot {
  connected: boolean
  totalUsers: number | null   // all-time persons count → Road to 500
  dau: number | null
  mau: number | null
  newUsers7d: number | null
  sessions7d: number | null
  dataStartDate: string | null  // ISO date string of earliest event (YYYY-MM-DD)
}

export type GscStatus = 'locked' | 'connected_pending_data' | 'active'

export interface GscSnapshot {
  connected: boolean
  connectionStatus: GscStatus
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

export interface TopFailingItem {
  label: string
  weight: number        // 1=minor 2=important 3=critical
  aiDetail: string | null
  categoryLabel: string | null
}

export interface StatusBoardItem {
  name: string
  description: string
  domain: 'growth' | 'product' | 'revenue'
  value: string
}

export interface NextStep {
  title: string
  description: string
  severity: 'critical' | 'important'
}

export interface OverviewResponse {
  date: string
  // Goal
  goal: { current: number; target: number; pct: number }
  // Top priority
  topPriority: { title: string; description: string; severity: 'critical' | 'important' } | null
  // Narrative
  brief: string
  // Stat strip
  stats: {
    growthAuditAvg: number
    stickiness: number | null   // DAU/MAU as percentage
    moduleAnalysed: number
    moduleTotal: number
    avgScore: number
  }
  // Status board
  statusBoard: {
    done: StatusBoardItem[]
    ongoing: StatusBoardItem[]
    pending: StatusBoardItem[]
    locked: StatusBoardItem[]
  }
  // Metric cards
  posthog: PostHogSnapshot
  gsc: GscSnapshot
  ga4: Ga4Snapshot
  psi: PsiSnapshot
  // Growth progress
  growthProgress: { name: string; score: number; status: string; note: string }[]
  // What's next
  whatNext: NextStep[]
  // Module-level details for brief generation
  lowestModule: { name: string; score: number } | null
  lowestFailingItems: TopFailingItem[]
}

// ── PostHog ───────────────────────────────────────────────────────────────────

async function runHogQL(host: string, projectId: string, apiKey: string, query: string): Promise<unknown[][] | null> {
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

function firstNum(rows: unknown[][] | null): number | null {
  const val = rows?.[0]?.[0]
  if (val == null) return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

async function fetchPostHog(apiKey: string, projectId: string, host: string): Promise<PostHogSnapshot> {
  const [totalRows, dauRows, mauRows, new7dRows, sessions7dRows, startRows] = await Promise.all([
    runHogQL(host, projectId, apiKey, `SELECT count() FROM persons`),
    runHogQL(host, projectId, apiKey, `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 1 DAY`),
    runHogQL(host, projectId, apiKey, `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 30 DAY`),
    runHogQL(host, projectId, apiKey, `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 7 DAY AND person.created_at > now() - INTERVAL 7 DAY`),
    runHogQL(host, projectId, apiKey, `SELECT count(DISTINCT $session_id) FROM events WHERE timestamp > now() - INTERVAL 7 DAY AND $session_id IS NOT NULL AND $session_id != ''`),
    runHogQL(host, projectId, apiKey, `SELECT min(timestamp) FROM events`),
  ])
  const rawStart = startRows?.[0]?.[0]
  const dataStartDate = rawStart ? String(rawStart).slice(0, 10) : null
  return {
    connected: true,
    totalUsers: firstNum(totalRows),
    dau: firstNum(dauRows),
    mau: firstNum(mauRows),
    newUsers7d: firstNum(new7dRows),
    sessions7d: firstNum(sessions7dRows),
    dataStartDate,
  }
}

// ── GSC ───────────────────────────────────────────────────────────────────────

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
      iat: now, exp: now + 3600,
    }))
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

async function fetchGsc(clientEmail: string, privateKey: string, siteUrl: string): Promise<GscSnapshot> {
  const base: GscSnapshot = { connected: true, connectionStatus: 'connected_pending_data', clicks7d: null, impressions7d: null, avgCtr7d: null, avgPosition7d: null, topQueries: [] }
  const token = await getGscToken(clientEmail, privateKey)
  if (!token) return base

  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const url = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`
  const hostname = new URL(url).hostname
  const propertyUrls = [url.replace(/\/$/, '') + '/', `sc-domain:${hostname}`]

  for (const property of propertyUrls) {
    try {
      const gscFetch = (body: object) => fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) },
      )
      const [aggRes, queryRes] = await Promise.all([
        gscFetch({ startDate, endDate, rowLimit: 1 }),
        gscFetch({ startDate, endDate, dimensions: ['query'], rowLimit: 10 }),
      ])
      if (!aggRes.ok) continue
      type GscRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }
      const aggData = await aggRes.json() as { rows?: GscRow[] }
      const aggRows = aggData.rows ?? []
      base.clicks7d = aggRows[0]?.clicks ?? 0
      base.impressions7d = aggRows[0]?.impressions ?? 0
      base.avgCtr7d = aggRows[0] ? Math.round((aggRows[0].ctr ?? 0) * 1000) / 10 : 0
      base.avgPosition7d = aggRows[0] ? Math.round((aggRows[0].position ?? 0) * 10) / 10 : null
      base.connectionStatus = 'active'
      if (queryRes.ok) {
        const queryData = await queryRes.json() as { rows?: GscRow[] }
        base.topQueries = (queryData.rows ?? []).slice(0, 5).map(r => ({
          query: r.keys?.[0] ?? '', clicks: r.clicks, impressions: r.impressions,
          position: Math.round(r.position * 10) / 10,
        }))
      }
      break
    } catch { continue }
  }
  return base
}

// ── GA4 ───────────────────────────────────────────────────────────────────────

async function getGa4Token(clientEmail: string, privateKey: string): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = base64url(JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now, exp: now + 3600,
    }))
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

async function fetchGa4(clientEmail: string, privateKey: string, propertyId: string): Promise<Ga4Snapshot> {
  const base: Ga4Snapshot = { connected: true, sessions7d: null, activeUsers7d: null, newUsers7d: null, pageviews7d: null }
  const token = await getGa4Token(clientEmail, privateKey)
  if (!token) return base
  const pid = propertyId.replace(/^properties\//, '')
  try {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' }, { name: 'screenPageViews' }],
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return base
    const data = await res.json() as { rows?: { metricValues: { value: string }[] }[] }
    const row = data.rows?.[0]
    if (row) {
      base.sessions7d    = parseInt(row.metricValues[0]?.value ?? '0', 10)
      base.activeUsers7d = parseInt(row.metricValues[1]?.value ?? '0', 10)
      base.newUsers7d    = parseInt(row.metricValues[2]?.value ?? '0', 10)
      base.pageviews7d   = parseInt(row.metricValues[3]?.value ?? '0', 10)
    }
  } catch { /* silently fail */ }
  return base
}

// ── PSI ───────────────────────────────────────────────────────────────────────

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
  } catch { /* silently fail */ }
  return base
}

// ── Narrative brief ───────────────────────────────────────────────────────────

async function generateBrief(
  brand: { name: string; websiteUrl: string },
  posthog: PostHogSnapshot,
  ga4: Ga4Snapshot,
  gsc: GscSnapshot,
  psi: PsiSnapshot,
  moduleHealth: { avgScore: number; analyzedModules: number; totalModules: number; complete: string[]; nearComplete: { name: string; score: number }[]; lowest: { name: string; score: number } | null; lowestFailingItems: TopFailingItem[] },
  connectedProviders: Set<string>,
): Promise<string> {
  const lines: string[] = []

  lines.push(`MODULES (${moduleHealth.analyzedModules} of ${moduleHealth.totalModules} analysed, avg score ${moduleHealth.avgScore}%):`)
  if (moduleHealth.complete.length) lines.push(`  Fully complete: ${moduleHealth.complete.join(', ')}`)
  if (moduleHealth.nearComplete.length) lines.push(`  Near-complete (≥75%): ${moduleHealth.nearComplete.map(m => `${m.name} ${m.score}%`).join(', ')}`)
  if (moduleHealth.lowest) lines.push(`  Lowest: ${moduleHealth.lowest.name} at ${moduleHealth.lowest.score}%`)
  if (moduleHealth.lowestFailingItems.length) {
    lines.push(`  Top failing items in ${moduleHealth.lowest?.name}:`)
    for (const item of moduleHealth.lowestFailingItems) {
      const sev = item.weight === 3 ? 'critical' : item.weight === 2 ? 'important' : 'minor'
      lines.push(`    - "${item.label}" [${sev}]${item.aiDetail ? ` — ${item.aiDetail}` : ''}`)
    }
  }

  if (posthog.connected) {
    const goal = posthog.totalUsers != null ? `${posthog.totalUsers} of 500 total users` : null
    lines.push(`USER ACTIVITY: ${[goal, posthog.dau != null ? `DAU ${posthog.dau}` : null, posthog.mau != null ? `MAU ${posthog.mau}` : null, posthog.newUsers7d != null ? `new users (7d) ${posthog.newUsers7d}` : null, posthog.sessions7d != null ? `sessions (7d) ${posthog.sessions7d}` : null].filter(Boolean).join(', ')}`)
  }
  if (ga4.connected && ga4.sessions7d != null) {
    lines.push(`GA4 (7d): sessions ${ga4.sessions7d}, active ${ga4.activeUsers7d ?? '—'}, new ${ga4.newUsers7d ?? '—'}, pageviews ${ga4.pageviews7d ?? '—'}`)
  }
  if (gsc.connectionStatus === 'active' && gsc.clicks7d != null) {
    lines.push(`GSC (7d): clicks ${gsc.clicks7d}, impressions ${gsc.impressions7d ?? '—'}, avg position ${gsc.avgPosition7d ?? '—'}`)
  }
  if (psi.connected && (psi.mobileScore != null || psi.desktopScore != null)) {
    lines.push(`PERFORMANCE: mobile ${psi.mobileScore ?? '—'}/100, desktop ${psi.desktopScore ?? '—'}/100`)
  }

  const allSources = ['posthog', 'ga4_api', 'gsc_api', 'google_psi']
  const missingLabels: Record<string, string> = {
    posthog: 'PostHog (user activity)',
    ga4_api: 'Google Analytics (sessions & pageviews)',
    gsc_api: 'Search Console (search traffic)',
    google_psi: 'PageSpeed Insights (performance scores)',
  }
  const missing = allSources.filter(s => !connectedProviders.has(s))
  if (missing.length) lines.push(`NOT CONNECTED: ${missing.map(s => missingLabels[s]).join('; ')}`)

  const systemPrompt = `You are the narrative engine for a growth dashboard. Your job is to turn structured audit, module, and analytics data into a single short paragraph under the heading "Summary — in plain terms."

STYLE RULES
- One paragraph, 80–130 words. No bullet points, no headers inside the output.
- Plain English. No jargon, no marketing language, no exclamation points.
- Bold the specific numbers and named entities that matter most, using **double asterisks**.
- If a named entity carries a severity flag (e.g. "critical"), wrap it in a chip instead of bold: {{chip:Entity Name}}. Only chip the single most severe item in the whole summary.
- Order of information, always:
  1. Overall position (modules completed toward goal)
  2. What's fully complete
  3. What's close to complete
  4. The single biggest open gap — name the specific sub-item causing it, not just the score
  5. Product/technical health (coverage + quality, stated together)
  6. User activity for the period, stated as raw numbers only — do not editorialize
  7. End with exactly one sentence naming any metric category that has no data source connected yet, and what would unlock it
- Never invent a number. If a field is null/missing, omit that clause entirely.
- Never repeat a number type twice.
- Do not recommend actions — only report state.`

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Brand: ${brand.name} (${brand.websiteUrl})\n\n${lines.join('\n')}` }],
    })
    const text = (response.content[0] as { type: string; text: string }).text.trim()
    if (text.length > 20) return text
  } catch { /* fall through */ }

  // Fallback: data-driven
  const parts: string[] = []
  if (moduleHealth.analyzedModules > 0) parts.push(`**${moduleHealth.analyzedModules} of ${moduleHealth.totalModules}** modules analysed at an average score of **${moduleHealth.avgScore}%**`)
  if (posthog.connected && posthog.dau != null) parts.push(`**${posthog.dau}** daily active users, **${posthog.mau}** monthly, **${posthog.newUsers7d}** new this week`)
  return parts.join('. ') + (parts.length ? '.' : 'Connect data sources to see your daily snapshot.')
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 404 })

  const [allIntegrations, allModules] = await Promise.all([
    db.select().from(brandIntegrations).where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.status, 'connected'))),
    db.select({ id: modules.id, status: modules.status, score: modules.score, name: modules.name, type: modules.type, order: modules.order })
      .from(modules).where(eq(modules.brandId, brand.id)).orderBy(modules.order),
  ])

  const integrationMap = new Map(allIntegrations.map(i => [i.provider, i]))
  const connectedProviders = new Set(allIntegrations.map(i => i.provider))

  // ── Module data ─────────────────────────────────────────────────────────────

  const relevantModules = allModules.filter(m => m.type !== 'business-stage')
  const analyzed = relevantModules.filter(m => m.status === 'complete')
  const avgScore = analyzed.length ? Math.round(analyzed.reduce((s, m) => s + (m.score ?? 0), 0) / analyzed.length) : 0
  const lowestMod = analyzed.length ? analyzed.reduce((min, cur) => ((cur.score ?? 0) < (min.score ?? 0) ? cur : min), analyzed[0]) : null

  // impactScore = (peerAverage - module.score) — module furthest below average wins
  const topPriorityMod = analyzed.length >= 2
    ? analyzed.reduce((best, m) => {
        const impact = avgScore - (m.score ?? 0)
        const bestImpact = avgScore - (best.score ?? 0)
        return impact > bestImpact ? m : best
      }, analyzed[0])
    : lowestMod

  // Fetch failing items for the top-priority module
  let lowestFailingItems: TopFailingItem[] = []
  if (topPriorityMod) {
    const cats = await db.select({ id: moduleCategories.id, label: moduleCategories.label })
      .from(moduleCategories).where(eq(moduleCategories.moduleId, topPriorityMod.id))
    const catLabelMap = new Map(cats.map(c => [c.id, c.label]))
    const rows = await db.select({ label: moduleItems.label, weight: moduleItems.weight, aiDetail: moduleItems.aiDetail, categoryId: moduleItems.categoryId, aiVerified: moduleItems.aiVerified, userChecked: moduleItems.userChecked, userSkipped: moduleItems.userSkipped })
      .from(moduleItems).where(eq(moduleItems.moduleId, topPriorityMod.id))
    lowestFailingItems = rows
      .filter(r => !r.aiVerified && !r.userChecked && !r.userSkipped)
      .sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))
      .slice(0, 3)
      .map(r => ({ label: r.label, weight: r.weight ?? 1, aiDetail: r.aiDetail, categoryLabel: catLabelMap.get(r.categoryId) ?? null }))
  }

  const moduleHealthForBrief = {
    avgScore,
    analyzedModules: analyzed.length,
    totalModules: relevantModules.length,
    complete: analyzed.filter(m => (m.score ?? 0) >= 100).map(m => m.name),
    nearComplete: analyzed.filter(m => (m.score ?? 0) >= 75 && (m.score ?? 0) < 100).map(m => ({ name: m.name, score: m.score ?? 0 })),
    lowest: topPriorityMod ? { name: topPriorityMod.name, score: topPriorityMod.score ?? 0 } : null,
    lowestFailingItems,
  }

  // ── Fetch live data ──────────────────────────────────────────────────────────

  const posthogInt = integrationMap.get('posthog')
  const gscApiInt  = integrationMap.get('gsc_api')
  const ga4ApiInt  = integrationMap.get('ga4_api')
  const psiInt     = integrationMap.get('google_psi')

  const [posthog, gsc, ga4, psi] = await Promise.all([
    posthogInt?.apiKey
      ? fetchPostHog(posthogInt.apiKey, (posthogInt.metadata as Record<string, string> | null)?.project_id ?? '', ((posthogInt.metadata as Record<string, string> | null)?.posthog_host ?? 'https://us.posthog.com').replace(/\/$/, ''))
      : Promise.resolve<PostHogSnapshot>({ connected: false, totalUsers: null, dau: null, mau: null, newUsers7d: null, sessions7d: null, dataStartDate: null }),

    gscApiInt && (gscApiInt.metadata as Record<string, string> | null)?.client_email && (gscApiInt.metadata as Record<string, string> | null)?.private_key
      ? fetchGsc((gscApiInt.metadata as Record<string, string>).client_email, (gscApiInt.metadata as Record<string, string>).private_key, brand.websiteUrl)
      : Promise.resolve<GscSnapshot>({ connected: false, connectionStatus: 'locked', clicks7d: null, impressions7d: null, avgCtr7d: null, avgPosition7d: null, topQueries: [] }),

    ga4ApiInt && (ga4ApiInt.metadata as Record<string, string> | null)?.client_email && (ga4ApiInt.metadata as Record<string, string> | null)?.private_key && (ga4ApiInt.metadata as Record<string, string> | null)?.property_id
      ? fetchGa4((ga4ApiInt.metadata as Record<string, string>).client_email, (ga4ApiInt.metadata as Record<string, string>).private_key, (ga4ApiInt.metadata as Record<string, string>).property_id)
      : Promise.resolve<Ga4Snapshot>({ connected: false, sessions7d: null, activeUsers7d: null, newUsers7d: null, pageviews7d: null }),

    psiInt?.apiKey
      ? fetchPsi(psiInt.apiKey, brand.websiteUrl)
      : Promise.resolve<PsiSnapshot>({ connected: false, mobileScore: null, desktopScore: null }),
  ])

  // ── Derived values ───────────────────────────────────────────────────────────

  const goalCurrent = posthog.totalUsers ?? 0
  const stickiness = (posthog.dau != null && posthog.mau != null && posthog.mau > 0)
    ? Math.round((posthog.dau / posthog.mau) * 1000) / 10
    : null

  // Top priority card
  const topPriority: OverviewResponse['topPriority'] = topPriorityMod ? {
    title: lowestFailingItems[0]
      ? `Fix "${lowestFailingItems[0].label}" in ${topPriorityMod.name}`
      : `Improve ${topPriorityMod.name} module score (currently ${topPriorityMod.score ?? 0}%)`,
    description: lowestFailingItems[0]?.aiDetail
      ?? `${topPriorityMod.name} is the weakest module by impact score — it's ${avgScore - (topPriorityMod.score ?? 0)} points below the ${avgScore}% average. Fixing the flagged items here will move your overall score more than anything else right now.`,
    severity: (lowestFailingItems[0]?.weight ?? 1) === 3 ? 'critical' : 'important',
  } : null

  // Status board
  const done: StatusBoardItem[] = []
  const ongoing: StatusBoardItem[] = []
  const pending: StatusBoardItem[] = []
  const locked: StatusBoardItem[] = []

  for (const mod of relevantModules) {
    const score = mod.score ?? 0
    const item: StatusBoardItem = {
      name: mod.name,
      description: score >= 100 ? 'All checks passed' : score > 20 ? `Score: ${score}%` : score > 0 ? `Needs work — score ${score}%` : 'Not yet analysed',
      domain: 'product',
      value: mod.status === 'complete' ? `${score}%` : '—',
    }
    if (score >= 100) done.push(item)
    else if (score > 20) ongoing.push(item)
    else pending.push(item)
  }

  if (!psi.connected)   locked.push({ name: 'Page Speed', description: 'Connect PageSpeed Insights to unlock Core Web Vitals', domain: 'product', value: '🔒' })
  if (!ga4.connected)   locked.push({ name: 'Google Analytics', description: 'Connect ga4_api for traffic sources and conversion paths', domain: 'product', value: '🔒' })
  if (!gsc.connected)   locked.push({ name: 'Search Performance', description: 'Connect Google Search Console API for clicks and impressions', domain: 'growth', value: '🔒' })
  locked.push({ name: 'Customer Economics', description: 'CAC, churn & ARPU — connect a billing source to unlock', domain: 'revenue', value: '🔒' })

  // Growth progress
  const growthProgress: OverviewResponse['growthProgress'] = analyzed.map(m => {
    const score = m.score ?? 0
    const status = score >= 100 ? 'done' : score >= 75 ? 'near' : score > 0 ? 'progress' : 'low'
    const note = score >= 100 ? 'All checks passed' : score >= 75 ? 'Almost there' : score > 0 ? 'In progress' : 'Needs attention'
    return { name: m.name, score, status, note }
  })

  // What's Next (rule-based, ordered by impact)
  const whatNext: NextStep[] = []

  if (topPriorityMod) {
    whatNext.push({
      title: `Fix flagged items in ${topPriorityMod.name}`,
      description: `Lowest module by impact score (${topPriorityMod.score ?? 0}% vs ${avgScore}% average) — fixing items here moves the needle most.`,
      severity: (topPriorityMod.score ?? 0) < 30 ? 'critical' : 'important',
    })
  }
  if (lowestFailingItems[0]?.weight === 3) {
    whatNext.push({
      title: `Review "${lowestFailingItems[0].label}"`,
      description: lowestFailingItems[0].aiDetail ?? `Critical-weight item blocking ${topPriorityMod?.name} score from advancing.`,
      severity: 'critical',
    })
  }
  const unanalysed = relevantModules.filter(m => m.status !== 'complete').length
  if (unanalysed > 0) {
    whatNext.push({
      title: `Analyse remaining ${unanalysed} module${unanalysed > 1 ? 's' : ''}`,
      description: `Your ${avgScore}% average is based on ${analyzed.length} of ${relevantModules.length} modules. The rest may contain critical gaps.`,
      severity: 'important',
    })
  }
  if (!gsc.connected) {
    whatNext.push({ title: 'Connect Search Console API', description: 'Unlocks clicks, impressions, and keyword position data — currently the biggest blind spot.', severity: 'important' })
  }
  if (stickiness != null && stickiness < 10) {
    whatNext.push({ title: 'Watch DAU/MAU stickiness', description: `${stickiness}% is below the 15% benchmark for healthy SaaS products. Worth investigating which features bring users back.`, severity: 'important' })
  }
  if (!ga4.connected) {
    whatNext.push({ title: 'Connect Google Analytics API', description: 'Unlocks traffic sources, conversion paths, and retention cohorts.', severity: 'important' })
  }

  // Narrative
  const brief = await generateBrief({ name: brand.name, websiteUrl: brand.websiteUrl }, posthog, ga4, gsc, psi, moduleHealthForBrief, connectedProviders)

  const response: OverviewResponse = {
    date: new Date().toISOString(),
    goal: { current: goalCurrent, target: 500, pct: Math.min(100, Math.round((goalCurrent / 500) * 100)) },
    topPriority,
    brief,
    stats: { growthAuditAvg: avgScore, stickiness, moduleAnalysed: analyzed.length, moduleTotal: relevantModules.length, avgScore },
    statusBoard: { done, ongoing, pending, locked },
    posthog, gsc, ga4, psi,
    growthProgress,
    whatNext: whatNext.slice(0, 5),
    lowestModule: topPriorityMod ? { name: topPriorityMod.name, score: topPriorityMod.score ?? 0 } : null,
    lowestFailingItems,
  }

  return NextResponse.json(response)
}
