import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { bugReports } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const BUCKET = 'bug-reports'

function isAdmin(email: string | undefined): boolean {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(s => s.trim())
    .includes(email ?? '')
}

// PATCH — update status (admin only)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { status = 'closed' } = await request.json()

  await db.update(bugReports).set({ status }).where(eq(bugReports.id, id))

  return NextResponse.json({ id, status, success: true })
}

// DELETE — remove record + storage files (admin only)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const [row] = await db.select().from(bugReports).where(eq(bugReports.id, id))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Delete images from Supabase Storage
  const storage = createAdminClient().storage.from(BUCKET)
  const keysToDelete = [
    ...(row.screenshotKey ? [row.screenshotKey] : []),
    ...(row.extraScreenshotKeys ?? []),
  ]
  if (keysToDelete.length) {
    await storage.remove(keysToDelete).catch(() => {})
  }

  await db.delete(bugReports).where(eq(bugReports.id, id))

  return NextResponse.json({ id, deleted: true })
}
