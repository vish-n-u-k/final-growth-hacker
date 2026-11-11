import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { getToken } from './get_ga_analytics'
import { connectGsc } from './get_gsc_data'

// Direct access to the brand's own Google Analytics 4 and Search Console, with the service
// accounts connected in Settings → Integrations. Claude builds the report (any dimensions,
// metrics, filters, dates); rows come back as plain objects, and Google's own message on errors.

type Json = Record<string, unknown>
const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const MAX_ROWS = 1000

const clampRows = (v: unknown, fallback = 100) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_ROWS) : fallback
}

async function googleFetch(url: string, token: string, body?: unknown) {
  try {
    const res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    const json = await res.json().catch(() => null) as Json | null
    if (!res.ok) {
      const err = (json?.error ?? {}) as { message?: string; status?: string }
      return { ok: false as const, error: `Google answered ${res.status}${err.status ? ` ${err.status}` : ''}: ${err.message ?? res.statusText}` }
    }
    return { ok: true as const, data: json ?? {} }
  } catch (e) {
    return { ok: false as const, error: e instanceof Error && e.name === 'TimeoutError' ? 'Google took longer than 30 s to answer. Ask for fewer rows or a shorter period.' : `Could not reach Google (${e instanceof Error ? e.message : 'failed'}).` }
  }
}

// ── Google Analytics 4 ────────────────────────────────────────────────────────

/** "sessions" or { name: "sessions" } → { name } */
const named = (list: unknown) => Array.isArray(list)
  ? list.map(x => (typeof x === 'string' ? { name: x } : x)).filter(x => x && typeof x === 'object')
  : undefined

type GaRow = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }
type GaReport = { dimensionHeaders?: { name: string }[]; metricHeaders?: { name: string; type?: string }[]; rows?: GaRow[]; totals?: GaRow[]; rowCount?: number; metadata?: Json; propertyQuota?: Json }

/** Rows as { dimension: value, metric: number } objects. */
function gaRows(r: GaReport, rows: GaRow[] | undefined) {
  const dims = (r.dimensionHeaders ?? []).map(h => h.name)
  const mets = (r.metricHeaders ?? []).map(h => h.name)
  return (rows ?? []).map(row => {
    const o: Record<string, string | number> = {}
    dims.forEach((d, i) => { o[d] = row.dimensionValues?.[i]?.value ?? '' })
    mets.forEach((m, i) => { const v = row.metricValues?.[i]?.value ?? ''; const n = Number(v); o[m] = v !== '' && Number.isFinite(n) ? n : v })
    return o
  })
}

export async function ga4(brandId: string, args: Json) {
  const [integration] = await db.select().from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'ga4_api'), eq(brandIntegrations.status, 'connected'))).limit(1)
  const meta = (integration?.metadata as Record<string, string> | null) ?? {}
  if (!integration || !meta.client_email || !meta.private_key || !meta.property_id) {
    return { connected: false, message: 'Google Analytics isn\'t connected. Settings → Integrations → Google Analytics Data API: add the service account key and the GA4 property ID.' }
  }
  const token = await getToken(meta.client_email, meta.private_key)
  if (!token) return { connected: true, error: 'Google rejected the Google Analytics service account key. Re-check it in Settings → Integrations.' }
  const pid = meta.property_id.replace(/^properties\//, '')
  const base = `https://analyticsdata.googleapis.com/v1beta/properties/${pid}`
  const action = String(args.action ?? 'report')

  if (action === 'metadata') {
    // Every dimension and metric this property has (custom ones included), to know the exact names
    const r = await googleFetch(`${base}/metadata`, token)
    if (!r.ok) return { connected: true, property: pid, error: r.error }
    const d = r.data as { dimensions?: { apiName: string; uiName?: string; customDefinition?: boolean }[]; metrics?: { apiName: string; uiName?: string; type?: string; customDefinition?: boolean }[] }
    const filter = typeof args.search === 'string' ? args.search.toLowerCase() : ''
    const keep = (x: { apiName: string; uiName?: string }) => !filter || x.apiName.toLowerCase().includes(filter) || (x.uiName ?? '').toLowerCase().includes(filter)
    return {
      connected: true, property: pid,
      dimensions: (d.dimensions ?? []).filter(keep).map(x => ({ name: x.apiName, label: x.uiName, ...(x.customDefinition ? { custom: true } : {}) })),
      metrics: (d.metrics ?? []).filter(keep).map(x => ({ name: x.apiName, label: x.uiName, type: x.type, ...(x.customDefinition ? { custom: true } : {}) })),
    }
  }

  const given = (args.request && typeof args.request === 'object' ? args.request : {}) as Json
  const limit = clampRows(given.limit ?? args.limit)

  if (action === 'realtime') {
    // Last 30 minutes (up to 60 on GA4 360)
    const body: Json = { ...given, dimensions: named(given.dimensions), metrics: named(given.metrics) ?? [{ name: 'activeUsers' }], limit }
    const r = await googleFetch(`${base}:runRealtimeReport`, token, body)
    if (!r.ok) return { connected: true, property: pid, error: r.error }
    const rep = r.data as GaReport
    return { connected: true, property: pid, kind: 'realtime', row_count: rep.rowCount ?? 0, rows: gaRows(rep, rep.rows), ...(rep.totals ? { totals: gaRows(rep, rep.totals) } : {}) }
  }

  if (action !== 'report') return { error: 'action must be report, realtime or metadata.' }
  const metrics = named(given.metrics)
  if (!metrics?.length) return { error: 'request.metrics is required, e.g. ["sessions", "newUsers"]. Use action "metadata" to list the names.' }
  const body: Json = {
    ...given,
    dimensions: named(given.dimensions),
    metrics,
    dateRanges: Array.isArray(given.dateRanges) && given.dateRanges.length ? given.dateRanges : [{ startDate: '28daysAgo', endDate: 'yesterday' }],
    limit,
    ...(given.metricAggregations ? {} : { metricAggregations: ['TOTAL'] }),
    returnPropertyQuota: true,
  }
  const r = await googleFetch(`${base}:runReport`, token, body)
  if (!r.ok) return { connected: true, property: pid, error: r.error, sent: body }
  const rep = r.data as GaReport
  const quota = rep.propertyQuota as { tokensPerDay?: { consumed?: number; remaining?: number } } | undefined
  return {
    connected: true,
    property: pid,
    date_ranges: body.dateRanges,
    row_count: rep.rowCount ?? 0,
    returned: rep.rows?.length ?? 0,
    rows: gaRows(rep, rep.rows),
    ...(rep.totals ? { totals: gaRows(rep, rep.totals) } : {}),
    ...((rep.rowCount ?? 0) > (rep.rows?.length ?? 0) ? { more: `Only ${rep.rows?.length ?? 0} of ${rep.rowCount} rows returned. Raise limit (max ${MAX_ROWS}) or pass offset.` } : {}),
    ...((rep.metadata as { samplingMetadatas?: unknown } | undefined)?.samplingMetadatas ? { sampled: true } : {}),
    ...(quota?.tokensPerDay ? { quota_left_today: quota.tokensPerDay.remaining } : {}),
  }
}

