import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { fetchGsc, fetchGa4 } from '@/lib/analytics/google-providers'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = request.nextUrl.searchParams.get('brandId')
  const range   = request.nextUrl.searchParams.get('range') ?? '7d'
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 })

  const days = range === '30d' ? 30 : range === '24h' ? 1 : 7

  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const integrations = await db
    .select()
    .from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.status, 'connected')))

  const intMap = new Map(integrations.map(i => [i.provider, i]))
  const gscInt = intMap.get('gsc_api')
  const ga4Int = intMap.get('ga4_api')

  const [gsc, ga4] = await Promise.all([
    (async () => {
      if (!gscInt) return { connected: false as const }
      const meta = (gscInt.metadata as Record<string, string> | null) ?? {}
      if (!meta.client_email || !meta.private_key) return { connected: false as const }
      return fetchGsc(meta.client_email, meta.private_key, brand.websiteUrl, days)
    })(),
    (async () => {
      if (!ga4Int) return { connected: false as const }
      const meta = (ga4Int.metadata as Record<string, string> | null) ?? {}
      if (!meta.client_email || !meta.private_key || !meta.property_id) return { connected: false as const }
      return fetchGa4(meta.client_email, meta.private_key, meta.property_id, days)
    })(),
  ])

  return NextResponse.json({ gsc, ga4 })
}
