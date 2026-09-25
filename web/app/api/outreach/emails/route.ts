import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, outreachEmails } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const emails = await db
    .select({
      id:             outreachEmails.id,
      toEmail:        outreachEmails.toEmail,
      toName:         outreachEmails.toName,
      subject:        outreachEmails.subject,
      status:         outreachEmails.status,
      source:         outreachEmails.source,
      gmailMessageId: outreachEmails.gmailMessageId,
      gmailDraftId:   outreachEmails.gmailDraftId,
      scheduledAt:    outreachEmails.scheduledAt,
      sentAt:         outreachEmails.sentAt,
      lastError:      outreachEmails.lastError,
      createdAt:      outreachEmails.createdAt,
    })
    .from(outreachEmails)
    .where(eq(outreachEmails.brandId, brand.id))
    .orderBy(desc(outreachEmails.createdAt))
    .limit(100)

  return NextResponse.json({ emails })
}
