import { db } from '@/lib/db'
import { outreachEmails, reminders } from '@/lib/db/schema'
import { getValidGmailToken, noteGmailResponse } from '@/lib/gmail/token'
import { isSuppressed } from '@/lib/gmail/suppression'
import { cleanEmailHtml, stripEmDashes } from '@/lib/email/clean'

export class GmailSendError extends Error {
  constructor(message: string, public code: 'not_connected' | 'missing_send_scope' | 'api_error' | 'suppressed') {
    super(message)
  }
}

// Non-ASCII header values (emoji, ₹, accented names) must be RFC 2047 encoded or they arrive garbled
function encodeHeader(value: string): string {
  return /[^\x20-\x7e]/.test(value) ? `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=` : value
}

function encodeAddress(to: string): string {
  const m = to.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/)
  return m ? `${encodeHeader(m[1].trim())} <${m[2]}>` : to
}

/**
 * RFC 2822 message as base64url, for Gmail messages.send / drafts.create. Every outreach email
 * passes through here, so this is where em dashes go and links get their UTM tags.
 */
export function buildRawMessage(
  { to, subject, body, inReplyTo }: { to: string; subject: string; body: string; inReplyTo?: string | null },
): string {
  subject = stripEmDashes(subject)
  body = cleanEmailHtml(body, 'outreach')
  // In-Reply-To/References + threadId make Gmail file a follow-up under the original thread
  const message = [
    `To: ${encodeAddress(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    body,
  ].join('\r\n')

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Sends an HTML email from the brand's connected Gmail account. With `log`, the sent email is
 * also saved to outreach_emails so it shows in Email Outreach's sent list (the agents use this;
 * the Email Outreach routes save their own rows).
 */
export async function sendGmailMessage(
  brandId: string,
  { to, subject, body, threadId, inReplyTo }: { to: string; subject: string; body: string; threadId?: string | null; inReplyTo?: string | null },
  log?: { source: string; toName?: string | null },
): Promise<{ id: string; threadId: string }> {
  const blocked = await isSuppressed(brandId, to)
  if (blocked) {
    throw new GmailSendError(
      blocked.reason === 'bounced'
        ? `Not sent: an earlier email to ${to} bounced.`
        : `Not sent: ${to} asked not to be contacted.`,
      'suppressed',
    )
  }

  let accessToken: string
  try {
    accessToken = await getValidGmailToken(brandId)
  } catch (e: unknown) {
    throw new GmailSendError(e instanceof Error ? e.message : 'Gmail not connected', 'not_connected')
  }

  const encoded = buildRawMessage({ to, subject, body, inReplyTo })
  // Save what was actually sent
  subject = stripEmDashes(subject)
  body = cleanEmailHtml(body, 'outreach')

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded, ...(threadId ? { threadId } : {}) }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[gmail/send] Gmail API error:', err)
    if (res.status === 401) {
      await noteGmailResponse(brandId, res)
      throw new GmailSendError('Gmail needs reconnecting. Go to Settings → Integrations → Gmail.', 'not_connected')
    }
    // 403 = missing gmail.send scope — user needs to reconnect
    if (res.status === 403) {
      throw new GmailSendError('Gmail send permission not granted. Please reconnect Gmail.', 'missing_send_scope')
    }
    throw new GmailSendError('Gmail API error — could not send email', 'api_error')
  }

  const sent = await res.json() as { id: string; threadId: string }
  if (log) {
    await db.insert(outreachEmails).values({
      brandId, toEmail: to, toName: log.toName ?? parseRecipientName(to), subject, body, status: 'sent', source: log.source,
      gmailMessageId: sent.id, gmailThreadId: sent.threadId, sentAt: new Date(),
    }).catch(e => console.error('[gmail/send] could not save the sent email:', e instanceof Error ? e.message : e))
  }
  return sent
}

export function parseRecipientName(to: string): string | null {
  return to.match(/^"?([^"<]+?)"?\s*<[^>]+>$/)?.[1]?.trim() ?? null
}

/** Creates an outreach follow-up reminder due `days` from now (clamped 1–30). */
export async function createFollowupReminder(
  brandId: string,
  { to, subject, threadId, days }: { to: string; subject: string; threadId: string; days: number },
) {
  const intervalDays = Math.min(Math.max(1, days), 30)
  await db.insert(reminders).values({
    brandId,
    title:       `Follow up: ${parseRecipientName(to) ?? to}`,
    description: `Re: ${subject}\ngmailThreadId:${threadId}`,
    category:    'outreach',
    intervalDays,
    nextDueAt:   new Date(Date.now() + intervalDays * 24 * 3600 * 1000),
    isPreset:    false,
    enabled:     true,
  })
}
