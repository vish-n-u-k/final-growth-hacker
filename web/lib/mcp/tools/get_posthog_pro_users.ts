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
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    return await res.json() as { results?: unknown[][] }
  } catch { return null }
}

// Pro/paid users = users whose PostHog person property matches a given plan value.
// Defaults to plan="pro" but caller can pass any property name + value.
export async function getPosthogProUsers(
  brandId: string,
  planProperty = 'plan',
  planValue = 'pro',
  limit = 100,
) {
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

  const cappedLimit = Math.min(limit, 200)

  // Sanitise property name and value — only allow alphanumeric + underscore/hyphen
  const safeProp = planProperty.replace(/[^a-zA-Z0-9_\-]/g, '')
  const safeVal = planValue.replace(/[^a-zA-Z0-9_\-]/g, '')

  const data = await phQuery(host, projectId, integration.apiKey,
    `SELECT
       person.properties.email AS email,
       person.properties.${safeProp} AS plan,
       max(timestamp) AS last_seen
     FROM events
     WHERE person.properties.email IS NOT NULL
       AND person.properties.email != ''
       AND person.properties.${safeProp} = '${safeVal}'
     GROUP BY email, plan
     ORDER BY last_seen DESC
     LIMIT ${cappedLimit}`,
  )

  const users = (data?.results ?? []).map(([email, plan, lastSeen]) => ({
    email: email as string,
    plan: plan as string,
    lastSeen: lastSeen as string,
  }))

  return {
    connected: true,
    definition: `Users where PostHog person property "${safeProp}" = "${safeVal}"`,
    planProperty: safeProp,
    planValue: safeVal,
    totalReturned: users.length,
    users,
  }
}
