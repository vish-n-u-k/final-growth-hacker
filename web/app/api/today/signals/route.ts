import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import {
  brands, brandIntegrations, modules, moduleItems,
  frektoScheduledPosts, keywordSnapshots, modulePageAudit,
} from '@/lib/db/schema'
import { eq, and, desc, gte, inArray } from 'drizzle-orm'
import { createSign } from 'crypto'
import { detectSignals, detectImpacts, type ActionCard, type SignalInput } from '@/lib/daily/signals'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// ── JWT / GA4 helpers (same pattern as daily-summary) ─────────────────────────

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

async function fetchGA4Signals(clientEmail: string, privateKey: string, propertyId: string) {
  const token = await googleToken(clientEmail, privateKey, 'https://www.googleapis.com/auth/analytics.readonly')
  if (!token) return null
  const pid = propertyId.replace(/^properties\//, '')

  // Fetch yesterday + 7-day breakdown
  const [yesterdayRows, priorRows, weekRows] = await Promise.all([
    ga4Report(token, pid, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
      metrics: [{ name: 'sessions' }],
    }),
    ga4Report(token, pid, {
      dateRanges: [{ startDate: '2daysAgo', endDate: '2daysAgo' }],
      metrics: [{ name: 'sessions' }],
    }),
    ga4Report(token, pid, {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    }),
  ])

  const visits = parseInt(yesterdayRows[0]?.metricValues[0]?.value ?? '0', 10)
  const visitsPrior = parseInt(priorRows[0]?.metricValues[0]?.value ?? '0', 10)
  const weekSessions = weekRows.map(r => parseInt(r.metricValues[0]?.value ?? '0', 10))

  return { visits, visitsPrior, weekSessions }
}

// ── PostHog helper ─────────────────────────────────────────────────────────────

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

async function fetchPHSignals(host: string, pid: string, key: string) {
  const trendRows = await hogql(host, pid, key,
    `SELECT toDate(timestamp) as day, count(DISTINCT person_id) as dau FROM events
     WHERE toDate(timestamp) >= toDate(now()) - 8 AND toDate(timestamp) < toDate(now())
     GROUP BY day ORDER BY day ASC`,
  )
  const dauTrend = (trendRows ?? []).map(r => ({ date: String(r[0] ?? ''), dau: Number(r[1] ?? 0) }))
  const last = dauTrend[dauTrend.length - 1]
  const prev = dauTrend[dauTrend.length - 2]
  return { dau: last?.dau ?? 0, dauPrior: prev?.dau ?? 0, dauTrend }
}

