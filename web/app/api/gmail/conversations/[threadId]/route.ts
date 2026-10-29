import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getValidGmailToken, noteGmailResponse } from '@/lib/gmail/token'
import { isOwnThread } from '@/lib/gmail/conversations'
import { extractText, stripQuoted, type GmailPart } from '@/lib/gmail/message-text'

// Messages of one thread GrowJin sent. Any other thread id is refused, so this can't be used
// to read the rest of the mailbox. Bodies are passed through and not stored.

interface GmailMessage { id: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart }

function senderName(from: string): string {
  const m = from.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/)
  return m ? m[1].trim() : from.trim()
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
  const { threadId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  if (!/^[0-9a-f]+$/i.test(threadId) || !(await isOwnThread(brand.id, threadId))) {
    return NextResponse.json({ error: 'Not a thread sent from GrowJin' }, { status: 404 })
  }

  let accessToken: string
  try {
    accessToken = await getValidGmailToken(brand.id)
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gmail not connected' }, { status: 400 })
  }

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 404) return NextResponse.json({ error: 'This thread is no longer in Gmail' }, { status: 404 })
  if (res.status === 401) {
    await noteGmailResponse(brand.id, res)
    return NextResponse.json({ error: 'Gmail needs reconnecting. Go to Settings → Integrations → Gmail.' }, { status: 400 })
  }
  if (!res.ok) return NextResponse.json({ error: 'Could not load the thread from Gmail' }, { status: 502 })

  const thread = await res.json() as { messages?: GmailMessage[] }
  const messages = (thread.messages ?? [])
    .filter(m => !m.labelIds?.includes('DRAFT'))
    .map((m, i) => {
      const from = m.payload?.headers?.find(h => h.name.toLowerCase() === 'from')?.value ?? ''
      const text = m.payload ? extractText(m.payload) : ''
      const isSelf = !!m.labelIds?.includes('SENT')
      return {
        id:     m.id,
        from:   isSelf ? 'You' : senderName(from),
        at:     m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
        // The first email is shown whole; replies without the quoted email below them
        body:   (i === 0 ? text : stripQuoted(text) || text).trim(),
        isSelf,
      }
    })

  return NextResponse.json({ messages })
}
