// One call to an Apify actor and its rows. The token is the developer's (APIFY_API_TOKEN), never the
// user's. Every call is capped, so a search can't cost more than its cap.

export const apifyConfigured = () => !!process.env.APIFY_API_TOKEN?.trim()

export class ApifyError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function runActor(actor: string, input: Record<string, unknown>, opts: { maxItems: number; capUsd: number; timeoutSec?: number }): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_API_TOKEN?.trim()
  if (!token) throw new ApifyError('Not switched on', 503)
  const wait = Math.max(30, Math.min(200, opts.timeoutSec ?? 120))
  // The actor id is "owner/name" in the store and "owner~name" in the API
  const url = `https://api.apify.com/v2/acts/${actor.replace('/', '~')}/run-sync-get-dataset-items?maxItems=${opts.maxItems}&maxTotalChargeUsd=${opts.capUsd.toFixed(3)}&timeout=${wait}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout((wait + 20) * 1000),
  })
  if (!res.ok) {
    const detail = await res.text().then(t => t.slice(0, 300)).catch(() => '')
    console.error('[engagement] Apify', actor, res.status, detail)
    throw new ApifyError(`${actor} returned ${res.status}`, res.status)
  }
  const rows = (await res.json()) as unknown
  return Array.isArray(rows) ? rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : []
}

/** The first non-empty string among these keys (case and nesting are not trusted). */
export function str(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return null
}

export function num(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  }
  return null
}
