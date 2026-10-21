import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import { getEarlyAccessEmails, setEarlyAccessEmails } from '@/lib/early-access'

async function adminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user && isAdminEmail(user.email) ? user : null
}

export async function GET() {
  if (!await adminUser()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ emails: await getEarlyAccessEmails() })
}

// Body: { emails: string[] } — replaces the whole list.
export async function PUT(req: Request) {
  if (!await adminUser()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null) as { emails?: unknown } | null
  if (!body || !Array.isArray(body.emails) || !body.emails.every(e => typeof e === 'string')) {
    return NextResponse.json({ error: 'emails must be a list of strings' }, { status: 400 })
  }
  return NextResponse.json({ emails: await setEarlyAccessEmails(body.emails as string[]) })
}