// ── Route ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  // Return cached signals if < 4 hours old
  if (brand.signalsCachedAt && brand.dailySignalsCache) {
    const age = Date.now() - new Date(brand.signalsCachedAt).getTime()
    if (age < 4 * 60 * 60 * 1000) {
      const streak = computeStreak(brand.dailyStreak ?? 0, brand.lastActionDate ?? null)
      const cards = brand.dailySignalsCache as ActionCard[]
      return NextResponse.json({
        cards,
        streak,
        allGood: cards.length === 0,
        cachedAt: brand.signalsCachedAt,
      })
    }
  }

  // Fetch integrations + DB data in parallel
  const sevenDaysAgo = new Date(Date.now() - 7 * 864e5)

  const [integrations, allModules, frektoRows, kwRows, critItems, auditPages] = await Promise.all([
    db.select().from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.status, 'connected'))),

    db.select({ id: modules.id, type: modules.type, score: modules.score, status: modules.status })
      .from(modules)
      .where(eq(modules.brandId, brand.id)),

    // Last 15 frekto posts
    db.select({
      platform: frektoScheduledPosts.platform,
      topic: frektoScheduledPosts.topic,
      status: frektoScheduledPosts.status,
      scheduledAt: frektoScheduledPosts.scheduledAt,
    })
      .from(frektoScheduledPosts)
      .where(eq(frektoScheduledPosts.brandId, brand.id))
      .orderBy(desc(frektoScheduledPosts.scheduledAt))
      .limit(15),

    // Keyword snapshots last 7 days
    db.select({ position: keywordSnapshots.position, fetchedAt: keywordSnapshots.fetchedAt })
      .from(keywordSnapshots)
      .where(and(eq(keywordSnapshots.brandId, brand.id), gte(keywordSnapshots.fetchedAt, sevenDaysAgo))),

    // Critical items (weight=3) that are unchecked
    db.select({
      id: moduleItems.id,
      slug: moduleItems.slug,
      label: moduleItems.label,
      moduleId: moduleItems.moduleId,
      aiVerified: moduleItems.aiVerified,
      userChecked: moduleItems.userChecked,
    })
      .from(moduleItems)
      .where(and(
        eq(moduleItems.weight, 3),
        eq(moduleItems.aiVerified, false),
        eq(moduleItems.userChecked, false),
      ))
      .limit(20),

    // Content audit pages with Remove/Refresh verdict
    db.select({ title: modulePageAudit.title, url: modulePageAudit.url, verdict: modulePageAudit.verdict, moduleId: modulePageAudit.moduleId })
      .from(modulePageAudit)
      .where(inArray(modulePageAudit.verdict, ['Remove', 'Refresh']))
      .limit(50),
  ])

  const intMap = new Map(integrations.map(i => [i.provider, i]))
  const ga4Int = intMap.get('ga4_api')
  const phInt  = intMap.get('posthog')

  const ga4Meta = (ga4Int?.metadata as Record<string, string> | null) ?? {}
  const phMeta  = (phInt?.metadata  as Record<string, string> | null) ?? {}

  // Filter to unlocked modules
  const unlockedModules = allModules.filter(m => m.status !== 'locked')

  // Fetch live GA4 + PostHog in parallel
  const [ga4Data, phData] = await Promise.all([
    (ga4Int && ga4Meta.client_email && ga4Meta.private_key && ga4Meta.property_id)
      ? fetchGA4Signals(ga4Meta.client_email, ga4Meta.private_key, ga4Meta.property_id)
      : Promise.resolve(null),
    (phInt?.apiKey && phMeta.project_id)
      ? fetchPHSignals(
          (phMeta.posthog_host ?? 'https://us.posthog.com').replace(/\/$/, ''),
          phMeta.project_id,
          phInt.apiKey,
        )
      : Promise.resolve(null),
  ])

  // Resolve module IDs for critical items
  const moduleTypeMap = new Map(unlockedModules.map(m => [m.id, m.type]))
  const seoModule = unlockedModules.find(m => m.type === 'seo') ?? null

  // Filter critical items to those in this brand's unlocked modules
  const brandModuleIds = new Set(unlockedModules.map(m => m.id))
  const uncheckedCritical = critItems
    .filter(i => brandModuleIds.has(i.moduleId))
    .map(i => ({
      id: i.id,
      slug: i.slug,
      label: i.label,
      moduleId: i.moduleId,
      moduleType: moduleTypeMap.get(i.moduleId) ?? 'module',
    }))
    .slice(0, 5)

  // Frekto signal
  const lastSent = frektoRows.find(r => r.status === 'done') ?? null
  const frektoSignal: SignalInput['frekto'] = {
    lastSentAt: lastSent?.scheduledAt ?? null,
    activePlatform: lastSent?.platform ?? frektoRows[0]?.platform ?? null,
    hasAnyPosts: frektoRows.length > 0,
  }

  // Recent posts for the social feed UI (done + scheduled, last 10)
  const recentPosts = frektoRows.slice(0, 10).map(r => ({
    platform: r.platform,
    topic: r.topic,
    status: r.status,
    scheduledAt: r.scheduledAt,
  }))

  // Keyword signal — compare last 3 days vs days 4-7
  let kwSignal: SignalInput['keywords'] = null
  if (kwRows.length >= 2) {
    const now = Date.now()
    const recent = kwRows.filter(r => now - new Date(r.fetchedAt).getTime() < 3 * 864e5)
    const older  = kwRows.filter(r => {
      const age = now - new Date(r.fetchedAt).getTime()
      return age >= 3 * 864e5 && age < 7 * 864e5
    })
    if (recent.length > 0 && older.length > 0) {
      const avg = (arr: typeof kwRows) => arr.reduce((s, r) => s + r.position, 0) / arr.length
      kwSignal = { recentAvgPosition: avg(recent), olderAvgPosition: avg(older) }
    }
  }

  // Filter page audit to this brand's modules
  const brandAuditPages = auditPages
    .filter(p => brandModuleIds.has(p.moduleId))
    .slice(0, 5)

  const input: SignalInput = {
    ga4: ga4Data,
    ph: phData,
    frekto: frektoSignal,
    keywords: kwSignal,
    seoModule: seoModule ? { id: seoModule.id, score: seoModule.score ?? 0 } : null,
    uncheckedCriticalItems: uncheckedCritical,
    pageAuditItems: brandAuditPages.map(p => ({ title: p.title, url: p.url, verdict: p.verdict })),
  }

  const cards = detectSignals(input)
  const impacts = detectImpacts(input)

  // Cache in DB
  await db.update(brands)
    .set({ dailySignalsCache: { cards, impacts }, signalsCachedAt: new Date() })
    .where(eq(brands.id, brand.id))

  const streak = computeStreak(brand.dailyStreak ?? 0, brand.lastActionDate ?? null)

  return NextResponse.json({
    cards,
    impacts,
    recentPosts,
    streak,
    allGood: cards.length === 0,
    cachedAt: new Date().toISOString(),
  })
}

function computeStreak(currentStreak: number, lastActionDate: string | null): number {
  if (!lastActionDate) return 0
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  if (lastActionDate === today) return currentStreak
  if (lastActionDate === yesterday) return currentStreak
  return 0 // gap > 1 day — streak broken
}
