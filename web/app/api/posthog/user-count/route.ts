import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { buildPostHogFilter } from '@/lib/posthog/filter'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ connected: false, count: 0 })

  const [integration] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.provider, 'posthog'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!integration?.apiKey) {
    console.log('[posthog] no apiKey found in integration row')
    return NextResponse.json({ connected: false, count: 0 })
  }

  const meta = (integration.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host = meta['posthog_host']?.replace(/\/$/, '') || 'https://us.posthog.com'

  if (!projectId) {
    console.log('[posthog] missing project_id in metadata:', meta)
    return NextResponse.json({ connected: true, count: 0, error: 'Missing project ID' })
  }

  const hogql = (query: string) => fetch(`${host}/api/projects/${projectId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${integration.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    signal: AbortSignal.timeout(8000),
  })

  const { personsCountQuery } = buildPostHogFilter(meta)

  try {
    const [countRes, startRes] = await Promise.all([
      hogql(personsCountQuery),
      hogql('SELECT min(timestamp) FROM events'),
    ])

    if (!countRes.ok) {
      const body = await countRes.text()
      console.log('[posthog] API error:', countRes.status, body.slice(0, 200))
      return NextResponse.json({ connected: true, count: 0, error: `PostHog API returned ${countRes.status}` })
    }

    const countData = await countRes.json() as { results?: number[][] }
    const count = countData.results?.[0]?.[0] ?? 0

    let dataStartDate: string | null = null
    if (startRes.ok) {
      const startData = await startRes.json() as { results?: unknown[][] }
      const raw = startData.results?.[0]?.[0]
      if (raw) dataStartDate = String(raw).slice(0, 10)
    }

    return NextResponse.json({ connected: true, count, dataStartDate })
  } catch (err) {
    console.log('[posthog] fetch error:', err)
    return NextResponse.json({ connected: true, count: 0, error: 'Failed to reach PostHog' })
  }
}
