import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

// PATCH { enabled?: boolean, mode?: 'approve' | 'auto' }
//   mode 'approve' — the daily run makes previews for the user to approve (default)
//   mode 'auto'    — the daily run schedules posts without asking
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { enabled, mode } = await request.json() as { enabled?: boolean; mode?: string }
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }
  if (mode !== undefined && mode !== 'approve' && mode !== 'auto') {
    return NextResponse.json({ error: 'mode must be "approve" or "auto"' }, { status: 400 })
  }

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  if (enabled !== undefined) {
    await db.update(brands).set({ frektoAutoPostEnabled: enabled }).where(eq(brands.id, brand.id))
  }

  if (mode !== undefined) {
    const where = and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'frekto'))
    const [frekto] = await db.select({ metadata: brandIntegrations.metadata }).from(brandIntegrations).where(where).limit(1)
    if (!frekto) return NextResponse.json({ error: 'Connect Frekto first' }, { status: 400 })
    const metadata = { ...((frekto.metadata as Record<string, string> | null) ?? {}), auto_post_mode: mode }
    await db.update(brandIntegrations).set({ metadata }).where(where)
  }

  return NextResponse.json({ ok: true, enabled, mode })
}
