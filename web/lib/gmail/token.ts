import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'

// Thrown when Google no longer accepts the saved connection: only reconnecting fixes it.
export class GmailAuthError extends Error {}

const RECONNECT = 'Gmail needs reconnecting. Go to Settings → Integrations → Gmail.'
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

const gmailRow = (brandId: string) => and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'gmail'))

// Google stopped accepting the token (revoked, password changed, refresh token expired…).
// Mark the row so every page shows "Reconnect" instead of "Connected".
export async function markGmailExpired(brandId: string, reason: string): Promise<void> {
  console.warn(`[gmail] connection for ${brandId} stopped working: ${reason}`)
  await db.update(brandIntegrations)
    .set({
      status: 'expired',
      metadata: sql`coalesce(${brandIntegrations.metadata}, '{}'::jsonb) || ${JSON.stringify({ expired_reason: reason.slice(0, 300), expired_at: new Date().toISOString() })}::jsonb`,
    })
    .where(gmailRow(brandId))
    .catch(e => console.error('[gmail] could not mark expired:', e instanceof Error ? e.message : e))
}

/** Call after any Gmail API request: a 401 means the saved access is dead. */
export async function noteGmailResponse(brandId: string, res: Response): Promise<void> {
  if (res.status === 401) await markGmailExpired(brandId, 'Gmail API answered 401')
}

export async function getValidGmailToken(brandId: string): Promise<string> {
  const [integration] = await db
    .select({
      status:         brandIntegrations.status,
      accessToken:    brandIntegrations.accessToken,
      refreshToken:   brandIntegrations.refreshToken,
      tokenExpiresAt: brandIntegrations.tokenExpiresAt,
    })
    .from(brandIntegrations)
    .where(gmailRow(brandId))
    .limit(1)

  if (!integration?.accessToken) throw new Error('Gmail not connected')
  if (integration.status !== 'connected') throw new GmailAuthError(RECONNECT)

  // Token still valid (5-min buffer)
  const expiresAt = integration.tokenExpiresAt ? new Date(integration.tokenExpiresAt) : null
  if (expiresAt && expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return integration.accessToken
  }

  // Expired (or expiry unknown) — refresh
  if (!integration.refreshToken) {
    await markGmailExpired(brandId, 'No refresh token saved')
    throw new GmailAuthError(RECONNECT)
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

  if (!res.ok) {
    const text = await res.text()
    // invalid_grant = Google revoked or expired the refresh token. Anything else (our client
    // id/secret, Google being down) isn't fixed by the user reconnecting, so don't flag it.
    if (/invalid_grant/.test(text)) {
      await markGmailExpired(brandId, `Refresh refused: ${text}`)
      throw new GmailAuthError(RECONNECT)
    }
    throw new Error(`Token refresh failed: ${text}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  const newExpiry = new Date(Date.now() + data.expires_in * 1000)

  await db
    .update(brandIntegrations)
    .set({ accessToken: data.access_token, tokenExpiresAt: newExpiry, lastUsedAt: new Date() })
    .where(gmailRow(brandId))

  return data.access_token
}

/** Really asks Google whether the connection works. Marks it expired when Google says no. */
export async function checkGmail(brandId: string): Promise<{ ok: boolean; detail: string }> {
  const [row] = await db.select({ status: brandIntegrations.status, scopes: brandIntegrations.scopes, metadata: brandIntegrations.metadata })
    .from(brandIntegrations).where(gmailRow(brandId)).limit(1)
  if (!row) return { ok: false, detail: 'Not connected.' }
  if (row.status !== 'connected') return { ok: false, detail: 'Google stopped accepting the connection. Reconnect Gmail.' }

  let token: string
  try {
    token = await getValidGmailToken(brandId)
  } catch (e) {
    if (e instanceof GmailAuthError) return { ok: false, detail: 'Google stopped accepting the connection. Reconnect Gmail.' }
    return { ok: false, detail: "Couldn't reach Google to check the connection." }
  }

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null)
  if (!res) return { ok: false, detail: "Couldn't reach Gmail." }
  if (res.status === 401) {
    await markGmailExpired(brandId, 'Profile check answered 401')
    return { ok: false, detail: 'Google stopped accepting the connection. Reconnect Gmail.' }
  }
  if (!res.ok) return { ok: false, detail: `Gmail returned an error (${res.status}).` }
  const profile = await res.json().catch(() => ({})) as { emailAddress?: string }

  if (row.scopes && !row.scopes.includes(SEND_SCOPE)) {
    return { ok: false, detail: 'Gmail is connected but GrowJin may not send. Reconnect and tick every box on Google’s screen.' }
  }
  const address = profile.emailAddress ?? (row.metadata as { gmail_address?: string } | null)?.gmail_address
  return { ok: true, detail: address ? `Sending from ${address}.` : 'Connection works.' }
}
