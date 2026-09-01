import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brainContext } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { limitations } = await req.json() as { limitations: string }

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 404 })

  await db
    .insert(brainContext)
    .values({ brandId: brand.id, limitations: limitations ?? '' })
    .onConflictDoUpdate({
      target: brainContext.brandId,
      set: { limitations: limitations ?? '' },
    })

  return NextResponse.json({ ok: true })
}
