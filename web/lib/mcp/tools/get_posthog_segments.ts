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

export async function getPosthogSegments(brandId: string) {
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

  const [
    newThisWeekData,
    newLastWeekData,
    churnedData,
    powerUsersData,
    totalActiveData,
  ] = await Promise.all([
    // New users this week (first seen in last 7 days)
    phQuery(host, projectId, integration.apiKey,
      `SELECT count(DISTINCT person_id) FROM events
       WHERE timestamp > now() - interval 7 day
       AND person_id NOT IN (
         SELECT DISTINCT person_id FROM events WHERE timestamp <= now() - interval 7 day
       )`),

    // New users last week (first seen 8-14 days ago)
    phQuery(host, projectId, integration.apiKey,
      `SELECT count(DISTINCT person_id) FROM events
       WHERE timestamp > now() - interval 14 day
       AND timestamp <= now() - interval 7 day
       AND person_id NOT IN (
         SELECT DISTINCT person_id FROM events WHERE timestamp <= now() - interval 14 day
       )`),

    // Churned users — active before 14 days ago but not seen since
    phQuery(host, projectId, integration.apiKey,
      `SELECT count(DISTINCT person_id) FROM events
       WHERE timestamp < now() - interval 14 day
       AND person_id NOT IN (
         SELECT DISTINCT person_id FROM events WHERE timestamp >= now() - interval 14 day
       )`),

    // Power users — active on 5+ distinct days in the last 7 days
    phQuery(host, projectId, integration.apiKey,
      `SELECT count(*) FROM (
         SELECT person_id, count(DISTINCT toDate(timestamp)) as active_days
         FROM events
         WHERE timestamp > now() - interval 7 day
         GROUP BY person_id
         HAVING active_days >= 5
       )`),

    // Total active last 30 days
    phQuery(host, projectId, integration.apiKey,
      `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - interval 30 day`),
  ])

  const newThisWeek = (newThisWeekData?.results?.[0]?.[0] as number) ?? null
  const newLastWeek = (newLastWeekData?.results?.[0]?.[0] as number) ?? null
  const churned = (churnedData?.results?.[0]?.[0] as number) ?? null
  const powerUsers = (powerUsersData?.results?.[0]?.[0] as number) ?? null
  const totalActive30d = (totalActiveData?.results?.[0]?.[0] as number) ?? null

  const weekOverWeekGrowth =
    newThisWeek !== null && newLastWeek !== null && newLastWeek > 0
      ? Math.round(((newThisWeek - newLastWeek) / newLastWeek) * 100)
      : null

  return {
    connected: true,
    segments: {
      newUsersThisWeek: newThisWeek,
      newUsersLastWeek: newLastWeek,
      weekOverWeekGrowthPct: weekOverWeekGrowth,
      churnedUsers: churned,
      powerUsers,
      totalActive30d,
    },
    interpretation: {
      growthTrend: weekOverWeekGrowth === null ? 'unknown'
        : weekOverWeekGrowth > 10 ? 'strong growth'
        : weekOverWeekGrowth > 0 ? 'growing'
        : weekOverWeekGrowth === 0 ? 'flat'
        : 'declining',
      churnRisk: churned !== null && totalActive30d !== null && totalActive30d > 0
        ? Math.round((churned / totalActive30d) * 100)
        : null,
    },
  }
}
