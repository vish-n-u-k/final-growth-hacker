import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Delete brand and all associated data (cascades to modules, items, brain, integrations)
  await db.delete(brands).where(eq(brands.userId, user.id))

  // Sign out the session
  await supabase.auth.signOut()

  return NextResponse.json({ ok: true })
}
