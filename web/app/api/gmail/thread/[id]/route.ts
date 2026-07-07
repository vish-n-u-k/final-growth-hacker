import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getValidGmailToken } from '@/lib/gmail/token'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GmailHeader  { name: string; value: string }
interface GmailPart    { mimeType: string; body?: { data?: string }; parts?: GmailPart[] }
interface GmailPayload { mimeType: string; headers?: GmailHeader[]; body?: { data?: string }; parts?: GmailPart[] }
interface GmailMessage { id: string; labelIds?: string[]; internalDate?: string; payload?: GmailPayload }
interface GmailThread  { messages?: GmailMessage[] }

function getHeader(headers: GmailHeader[] = [], name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function parseFrom(fromHeader: string): { name: string; email: string } {
  const match = fromHeader.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/)
  if (match) return { name: match[1].trim(), email: match[2].trim() }
  return { name: fromHeader.trim(), email: fromHeader.trim() }
}

function decodeBase64(data: string): string {
  // base64url → base64 → utf-8
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64').toString('utf-8')
}

function extractText(payload: GmailPayload | GmailPart): string {
  // Direct body
  if (payload.body?.data) return decodeBase64(payload.body.data)

  if (!payload.parts) return ''

  // Prefer text/plain
  for (const part of payload.parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64(part.body.data)
  }
  // Recurse into nested parts (multipart/*)
  for (const part of payload.parts) {
    if (part.mimeType.startsWith('multipart/')) {
      const nested = extractText(part)
      if (nested) return nested
    }
  }
  // Fallback: strip HTML
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

function formatMsgTime(internalDate: string): string {
  try {
    const date = new Date(Number(internalDate))
    const now  = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    const timeStr  = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    if (diffDays === 0)  return `Today, ${timeStr}`
    if (diffDays === 1)  return `Yesterday, ${timeStr}`
    if (diffDays < 7)    return `${date.toLocaleDateString('en-US', { weekday: 'long' })}, ${timeStr}`
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${timeStr}`
  } catch {
    return ''
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  let accessToken: string
  try {
    accessToken = await getValidGmailToken(brand.id)
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gmail not connected' }, { status: 400 })
  }

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) return NextResponse.json({ error: 'Failed to fetch thread' }, { status: 502 })

  const thread = await res.json() as GmailThread

  // Also get the authenticated user's email to mark self-sent messages
  const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const profile = profileRes.ok ? await profileRes.json() as { emailAddress?: string } : {}
  const myEmail = profile.emailAddress ?? ''

  const messages = (thread.messages ?? []).map(msg => {
    const headers  = msg.payload?.headers ?? []
    const fromRaw  = getHeader(headers, 'From')
    const { name, email } = parseFrom(fromRaw)
    const isSelf   = myEmail ? email.toLowerCase() === myEmail.toLowerCase() : false
    const body     = msg.payload ? extractText(msg.payload) : ''
    const time     = msg.internalDate ? formatMsgTime(msg.internalDate) : ''

    return {
      from:   isSelf ? 'You' : (name || email),
      time,
      body:   body.trim(),
      isSelf,
    }
  })

  return NextResponse.json(messages)
}
