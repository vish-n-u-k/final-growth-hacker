import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { userNotes, analysisRequests } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'

function isAdmin(email: string | undefined): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return adminEmails.includes(email ?? '')
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [notes, recentRequests] = await Promise.all([
    db.select().from(userNotes).orderBy(desc(userNotes.createdAt)),
    db.select({ userId: analysisRequests.userId, userEmail: analysisRequests.userEmail })
      .from(analysisRequests)
      .orderBy(desc(analysisRequests.requestedAt)),
  ])

  // Build userId -> email map
  const emailMap = new Map<string, string>()
  for (const r of recentRequests) {
    if (!emailMap.has(r.userId)) emailMap.set(r.userId, r.userEmail)
  }

  const result = notes.map(n => ({
    ...n,
    userEmail: emailMap.get(n.userId) ?? '(unknown)',
  }))

  return NextResponse.json({ notes: result })
}
