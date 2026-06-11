import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { userProgress } from '@/lib/db/schema'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userCount } = await request.json()

  await db
    .insert(userProgress)
    .values({ userId: user.id, userCount })
    .onConflictDoUpdate({
      target: userProgress.userId,
      set: { userCount, updatedAt: new Date() },
    })

  return NextResponse.json({ ok: true })
}
