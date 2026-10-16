import { db } from '@/lib/db'
import { reminders } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

type ReminderRow = typeof reminders.$inferSelect

// Gmail follow-ups are one-off (lib/gmail/send.ts createFollowupReminder)
export function isGmailFollowup(r: Pick<ReminderRow, 'category' | 'description'>): boolean {
  return r.category === 'outreach' || (r.description?.includes('gmailThreadId:') ?? false)
}

// Marks a reminder done: recurring checks re-arm one interval from now, follow-ups close
export async function completeReminder(brandId: string, reminderId: string): Promise<ReminderRow | null> {
  const [existing] = await db.select().from(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.brandId, brandId)))
    .limit(1)
  if (!existing) return null

  const now = new Date()
  const nextDueAt = new Date(now.getTime() + existing.intervalDays * 24 * 3600 * 1000)
  const [row] = await db.update(reminders)
    .set({ lastDoneAt: now, nextDueAt, snoozedUntil: null, ...(isGmailFollowup(existing) ? { enabled: false } : {}) })
    .where(and(eq(reminders.id, reminderId), eq(reminders.brandId, brandId)))
    .returning()
  return row ?? null
}
