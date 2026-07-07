import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function getValidGmailToken(brandId: string): Promise<string> {
  const [integration] = await db
    .select({
      accessToken:    brandIntegrations.accessToken,
      refreshToken:   brandIntegrations.refreshToken,
      tokenExpiresAt: brandIntegrations.tokenExpiresAt,
    })
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'gmail'),
    ))
    .limit(1)

  if (!integration?.accessToken) throw new Error('Gmail not connected')

  // Token still valid (5-min buffer)
  const expiresAt = integration.tokenExpiresAt ? new Date(integration.tokenExpiresAt) : null
  if (!expiresAt || expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return integration.accessToken
  }

  // Expired — refresh
  if (!integration.refreshToken) {
    throw new Error('No refresh token — please reconnect Gmail')
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: integration.refreshToken,
      grant_type:    'refresh_token',
    }),
  })

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)

  const data = await res.json() as { access_token: string; expires_in: number }
  const newExpiry = new Date(Date.now() + data.expires_in * 1000)

  await db
    .update(brandIntegrations)
    .set({ accessToken: data.access_token, tokenExpiresAt: newExpiry, lastUsedAt: new Date() })
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'gmail'),
    ))

  return data.access_token
}
