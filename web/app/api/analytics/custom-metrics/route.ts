import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, customMetrics } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// ── HogQL helpers ─────────────────────────────────────────────────────────────

async function hogqlRows(host: string, projectId: string, apiKey: string, query: string): Promise<unknown[][] | null> {
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json() as { results?: unknown[][] }
    return data.results ?? null
  } catch { return null }
}

// ── GET — list saved metrics with live PostHog counts ─────────────────────────

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = request.nextUrl.searchParams.get('brandId')
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 })

  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const saved = await db
    .select()
    .from(customMetrics)
    .where(eq(customMetrics.brandId, brandId))
    .orderBy(customMetrics.order, customMetrics.createdAt)

  if (saved.length === 0) return NextResponse.json({ metrics: [] })

  // Look up PostHog integration to get live counts
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
    // Return metrics with zero counts if PostHog not connected
    return NextResponse.json({
      metrics: saved.map(m => ({
        id: m.id, eventName: m.eventName, label: m.label,
        tone: m.tone, metricType: m.metricType,
        count24h: 0, count7d: 0, count30d: 0,
        uniqueUsers24h: 0, uniqueUsers7d: 0, uniqueUsers30d: 0,
      })),
    })
  }

  const meta = (phInt.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')

  if (!projectId) {
    return NextResponse.json({
      metrics: saved.map(m => ({
        id: m.id, eventName: m.eventName, label: m.label,
        tone: m.tone, metricType: m.metricType,
        count24h: 0, count7d: 0, count30d: 0,
        uniqueUsers24h: 0, uniqueUsers7d: 0, uniqueUsers30d: 0,
      })),
    })
  }

  // Query all metrics in parallel — one combined query per metric
  const countRows = await Promise.all(
    saved.map(m =>
      hogqlRows(host, projectId, phInt.apiKey!, `
        SELECT
          countIf(timestamp >= now() - interval 1 day),
          countIf(timestamp >= now() - interval 7 day),
          countIf(timestamp >= now() - interval 30 day),
          count(DISTINCT if(timestamp >= now() - interval 1 day, person_id, null)),
          count(DISTINCT if(timestamp >= now() - interval 7 day, person_id, null)),
          count(DISTINCT if(timestamp >= now() - interval 30 day, person_id, null))
        FROM events WHERE event = '${m.eventName.replace(/'/g, "\\'")}'
      `)
    )
  )

  const metrics = saved.map((m, i) => {
    const row = countRows[i]?.[0] ?? []
    return {
      id: m.id,
      eventName: m.eventName,
      label: m.label,
      tone: m.tone,
      metricType: m.metricType,
      count24h:       Number(row[0] ?? 0),
      count7d:        Number(row[1] ?? 0),
      count30d:       Number(row[2] ?? 0),
      uniqueUsers24h: Number(row[3] ?? 0),
      uniqueUsers7d:  Number(row[4] ?? 0),
      uniqueUsers30d: Number(row[5] ?? 0),
    }
  })

  return NextResponse.json({ metrics })
}

// ── POST — save a new custom metric ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    brandId?: string; eventName?: string; label?: string
    tone?: string; metricType?: string
  }
  const { brandId, eventName, label, tone = 'green', metricType = 'count' } = body

  if (!brandId || !eventName || !label) {
    return NextResponse.json({ error: 'brandId, eventName, and label are required' }, { status: 400 })
  }

  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [saved] = await db
    .insert(customMetrics)
    .values({ brandId, eventName, label, tone, metricType })
    .returning()

  return NextResponse.json({ ok: true, id: saved.id })
}
