import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandForUser } from '@/lib/server-session'
import { checkIntegrations, type IntegrationHealth } from '@/lib/integrations/health'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET /api/integrations/health → is each connected data source actually working? ?fresh=1 skips the cache.
const cache = new Map<string, { at: number; data: IntegrationHealth[] }>()
const CACHE_MS = 10 * 60_000

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const brand = await getBrandForUser(user.id)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const fresh = new URL(request.url).searchParams.get('fresh') === '1'
  const hit = cache.get(brand.id)
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json({ integrations: hit.data, checkedAt: new Date(hit.at).toISOString() })
  const data = await checkIntegrations(brand.id, brand.websiteUrl ?? '')
  cache.set(brand.id, { at: Date.now(), data })
  return NextResponse.json({ integrations: data, checkedAt: new Date().toISOString() })
}
