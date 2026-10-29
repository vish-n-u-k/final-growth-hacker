import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { ACTOR as LINKEDIN_ACTOR } from '@/lib/leads/linkedin-leads'
import { ACTOR_FB, ACTOR_IG } from '@/lib/leads/social-check'
import { capLimit } from './limit'

// Runs an Apify actor (GrowJin's APIFY_API_TOKEN, as the other Apify calls) and returns its raw
// dataset items. Waits up to ~60 s; a longer run comes back as { run_id, status: 'RUNNING' } and is
// picked up by calling again with that run_id. Run ids are kept per brand, so only the brand that
// started a run can read it.

const BASE = 'https://api.apify.com/v2'

// Our configured actors, and the input field each one reads as its max results
const ALIASES: Record<string, { id: string; maxField: string }> = {
  linkedin: { id: LINKEDIN_ACTOR, maxField: 'totalResults' },
  instagram: { id: ACTOR_IG, maxField: 'resultsLimit' },
  facebook: { id: ACTOR_FB, maxField: 'resultsLimit' },
}

const RUNS_KEY = 'mcp:apify-runs'
type RunsDoc = { runs: { id: string; actor: string; limit: number; at: string }[] }

type Run = { id?: string; status?: string; statusMessage?: string | null; defaultDatasetId?: string; usageTotalUsd?: number }

async function call<T>(path: string, init: RequestInit = {}): Promise<{ ok: true; data: T; headers: Headers } | { ok: false; error: string; status: number }> {
  const token = process.env.APIFY_API_TOKEN?.trim()
  if (!token) return { ok: false, error: 'Apify is not set up on this server (APIFY_API_TOKEN).', status: 0 }
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(90_000),
    })
    const text = await res.text()
    let json: unknown = text
    try { json = JSON.parse(text) } catch { /* keep the text */ }
    if (!res.ok) {
      // Apify says why in { error: { type, message } }
      const e = (json as { error?: { type?: string; message?: string } })?.error
      return { ok: false, error: `Apify ${res.status}: ${e?.message ?? (typeof json === 'string' ? json.slice(0, 300) : 'request refused')}${e?.type ? ` (${e.type})` : ''}`, status: res.status }
    }
    return { ok: true, data: json as T, headers: res.headers }
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return { ok: false, error: timedOut ? 'Apify did not answer in time. Try again.' : 'Could not reach Apify. Try again in a minute.', status: 0 }
  }
}

/** The run's state: its dataset items once it succeeded, an error when it failed, else RUNNING. */
async function answer(run: Run, limit: number) {
  const status = run.status ?? 'UNKNOWN'
  const base = { run_id: run.id, status, cost_usd: run.usageTotalUsd ?? null }
  if (status === 'SUCCEEDED') {
    if (!run.defaultDatasetId) return { ...base, total: 0, items: [] }
    const items = await call<unknown[]>(`/datasets/${run.defaultDatasetId}/items?clean=1&limit=${limit}`)
    if (!items.ok) return { ...base, error: items.error }
    const total = Number(items.headers.get('x-apify-pagination-total'))
    return { ...base, total: Number.isFinite(total) ? total : items.data.length, items: items.data }
  }
  if (['FAILED', 'ABORTED', 'TIMED-OUT', 'TIMING-OUT', 'ABORTING'].includes(status)) {
    return { ...base, error: `Apify run ${status}${run.statusMessage ? `: ${run.statusMessage}` : ''}` }
  }
  return { ...base, status: 'RUNNING', note: 'Still running. Call apify again with { "run_id": "' + run.id + '" } to get the results.' }
}

export async function apify(brandId: string, args: { actor?: unknown; input?: unknown; limit?: unknown; run_id?: unknown }) {
  const runId = typeof args.run_id === 'string' ? args.run_id.trim() : ''

  // Picking up an earlier run
  if (runId) {
    const mine = (await getSnapshot<RunsDoc>(brandId, RUNS_KEY))?.runs?.find(r => r.id === runId)
    if (!mine) return { error: `No Apify run ${runId} was started for this brand.` }
    const r = await call<{ data: Run }>(`/actor-runs/${encodeURIComponent(runId)}?waitForFinish=50`)
    if (!r.ok) return { error: r.error }
    return answer(r.data.data, capLimit(args.limit ?? mine.limit))
  }

  const name = typeof args.actor === 'string' ? args.actor.trim() : ''
  if (!name) return { error: 'actor is required: "linkedin", "instagram", "facebook", or an Apify actor ID such as "apify~instagram-scraper". Or pass run_id to fetch an earlier run.' }
  const alias = ALIASES[name.toLowerCase()]
  const actor = alias?.id ?? name.replace('/', '~')
  if (!/^[\w.-]+~[\w.-]+$/.test(actor) && !/^[A-Za-z0-9]{17}$/.test(actor)) {
    return { error: `"${name}" is not an alias (linkedin, instagram, facebook) or an Apify actor ID ("username~actor-name" or the 17-character ID).` }
  }
  if (args.input !== undefined && (!args.input || typeof args.input !== 'object' || Array.isArray(args.input))) {
    return { error: 'input must be an object: the actor\'s own input, e.g. { "usernames": ["natgeo"] }.' }
  }

  const limit = capLimit(args.limit)
  const input: Record<string, unknown> = { ...((args.input ?? {}) as Record<string, unknown>) }
  if (alias) input[alias.maxField] = limit
  // maxItems also caps what a pay-per-result actor can return (and bill), whatever its input says
  const r = await call<{ data: Run }>(`/acts/${encodeURIComponent(actor)}/runs?waitForFinish=60&maxItems=${limit}`, { method: 'POST', body: JSON.stringify(input) })
  if (!r.ok) return { error: r.error }
  const run = r.data.data
  if (run.id) {
    const runs = (await getSnapshot<RunsDoc>(brandId, RUNS_KEY))?.runs ?? []
    await saveSnapshot(brandId, RUNS_KEY, { runs: [{ id: run.id, actor, limit, at: new Date().toISOString() }, ...runs].slice(0, 200) })
  }
  return { actor, limit_applied: limit, ...(await answer(run, limit)) }
}
