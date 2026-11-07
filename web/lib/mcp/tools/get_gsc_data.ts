import { db } from '@/lib/db'
import { brandIntegrations, brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getServiceToken } from '@/lib/analytics/google-providers'
import { pickProperty } from '@/lib/modules/seo/gsc-indexing'

// MCP get_gsc_data. Finds the Search Console property the service account can see for the brand's
// site (a URL-prefix property, or a domain property sc-domain:example.com), the same way the
// integration health check does, and reports Google's own error instead of empty lists.

const NOT_CONNECTED = {
  connected: false,
  message: 'Google Search Console API is not connected. Go to Settings → Integrations → Google Search Console API to add your Service Account credentials.',
}

type GscRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }
type SiteEntry = { siteUrl: string; permissionLevel: string }

/** The brand's home page as URL variants (as given, https, with and without www) to match a property. */
function homeVariants(websiteUrl: string): string[] {
  const raw = websiteUrl.trim()
  const url = /^https?:\/\//.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(url)
    const bare = u.hostname.replace(/^www\./, '')
    const path = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`
    return [...new Set([`${u.protocol}//${u.hostname}${path}`, `https://${bare}/`, `https://www.${bare}/`, `http://${bare}/`, `http://www.${bare}/`])]
  } catch { return [] }
}

async function googleError(res: Response): Promise<string> {
  const e = await res.json().catch(() => null) as { error?: { message?: string } } | null
  return `Google answered ${res.status}: ${e?.error?.message ?? res.statusText}`
}

async function gscQuery(token: string, property: string, body: object): Promise<{ rows: GscRow[]; error?: string }> {
  try {
    const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return { rows: [], error: await googleError(res) }
    return { rows: ((await res.json()) as { rows?: GscRow[] }).rows ?? [] }
  } catch (e) {
    return { rows: [], error: e instanceof Error && e.name === 'TimeoutError' ? 'Search Console took too long to answer.' : `Could not reach Search Console (${e instanceof Error ? e.message : 'failed'}).` }
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10
const ctrPct = (n: number) => Math.round(n * 1000) / 10

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

  const span = [7, 28, 90].includes(days) ? days : Math.min(Math.max(1, Math.round(days) || 28), 480)
  const rowLimit = Math.min(Math.max(1, Math.round(limit) || 20), 100)

  const token = await getServiceToken(meta.client_email, meta.private_key, 'https://www.googleapis.com/auth/webmasters.readonly')
  if (!token) return { connected: true, error: 'Google rejected the Search Console service account key. Re-check the email and private key in Settings → Integrations.' }

  // Which property to read
  let entries: SiteEntry[] = []
  try {
    const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return { connected: true, error: `Could not list Search Console properties. ${await googleError(res)}` }
    entries = ((await res.json()) as { siteEntry?: SiteEntry[] }).siteEntry ?? []
  } catch (e) {
    return { connected: true, error: `Could not reach Search Console (${e instanceof Error ? e.message : 'failed'}).` }
  }
  const websiteUrl = brand?.websiteUrl ?? ''
  const property = homeVariants(websiteUrl).map(u => pickProperty(entries, u)).find(Boolean) ?? null
  if (!property) {
    return {
      connected: true,
      error: `The service account (${meta.client_email}) can't see a Search Console property for ${websiteUrl || 'this site'}. In Search Console → Settings → Users and permissions, add it as a user on that property.`,
      properties_it_can_see: entries.map(e => e.siteUrl),
    }
  }

  // Search Console's data runs about 2 days behind, so the window ends 2 days ago
  const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)
  const endDate = day(2)
  const startDate = day(span + 1)
  const base = { startDate, endDate, dataState: 'all' }

  const [totals, queries, pages] = await Promise.all([
    gscQuery(token, property, { ...base, rowLimit: 1 }),
    gscQuery(token, property, { ...base, dimensions: ['query'], rowLimit: rowLimit * 2 }),
    gscQuery(token, property, { ...base, dimensions: ['page'], rowLimit }),
  ])
  const errors = [...new Set([totals.error, queries.error, pages.error].filter((e): e is string => !!e))]
  if (totals.error && queries.error && pages.error) return { connected: true, property, error: errors.join(' ') }

  const t = totals.rows[0]
  // Searches with operators (site:, inurl:…) come from SEO and lead tools, ours included, not people
  const topQueries = queries.rows
    .filter(r => !/(^|\s)-?(site|inurl|intitle|intext|allinurl|allintitle|related|cache):/i.test(r.keys?.[0] ?? ''))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, rowLimit)
    .map(r => ({ query: r.keys?.[0] ?? '', clicks: r.clicks, impressions: r.impressions, ctr: ctrPct(r.ctr), position: round1(r.position) }))
  const topPages = pages.rows
    .map(r => ({ page: r.keys?.[0] ?? '', clicks: r.clicks, impressions: r.impressions, ctr: ctrPct(r.ctr), position: round1(r.position) }))

  return {
    connected: true,
    property,
    days: span,
    from: startDate,
    to: endDate,
    totals: t ? { clicks: t.clicks, impressions: t.impressions, ctr: ctrPct(t.ctr), position: round1(t.position) } : { clicks: 0, impressions: 0, ctr: 0, position: null },
    topQueries,
    topPages,
    ...(errors.length ? { partial_error: errors.join(' ') } : {}),
    ...(!t && !queries.rows.length && !pages.rows.length && !errors.length ? { note: `Search Console has no search data for ${property} between ${startDate} and ${endDate}.` } : {}),
  }
}
