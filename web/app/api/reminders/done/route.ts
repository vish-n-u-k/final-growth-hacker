import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { reminders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { verifyReminderToken } from '@/lib/reminders/token'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/reminders?done=invalid', req.url))

  const payload = verifyReminderToken(token)
  if (!payload) return NextResponse.redirect(new URL('/reminders?done=invalid', req.url))

  const existing = await db.select().from(reminders)
    .where(eq(reminders.id, payload.reminderId))
    .limit(1)

  if (!existing[0] || existing[0].brandId !== payload.brandId) {
    return NextResponse.redirect(new URL('/reminders?done=invalid', req.url))
  }

  const now = new Date()
  const nextDueAt = new Date(now.getTime() + existing[0].intervalDays * 24 * 3600 * 1000)

  // Gmail follow-ups are one-off: close them instead of re-arming the interval
  const isGmailFollowup = existing[0].description?.includes('gmailThreadId:') ?? false

  await db.update(reminders)
    .set({ lastDoneAt: now, nextDueAt, snoozedUntil: null, ...(isGmailFollowup ? { enabled: false } : {}) })
    .where(eq(reminders.id, payload.reminderId))

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.growjin.com'
  return NextResponse.redirect(new URL('/reminders?done=1', appUrl))
}
