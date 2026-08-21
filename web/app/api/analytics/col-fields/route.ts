import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { brandId, colFields } = await request.json() as { brandId: string; colFields: Record<string, string> }
  if (!brandId || !colFields) return NextResponse.json({ error: 'brandId and colFields required' }, { status: 400 })

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id)))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db
    .update(brands)
    .set({ analyticsColFields: colFields })
    .where(eq(brands.id, brand.id))

  return NextResponse.json({ ok: true })
}
