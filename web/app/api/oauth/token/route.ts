import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { brandIntegrations, mcpOAuthCodes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function tokenError(error: string, description: string, status = 400) {
  return Response.json(
    { error, error_description: description },
    { status, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(request: Request) {
  // Accept both form-encoded and JSON
  const contentType = request.headers.get('content-type') ?? ''
  let params: Record<string, string> = {}

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text()
    params = Object.fromEntries(new URLSearchParams(text))
  } else {
    try {
      params = await request.json()
    } catch {
      return tokenError('invalid_request', 'Could not parse request body')
    }
  }

  const { grant_type, code, redirect_uri, code_verifier } = params

  if (grant_type !== 'authorization_code') {
    return tokenError('unsupported_grant_type', 'Only authorization_code is supported')
  }
  if (!code) return tokenError('invalid_request', 'Missing code')

  // Look up auth code
  const [row] = await db
    .select()
    .from(mcpOAuthCodes)
    .where(eq(mcpOAuthCodes.code, code))
    .limit(1)

  if (!row) return tokenError('invalid_grant', 'Code not found')
  if (row.usedAt) return tokenError('invalid_grant', 'Code already used')
  if (new Date() > row.expiresAt) return tokenError('invalid_grant', 'Code expired')
  if (redirect_uri && row.redirectUri !== redirect_uri) {
    return tokenError('invalid_grant', 'redirect_uri mismatch')
  }

  // Validate PKCE
  if (row.codeChallenge) {
    if (!code_verifier) return tokenError('invalid_grant', 'Missing code_verifier')
    const computed = createHash('sha256').update(code_verifier).digest('base64url')
    if (computed !== row.codeChallenge) {
      return tokenError('invalid_grant', 'PKCE verification failed')
    }
  }

  // Mark code as used
  await db
    .update(mcpOAuthCodes)
    .set({ usedAt: new Date() })
    .where(eq(mcpOAuthCodes.code, code))

  // Generate access token (1 year expiry — user can revoke from settings)
  const accessToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

  // Store in brandIntegrations (same row as API key, just updates accessToken)
  await db
    .insert(brandIntegrations)
    .values({
      brandId: row.brandId,
      provider: 'mcp',
      type: 'oauth',
      status: 'connected',
      accessToken,
      tokenExpiresAt: expiresAt,
    })
    .onConflictDoUpdate({
      target: [brandIntegrations.brandId, brandIntegrations.provider],
      set: { accessToken, tokenExpiresAt: expiresAt, lastUsedAt: new Date() },
    })

  return Response.json(
    {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 365 * 24 * 60 * 60,
    },
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
}
