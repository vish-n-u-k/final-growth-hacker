import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({
    id: brands.id,
    dailyStreak: brands.dailyStreak,
    lastActionDate: brands.lastActionDate,
  }).from(brands).where(eq(brands.userId, user.id)).limit(1)

  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  const last = brand.lastActionDate

  let newStreak: number
  if (last === today) {
    // Already actioned today — keep streak
    newStreak = brand.dailyStreak ?? 1
  } else if (last === yesterday) {
    // Consecutive day — increment
    newStreak = (brand.dailyStreak ?? 0) + 1
  } else {
    // Gap > 1 day or first action — reset to 1
    newStreak = 1
  }

  await db.update(brands)
    .set({ dailyStreak: newStreak, lastActionDate: today })
    .where(eq(brands.id, brand.id))

  return NextResponse.json({ streak: newStreak })
}
