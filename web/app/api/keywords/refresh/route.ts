import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, keywordSnapshots } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { fetchGscTopQueries } from '@/lib/modules/seo/keyword-fetchers'

export const maxDuration = 60

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  // Fetch GSC credentials
  const [gscRow] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.provider, 'gsc_api'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!gscRow) {
    return NextResponse.json({ error: 'GSC not connected', hasGsc: false }, { status: 400 })
  }

  const gscMeta = (gscRow.metadata as Record<string, string> | null) ?? {}
  const clientEmail = gscMeta['client_email']
  const privateKey = gscMeta['private_key']

  if (!clientEmail || !privateKey) {
    return NextResponse.json({ error: 'GSC credentials incomplete', hasGsc: false }, { status: 400 })
  }

  let rows: Awaited<ReturnType<typeof fetchGscTopQueries>>
  try {
    rows = await fetchGscTopQueries(clientEmail, privateKey, brand.websiteUrl, 100)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'GSC fetch failed' },
      { status: 502 },
    )
  }

  if (rows.length === 0) {
    return NextResponse.json({ count: 0, fetchedAt: new Date().toISOString() })
  }

  const fetchedAt = new Date()
  await db.insert(keywordSnapshots).values(
    rows.map((r) => ({
      brandId: brand.id,
      keyword: r.query,
      impressions: r.impressions,
      clicks: r.clicks,
      position: r.position,
      fetchedAt,
    })),
  )

  return NextResponse.json({ count: rows.length, fetchedAt: fetchedAt.toISOString() })
}
