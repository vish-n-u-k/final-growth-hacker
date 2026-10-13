import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export type HogQL = (query: string) => Promise<unknown[][] | null>

/** The brand's connected PostHog project as a HogQL runner (null = not connected). Queries that fail return null. */
export async function posthogForBrand(brandId: string): Promise<{ q: HogQL; meta: Record<string, string> } | null> {
  const [ph] = await db.select().from(brandIntegrations).where(and(
    eq(brandIntegrations.brandId, brandId),
    eq(brandIntegrations.provider, 'posthog'),
    eq(brandIntegrations.status, 'connected'),
  )).limit(1)
  const meta = (ph?.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  if (!ph?.apiKey || !projectId) return null
  const host = (meta['posthog_host'] || 'https://us.posthog.com').replace(/\/$/, '')
  const apiKey = ph.apiKey

  const q: HogQL = async (query) => {
    try {
      const res = await fetch(`${host}/api/projects/${projectId}/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) return null
      const data = await res.json() as { results?: unknown[][] }
      return data.results ?? null
    } catch {
      return null
    }
  }
  return { q, meta }
}
