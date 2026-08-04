import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { brandId?: string; userId?: string; plan?: string }
  const { brandId, userId, plan } = body

  if (!brandId || !userId || !plan) {
    return NextResponse.json({ error: 'brandId, userId, and plan are required' }, { status: 400 })
  }
  if (plan !== 'pro' && plan !== 'free') {
    return NextResponse.json({ error: 'plan must be "pro" or "free"' }, { status: 400 })
  }

  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const [phInt] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'posthog'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!phInt?.apiKey) return NextResponse.json({ error: 'PostHog not connected for this brand' }, { status: 400 })

  const meta = (phInt.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')

  if (!projectId) return NextResponse.json({ error: 'PostHog project_id not configured' }, { status: 400 })

  // Step 1: Find the person by distinct_id to get their PostHog person ID
  const findRes = await fetch(
    `${host}/api/projects/${projectId}/persons/?distinct_id=${encodeURIComponent(userId)}`,
    {
      headers: { Authorization: `Bearer ${phInt.apiKey}` },
      signal: AbortSignal.timeout(10000),
    },
  )
  if (!findRes.ok) {
    return NextResponse.json({ error: 'Failed to find person in PostHog' }, { status: 502 })
  }

  const findData = await findRes.json() as { results?: { id: string }[] }
  const person = findData.results?.[0]
  if (!person?.id) {
    return NextResponse.json({ error: `Person with distinct_id "${userId}" not found in PostHog` }, { status: 404 })
  }

  // Step 2: PATCH person properties to set plan
  const patchRes = await fetch(
    `${host}/api/projects/${projectId}/persons/${person.id}/`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${phInt.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties: { plan } }),
      signal: AbortSignal.timeout(10000),
    },
  )
  if (!patchRes.ok) {
    const errText = await patchRes.text().catch(() => '')
    return NextResponse.json({ error: 'Failed to update person in PostHog', detail: errText }, { status: 502 })
  }

  return NextResponse.json({ ok: true, userId, plan })
}
