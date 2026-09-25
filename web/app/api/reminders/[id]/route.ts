import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { reminders, brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

async function getBrandId(userId: string): Promise<string | null> {
  const rows = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, userId)).limit(1)
  return rows[0]?.id ?? null
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = await getBrandId(user.id)
  if (!brandId) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const { id } = await params
  const body = await req.json()

  const updates: Partial<typeof reminders.$inferInsert> = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.category !== undefined) updates.category = body.category
  if (body.intervalDays !== undefined) updates.intervalDays = Math.max(1, parseInt(body.intervalDays, 10))
  if (body.enabled !== undefined) updates.enabled = body.enabled
  if (body.snooze === true) {
    const snoozeDays = Math.min(Math.max(1, Number(body.snoozeDays) || 7), 30)
    updates.snoozedUntil = new Date(Date.now() + snoozeDays * 24 * 3600 * 1000)
  }
  if (body.snooze === false) {
    updates.snoozedUntil = null
  }

  const [row] = await db.update(reminders)
    .set(updates)
    .where(and(eq(reminders.id, id), eq(reminders.brandId, brandId)))
    .returning()

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ reminder: row })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = await getBrandId(user.id)
  if (!brandId) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const { id } = await params
  await db.delete(reminders)
    .where(and(eq(reminders.id, id), eq(reminders.brandId, brandId)))

  return NextResponse.json({ ok: true })
}
