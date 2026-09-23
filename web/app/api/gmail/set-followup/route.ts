import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { reminders, brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { threadId, subject, recipientName, days } =
    await req.json() as { threadId: string; subject: string; recipientName?: string; days?: number }

  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const intervalDays = Math.max(1, days ?? 3)
  const nextDueAt = new Date(Date.now() + intervalDays * 24 * 3600 * 1000)
  const label = recipientName?.trim() || subject?.trim() || threadId

  const [row] = await db.insert(reminders).values({
    brandId:     brand.id,
    title:       `Follow up: ${label}`,
    description: subject ? `Re: ${subject}\ngmailThreadId:${threadId}` : `gmailThreadId:${threadId}`,
    category:    'outreach',
    intervalDays,
    nextDueAt,
    isPreset:    false,
    enabled:     true,
  }).returning()

  return NextResponse.json({ reminder: row }, { status: 201 })
}
