import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { buildPostHogFilter, type PostHogPersonFilter } from '@/lib/posthog/filter'

// Shared by the MCP PostHog tools: the connection, one HogQL query that reports PostHog's own error
// (instead of an empty answer), and how a person's email is read.

export const NOT_CONNECTED = {
  connected: false,
  message: 'PostHog is not connected. Go to Settings → Integrations → PostHog to add your Personal API Key and Project ID.',
}

// The MCP client gives up after about 60 s, so one query may take up to 45 s
const TIMEOUT_MS = 45_000

export interface PosthogConn {
  host: string
  projectId: string
  apiKey: string
  meta: Record<string, string>
  filter: PostHogPersonFilter
}

export async function posthogConn(brandId: string): Promise<PosthogConn | null> {
  const [integration] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'posthog'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)
  if (!integration?.apiKey) return null
  const meta = (integration.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  if (!projectId) return null
  return {
    host: (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, ''),
    projectId,
    apiKey: integration.apiKey,
    meta,
    // The "Count unique users only" setting (Settings → Integrations → PostHog), as the app's own counts use it
    filter: buildPostHogFilter(meta),
  }
}

export type PhResult = { ok: true; results: unknown[][] } | { ok: false; error: string }

export async function phQuery(c: PosthogConn, query: string): Promise<PhResult> {
  try {
    const res = await fetch(`${c.host}/api/projects/${c.projectId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => null) as { detail?: string; error?: string; code?: string } | null
      const why = e?.detail ?? e?.error ?? res.statusText
      return {
        ok: false,
        error: res.status === 401 || res.status === 403
          ? `PostHog refused the API key (${res.status}: ${why}). Check the Personal API Key in Settings → Integrations → PostHog (it needs query read access).`
          : `PostHog answered ${res.status}: ${why}`,
      }
    }
    const data = await res.json() as { results?: unknown[][]; error?: string }
    if (data.error) return { ok: false, error: `PostHog: ${data.error}` }
    return { ok: true, results: data.results ?? [] }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
        ? `PostHog took longer than ${TIMEOUT_MS / 1000} s to answer. Try a shorter period.`
        : `Could not reach PostHog (${e instanceof Error ? e.message : 'failed'}).`,
    }
  }
}

/** First cell of a one-number query, or null. */
export const num = (r: PhResult): number | null => {
  if (!r.ok) return null
  const v = r.results[0]?.[0]
  return typeof v === 'number' ? v : v == null ? null : Number(v)
}

const PROP = /^[\w$]+$/

/**
 * A person's email as a HogQL expression (on the events table): the property chosen in the app's
 * PostHog settings when it's an email one, else `email`, else `$email`, else the distinct id when
 * it is an email address. Products set the email under different names; reading only `email`
 * made every list come back empty for those that use `$email`.
 */
export function emailExpr(c: PosthogConn): string {
  const chosen = c.meta['unique_filter_property']
  const props = [...new Set([...(chosen && PROP.test(chosen) && /mail/i.test(chosen) ? [chosen] : []), 'email', '$email'])]
  const parts = props.map(p => `nullIf(toString(person.properties.${p}), '')`)
  parts.push(`if(match(distinct_id, '^[^@\\\\s]+@[^@\\\\s]+\\\\.[^@\\\\s]+$'), distinct_id, NULL)`)
  return `coalesce(${parts.join(', ')})`
}

/** How people were matched, for the answer. */
export function emailNote(c: PosthogConn): string {
  const chosen = c.meta['unique_filter_property']
  const first = chosen && PROP.test(chosen) && /mail/i.test(chosen) ? `${chosen}, then ` : ''
  return `Email read from the person property ${first}email, then $email, then the distinct id when it is an email address. People with none of these are not listed.`
}

/** Days as a whole number in [min, max]. */
export const clampDays = (v: number, fallback: number, min = 1, max = 365) =>
  Math.min(max, Math.max(min, Number.isFinite(v) && v > 0 ? Math.round(v) : fallback))
