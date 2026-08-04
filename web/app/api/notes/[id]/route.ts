import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { userNotes } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  const allowed: Record<string, unknown> = {}
  if ('title' in body) allowed.title = body.title
  if ('content' in body) allowed.content = body.content
  if ('tags' in body) allowed.tags = body.tags
  if ('pinned' in body) allowed.pinned = body.pinned
  if ('moduleType' in body) allowed.moduleType = body.moduleType
  allowed.updatedAt = new Date()

  const [note] = await db
    .update(userNotes)
    .set(allowed)
    .where(and(eq(userNotes.id, id), eq(userNotes.userId, user.id)))
    .returning()

  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(note)
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  await db
    .delete(userNotes)
    .where(and(eq(userNotes.id, id), eq(userNotes.userId, user.id)))

  return NextResponse.json({ ok: true })
}
