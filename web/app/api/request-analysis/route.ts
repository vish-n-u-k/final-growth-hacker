import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, analysisRequests } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { Resend } from 'resend'
import { appUrl } from '@/lib/app-url'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { moduleId, moduleName } = await req.json() as { moduleId: string; moduleName: string }
  if (!moduleId || !moduleName) {
    return NextResponse.json({ error: 'Missing moduleId or moduleName' }, { status: 400 })
  }

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id))
  const brandName = brand?.name ?? '(unknown brand)'
  const websiteUrl = brand?.websiteUrl ?? '(unknown website)'

  // Insert into admin queue
  await db.insert(analysisRequests).values({
    moduleId,
    userId: user.id,
    userEmail: user.email ?? '',
    brandName,
    websiteUrl,
    moduleName,
    status: 'pending',
  })

  const moduleUrl = appUrl(`/dashboard/${moduleId}`)

  // Fire email notification (non-fatal)
  try {
    await resend.emails.send({
      // Set RESEND_FROM (e.g. 'GrowJin <noreply@growjin.com>') once growjin.com is verified in Resend.
      from: process.env.RESEND_FROM || 'GrowJin <onboarding@resend.dev>',
      to: 'vishnu@kuchnaya.com',
      subject: `Analysis Requested — ${brandName} / ${moduleName}`,
      text: [
        `User: ${user.email}`,
        `Brand: ${brandName}`,
        `Website: ${websiteUrl}`,
        `Module: ${moduleName} (moduleId: ${moduleId})`,
        `Module URL: ${moduleUrl}`,
        ``,
        `Admin queue: ${appUrl('/admin')}`,
      ].join('\n'),
    })
  } catch (err) {
    console.error('[request-analysis] Email failed (non-fatal):', err)
  }

  return NextResponse.json({ ok: true })
}
