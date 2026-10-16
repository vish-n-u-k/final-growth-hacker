import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { getServiceToken } from '@/lib/analytics/google-providers'
import { pickProperty } from '@/lib/modules/seo/gsc-indexing'

// Live check that each connected data source really works, so a dead key, a revoked service
// account or a wrong property id shows up as "not working" instead of quietly feeding zeros
// into dashboards. Each check makes one small, read-only request.

export type HealthStatus = 'ok' | 'no-data' | 'error'
export interface IntegrationHealth { provider: string; name: string; status: HealthStatus; detail: string }

const NAMES: Record<string, string> = { posthog: 'PostHog', ga4_api: 'Google Analytics', gsc_api: 'Search Console', frekto: 'Frekto' }
export const CHECKED_PROVIDERS = Object.keys(NAMES)

async function timed(url: string, init: RequestInit = {}): Promise<Response | null> {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) } catch { return null }
}

async function checkPosthog(apiKey: string, meta: Record<string, string>): Promise<[HealthStatus, string]> {
  const host = (meta.posthog_host || 'https://us.posthog.com').replace(/\/$/, '')
  if (!meta.project_id) return ['error', 'No project ID saved. Reconnect PostHog in Settings → Integrations.']
  const res = await timed(`${host}/api/projects/${meta.project_id}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: 'SELECT count() FROM events WHERE timestamp >= now() - interval 7 day' } }),
  })
  if (!res) return ['error', `Couldn't reach PostHog at ${host}.`]
  if (res.status === 401 || res.status === 403) return ['error', 'PostHog rejected the API key (expired, deleted, or missing the "query" permission).']
  if (res.status === 404) return ['error', `Project ${meta.project_id} wasn't found. Check the project ID and region (US/EU).`]
  if (!res.ok) return ['error', `PostHog returned an error (${res.status}).`]
  const d = await res.json().catch(() => null) as { results?: unknown[][] } | null
  const events = Number(d?.results?.[0]?.[0] ?? 0)
  return events > 0 ? ['ok', `${events.toLocaleString()} events in the last 7 days.`] : ['no-data', 'Connected, but no events in the last 7 days. Is PostHog installed on your site and app?']
}

export async function checkGa4(meta: Record<string, string>): Promise<[HealthStatus, string]> {
  if (!meta.client_email || !meta.private_key || !meta.property_id) return ['error', 'Service account email, key or property ID is missing.']
  const token = await getServiceToken(meta.client_email, meta.private_key, 'https://www.googleapis.com/auth/analytics.readonly')
  if (!token) return ['error', 'Google rejected the service account key.']
  const pid = meta.property_id.replace(/^properties\//, '')
  const res = await timed(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], metrics: [{ name: 'sessions' }] }),
  })
  if (!res) return ['error', "Couldn't reach Google Analytics."]
  if (res.status === 403) {
    const body = await res.text().catch(() => '')
    if (/SERVICE_DISABLED|has not been used|is disabled/i.test(body)) return ['error', 'The Google Analytics Data API is not enabled in your service account\'s Cloud project. Enable it at console.cloud.google.com/apis/library/analyticsdata.googleapis.com, wait a minute, then test again.']
    return ['error', `The service account can't read property ${pid}. In GA4, switch to the property with ID ${pid} (the URL shows p${pid}), then Admin → Property access management → + → Add users → add ${meta.client_email} with the Viewer role.`]
  }
  if (res.status === 404 || res.status === 400) return ['error', `Property ${pid} wasn't found. Use the numeric GA4 property ID (not the G- measurement ID).`]
  if (!res.ok) return ['error', `Google Analytics returned an error (${res.status}).`]
  const d = await res.json().catch(() => null) as { rows?: { metricValues?: { value?: string }[] }[] } | null
  const sessions = Number(d?.rows?.[0]?.metricValues?.[0]?.value ?? 0)
  return sessions > 0 ? ['ok', `${sessions.toLocaleString()} sessions in the last 7 days.`] : ['no-data', 'Connected, but no sessions in the last 7 days. Check the GA4 tag is on your website.']
}

async function checkGsc(meta: Record<string, string>, websiteUrl: string): Promise<[HealthStatus, string]> {
  if (!meta.client_email || !meta.private_key) return ['error', 'Service account email or key is missing.']
  const token = await getServiceToken(meta.client_email, meta.private_key, 'https://www.googleapis.com/auth/webmasters.readonly')
  if (!token) return ['error', 'Google rejected the service account key.']
  const res = await timed('https://www.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${token}` } })
  if (!res || !res.ok) return ['error', "Couldn't list Search Console properties."]
  const d = await res.json().catch(() => null) as { siteEntry?: { siteUrl: string; permissionLevel: string }[] } | null
  const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  const property = websiteUrl ? pickProperty(d?.siteEntry ?? [], url) : null
  if (!property) {
    const host = (() => { try { return new URL(url).hostname } catch { return websiteUrl } })()
    return ['error', `The service account can't see a Search Console property for ${host}. Add ${meta.client_email} as a user on that property.`]
  }
  return ['ok', `Reading ${property}.`]
}

async function checkFrekto(apiKey: string): Promise<[HealthStatus, string]> {
  // Any authenticated request works; an unknown job id answers 404 with a valid key, 401/403 without.
  const res = await timed('https://api.frekto.ai/jobs/growjin-health-check', { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!res) return ['error', "Couldn't reach Frekto."]
  if (res.status === 401 || res.status === 403) return ['error', 'Frekto rejected the API key. Create a new one in Frekto and update it in Settings → Integrations.']
  return ['ok', 'API key accepted.']
}

export async function checkIntegrations(brandId: string, websiteUrl: string): Promise<IntegrationHealth[]> {
  const rows = await db.select().from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.status, 'connected'), inArray(brandIntegrations.provider, CHECKED_PROVIDERS)))
  return Promise.all(rows.map(async (r): Promise<IntegrationHealth> => {
    const meta = (r.metadata as Record<string, string> | null) ?? {}
    let result: [HealthStatus, string]
    try {
      result = r.provider === 'posthog' ? (r.apiKey ? await checkPosthog(r.apiKey, meta) : ['error', 'No API key saved.'])
        : r.provider === 'ga4_api' ? await checkGa4(meta)
        : r.provider === 'gsc_api' ? await checkGsc(meta, websiteUrl)
        : r.apiKey ? await checkFrekto(r.apiKey) : ['error', 'No API key saved.']
    } catch {
      result = ['error', 'The check failed unexpectedly.']
    }
    return { provider: r.provider, name: NAMES[r.provider] ?? r.provider, status: result[0], detail: result[1] }
  }))
}
