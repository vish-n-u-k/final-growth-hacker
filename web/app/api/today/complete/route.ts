import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { toggleItem } from '@/lib/mcp/tools/toggle_item'
import { resolveSignal } from '@/lib/signals'

// Completes a /today task card: checklist items are ticked, alerts/plays are
// resolved (done or dismissed). Same effect as the MCP toggle_item / resolve_signal.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const { kind, id, status } = (await request.json()) as {
    kind: 'alert' | 'play' | 'item'
    id: string
    status?: 'done' | 'dismissed'
  }
  if (!id || !kind) return NextResponse.json({ error: 'Missing kind or id' }, { status: 400 })

  const result = kind === 'item'
    ? await toggleItem(brand.id, id, true)
    : await resolveSignal(brand.id, id, status === 'dismissed' ? 'dismissed' : 'done')
  if ('error' in result) return NextResponse.json(result, { status: 404 })

  // Next /today load rebuilds the list so the next task moves up
  await db.update(brands).set({ signalsCachedAt: null }).where(eq(brands.id, brand.id))

  return NextResponse.json(result)
}
