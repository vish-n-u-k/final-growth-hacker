import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import { db } from '@/lib/db'
import { userNotes } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Notes are an internal GrowJin team tool.
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const notes = await db
    .select()
    .from(userNotes)
    .where(eq(userNotes.userId, user.id))
    .orderBy(desc(userNotes.pinned), desc(userNotes.createdAt))

  return NextResponse.json(notes)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Notes are an internal GrowJin team tool.
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json()
  const { title = '', content = '', tags = [], pinned = false, moduleType = null } = body

  const [note] = await db
    .insert(userNotes)
    .values({ userId: user.id, title, content, tags, pinned, moduleType })
    .returning()

  return NextResponse.json(note)
}
