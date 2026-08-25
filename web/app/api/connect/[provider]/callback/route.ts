// GET /api/connect/[provider]/callback
// Handles the OAuth callback: exchanges code → token → stores in brand_integrations → redirects to settings.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function callbackUrl(provider: string) {
  return `${APP_URL}/api/connect/${provider}/callback`
}

function parseState(state: string): { brandId: string; returnTo?: string | null } | null {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString())
  } catch { return null }
}

async function upsertIntegration(
  brandId: string,
  provider: string,
  data: {
    accessToken?: string
    refreshToken?: string
    tokenExpiresAt?: Date
    scopes?: string[]
    metadata?: Record<string, string>
  },
) {
  const existing = await db.select({ id: brandIntegrations.id })
    .from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, provider)))
    .limit(1)

  if (existing.length > 0) {
    await db.update(brandIntegrations)
      .set({ ...data, status: 'connected', lastUsedAt: new Date() })
      .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, provider)))
  } else {
    await db.insert(brandIntegrations).values({
      brandId,
      provider,
      type: 'oauth',
      status: 'connected',
      ...data,
      connectedAt: new Date(),
    })
  }
}

// ── Meta ──────────────────────────────────────────────────────────────────────

async function handleMeta(code: string, brandId: string): Promise<string> {
  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!
  const cb = callbackUrl('meta_oauth')

  // 1. Exchange code for short-lived token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(cb)}&client_secret=${appSecret}&code=${code}`,
  )
  if (!tokenRes.ok) throw new Error('Meta token exchange failed')
  const { access_token: shortToken } = await tokenRes.json() as { access_token: string }

  // 2. Exchange for long-lived token (~60 days)
  const llRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`,
  )
  const llData = await llRes.json() as { access_token: string; expires_in?: number }
  const longToken = llData.access_token
  const expiresAt = new Date(Date.now() + (llData.expires_in ?? 5184000) * 1000)

  // 3. Get user's pages + Instagram business accounts
  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,followers_count,media_count}&access_token=${longToken}`,
  )
  const pagesData = await pagesRes.json() as {
    data?: Array<{
      id: string
      name: string
      access_token: string
      instagram_business_account?: { id: string; username?: string; followers_count?: number; media_count?: number }
    }>
  }

  const firstPage = pagesData.data?.[0]
  const ig = firstPage?.instagram_business_account

  const metadata: Record<string, string> = {}
  if (firstPage) {
    metadata.page_id = firstPage.id
    metadata.page_name = firstPage.name
    metadata.page_access_token = firstPage.access_token
  }
  if (ig) {
    metadata.instagram_id = ig.id
    if (ig.username) metadata.instagram_username = ig.username
    if (ig.followers_count != null) metadata.instagram_followers = String(ig.followers_count)
    if (ig.media_count != null) metadata.instagram_posts = String(ig.media_count)
  }

  await upsertIntegration(brandId, 'meta_oauth', {
    accessToken: longToken,
    tokenExpiresAt: expiresAt,
    scopes: ['instagram_basic', 'pages_show_list', 'pages_read_engagement', 'instagram_manage_insights'],
    metadata,
  })

  return ig?.username ? `@${ig.username}` : (firstPage?.name ?? 'Meta account')
}

// ── Instagram (standalone — Instagram app, no Facebook Page required) ─────────

async function handleInstagram(code: string, brandId: string): Promise<string> {
  const igAppId = process.env.INSTAGRAM_CLIENT_ID!
  const igAppSecret = process.env.INSTAGRAM_CLIENT_SECRET!
  const cb = callbackUrl('instagram_oauth')

  // 1. Exchange code for short-lived token via Instagram's token endpoint
  const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: igAppId,
      client_secret: igAppSecret,
      grant_type: 'authorization_code',
      redirect_uri: cb,
      code,
    }),
  })
  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    throw new Error(`Instagram token exchange failed: ${err}`)
  }
  const { access_token: shortToken } = await tokenRes.json() as { access_token: string }

  // 2. Exchange for long-lived token (~60 days)
  const llRes = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_id=${igAppId}&client_secret=${igAppSecret}&access_token=${shortToken}`,
  )
  if (!llRes.ok) throw new Error('Instagram long-lived token exchange failed')
  const llData = await llRes.json() as { access_token: string; expires_in?: number }
  const longToken = llData.access_token
  const expiresAt = new Date(Date.now() + (llData.expires_in ?? 5184000) * 1000)

  // 3. Get profile info
  const profileRes = await fetch(
    `https://graph.instagram.com/me?fields=id,username,followers_count,media_count,biography,website&access_token=${longToken}`,
  )
  const profile = await profileRes.json() as {
    id: string
    username?: string
    followers_count?: number
    media_count?: number
    biography?: string
    website?: string
  }

  const metadata: Record<string, string> = { instagram_id: profile.id }
  if (profile.username)              metadata.instagram_username  = profile.username
  if (profile.followers_count != null) metadata.instagram_followers = String(profile.followers_count)
  if (profile.media_count != null)   metadata.instagram_posts     = String(profile.media_count)
  if (profile.biography)             metadata.instagram_bio       = profile.biography
  if (profile.website)               metadata.instagram_website   = profile.website

  await upsertIntegration(brandId, 'instagram_oauth', {
    accessToken: longToken,
    tokenExpiresAt: expiresAt,
    scopes: ['instagram_business_basic', 'instagram_business_manage_insights'],
    metadata,
  })

  return profile.username ? `@${profile.username}` : 'Instagram account'
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────

