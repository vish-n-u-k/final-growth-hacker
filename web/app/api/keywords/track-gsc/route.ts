import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, trackedKeywords } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const body = await req.json() as { keyword: string; position?: number }
  const keyword = body.keyword?.trim()
  if (!keyword) return NextResponse.json({ error: 'keyword is required' }, { status: 400 })
  const startPosition = typeof body.position === 'number' ? body.position : null

  const now = new Date()
  const [row] = await db
    .insert(trackedKeywords)
    .values({
      brandId: brand.id,
      keyword,
      status: 'tracking',
      source: 'gsc_import',
      aiReason: 'Imported from Google Search Console — keyword your site is already ranking for.',
      trackingStartedAt: now,
      startPosition,
    })
    .onConflictDoUpdate({
      target: [trackedKeywords.brandId, trackedKeywords.keyword],
      set: {
        status: 'tracking',
        source: 'gsc_import',
        trackingStartedAt: now,
        startPosition,
      },
    })
    .returning({ id: trackedKeywords.id })

  return NextResponse.json({ ok: true, id: row.id })
}
