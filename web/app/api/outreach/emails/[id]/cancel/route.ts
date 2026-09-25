import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, outreachEmails } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'

// Cancels a scheduled (or failed) email before the cron sends it.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const { id } = await params

  const [row] = await db.update(outreachEmails)
    .set({ status: 'cancelled' })
    .where(and(
      eq(outreachEmails.id, id),
      eq(outreachEmails.brandId, brand.id),
      inArray(outreachEmails.status, ['scheduled', 'failed']),
    ))
    .returning({ id: outreachEmails.id })

  if (!row) {
    return NextResponse.json({ error: 'Email is already sending or sent — it can no longer be cancelled' }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