// ── Search Console ────────────────────────────────────────────────────────────

const DIMS = ['query', 'page', 'date', 'country', 'device', 'searchAppearance', 'hour']

export async function gsc(brandId: string, args: Json) {
  const conn = await connectGsc(brandId)
  if (!conn.ok) return conn.answer
  const { token, property } = conn
  const site = encodeURIComponent(property)
  const action = String(args.action ?? 'query')

  if (action === 'sites') {
    const r = await googleFetch('https://www.googleapis.com/webmasters/v3/sites', token)
    if (!r.ok) return { connected: true, error: r.error }
    return { connected: true, using: property, properties: (r.data as { siteEntry?: unknown[] }).siteEntry ?? [] }
  }

  if (action === 'sitemaps') {
    const r = await googleFetch(`https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps`, token)
    if (!r.ok) return { connected: true, property, error: r.error }
    return { connected: true, property, sitemaps: (r.data as { sitemap?: unknown[] }).sitemap ?? [] }
  }

  if (action === 'inspect') {
    // Google's own verdict on one page: indexed or not, why, last crawl, canonical, mobile, rich results
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    if (!/^https?:\/\//.test(url)) return { error: 'url is required for inspect: the full page address, e.g. "https://example.com/pricing".' }
    const r = await googleFetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', token, { inspectionUrl: url, siteUrl: property, languageCode: 'en-US' })
    if (!r.ok) return { connected: true, property, url, error: r.error }
    return { connected: true, property, url, ...((r.data as { inspectionResult?: Json }).inspectionResult ?? {}), note: 'Google allows about 2,000 inspections a day per property.' }
  }

  if (action !== 'query') return { error: 'action must be query, inspect, sitemaps or sites.' }
  const given = (args.request && typeof args.request === 'object' ? args.request : {}) as Json
  const dimensions = Array.isArray(given.dimensions) ? given.dimensions.map(String) : []
  const bad = dimensions.filter(d => !DIMS.includes(d))
  if (bad.length) return { error: `Unknown dimension ${bad.join(', ')}. Use: ${DIMS.join(', ')}.` }
  // Search Console runs 2-3 days behind, so the default window ends 2 days ago
  const body: Json = {
    ...given,
    dimensions,
    startDate: typeof given.startDate === 'string' ? given.startDate : iso(Date.now() - 30 * DAY),
    endDate: typeof given.endDate === 'string' ? given.endDate : iso(Date.now() - 2 * DAY),
    rowLimit: clampRows(given.rowLimit ?? args.limit),
    dataState: given.dataState ?? 'all',
  }
  const r = await googleFetch(`https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, token, body)
  if (!r.ok) return { connected: true, property, error: r.error, sent: body }
  const rows = ((r.data as { rows?: { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }).rows ?? [])
    .map(row => {
      const o: Record<string, string | number> = {}
      dimensions.forEach((d, i) => { o[d] = row.keys?.[i] ?? '' })
      return { ...o, clicks: row.clicks, impressions: row.impressions, ctr_pct: Math.round(row.ctr * 1000) / 10, position: Math.round(row.position * 10) / 10 }
    })
  return {
    connected: true,
    property,
    from: body.startDate,
    to: body.endDate,
    returned: rows.length,
    rows,
    ...(rows.length === body.rowLimit ? { more: `Hit the row limit (${body.rowLimit}). Pass startRow to page on, or raise rowLimit (max ${MAX_ROWS}).` } : {}),
    ...(rows.length === 0 ? { note: 'No rows: no search data for this window and filter (or the site is new).' } : {}),
  }
}
