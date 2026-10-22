// Are the paid data services connected, and how much is left? Shown on the AI Agents page so a
// test run can be judged: real data or demo, and what it cost. Both calls are free (account
// endpoints) and time out quickly; a failure is reported, never thrown.

import { agentsDemo } from './demo'

export interface ServiceStatus {
  demo: boolean
  dataforseo: { configured: boolean; ok: boolean; balance: number | null; error?: string }
  hunter: { configured: boolean; ok: boolean; plan: string | null; left: number | null; total: number | null; error?: string }
}

async function dataForSeo(): Promise<ServiceStatus['dataforseo']> {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) return { configured: false, ok: false, balance: null }
  try {
    const res = await fetch('https://api.dataforseo.com/v3/appendix/user_data', {
      headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}` },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    const j = await res.json().catch(() => null) as {
      status_code?: number; status_message?: string
      tasks?: { status_code?: number; status_message?: string; result?: { money?: { balance?: number } }[] }[]
    } | null
    const t = j?.tasks?.[0]
    if (!res.ok || j?.status_code !== 20000 || t?.status_code !== 20000) {
      return { configured: true, ok: false, balance: null, error: t?.status_message ?? j?.status_message ?? `HTTP ${res.status}` }
    }
    return { configured: true, ok: true, balance: t?.result?.[0]?.money?.balance ?? null }
  } catch (e) {
    return { configured: true, ok: false, balance: null, error: e instanceof Error ? e.message : 'unreachable' }
  }
}

async function hunter(): Promise<ServiceStatus['hunter']> {
  const key = process.env.HUNTER_API_KEY
  if (!key) return { configured: false, ok: false, plan: null, left: null, total: null }
  try {
    const res = await fetch(`https://api.hunter.io/v2/account?${new URLSearchParams({ api_key: key })}`, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
    type Pool = { used?: number; available?: number }
    const j = await res.json().catch(() => null) as {
      data?: { plan_name?: string; requests?: { credits?: Pool; searches?: Pool } }
      errors?: { details?: string }[]
    } | null
    if (!res.ok || !j?.data) return { configured: true, ok: false, plan: null, left: null, total: null, error: j?.errors?.[0]?.details ?? `HTTP ${res.status}` }
    // Newer accounts report one credit pool; older ones report searches
    const pool = j.data.requests?.credits ?? j.data.requests?.searches
    const total = pool?.available ?? null
    const left = total !== null && pool?.used !== undefined ? Math.max(0, total - pool.used) : null
    return { configured: true, ok: true, plan: j.data.plan_name ?? null, left, total }
  } catch (e) {
    return { configured: true, ok: false, plan: null, left: null, total: null, error: e instanceof Error ? e.message : 'unreachable' }
  }
}

export async function serviceStatus(): Promise<ServiceStatus> {
  const [d, h] = await Promise.all([dataForSeo(), hunter()])
  return { demo: agentsDemo(), dataforseo: d, hunter: h }
}

/** "data $0.123 · 4 email lookups" for a run's summary (nothing in demo mode or when free). */
export function costNote(meter: { dataforseo: number; hunter: number }): string | null {
  if (agentsDemo()) return null
  const parts = [
    meter.dataforseo > 0 ? `data $${meter.dataforseo.toFixed(3)}` : null,
    meter.hunter > 0 ? `${meter.hunter} email lookup${meter.hunter === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}
