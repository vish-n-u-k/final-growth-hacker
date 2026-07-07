import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getValidGmailToken } from '@/lib/gmail/token'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GmailHeader { name: string; value: string }
interface GmailMessage { id: string; labelIds?: string[]; payload?: { headers?: GmailHeader[] } }
interface GmailThread  { id: string; snippet?: string; messages?: GmailMessage[] }

function getHeader(headers: GmailHeader[] = [], name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function parseFrom(fromHeader: string): { name: string; email: string } {
  const match = fromHeader.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/)
  if (match) return { name: match[1].trim(), email: match[2].trim() }
  return { name: fromHeader.trim(), email: fromHeader.trim() }
}

function getInitials(name: string): string {
  return name.split(/\s+/).map(n => n[0] ?? '').join('').slice(0, 2).toUpperCase()
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now  = new Date()
    const diffMs   = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7)   return date.toLocaleDateString('en-US', { weekday: 'short' })
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
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

  // 1. List inbox threads (latest 20)
  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=20&labelIds=INBOX',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!listRes.ok) return NextResponse.json({ error: 'Failed to list threads' }, { status: 502 })

  const list = await listRes.json() as { threads?: { id: string; snippet?: string }[] }
  const threadItems = list.threads ?? []
  if (threadItems.length === 0) return NextResponse.json([])

  // Snippet map from list (threads.list includes snippet)
  const snippetMap: Record<string, string> = {}
  for (const t of threadItems) snippetMap[t.id] = t.snippet ?? ''

  // 2. Fetch metadata for each thread in parallel
  const metaResults = await Promise.all(
    threadItems.map(({ id }) =>
      fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ).then(r => r.ok ? r.json() as Promise<GmailThread> : null),
    ),
  )

  // 3. Shape into Thread-like objects
  const threads = metaResults
    .filter((t): t is GmailThread => t !== null && !!t.messages?.length)
    .map(t => {
      // Use the latest message for headers, but check all messages for UNREAD label
      const latest   = t.messages![t.messages!.length - 1]
      const headers  = latest.payload?.headers ?? []
      const fromRaw  = getHeader(headers, 'From')
      const subject  = getHeader(headers, 'Subject') || '(no subject)'
      const dateRaw  = getHeader(headers, 'Date')
      const isRead   = !t.messages!.some(m => m.labelIds?.includes('UNREAD'))
      const { name, email } = parseFrom(fromRaw)

      return {
        id:        t.id!,
        from:      name  || email,
        email,
        initials:  getInitials(name || email),
        subject,
        preview:   snippetMap[t.id!] ?? '',
        time:      formatDate(dateRaw),
        isRead,
        tag:       null,
        messages:  [],    // lazy-loaded when thread is opened
        aiSummary: '',
        aiDraft:   '',
      }
    })

  return NextResponse.json(threads)
}
