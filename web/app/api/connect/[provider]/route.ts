// GET /api/connect/[provider]
// Initiates the OAuth flow — redirects user to the platform's auth page.
// Supported providers: meta_oauth | linkedin_oauth | pinterest_oauth

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function callbackUrl(provider: string) {
  return `${APP_URL}/api/connect/${provider}/callback`
}

function buildState(brandId: string) {
  return Buffer.from(JSON.stringify({ brandId, ts: Date.now() })).toString('base64url')
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${APP_URL}/login`)

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.redirect(`${APP_URL}/onboarding`)

  const state = buildState(brand.id)
  const cb = encodeURIComponent(callbackUrl(provider))

  let authUrl: string

  switch (provider) {
    case 'meta_oauth': {
      const appId = process.env.META_APP_ID
      if (!appId) return NextResponse.json({ error: 'META_APP_ID not configured' }, { status: 500 })
      const scopes = [
        'instagram_basic',
        'pages_show_list',
        'pages_read_engagement',
        'instagram_manage_insights',
        'business_management',
      ].join(',')
      authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${cb}&scope=${scopes}&state=${state}&response_type=code`
      break
    }

    case 'linkedin_oauth': {
      const clientId = process.env.LINKEDIN_CLIENT_ID
      if (!clientId) return NextResponse.json({ error: 'LINKEDIN_CLIENT_ID not configured' }, { status: 500 })
      const scopes = encodeURIComponent('r_liteprofile r_emailaddress r_organization_social rw_organization_admin')
      authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${cb}&state=${state}&scope=${scopes}`
      break
    }

    case 'pinterest_oauth': {
      const appId = process.env.PINTEREST_APP_ID
      if (!appId) return NextResponse.json({ error: 'PINTEREST_APP_ID not configured' }, { status: 500 })
      const scopes = 'boards:read,pins:read,user_accounts:read'
      authUrl = `https://www.pinterest.com/oauth/?client_id=${appId}&redirect_uri=${cb}&response_type=code&scope=${scopes}&state=${state}`
      break
    }

    default:
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
  }

  return NextResponse.redirect(authUrl)
}
