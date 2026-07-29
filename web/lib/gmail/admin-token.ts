import { db } from '@/lib/db'
import { adminSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(adminSettings).where(eq(adminSettings.key, key))
  return row?.value ?? null
}

async function setSetting(key: string, value: string) {
  await db
    .insert(adminSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: adminSettings.key, set: { value, updatedAt: new Date() } })
}

export async function getValidAdminGmailToken(): Promise<string> {
  const accessToken  = await getSetting('gmail_access_token')
  const refreshToken = await getSetting('gmail_refresh_token')
  const expiresAtStr = await getSetting('gmail_token_expires_at')

  if (!accessToken) throw new Error('Admin Gmail not connected')

  const expiresAt = expiresAtStr ? new Date(expiresAtStr) : null
  if (!expiresAt || expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return accessToken
  }

  if (!refreshToken) throw new Error('No admin Gmail refresh token — please reconnect')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  })

  if (!res.ok) throw new Error(`Admin Gmail token refresh failed: ${await res.text()}`)

  const data = await res.json() as { access_token: string; expires_in: number }
  const newExpiry = new Date(Date.now() + data.expires_in * 1000)

  await setSetting('gmail_access_token', data.access_token)
  await setSetting('gmail_token_expires_at', newExpiry.toISOString())

  return data.access_token
}

export async function getAdminGmailAddress(): Promise<string | null> {
  return getSetting('gmail_address')
}

export async function storeAdminGmailTokens(tokens: {
  access_token: string
  refresh_token?: string
  expires_in: number
  email: string
}) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  await Promise.all([
    setSetting('gmail_access_token', tokens.access_token),
    setSetting('gmail_token_expires_at', expiresAt.toISOString()),
    setSetting('gmail_address', tokens.email),
    ...(tokens.refresh_token ? [setSetting('gmail_refresh_token', tokens.refresh_token)] : []),
  ])
}
