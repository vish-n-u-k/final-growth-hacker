import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const NOT_CONNECTED = {
  connected: false,
  message: 'PostHog is not connected. Go to Settings → Integrations → PostHog to add your Personal API Key and Project ID.',
}

async function phQuery(host: string, projectId: string, apiKey: string, query: string) {
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    return await res.json() as { results?: unknown[][] }
  } catch { return null }
}

export async function getPosthogAnalytics(brandId: string, days = 30) {
  const [integration] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'posthog'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!integration?.apiKey) return NOT_CONNECTED

  const meta = (integration.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')

  if (!projectId) return NOT_CONNECTED

  const [eventsData, dauData, mauData, wauData] = await Promise.all([
    phQuery(host, projectId, integration.apiKey,
      `SELECT event, count() as cnt FROM events WHERE timestamp > now() - interval ${days} day AND event NOT LIKE '$%' GROUP BY event ORDER BY cnt DESC LIMIT 20`),
    phQuery(host, projectId, integration.apiKey,
      `SELECT count(DISTINCT person_id) as dau FROM events WHERE timestamp >= today()`),
    phQuery(host, projectId, integration.apiKey,
      `SELECT count(DISTINCT person_id) as mau FROM events WHERE timestamp > now() - interval 30 day`),
    phQuery(host, projectId, integration.apiKey,
      `SELECT count(DISTINCT person_id) as wau FROM events WHERE timestamp > now() - interval 7 day`),
  ])

  const topEvents = (eventsData?.results ?? []).map(([event, count]) => ({
    event: event as string,
    count: count as number,
  }))

  return {
    connected: true,
    days,
    dau: (dauData?.results?.[0]?.[0] as number) ?? null,
    wau: (wauData?.results?.[0]?.[0] as number) ?? null,
    mau: (mauData?.results?.[0]?.[0] as number) ?? null,
    topEvents,
  }
}
