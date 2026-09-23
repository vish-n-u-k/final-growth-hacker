import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, reminders, brainContext } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getValidGmailToken } from '@/lib/gmail/token'
import { callAI } from '@/lib/ai/client'

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

  if (threadId) {
    try {
      const accessToken = await getValidGmailToken(brand.id)
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (res.ok) {
        const thread = await res.json() as GmailThread
        const messages = thread.messages ?? []

        // Extract recipient email from first sent message's To: header
        if (messages[0]?.payload?.headers) {
          recipientEmail = getHeader(messages[0].payload.headers, 'To')
        }

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

  // Brand context
  const [brain] = await db.select().from(brainContext).where(eq(brainContext.brandId, brand.id))
  const playbook = brand.playbook as Record<string, string> | null
  const brandCtx = [
    `Company: ${brand.name}`,
    brand.usp            ? `Value proposition: ${brand.usp}` : null,
    brand.targetAudience ? `Target audience: ${brand.targetAudience}` : null,
    playbook?.keyOneLiners
      ? `Key selling points: ${playbook.keyOneLiners}`
      : brain?.summary
        ? `Brand overview: ${brain.summary.slice(0, 400)}`
        : null,
  ].filter(Boolean).join('\n')

  const subjectLine = rawSubject || 'your product/service'

  const prompt = `You sent a cold outreach email to ${recipient} ${daysSince} day${daysSince !== 1 ? 's' : ''} ago about "${subjectLine}". They haven't replied.

Write a short, human follow-up email body. 2-3 sentences max. Reference the original briefly. Don't be pushy — light "circling back" tone.${threadContext ? `\n\nOriginal thread:\n${threadContext}` : ''}

Brand context:
${brandCtx}

Return ONLY the follow-up body text — no subject line, no "Hi [Name]" greeting, no signature. Just 2-3 natural sentences.`

  const raw = await callAI({
    system: 'You write short follow-up email bodies. Return only plain body text — no subject, no greeting, no signature.',
    prompt,
    maxTokens: 200,
    model: 'claude-haiku-4-5-20251001',
  })

  const bodyText = raw.trim().replace(/—/g, '').replace(/\s{2,}/g, ' ').trim()

  // Wrap in minimal HTML for sending
  const bodyHtml = bodyText
    .split(/\n{2,}/)
    .map(para => `<p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.75;color:#1a2e20;margin:0 0 14px;">${para.replace(/\n/g, '<br/>')}</p>`)
    .join('\n')

  return NextResponse.json({
    to: recipientEmail,
    subject: rawSubject ? `Re: ${rawSubject}` : '',
    body: bodyHtml,
    bodyText,
  })
}
