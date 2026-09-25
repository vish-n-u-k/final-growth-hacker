import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, outreachEmails } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { sendGmailMessage, createFollowupReminder, parseRecipientName, GmailSendError } from '@/lib/gmail/send'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { to, subject, body, followUpDays, source, campaignInstruction, scheduledAt } =
    await req.json() as { to: string; subject: string; body: string; followUpDays?: number; source?: string; campaignInstruction?: string; scheduledAt?: string }

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.userId, user.id))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  // Scheduled send: queue it — /api/cron/send-scheduled delivers it (hourly)
  if (scheduledAt) {
    const when = new Date(scheduledAt)
    if (isNaN(when.getTime())) return NextResponse.json({ error: 'Invalid scheduled time' }, { status: 400 })
    if (when.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: 'Scheduled time must be in the future' }, { status: 400 })
    }

    const [row] = await db.insert(outreachEmails).values({
      brandId: brand.id, toEmail: to, toName: parseRecipientName(to),
      subject, body, status: 'scheduled', scheduledAt: when,
      followUpDays: followUpDays && followUpDays > 0 ? followUpDays : null,
      source: source ?? 'outreach', campaignInstruction: campaignInstruction ?? null,
    }).returning({ id: outreachEmails.id })

    return NextResponse.json({ id: row.id, scheduled: true, scheduledAt: when.toISOString() })
  }

  let sent: { id: string; threadId: string }
  try {
    sent = await sendGmailMessage(brand.id, { to, subject, body })
  } catch (e: unknown) {
    if (e instanceof GmailSendError) {
      if (e.code === 'missing_send_scope') {
        return NextResponse.json({ error: 'missing_send_scope', message: e.message }, { status: 403 })
      }
      return NextResponse.json({ error: e.message }, { status: e.code === 'not_connected' ? 400 : 502 })
    }
    throw e
  }

  // Log to outreach_emails (fire-and-forget)
  db.insert(outreachEmails).values({
    brandId: brand.id, toEmail: to, toName: parseRecipientName(to),
    subject, body, status: 'sent', sentAt: new Date(),
    gmailMessageId: sent.id, gmailThreadId: sent.threadId,
    source: source ?? 'outreach', campaignInstruction: campaignInstruction ?? null,
  }).catch(e => console.error('[send-email] DB log error:', e))

  // Auto-create follow-up reminder if requested
  if (followUpDays && followUpDays > 0) {
    await createFollowupReminder(brand.id, { to, subject, threadId: sent.threadId, days: followUpDays })
  }

  return NextResponse.json({ messageId: sent.id, scheduled: false, scheduledAt: null })
}
