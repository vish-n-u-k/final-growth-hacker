import { createSign } from 'crypto'
import { db } from '@/lib/db'
import { brandIntegrations, brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const NOT_CONNECTED = {
  connected: false,
  message: 'Google Search Console API is not connected. Go to Settings → Integrations → Google Search Console API to add your Service Account credentials.',
}

async function getToken(email: string, key: string): Promise<string | null> {
  try {
    const buf = (s: string) => Buffer.from(s).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const h = buf(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const p = buf(JSON.stringify({ iss: email, scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
    const input = `${h}.${p}`
    const sign = createSign('RSA-SHA256')
    sign.update(input)
    const sig = sign.sign(key.replace(/\\n/g, '\n'), 'base64url')
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${sig}` }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    return ((await res.json()) as { access_token?: string }).access_token ?? null
  } catch { return null }
}

type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

async function gscQuery(token: string, siteUrl: string, body: object): Promise<GscRow[]> {
  try {
    const encodedSite = encodeURIComponent(siteUrl)
    const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: { message: string } }
      console.error('[gsc-mcp]', res.status, e?.error?.message)
      return []
    }
    return ((await res.json()) as { rows?: GscRow[] }).rows ?? []
  } catch (e) { console.error('[gsc-mcp]', e); return [] }
}

export async function getGscData(brandId: string, days = 28, limit = 20) {
  const [[brand], [integration]] = await Promise.all([
    db.select({ websiteUrl: brands.websiteUrl }).from(brands).where(eq(brands.id, brandId)).limit(1),
    db.select()
      .from(brandIntegrations)
      .where(and(
        eq(brandIntegrations.brandId, brandId),
        eq(brandIntegrations.provider, 'gsc_api'),
        eq(brandIntegrations.status, 'connected'),
      ))
      .limit(1),
  ])

  if (!integration) return NOT_CONNECTED

  const meta = (integration.metadata as Record<string, string> | null) ?? {}
  if (!meta.client_email || !meta.private_key) return NOT_CONNECTED

  const token = await getToken(meta.client_email, meta.private_key)
  if (!token) return { connected: true, error: 'GSC authentication failed. Check your Service Account credentials.' }

  const siteUrl = brand?.websiteUrl ?? ''
  const endDate = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  const [queryRows, pageRows] = await Promise.all([
    gscQuery(token, siteUrl, {
      startDate,
      endDate,
      dimensions: ['query'],
      rowLimit: limit,
      orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
    }),
    gscQuery(token, siteUrl, {
      startDate,
      endDate,
      dimensions: ['page'],
      rowLimit: limit,
      orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
    }),
  ])

  const topQueries = queryRows.map(r => ({
    query: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Math.round(r.ctr * 1000) / 10,
    position: Math.round(r.position * 10) / 10,
  }))

  const topPages = pageRows.map(r => ({
    page: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Math.round(r.ctr * 1000) / 10,
    position: Math.round(r.position * 10) / 10,
  }))

  return {
    connected: true,
    siteUrl,
    days,
    topQueries,
    topPages,
  }
}
