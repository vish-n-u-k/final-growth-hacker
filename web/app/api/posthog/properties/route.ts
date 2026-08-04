import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const FALLBACK_PROPERTIES = [
  { name: '$email', label: 'Email ($email)' },
  { name: '$name', label: 'Name ($name)' },
  { name: 'distinct_id', label: 'Distinct ID (distinct_id)' },
]

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ properties: FALLBACK_PROPERTIES })

  const [integration] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.provider, 'posthog'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!integration?.apiKey) return NextResponse.json({ properties: FALLBACK_PROPERTIES })

  const meta = (integration.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host = meta['posthog_host']?.replace(/\/$/, '') || 'https://us.posthog.com'

  if (!projectId) return NextResponse.json({ properties: FALLBACK_PROPERTIES })

  try {
    const res = await fetch(
      `${host}/api/projects/${projectId}/property_definitions?type=person&limit=100`,
      {
        headers: { Authorization: `Bearer ${integration.apiKey}` },
        signal: AbortSignal.timeout(8000),
      },
    )
    if (!res.ok) return NextResponse.json({ properties: FALLBACK_PROPERTIES })

    const data = await res.json() as { results?: { name: string; id: string }[] }
    const properties = (data.results ?? []).map(p => ({
      name: p.name,
      label: `${p.name}`,
    }))

    return NextResponse.json({ properties: properties.length ? properties : FALLBACK_PROPERTIES })
  } catch {
    return NextResponse.json({ properties: FALLBACK_PROPERTIES })
  }
}
