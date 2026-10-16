import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { reminders, brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { cleanTitle, cleanCategory, cleanInterval, cleanUrl } from '@/lib/reminders/validate'

async function getBrandId(userId: string): Promise<string | null> {
  const rows = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, userId)).limit(1)
  return rows[0]?.id ?? null
}

export async function GET() {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
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

// Recurring checks the user adds (custom, or one of the common checks on the page).
// The first one is due soon, not a full interval away, so it shows up while it's still relevant.
const FIRST_DUE_DAYS = 3

export async function POST(req: NextRequest) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = await getBrandId(user.id)
  if (!brandId) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const title = cleanTitle(body.title)
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  const category = cleanCategory(body.category)
  if (!category) return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  const days = cleanInterval(body.intervalDays ?? 30)
  if (!days) return NextResponse.json({ error: 'Invalid interval' }, { status: 400 })
  const url = cleanUrl(body.url)
  if (!url.ok) return NextResponse.json({ error: 'Invalid link' }, { status: 400 })

  const [row] = await db.insert(reminders).values({
    brandId,
    title,
    description: typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 1000) : null,
    category,
    url: url.url,
    intervalDays: days,
    nextDueAt: new Date(Date.now() + Math.min(days, FIRST_DUE_DAYS) * 24 * 3600 * 1000),
    isPreset: body.isPreset === true,
    enabled: true,
  }).returning()

  return NextResponse.json({ reminder: row }, { status: 201 })
}
