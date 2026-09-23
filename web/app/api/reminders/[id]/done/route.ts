import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { reminders, brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

async function getBrandId(userId: string): Promise<string | null> {
  const rows = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, userId)).limit(1)
  return rows[0]?.id ?? null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = await getBrandId(user.id)
  if (!brandId) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const { id } = await params

  const existing = await db.select().from(reminders)
    .where(and(eq(reminders.id, id), eq(reminders.brandId, brandId)))
    .limit(1)

  if (!existing[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date()
  const nextDueAt = new Date(now.getTime() + existing[0].intervalDays * 24 * 3600 * 1000)

  const [row] = await db.update(reminders)
    .set({ lastDoneAt: now, nextDueAt, snoozedUntil: null })
    .where(eq(reminders.id, id))
    .returning()

  return NextResponse.json({ reminder: row })
}
