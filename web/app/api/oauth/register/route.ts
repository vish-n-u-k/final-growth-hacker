import { randomBytes } from 'crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

// Dynamic client registration — Claude.ai registers itself here.
// We don't persist clients; PKCE is the real security mechanism.
export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // empty body is fine
  }

  const clientId = `claude_${randomBytes(12).toString('hex')}`

  return Response.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body.redirect_uris ?? [],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_name: body.client_name ?? 'Claude',
    },
    { status: 201, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
}
