import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { reminders, brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

async function getBrandId(userId: string): Promise<string | null> {
  const rows = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, userId)).limit(1)
  return rows[0]?.id ?? null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = await getBrandId(user.id)
  if (!brandId) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const rows = await db.select().from(reminders)
    .where(eq(reminders.brandId, brandId))
    .orderBy(reminders.nextDueAt)

  return NextResponse.json({ reminders: rows })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = await getBrandId(user.id)
  if (!brandId) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const { title, description, category, intervalDays } = await req.json()
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (!category) return NextResponse.json({ error: 'Category is required' }, { status: 400 })

  const days = Math.max(1, parseInt(intervalDays ?? '30', 10))
  const nextDueAt = new Date(Date.now() + days * 24 * 3600 * 1000)

  const [row] = await db.insert(reminders).values({
    brandId,
    title: title.trim(),
    description: description?.trim() || null,
    category,
    intervalDays: days,
    nextDueAt,
    isPreset: false,
    enabled: true,
  }).returning()

  return NextResponse.json({ reminder: row }, { status: 201 })
}
