import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { analysisRequests } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

function isAdmin(email: string | undefined): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return adminEmails.includes(email ?? '')
}

// GET /api/admin/requests — list all requests (newest first)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await db.select().from(analysisRequests).orderBy(desc(analysisRequests.requestedAt))
  return NextResponse.json({ requests: rows })
}

// PATCH /api/admin/requests — mark a request as done + notify the user
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await req.json() as { id: string }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const [request] = await db.select().from(analysisRequests).where(eq(analysisRequests.id, id))
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.update(analysisRequests)
    .set({ status: 'done', completedAt: new Date() })
    .where(eq(analysisRequests.id, id))

  // Notify the user their analysis is ready
  try {
    await resend.emails.send({
      from: 'GrowJin <onboarding@resend.dev>',
      to: request.userEmail,
      subject: `Your ${request.moduleName} analysis is ready`,
      text: [
        `Hi,`,
        ``,
        `Your ${request.moduleName} analysis for ${request.brandName} is complete.`,
        ``,
        `View your results: https://growjin.com/dashboard/${request.moduleId}`,
        ``,
        `— GrowJin`,
      ].join('\n'),
    })
  } catch (err) {
    console.error('[admin/requests] User notification email failed (non-fatal):', err)
  }

  return NextResponse.json({ ok: true })
}
