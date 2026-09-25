import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brainContext } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { refineFollowupCopy, buildFollowupHTML, brandContextFor, firstName, htmlToText } from '@/lib/email/followup'

export const maxDuration = 60

// Applies one edit instruction to a batch of drafted follow-ups (the Follow-ups tab "AI edit").
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const { instruction, emails } = await req.json() as {
    instruction: string
    emails: { id: string; to: string; recipient?: string; currentBody: string }[]
  }
  if (!instruction?.trim()) return NextResponse.json({ error: 'instruction required' }, { status: 400 })
  if (!Array.isArray(emails) || emails.length === 0) return NextResponse.json({ error: 'emails required' }, { status: 400 })
  if (emails.length > 5) return NextResponse.json({ error: 'max 5 emails per request' }, { status: 400 })

  const [brain] = await db.select().from(brainContext).where(eq(brainContext.brandId, brand.id))
  const brandContext = brandContextFor(brand, brain?.summary)

  const results = await Promise.all(emails.map(async email => {
    try {
      const displayName = email.to.match(/^"?([^"<]+?)"?\s*<[^>]+>$/)?.[1] ?? email.recipient ?? ''
      const copy = await refineFollowupCopy({
        brandContext,
        brandUrl:      brand.websiteUrl ?? '',
        recipientName: firstName(displayName),
        instruction,
        currentText:   htmlToText(email.currentBody),
      })
      return { id: email.id, body: buildFollowupHTML(copy, brand) }
    } catch (e) {
      console.error('[followup/refine] error for', email.id, e instanceof Error ? e.message : e)
      return { id: email.id, error: 'Could not edit this follow-up' }
    }
  }))

  return NextResponse.json({ results })
}
