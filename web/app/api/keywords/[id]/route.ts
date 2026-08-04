import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, trackedKeywords, keywordSnapshots } from '@/lib/db/schema'
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
  const body = await req.json() as { status?: string; isTargeted?: boolean }
  const { status, isTargeted } = body

  // Validate at least one field is being updated
  if (status === undefined && isTargeted === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  if (status !== undefined && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // Fetch existing row for ownership check + keyword text
  const [existing] = await db
    .select({ keyword: trackedKeywords.keyword })
    .from(trackedKeywords)
    .where(and(eq(trackedKeywords.id, id), eq(trackedKeywords.brandId, brand.id)))
    .limit(1)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date()
  const updates: Record<string, unknown> = {}

  if (isTargeted !== undefined && typeof isTargeted === 'boolean') {
    updates.isTargeted = isTargeted
    updates.targetedAt = isTargeted ? now : null
  }

  if (status !== undefined) {
    updates.status = status

    if (status === 'tracking') {
      updates.trackingStartedAt = now

      // Capture current GSC position as the baseline — stored once, survives snapshot refresh
      const snapshots = await db
        .select()
        .from(keywordSnapshots)
        .where(eq(keywordSnapshots.brandId, brand.id))

      const kl = existing.keyword.toLowerCase()
      const match = snapshots
        .filter(s => { const sl = s.keyword.toLowerCase(); return sl === kl || sl.includes(kl) || kl.includes(sl) })
        .sort((a, b) => b.impressions - a.impressions)[0]

      updates.startPosition = match?.position ?? null
    }

    if (status === 'implemented') updates.implementedAt = now
  }

  await db
    .update(trackedKeywords)
    .set(updates)
    .where(eq(trackedKeywords.id, id))

  return NextResponse.json({ ok: true })
}
