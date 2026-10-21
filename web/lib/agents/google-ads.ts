// Wasted-spend check for the Search Agent, using the brand's Google Ads connection
// (Settings → Integrations → Google Ads). Finds search terms that cost money last month and
// never converted. API version: GOOGLE_ADS_API_VERSION (Google retires versions yearly).

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'

const VERSION = () => process.env.GOOGLE_ADS_API_VERSION || 'v21'

interface AdsCreds { developer_token: string; client_id: string; client_secret: string; refresh_token: string; customer_id: string; login_customer_id?: string }

export async function readGoogleAdsCreds(brandId: string): Promise<AdsCreds | null> {
  const [row] = await db.select({ metadata: brandIntegrations.metadata }).from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'google_ads'), eq(brandIntegrations.status, 'connected')))
    .limit(1)
  const m = (row?.metadata as Record<string, string> | null) ?? {}
  if (!m.developer_token || !m.client_id || !m.client_secret || !m.refresh_token || !m.customer_id) return null
  return m as unknown as AdsCreds
}

async function accessToken(c: AdsCreds): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' }),
  })
  const j = await res.json() as { access_token?: string; error_description?: string }
  if (!j.access_token) throw new Error(j.error_description ?? 'Google Ads sign-in failed')
  return j.access_token
}

async function search<T>(c: AdsCreds, token: string, query: string): Promise<T[]> {
  const cid = c.customer_id.replace(/\D/g, '')
  const res = await fetch(`https://googleads.googleapis.com/${VERSION()}/customers/${cid}/googleAds:search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': c.developer_token,
      'Content-Type': 'application/json',
      ...(c.login_customer_id ? { 'login-customer-id': c.login_customer_id.replace(/\D/g, '') } : {}),
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message ?? `Google Ads ${res.status}`)
  }
  const j = await res.json() as { results?: T[] }
  return j.results ?? []
}

export interface WastedTerm { term: string; cost: number; clicks: number }
export interface WastedSpend { currency: string; total: number; terms: WastedTerm[] }

/** Search terms with spend and zero conversions in the last 30 days (top 10 by cost). */
export async function wastedSearchTerms(c: AdsCreds): Promise<WastedSpend> {
  const token = await accessToken(c)
  type Row = { searchTermView?: { searchTerm?: string }; metrics?: { costMicros?: string; clicks?: string; conversions?: number } }
  const [cur, rows] = await Promise.all([
    search<{ customer?: { currencyCode?: string } }>(c, token, 'SELECT customer.currency_code FROM customer LIMIT 1'),
    search<Row>(c, token, `SELECT search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM search_term_view WHERE segments.date DURING LAST_30_DAYS AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC LIMIT 200`),
  ])
  const byTerm = new Map<string, WastedTerm & { conversions: number }>()
  for (const r of rows) {
    const term = r.searchTermView?.searchTerm
    if (!term) continue
    const t = byTerm.get(term) ?? { term, cost: 0, clicks: 0, conversions: 0 }
    t.cost += Number(r.metrics?.costMicros ?? 0) / 1e6
    t.clicks += Number(r.metrics?.clicks ?? 0)
    t.conversions += Number(r.metrics?.conversions ?? 0)
    byTerm.set(term, t)
  }
  const wasted = [...byTerm.values()].filter(t => t.conversions === 0 && t.clicks >= 3).sort((a, b) => b.cost - a.cost)
  return {
    currency: cur[0]?.customer?.currencyCode ?? 'USD',
    total: Math.round(wasted.reduce((s, t) => s + t.cost, 0)),
    terms: wasted.slice(0, 10).map(({ term, cost, clicks }) => ({ term, cost: Math.round(cost), clicks })),
  }
}
