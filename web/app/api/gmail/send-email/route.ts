import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getValidGmailToken } from '@/lib/gmail/token'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { to, subject, body } =
    await req.json() as { to: string; subject: string; body: string }

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.userId, user.id))
    .limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  let accessToken: string
  try {
    accessToken = await getValidGmailToken(brand.id)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Gmail not connected' },
      { status: 400 },
    )
  }

  // Build RFC 2822 message and encode as base64url
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    body,
  ].join('\r\n')

  const encoded = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  })

  if (!sendRes.ok) {
    const err = await sendRes.text()
    console.error('[send-email] Gmail API error:', err)

    // 403 = missing gmail.send scope — user needs to reconnect
    if (sendRes.status === 403) {
      return NextResponse.json(
        { error: 'missing_send_scope', message: 'Gmail send permission not granted. Please reconnect Gmail.' },
        { status: 403 },
      )
    }

    return NextResponse.json({ error: 'Gmail API error — could not send email' }, { status: 502 })
  }

  const sent = await sendRes.json() as { id: string }
  return NextResponse.json({ messageId: sent.id })
}
