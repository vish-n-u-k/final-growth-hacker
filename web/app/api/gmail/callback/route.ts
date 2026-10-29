import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { storeAdminGmailTokens } from '@/lib/gmail/admin-token'
import { invalidateToday } from '@/lib/daily/invalidate'

export async function GET(req: NextRequest) {
  const origin      = req.nextUrl.origin
  const code        = req.nextUrl.searchParams.get('code')
  const state       = req.nextUrl.searchParams.get('state')
  const errorParam  = req.nextUrl.searchParams.get('error')

  // "<brandId>:settings" came from Settings → Integrations, so go back there
  const [stateId, from] = (state ?? '').split(':')
  const back = (q: string) => from === 'settings' ? `${origin}/settings?connect=gmail&gmail=${q}` : `${origin}/gmail-hub?${q === 'connected' ? 'connected=1' : `error=${q}`}`

  // User cancelled or Google returned an error
  if (errorParam || !code || !state) {
    const errDest = state === 'admin' ? `${origin}/admin?gmail=cancelled` : back('cancelled')
    return NextResponse.redirect(errDest)
  }

  // ── Exchange code for tokens ─────────────────────────────────────────────

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
    console.error('Gmail token exchange failed:', await tokenRes.text())
    return NextResponse.redirect(back('token_failed'))
  }

  const tokens = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
  }

  // ── Get the Gmail address from Google ────────────────────────────────────

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  const profile = profileRes.ok ? await profileRes.json() : {}
  const gmailAddress: string = profile.email ?? 'unknown'

  // ── Admin flow — store in admin_settings ─────────────────────────────────

  if (state === 'admin') {
    await storeAdminGmailTokens({
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in:    tokens.expires_in,
      email:         gmailAddress,
    })
    return NextResponse.redirect(`${origin}/admin?gmail=connected`)
  }

  // ── User flow — upsert into brandIntegrations ─────────────────────────────

  const brandId = stateId
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

  await db
    .insert(brandIntegrations)
    .values({
      brandId,
      provider:       'gmail',
      type:           'oauth',
      status:         'connected',
      accessToken:    tokens.access_token,
      refreshToken:   tokens.refresh_token ?? null,
      tokenExpiresAt: expiresAt,
      scopes:         tokens.scope.split(' '),
      metadata:       { gmail_address: gmailAddress },
    })
    .onConflictDoUpdate({
      target: [brandIntegrations.brandId, brandIntegrations.provider],
      set: {
        accessToken:    tokens.access_token,
        // Google only sends a refresh token on the first consent; keep the old one otherwise
        refreshToken:   tokens.refresh_token ?? sql`${brandIntegrations.refreshToken}`,
        tokenExpiresAt: expiresAt,
        scopes:         tokens.scope.split(' '),
        metadata:       { gmail_address: gmailAddress },   // also clears expired_reason
        status:         'connected',
        lastUsedAt:     new Date(),
      },
    })
  await invalidateToday(brandId)

  return NextResponse.redirect(back('connected'))
}
