import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

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

  if (!integration?.apiKey) return NextResponse.json({ connected: false, count: 0 })

  const meta = (integration.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host = meta['posthog_host']?.replace(/\/$/, '') || 'https://us.posthog.com'

  if (!projectId) return NextResponse.json({ connected: true, count: 0, error: 'Missing project ID' })

  try {
    const res = await fetch(`${host}/api/projects/${projectId}/persons/?limit=1`, {
      headers: { Authorization: `Bearer ${integration.apiKey}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return NextResponse.json({ connected: true, count: 0, error: `PostHog API returned ${res.status}` })
    const data = await res.json() as { count?: number }
    return NextResponse.json({ connected: true, count: data.count ?? 0 })
  } catch {
    return NextResponse.json({ connected: true, count: 0, error: 'Failed to reach PostHog' })
  }
}
