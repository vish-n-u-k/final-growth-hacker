import { dfsRaw } from '@/lib/agents/dataforseo'
import { addUsage, newMeter } from '@/lib/agents/store'
import { capLimit } from './limit'

// Passthrough to any DataForSEO endpoint, through GrowJin's own account. No filtering: the raw answer comes back.

const MAX_TASKS = 10
// Endpoint families whose tasks take a `limit` field (SERP endpoints take `depth` instead)
const LIMIT_FAMILIES = /^(dataforseo_labs|backlinks|domain_analytics|business_data\/business_listings|content_analysis|merchant|app_data)\//

/** The task with `limit` applied: capped where the caller set it, added where the endpoint takes it. */
function withLimit(endpoint: string, task: Record<string, unknown>, limit: number): Record<string, unknown> {
  const t = { ...task }
  const cap = (k: string) => { const n = Number(t[k]); t[k] = Number.isFinite(n) && n > 0 ? Math.min(n, limit) : limit }
  if ('depth' in t || endpoint.startsWith('serp/')) cap('depth')
  if ('limit' in t || LIMIT_FAMILIES.test(endpoint)) cap('limit')
  return t
}

export async function dataforseo(brandId: string, endpoint: string, payload: unknown, limitArg: unknown) {
  const path = endpoint.trim().replace(/^https?:\/\/api\.dataforseo\.com/, '').replace(/^\/?(v3\/)?/, '')
  if (!path || !/^[a-z0-9_/]+$/i.test(path) || path.includes('//')) {
    return { error: 'endpoint must be a DataForSEO v3 path, e.g. "serp/google/organic/live/advanced".' }
  }
  const tasks = Array.isArray(payload) ? payload : payload && typeof payload === 'object' ? [payload] : null
  if (!tasks || !tasks.length || tasks.some(t => !t || typeof t !== 'object' || Array.isArray(t))) {
    return { error: 'payload must be the task object (or an array of task objects) DataForSEO expects for this endpoint.' }
  }
  if (tasks.length > MAX_TASKS) return { error: `At most ${MAX_TASKS} tasks per call.` }

  const limit = capLimit(limitArg)
  const sent = tasks.map(t => withLimit(path, t as Record<string, unknown>, limit))
  const meter = newMeter()
  let r: { status: number; json: unknown }
  try {
    r = await dfsRaw(`/${path}`, sent, meter)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'DataForSEO request failed.' }
  }
  await addUsage(brandId, meter, 'Claude (MCP)').catch(() => {})

  const j = r.json as { status_code?: number; status_message?: string; tasks?: { status_code?: number; status_message?: string }[] } | string
  if (typeof j === 'string' || r.status >= 400 || (j.status_code && j.status_code !== 20000)) {
    const message = typeof j === 'string' ? j.slice(0, 500) : j.status_message ?? `HTTP ${r.status}`
    return { error: `DataForSEO: ${message}`, http_status: r.status, response: j }
  }
  // A task can fail on its own while the call as a whole succeeds
  const failed = (j.tasks ?? []).filter(t => t.status_code !== 20000).map(t => `${t.status_code}: ${t.status_message}`)
  return {
    ...(failed.length === (j.tasks ?? []).length && failed.length ? { error: `DataForSEO task failed: ${failed.join('; ')}` } : {}),
    limit_applied: limit,
    cost_usd: Math.round(meter.dataforseo * 10000) / 10000,
    response: j,
  }
}
