export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export function GET() {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.growjin.com').replace(/\/$/, '')

  return Response.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read', 'write'],
    },
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
}
