import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { userTasks } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { levelId, taskIndex, checked } = await request.json()

  if (checked) {
    await db
      .insert(userTasks)
      .values({ userId: user.id, levelId, taskIndex })
      .onConflictDoNothing()
  } else {
    await db
      .delete(userTasks)
      .where(
        and(
          eq(userTasks.userId, user.id),
          eq(userTasks.levelId, levelId),
          eq(userTasks.taskIndex, taskIndex),
        ),
      )
  }

  return NextResponse.json({ ok: true })
}