async function handleLinkedIn(code: string, brandId: string): Promise<string> {
  const clientId = process.env.LINKEDIN_CLIENT_ID!
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!
  const cb = callbackUrl('linkedin_oauth')

  // 1. Exchange code for token
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cb,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (!tokenRes.ok) throw new Error('LinkedIn token exchange failed')
  const tokenData = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    refresh_token_expires_in?: number
  }

  const accessToken = tokenData.access_token
  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 5184000) * 1000)

  // 2. Get profile
  const profileRes = await fetch('https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const profile = await profileRes.json() as { id: string; localizedFirstName?: string; localizedLastName?: string }
  const profileName = [profile.localizedFirstName, profile.localizedLastName].filter(Boolean).join(' ')

  // 3. Get organization ACLs (pages user admins)
  const aclRes = await fetch('https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&count=10', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const aclData = await aclRes.json() as { elements?: Array<{ organization: string }> }

  const metadata: Record<string, string> = {}
  if (profileName) metadata.profile_name = profileName

  // Get first org details
  const firstOrgUrn = aclData.elements?.[0]?.organization
  if (firstOrgUrn) {
    const orgId = firstOrgUrn.split(':').pop() ?? ''
    metadata.org_id = orgId

    const orgRes = await fetch(`https://api.linkedin.com/v2/organizations/${orgId}?projection=(id,localizedName,followersCount)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => null)

    if (orgRes?.ok) {
      const org = await orgRes.json() as { localizedName?: string; followersCount?: number }
      if (org.localizedName) metadata.org_name = org.localizedName
      if (org.followersCount != null) metadata.org_followers = String(org.followersCount)
    }
  }

  await upsertIntegration(brandId, 'linkedin_oauth', {
    accessToken,
    refreshToken: tokenData.refresh_token,
    tokenExpiresAt: expiresAt,
    scopes: ['r_liteprofile', 'r_emailaddress', 'r_organization_social'],
    metadata,
  })

  return metadata.org_name ?? profileName ?? 'LinkedIn account'
}

// ── Pinterest ─────────────────────────────────────────────────────────────────

async function handlePinterest(code: string, brandId: string): Promise<string> {
  const appId = process.env.PINTEREST_APP_ID!
  const appSecret = process.env.PINTEREST_APP_SECRET!
  const cb = callbackUrl('pinterest_oauth')

  // 1. Exchange code for token
  const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString('base64')
  const tokenRes = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cb,
    }),
  })
  if (!tokenRes.ok) throw new Error('Pinterest token exchange failed')
  const tokenData = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  const accessToken = tokenData.access_token
  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 2592000) * 1000)

  // 2. Get profile
  const profileRes = await fetch('https://api.pinterest.com/v5/user_account', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const profile = await profileRes.json() as {
    username?: string
    profile_image?: string
    follower_count?: number
    following_count?: number
    pin_count?: number
    board_count?: number
  }

  const metadata: Record<string, string> = {}
  if (profile.username) metadata.username = profile.username
  if (profile.follower_count != null) metadata.followers = String(profile.follower_count)
  if (profile.pin_count != null) metadata.pins = String(profile.pin_count)
  if (profile.board_count != null) metadata.boards = String(profile.board_count)
  if (profile.profile_image) metadata.avatar = profile.profile_image

  await upsertIntegration(brandId, 'pinterest_oauth', {
    accessToken,
    refreshToken: tokenData.refresh_token,
    tokenExpiresAt: expiresAt,
    scopes: ['boards:read', 'pins:read', 'user_accounts:read'],
    metadata,
  })

  return profile.username ? `@${profile.username}` : 'Pinterest account'
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  const settingsUrl = `${APP_URL}/settings?tab=integrations`

  if (errorParam) {
    return NextResponse.redirect(`${settingsUrl}&oauth_error=${encodeURIComponent(errorParam)}`)
  }
  if (!code || !state) {
    return NextResponse.redirect(`${settingsUrl}&oauth_error=missing_code`)
  }

  const parsed = parseState(state)
  if (!parsed) {
    return NextResponse.redirect(`${settingsUrl}&oauth_error=invalid_state`)
  }

  // Where to send the user after OAuth completes (defaults to settings)
  const returnBase = parsed.returnTo
    ? `${APP_URL}${parsed.returnTo}`
    : settingsUrl
  const sep = returnBase.includes('?') ? '&' : '?'

  // Verify brand belongs to the currently logged-in user
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${APP_URL}/login`)

  const [brand] = await db.select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.id, parsed.brandId), eq(brands.userId, user.id)))
    .limit(1)

  if (!brand) {
    return NextResponse.redirect(`${settingsUrl}&oauth_error=brand_mismatch`)
  }

  try {
    let label: string
    switch (provider) {
      case 'meta_oauth':       label = await handleMeta(code, brand.id); break
      case 'instagram_oauth':  label = await handleInstagram(code, brand.id); break
      case 'linkedin_oauth':   label = await handleLinkedIn(code, brand.id); break
      case 'pinterest_oauth':  label = await handlePinterest(code, brand.id); break
      default:
        return NextResponse.redirect(`${settingsUrl}&oauth_error=unknown_provider`)
    }

    return NextResponse.redirect(`${returnBase}${sep}oauth_connected=${encodeURIComponent(provider)}&label=${encodeURIComponent(label)}`)
  } catch (e) {
    console.error(`[oauth-callback][${provider}]`, e)
    return NextResponse.redirect(`${returnBase}${sep}oauth_error=${encodeURIComponent(String(e))}`)
  }
}
