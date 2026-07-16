import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const maxDuration = 30

// Run a HogQL query and return the first numeric result
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

// Run a PostHog insight query and return raw response
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

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = request.nextUrl.searchParams.get('brandId')
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 })

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [phInt] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'posthog'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!phInt?.apiKey) {
    return NextResponse.json({ posthogConnected: false })
  }

  const meta = (phInt.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')

  if (!projectId) {
    return NextResponse.json({ posthogConnected: true, missingProjectId: true })
  }

  const key = phInt.apiKey

  // Run all queries in parallel
  const [signups24h, signins24h, dau, mau, retentionRaw, funnelRaw] = await Promise.all([
    // New persons created in last 24h (proxy for signups)
    hogql(host, projectId, key, `SELECT count() FROM persons WHERE created_at >= now() - interval 1 day`),

    // $identify events in last 24h (proxy for sign-ins)
    hogql(host, projectId, key, `SELECT count() FROM events WHERE event = '$identify' AND timestamp >= now() - interval 1 day`),

    // Distinct active users today
    hogql(host, projectId, key, `SELECT count(DISTINCT person_id) FROM events WHERE timestamp >= now() - interval 1 day`),

    // Distinct active users in last 30d (MAU)
    hogql(host, projectId, key, `SELECT count(DISTINCT person_id) FROM events WHERE timestamp >= now() - interval 30 day`),

    // Retention cohort — Day 0 through Day 30
    phQuery(host, projectId, key, {
      kind: 'RetentionQuery',
      retentionFilter: {
        retention_type: 'retention_first_time',
        target_entity: { id: '$pageview', type: 'events' },
        returning_entity: { id: '$pageview', type: 'events' },
        total_intervals: 7,
        period: 'Day',
      },
      dateRange: { date_from: '-30d' },
    }),

    // Conversion funnel: visited → signed up → activated
    phQuery(host, projectId, key, {
      kind: 'FunnelsQuery',
      series: [
        { kind: 'EventsNode', event: '$pageview', name: 'Visited site' },
        { kind: 'EventsNode', event: '$identify', name: 'Signed up' },
      ],
      funnelsFilter: { funnel_window_days: 14 },
      dateRange: { date_from: '-30d' },
    }),
  ])

  // Parse retention: use first cohort row, values[i] = retained count on day i
  let retention: { day: string; rate: number }[] | null = null
  try {
    const rd = retentionRaw as { results?: Array<{ values: Array<{ count: number }> }> } | null
    const firstCohort = rd?.results?.[0]
    if (firstCohort && firstCohort.values.length > 0) {
      const d0 = firstCohort.values[0]?.count ?? 1
      const dayMap: { label: string; valueIdx: number }[] = [
        { label: 'D0', valueIdx: 0 },
        { label: 'D1', valueIdx: 1 },
        { label: 'D3', valueIdx: 3 },
        { label: 'D7', valueIdx: 6 },
        { label: 'D14', valueIdx: 6 }, // cap at available intervals
        { label: 'D30', valueIdx: 6 },
      ]
      retention = dayMap.map(({ label, valueIdx }) => {
        const count = firstCohort.values[valueIdx]?.count ?? 0
        return { day: label, rate: Math.round((count / Math.max(d0, 1)) * 100) }
      })
    }
  } catch { /* fall back to null */ }

  // Parse funnel: results[0] is an array of funnel steps
  let funnel: { stage: string; value: number }[] | null = null
  try {
    const fd = funnelRaw as { results?: Array<Array<{ name: string; count: number }>> } | null
    const steps = fd?.results?.[0]
    if (steps && steps.length > 0) {
      funnel = steps.map((s) => ({ stage: s.name, value: s.count }))
    }
  } catch { /* fall back to null */ }

  return NextResponse.json({
    posthogConnected: true,
    signups24h,
    signins24h,
    dau,
    mau,
    retention,
    funnel,
  })
}
