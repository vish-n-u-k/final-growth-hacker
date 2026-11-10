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

type GscAnswer = { ok: true; rows: GscRow[] } | { ok: false; status: number; message: string }

async function gscQuery(token: string, siteId: string, body: object): Promise<GscAnswer> {
  try {
    const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteId)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: { message: string } }
      console.error('[gsc-mcp]', siteId, res.status, e?.error?.message)
      return { ok: false, status: res.status, message: e?.error?.message ?? `HTTP ${res.status}` }
    }
    return { ok: true, rows: ((await res.json()) as { rows?: GscRow[] }).rows ?? [] }
  } catch (e) {
    console.error('[gsc-mcp]', siteId, e)
    return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Search Console properties are either URL-prefix ("https://frekto.ai/") or domain
 * ("sc-domain:frekto.ai"). The brand's website URL alone often isn't the property's exact name,
 * so try each form (as the app's own Analytics does) and keep the first that has data.
 */
function propertyCandidates(websiteUrl: string): string[] {
  const url = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`
  let host = ''
  try { host = new URL(url).hostname } catch { return [websiteUrl] }
  const bare = host.replace(/^www\./i, '')
  const list = [
    url,
    `https://${host}/`,
    `https://www.${bare}/`,
    `http://${host}/`,
    `sc-domain:${bare}`,
  ]
  return [...new Set(list)]
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

  const websiteUrl = brand?.websiteUrl ?? ''
  if (!websiteUrl) return { connected: true, error: 'The brand has no website URL, so there is no Search Console property to read.' }
  const endDate = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const queryBody = {
    startDate,
    endDate,
    dimensions: ['query'],
    rowLimit: limit,
    orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
  }

  // Find the property: the first form that answers with rows, else the first that answers at all
  const tried: { property: string; result: string }[] = []
  let siteUrl = ''
  let queryRows: GscRow[] = []
  for (const property of propertyCandidates(websiteUrl)) {
    const r = await gscQuery(token, property, queryBody)
    if (!r.ok) { tried.push({ property, result: `${r.status || 'error'}: ${r.message}` }); continue }
    tried.push({ property, result: `${r.rows.length} rows` })
    if (!siteUrl) { siteUrl = property; queryRows = r.rows }
    if (r.rows.length) { siteUrl = property; queryRows = r.rows; break }
  }

  if (!siteUrl) {
    return {
      connected: true,
      error: 'Search Console refused every property form for this site. Most likely the Service Account email has not been added as a user on the property in Search Console (Settings → Users and permissions), or the property is under a different address.',
      service_account: meta.client_email,
      tried,
    }
  }

  const pageAnswer = await gscQuery(token, siteUrl, {
    startDate,
    endDate,
    dimensions: ['page'],
    rowLimit: limit,
    orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
  })
  const pageRows = pageAnswer.ok ? pageAnswer.rows : []

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
    ...(topQueries.length === 0 && topPages.length === 0
      ? { note: `Search Console answered but has no data for ${siteUrl} in the last ${days} days (new site, or very few impressions).`, tried }
      : {}),
  }
}
