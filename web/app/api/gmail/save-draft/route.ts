import { NextRequest, NextResponse } from 'next/server'
import { requirePro } from '@/lib/billing/guard'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, outreachEmails } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getValidGmailToken } from '@/lib/gmail/token'
import { buildRawMessage } from '@/lib/gmail/send'
import { isSuppressed } from '@/lib/gmail/suppression'

export async function POST(req: NextRequest) {
  const proBlock = await requirePro()
  if (proBlock) return proBlock
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

  const blocked = await isSuppressed(brand.id, to)
  if (blocked) {
    return NextResponse.json({
      error: blocked.reason === 'bounced' ? `An earlier email to ${to} bounced.` : `${to} asked not to be contacted.`,
    }, { status: 409 })
  }

  let accessToken: string
  try {
    accessToken = await getValidGmailToken(brand.id)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Gmail not connected' },
      { status: 400 },
    )
  }

  const encoded = buildRawMessage({ to, subject, body })

  const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw: encoded } }),
  })

  if (!draftRes.ok) {
    const err = await draftRes.text()
    console.error('[save-draft] Gmail API error:', err)
    return NextResponse.json({ error: 'Gmail API error — could not create draft' }, { status: 502 })
  }

  const draft = await draftRes.json() as { id: string }

  // Log to outreach_emails (awaited so serverless doesn't cut it off)
  await db.insert(outreachEmails).values({
    brandId: brand.id, toEmail: to, subject, body,
    status: 'draft', gmailDraftId: draft.id, source: 'outreach',
  }).catch(e => console.error('[save-draft] DB log error:', e))

  return NextResponse.json({ draftId: draft.id })
}
