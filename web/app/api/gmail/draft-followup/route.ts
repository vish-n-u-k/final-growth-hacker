import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, reminders, brainContext } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getValidGmailToken } from '@/lib/gmail/token'
import { writeFollowupCopy, buildFollowupHTML, brandContextFor, firstName } from '@/lib/email/followup'

// ── Minimal Gmail types (mirrored from thread/[id]/route.ts) ──────────────────

interface GmailHeader  { name: string; value: string }
interface GmailPart    { mimeType: string; body?: { data?: string }; parts?: GmailPart[] }
interface GmailPayload { mimeType: string; headers?: GmailHeader[]; body?: { data?: string }; parts?: GmailPart[] }
interface GmailMessage { id: string; payload?: GmailPayload }
interface GmailThread  { messages?: GmailMessage[] }

function decodeBase64(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

function extractText(payload: GmailPayload | GmailPart): string {
  if (payload.body?.data) return decodeBase64(payload.body.data)
  if (!payload.parts) return ''
  for (const part of payload.parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64(part.body.data)
  }
  for (const part of payload.parts) {
    if (part.mimeType.startsWith('multipart/')) {
      const nested = extractText(part)
      if (nested) return nested
    }
  }
  for (const part of payload.parts) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      return decodeBase64(part.body.data)
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    }
  }
  return ''
}

function getHeader(headers: GmailHeader[], name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { reminderId } = await req.json() as { reminderId: string }
  if (!reminderId) return NextResponse.json({ error: 'reminderId required' }, { status: 400 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const [reminder] = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.brandId, brand.id)))
    .limit(1)
  if (!reminder) return NextResponse.json({ error: 'Reminder not found' }, { status: 404 })

  // Parse reminder fields
  const recipient = reminder.title.replace(/^Follow up:\s*/i, '').trim()
  const desc = reminder.description ?? ''
  const rawSubject = desc.split('\n')[0].replace(/^Re:\s*/i, '').trim()
  const threadId = desc.match(/gmailThreadId:(\S+)/)?.[1] ?? null

  // Days since the reminder was created (≈ days since email was sent)
  const daysSince = reminder.createdAt
    ? Math.max(1, Math.round((Date.now() - new Date(reminder.createdAt).getTime()) / 86400000))
    : reminder.intervalDays

  // Fetch thread if possible
  let recipientEmail = ''
  let threadContext = ''
  let inReplyTo = ''
  let threadFound = false

  if (threadId) {
    try {
      const accessToken = await getValidGmailToken(brand.id)
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (res.ok) {
        const thread = await res.json() as GmailThread
        threadFound = true
        const messages = thread.messages ?? []

        // Extract recipient email from first sent message's To: header
        if (messages[0]?.payload?.headers) {
          recipientEmail = getHeader(messages[0].payload.headers, 'To')
        }

        // Reply to the latest message so Gmail keeps the follow-up in the same thread
        const last = messages[messages.length - 1]
        if (last?.payload?.headers) inReplyTo = getHeader(last.payload.headers, 'Message-ID')

        // Build thread context (first 3 messages, 800 chars each)
        const parts = messages.slice(0, 3).map(msg => {
          const from = msg.payload?.headers ? getHeader(msg.payload.headers, 'From') : ''
          const text = msg.payload ? extractText(msg.payload).slice(0, 800) : ''
          return from ? `From: ${from}\n${text}` : text
        }).filter(Boolean)
        threadContext = parts.join('\n\n---\n\n')
      }
    } catch {
      // Continue without thread context — not fatal
    }
  }

  const [brain] = await db.select().from(brainContext).where(eq(brainContext.brandId, brand.id))
  const displayName = recipientEmail.match(/^"?([^"<]+?)"?\s*<[^>]+>$/)?.[1] ?? recipient

  let copy
  try {
    copy = await writeFollowupCopy({
      brandContext:  brandContextFor(brand, brain?.summary),
      brandUrl:      brand.websiteUrl ?? '',
      recipientName: firstName(displayName),
      subject:       rawSubject,
      daysSince,
      threadContext,
    })
  } catch (e) {
    console.error('[draft-followup] AI error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Could not write a follow-up, try again' }, { status: 502 })
  }

  const bodyHtml = buildFollowupHTML(copy, brand)

  return NextResponse.json({
    to: recipientEmail,
    subject: rawSubject ? `Re: ${rawSubject}` : '',
    body: bodyHtml,
    threadId: threadFound ? threadId : null,
    inReplyTo: threadFound && inReplyTo ? inReplyTo : null,
  })
}
