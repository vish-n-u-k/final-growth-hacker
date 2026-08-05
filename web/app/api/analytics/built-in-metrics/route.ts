import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const ALLOWED_KEYS = new Set(['deleted', 'pro'])

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { brandId?: string; key?: string; label?: string; events?: string[] }
  const { brandId, key, label, events } = body

  if (!brandId || !key) return NextResponse.json({ error: 'brandId and key required' }, { status: 400 })
  if (!ALLOWED_KEYS.has(key)) return NextResponse.json({ error: `key must be one of: ${[...ALLOWED_KEYS].join(', ')}` }, { status: 400 })

  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existing = (brand.analyticsCardOverrides as Record<string, unknown> | null) ?? {}
  const cardEntry: Record<string, unknown> = {}
  if (label !== undefined) cardEntry['label'] = label
  if (events !== undefined) cardEntry['events'] = events.filter(e => e.trim())

  const updated = { ...existing, [key]: { ...(existing[key] as object ?? {}), ...cardEntry } }

  await db
    .update(brands)
    .set({ analyticsCardOverrides: updated })
    .where(eq(brands.id, brandId))

  return NextResponse.json({ ok: true })
}
