import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { reminders, brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getPresetsForWebsiteType } from '@/lib/reminders/presets'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const presets = getPresetsForWebsiteType(brand.websiteType)

  // Get existing preset titles to avoid duplicates
  const existing = await db.select({ title: reminders.title })
    .from(reminders)
    .where(and(eq(reminders.brandId, brand.id), eq(reminders.isPreset, true)))

  const existingTitles = new Set(existing.map(r => r.title))
  const toInsert = presets.filter(p => !existingTitles.has(p.title))

  if (toInsert.length === 0) return NextResponse.json({ seeded: 0 })

  const now = new Date()
  const rows = await db.insert(reminders).values(
    toInsert.map(p => ({
      brandId: brand.id,
      title: p.title,
      category: p.category,
      intervalDays: p.intervalDays,
      nextDueAt: new Date(now.getTime() + p.intervalDays * 24 * 3600 * 1000),
      isPreset: true,
      enabled: true,
    })),
  ).returning()

  return NextResponse.json({ seeded: rows.length })
}
