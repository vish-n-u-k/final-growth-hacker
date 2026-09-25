import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { outreachEmails } from '@/lib/db/schema'
import { eq, and, lte, asc, sql } from 'drizzle-orm'
import { sendGmailMessage, createFollowupReminder } from '@/lib/gmail/send'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BATCH_LIMIT   = 40
const TIME_BUDGET   = 50_000         // stop picking up new emails after 50s
const MAX_ATTEMPTS  = 3
const STALE_SENDING = 30 * 60_000    // 'sending' rows older than this were interrupted mid-run

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Runs hourly (vercel.json). Sends every scheduled email whose time has passed —
// including ones missed by earlier runs — oldest first.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  const now = new Date()

  // Interrupted sends: Gmail may or may not have accepted them, so don't resend
  // blindly (could duplicate) — mark failed so the user can check and reschedule.
  const stale = await db.update(outreachEmails)
    .set({ status: 'failed', lastError: 'Send was interrupted. Check your Gmail Sent folder before retrying.' })
    .where(and(
      eq(outreachEmails.status, 'sending'),
      lte(outreachEmails.claimedAt, new Date(now.getTime() - STALE_SENDING)),
    ))
    .returning({ id: outreachEmails.id })

  const due = await db.select({ id: outreachEmails.id })
    .from(outreachEmails)
    .where(and(eq(outreachEmails.status, 'scheduled'), lte(outreachEmails.scheduledAt, now)))
    .orderBy(asc(outreachEmails.scheduledAt))
    .limit(BATCH_LIMIT)

  const results: { id: string; status: 'sent' | 'retry' | 'failed' | 'skipped'; error?: string }[] = []

  for (const { id } of due) {
    if (Date.now() - started > TIME_BUDGET) break

    // Claim atomically — skips rows another run (or a cancel) got to first
    const [email] = await db.update(outreachEmails)
      .set({ status: 'sending', claimedAt: new Date(), sendAttempts: sql`${outreachEmails.sendAttempts} + 1` })
      .where(and(eq(outreachEmails.id, id), eq(outreachEmails.status, 'scheduled')))
      .returning()
    if (!email) { results.push({ id, status: 'skipped' }); continue }

    try {
      const sent = await sendGmailMessage(email.brandId, { to: email.toEmail, subject: email.subject, body: email.body })
      await db.update(outreachEmails)
        .set({ status: 'sent', sentAt: new Date(), gmailMessageId: sent.id, gmailThreadId: sent.threadId, lastError: null })
        .where(eq(outreachEmails.id, id))

      if (email.followUpDays && email.followUpDays > 0) {
        await createFollowupReminder(email.brandId, {
          to: email.toEmail, subject: email.subject, threadId: sent.threadId, days: email.followUpDays,
        }).catch(e => console.error('[send-scheduled] reminder error:', e))
      }
      results.push({ id, status: 'sent' })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Send failed'
      const giveUp = email.sendAttempts >= MAX_ATTEMPTS
      // Back to 'scheduled' so the next hourly run retries it
      await db.update(outreachEmails)
        .set({ status: giveUp ? 'failed' : 'scheduled', lastError: message })
        .where(eq(outreachEmails.id, id))
      results.push({ id, status: giveUp ? 'failed' : 'retry', error: message })
    }
  }

  return NextResponse.json({
    ok: true,
    due: due.length,
    sent: results.filter(r => r.status === 'sent').length,
    staleMarkedFailed: stale.length,
    results,
  })
}
