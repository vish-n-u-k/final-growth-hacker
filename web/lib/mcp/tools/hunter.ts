import { hunterFetch } from '@/lib/agents/hunter'
import { addUsage, newMeter } from '@/lib/agents/store'
import { capLimit } from './limit'

// Passthrough to Hunter.io (GrowJin's key). Returns Hunter's raw answer.

const ACTIONS = ['domain-search', 'email-finder', 'email-verifier'] as const
type Action = (typeof ACTIONS)[number]

export async function hunter(brandId: string, action: string, params: unknown, limitArg: unknown) {
  if (!ACTIONS.includes(action as Action)) return { error: `action must be one of: ${ACTIONS.join(', ')}.` }
  if (!process.env.HUNTER_API_KEY) return { error: 'Hunter is not set up on this server (HUNTER_API_KEY).' }
  if (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) {
    return { error: 'params must be an object, e.g. { "domain": "example.com" }.' }
  }

  // Values as Hunter's query string; the key is always ours, never the caller's
  const q: Record<string, string> = {}
  for (const [k, v] of Object.entries((params ?? {}) as Record<string, unknown>)) {
    if (k === 'api_key' || v === null || v === undefined || v === '') continue
    q[k] = Array.isArray(v) ? v.join(',') : String(v)
  }
  const limit = capLimit(limitArg ?? q.limit)
  if (action === 'domain-search') q.limit = String(limit)

  const res = await hunterFetch(action, q)
  if (!res) return { error: 'Could not reach Hunter. Try again in a minute.' }
  const json = await res.json().catch(() => null) as { data?: Record<string, unknown>; errors?: { id?: string; code?: number; details?: string }[] } | null

  if (!res.ok && res.status !== 202) {
    const details = json?.errors?.map(e => e.details ?? e.id).filter(Boolean).join('; ')
    const why = res.status === 429 ? 'no credits left this period (usage limit reached)' : details || `HTTP ${res.status}`
    return { error: `Hunter: ${why}`, http_status: res.status, response: json }
  }

  // Credits: 1 per email returned (0 for a miss), as the Lead Agent counts them
  const emails = action === 'domain-search' ? (Array.isArray(json?.data?.emails) ? json!.data!.emails.length : 0) : action === 'email-finder' && json?.data?.email ? 1 : 0
  if (emails) await addUsage(brandId, { ...newMeter(), hunter: emails }, 'Claude (MCP)').catch(() => {})

  return {
    ...(res.status === 202 ? { note: 'Hunter is still verifying this address. Call again in a minute for the result.' } : {}),
    ...(action === 'domain-search' ? { limit_applied: limit } : {}),
    response: json,
  }
}
