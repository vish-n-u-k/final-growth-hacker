import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, mcpOAuthCodes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { randomBytes } from 'crypto'

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const params = await searchParams
  const {
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method = 'S256',
    client_id = 'claude',
  } = params

  if (!redirect_uri) {
    return (
      <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 480, margin: '4rem auto' }}>
        <h2>Invalid request</h2>
        <p>Missing <code>redirect_uri</code> parameter.</p>
      </div>
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div style={{
        fontFamily: 'sans-serif',
        padding: '2rem',
        maxWidth: 480,
        margin: '4rem auto',
        background: '#0a1410',
        color: '#e8f3ec',
        borderRadius: 12,
        border: '1px solid #1e3a2f',
      }}>
        <h2 style={{ color: '#2fbf71', marginBottom: '0.5rem' }}>Connect GrowJin to Claude</h2>
        <p style={{ color: '#8aa897', marginBottom: '1.5rem' }}>
          You need to be logged in to GrowJin to connect your account.
        </p>
        <a
          href={`/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(params).toString()}`)}`}
          style={{
            display: 'inline-block',
            background: '#2fbf71',
            color: '#0a1410',
            padding: '0.6rem 1.4rem',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Log in to GrowJin
        </a>
      </div>
    )
  }

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.userId, user.id))
    .limit(1)

  if (!brand) redirect('/onboarding')

  // Auto-approve: create auth code and redirect back to Claude
  const code = randomBytes(20).toString('hex')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  await db.insert(mcpOAuthCodes).values({
    code,
    brandId: brand.id,
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge ?? null,
    codeChallengeMethod: code_challenge_method,
    expiresAt,
  })

  const callbackUrl = new URL(redirect_uri)
  callbackUrl.searchParams.set('code', code)
  if (state) callbackUrl.searchParams.set('state', state)

  redirect(callbackUrl.toString())
}
