import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, frektoScheduledPosts, keywordSnapshots, reminders } from '@/lib/db/schema'
import { eq, and, desc, gte, lte, or, isNull } from 'drizzle-orm'
import { createSign } from 'crypto'
import { detectImpacts, type ActionCard, type SignalInput } from '@/lib/daily/signals'
import { getTodayTasks, tasksToCards, type TodayTasks } from '@/lib/daily/today-tasks'

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

// ── Route ──────────────────────────────────────────────────────────────────────
// Action cards come from getTodayTasks — the same list as the daily email and the
// MCP get_today_tasks tool. This route adds reminders, "what's working" impacts,
// recent social posts and the streak on top.

type CachedSignals = { cards?: ActionCard[]; impacts?: unknown[]; focus?: TodayTasks['focus'] }

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const streak = computeStreak(brand.dailyStreak ?? 0, brand.lastActionDate ?? null)
  const force = new URL(request.url).searchParams.get('refresh') === '1'

  // Return cached cards if < 4 hours old (reminders always fetched fresh)
  if (!force && brand.signalsCachedAt && brand.dailySignalsCache) {
    const age = Date.now() - new Date(brand.signalsCachedAt).getTime()
    if (age < 4 * 60 * 60 * 1000) {
      const cached = brand.dailySignalsCache as CachedSignals | ActionCard[]
      const cachedCards = Array.isArray(cached) ? cached : (cached.cards ?? [])
      const impacts = Array.isArray(cached) ? [] : (cached.impacts ?? [])
      const focus = Array.isArray(cached) ? null : (cached.focus ?? null)
      const reminderCards = await fetchReminderCards(brand.id)
      const cards = [...reminderCards, ...cachedCards]
      return NextResponse.json({ cards, impacts, focus, streak, allGood: cards.length === 0, cachedAt: brand.signalsCachedAt })
    }
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 864e5)
  const [today, [ga4Int], frektoRows, kwRows] = await Promise.all([
    getTodayTasks(brand.id),
    db.select().from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'ga4_api'), eq(brandIntegrations.status, 'connected')))
      .limit(1),
    db.select({
      platform: frektoScheduledPosts.platform,
      topic: frektoScheduledPosts.topic,
      status: frektoScheduledPosts.status,
      scheduledAt: frektoScheduledPosts.scheduledAt,
    })
      .from(frektoScheduledPosts)
      .where(eq(frektoScheduledPosts.brandId, brand.id))
      .orderBy(desc(frektoScheduledPosts.scheduledAt))
      .limit(10),
    db.select({ position: keywordSnapshots.position, fetchedAt: keywordSnapshots.fetchedAt })
      .from(keywordSnapshots)
      .where(and(eq(keywordSnapshots.brandId, brand.id), gte(keywordSnapshots.fetchedAt, sevenDaysAgo))),
  ])

  // "What's working" impacts: yesterday's traffic vs the day before, keyword gains
  const ga4Meta = (ga4Int?.metadata as Record<string, string> | null) ?? {}
  const ga4Data = ga4Meta.client_email && ga4Meta.private_key && ga4Meta.property_id
    ? await fetchGA4Signals(ga4Meta.client_email, ga4Meta.private_key, ga4Meta.property_id)
    : null

  let kwSignal: SignalInput['keywords'] = null
  if (kwRows.length >= 2) {
    const now = Date.now()
    const recent = kwRows.filter(r => now - new Date(r.fetchedAt).getTime() < 3 * 864e5)
    const older = kwRows.filter(r => {
      const age = now - new Date(r.fetchedAt).getTime()
      return age >= 3 * 864e5 && age < 7 * 864e5
    })
    if (recent.length > 0 && older.length > 0) {
      const avg = (arr: typeof kwRows) => arr.reduce((s, r) => s + r.position, 0) / arr.length
      kwSignal = { recentAvgPosition: avg(recent), olderAvgPosition: avg(older) }
    }
  }
  const impacts = detectImpacts({ ga4: ga4Data, keywords: kwSignal })

  const taskCards = today ? tasksToCards(today) : []
  const focus = today?.focus ?? null

  // Cache task cards only (not reminders — they're always fetched fresh)
  await db.update(brands)
    .set({ dailySignalsCache: { cards: taskCards, impacts, focus }, signalsCachedAt: new Date() })
    .where(eq(brands.id, brand.id))

  const reminderCards = await fetchReminderCards(brand.id)
  const cards = [...reminderCards, ...taskCards]

  return NextResponse.json({
    cards,
    impacts,
    focus,
    recentPosts: frektoRows,
    streak,
    allGood: cards.length === 0,
    cachedAt: new Date().toISOString(),
  })
}

async function fetchReminderCards(brandId: string): Promise<ActionCard[]> {
  try {
    const now = new Date()
    const rows = await db.select({
      id: reminders.id,
      title: reminders.title,
      nextDueAt: reminders.nextDueAt,
    })
      .from(reminders)
      .where(and(
        eq(reminders.brandId, brandId),
        eq(reminders.enabled, true),
        lte(reminders.nextDueAt, now),
        or(isNull(reminders.snoozedUntil), lte(reminders.snoozedUntil, now)),
      ))
      .orderBy(reminders.nextDueAt)
      .limit(3)

    return rows.map(r => {
      const daysOverdue = Math.round((Date.now() - new Date(r.nextDueAt!).getTime()) / 86400000)
      return {
        id: `reminder-${r.id}`,
        type: 'reminder' as const,
        priority: -1,
        headline: r.title,
        reason: daysOverdue > 0
          ? `Overdue by ${daysOverdue} day${daysOverdue === 1 ? '' : 's'}`
          : 'Due today',
        cta: 'Mark done',
        ctaUrl: `/api/reminders/${r.id}/done`,
        data: { reminderId: r.id },
      }
    })
  } catch { return [] }
}

function computeStreak(currentStreak: number, lastActionDate: string | null): number {
  if (!lastActionDate) return 0
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  if (lastActionDate === today) return currentStreak
  if (lastActionDate === yesterday) return currentStreak
  return 0 // gap > 1 day — streak broken
}
