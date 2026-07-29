import { NextRequest, NextResponse } from 'next/server'
import { storeAdminGmailTokens } from '@/lib/gmail/admin-token'

export async function GET(req: NextRequest) {
  const origin     = req.nextUrl.origin
  const code       = req.nextUrl.searchParams.get('code')
  const errorParam = req.nextUrl.searchParams.get('error')

  if (errorParam || !code) {
    return NextResponse.redirect(`${origin}/admin?gmail=cancelled`)
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  process.env.GOOGLE_REDIRECT_URI!,
      grant_type:    'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    console.error('[admin/gmail/callback] Token exchange failed:', await tokenRes.text())
    return NextResponse.redirect(`${origin}/admin?gmail=error`)
  }

  const tokens = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const profile = profileRes.ok ? await profileRes.json() as { email?: string } : {}

  await storeAdminGmailTokens({
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in:    tokens.expires_in,
    email:         profile.email ?? 'unknown',
  })

  return NextResponse.redirect(`${origin}/admin?gmail=connected`)
}
