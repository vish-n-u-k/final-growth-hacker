import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { emailTokens } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.growjin.com'
  const loginUrl = new URL('/login', appUrl)
  const token = req.nextUrl.searchParams.get('t')

  if (!token) return NextResponse.redirect(loginUrl)

  const [row] = await db
    .select()
    .from(emailTokens)
    .where(eq(emailTokens.token, token))
    .limit(1)

  if (!row || row.expiresAt < new Date()) {
    loginUrl.searchParams.set('error', 'link_expired')
    return NextResponse.redirect(loginUrl)
  }

  const supabase = createAdminClient()

  const { data: userData } = await supabase.auth.admin.getUserById(row.userId)
  if (!userData.user?.email) return NextResponse.redirect(loginUrl)

  const { data: linkData, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: userData.user.email,
    options: { redirectTo: `${appUrl}/authAnalytics` },
  })

  if (error || !linkData?.properties?.action_link) {
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.redirect(linkData.properties.action_link)
}
