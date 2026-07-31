import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, trackedKeywords } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const VALID_STATUSES = ['tracking', 'implemented', 'dismissed', 'suggested'] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.userId, user.id))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const { id } = await params
  const body = await req.json() as { status: string }
  const { status } = body

  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const now = new Date()
  const updates: Record<string, unknown> = { status }
  if (status === 'tracking') updates.trackingStartedAt = now
  if (status === 'implemented') updates.implementedAt = now

  const [updated] = await db
    .update(trackedKeywords)
    .set(updates)
    .where(and(
      eq(trackedKeywords.id, id),
      eq(trackedKeywords.brandId, brand.id),
    ))
    .returning({ id: trackedKeywords.id })

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
