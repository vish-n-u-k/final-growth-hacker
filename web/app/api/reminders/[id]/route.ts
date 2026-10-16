import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { reminders, brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { cleanTitle, cleanCategory, cleanInterval, cleanUrl } from '@/lib/reminders/validate'

async function getBrandId(userId: string): Promise<string | null> {
  const rows = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, userId)).limit(1)
  return rows[0]?.id ?? null
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = await getBrandId(user.id)
  if (!brandId) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const updates: Partial<typeof reminders.$inferInsert> = {}
  if (body.title !== undefined) {
    const title = cleanTitle(body.title)
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    updates.title = title
  }
  if (body.description !== undefined) {
    updates.description = typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 1000) : null
  }
  if (body.category !== undefined) {
    const category = cleanCategory(body.category)
    if (!category) return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    updates.category = category
  }
  if (body.url !== undefined) {
    const url = cleanUrl(body.url)
    if (!url.ok) return NextResponse.json({ error: 'Invalid link' }, { status: 400 })
    updates.url = url.url
  }
  if (body.intervalDays !== undefined) {
    const days = cleanInterval(body.intervalDays)
    if (!days) return NextResponse.json({ error: 'Invalid interval' }, { status: 400 })
    updates.intervalDays = days
  }
  if (typeof body.enabled === 'boolean') updates.enabled = body.enabled
  if (body.snooze === true) {
    const snoozeDays = Math.min(Math.max(1, Number(body.snoozeDays) || 7), 30)
    updates.snoozedUntil = new Date(Date.now() + snoozeDays * 24 * 3600 * 1000)
  }
  if (body.snooze === false) {
    updates.snoozedUntil = null
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const [row] = await db.update(reminders)
    .set(updates)
    .where(and(eq(reminders.id, id), eq(reminders.brandId, brandId)))
    .returning()

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ reminder: row })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
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
