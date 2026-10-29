import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { ACTOR as LINKEDIN_ACTOR } from '@/lib/leads/linkedin-leads'
import { ACTOR_FB, ACTOR_IG } from '@/lib/leads/social-check'
import { capLimit } from './limit'

// Runs an Apify actor (GrowJin's APIFY_API_TOKEN, as the other Apify calls) and returns its raw
// dataset items. Waits up to ~60 s; a longer run comes back as { run_id, status: 'RUNNING' } and is
// picked up by calling again with that run_id. Run ids are kept per brand, so only the brand that
// started a run can read it.

const BASE = 'https://api.apify.com/v2'

// Our configured actors, and the input field each one reads as its max results. `defaults` fill in what
// the caller left out. `fallback` runs only when the main actor's run fails: it gets the caller's input
// turned into its own fields (`translate`), and the answer says which actor ran (`actor_used`).
type Input = Record<string, unknown>
interface Alias { id: string; maxField: string; defaults?: Input; fallback?: { id: string; maxField: string; translate: (input: Input) => Input } }
const ALIASES: Record<string, Alias> = {
  linkedin: { id: LINKEDIN_ACTOR, maxField: 'totalResults' },
  instagram: { id: ACTOR_IG, maxField: 'resultsLimit' },
  facebook: { id: ACTOR_FB, maxField: 'resultsLimit' },
  // Product Hunt launches with makers, website and public emails. Third-party scrapers, for evaluation:
  // move to the official Product Hunt API once commercial permission is granted.
  producthunt: {
    id: 'maximedupre~product-hunt-scraper',
    maxField: 'maxNbItemsToScrape',
    // Emails are what the leads need; the actor charges per saved row that has one
    defaults: { target: 'daily', shouldCollectProductDetailsAndEmails: true },
    fallback: { id: 'runtime~producthunt-scraper', maxField: 'maxResults', translate: productHuntFallbackInput },
  },
}

/**
 * The primary Product Hunt actor's input in the fallback's fields: a daily date range stays a date range,
 * Product Hunt URLs become its start URLs, and product pages are always read (makers, websites, socials).
 * Weekly, monthly, yearly, category and topic choices have no equivalent there, so it reads the daily
 * leaderboard for the given dates (or its default, yesterday).
 */
function productHuntFallbackInput(input: Input): Input {
  const out: Input = { getDetails: true }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const urls = Array.isArray(input.productHuntPageUrls)
    ? input.productHuntPageUrls.map(u => (typeof u === 'string' ? u : (u as { url?: string })?.url)).filter((u): u is string => !!u)
      .map(u => (/^https?:\/\//.test(u) ? u : `https://www.producthunt.com/products/${u}`))
    : []
  if (str(input.startDate)) {
    out.startDate = str(input.startDate)
    if (str(input.endDate)) out.endDate = str(input.endDate)
  } else if (urls.length) out.startUrls = urls.join('\n')
  return out
}

const RUNS_KEY = 'mcp:apify-runs'
// alias + input: kept for a run that may still fail later, so picking it up can start the fallback
type RunsDoc = { runs: { id: string; actor: string; limit: number; at: string; alias?: string; input?: Input; fallback?: boolean }[] }

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

const FAILED = ['FAILED', 'ABORTED', 'TIMED-OUT', 'TIMING-OUT', 'ABORTING']

/** Starts a run (waits up to ~60 s) and remembers it for this brand. */
async function start(brandId: string, actor: string, input: Input, limit: number, memo: { alias?: string; fallback?: boolean } = {}) {
  // maxItems also caps what a pay-per-result actor can return (and bill), whatever its input says
  const r = await call<{ data: Run }>(`/acts/${encodeURIComponent(actor)}/runs?waitForFinish=60&maxItems=${limit}`, { method: 'POST', body: JSON.stringify(input) })
  if (!r.ok) return { ok: false as const, error: r.error }
  const run = r.data.data
  if (run.id) {
    const runs = (await getSnapshot<RunsDoc>(brandId, RUNS_KEY))?.runs ?? []
    await saveSnapshot(brandId, RUNS_KEY, { runs: [{ id: run.id, actor, limit, at: new Date().toISOString(), ...(memo.alias ? { alias: memo.alias, input } : {}), ...(memo.fallback ? { fallback: true } : {}) }, ...runs].slice(0, 200) })
  }
  return { ok: true as const, run }
}

/** An alias's fallback actor, run because the main one failed (`why`). */
async function runFallback(brandId: string, name: string, alias: Alias, input: Input, limit: number, why: string) {
  const fb = alias.fallback!
  const fbInput = { ...fb.translate(input), [fb.maxField]: limit }
  const r = await start(brandId, fb.id, fbInput, limit, { fallback: true })
  if (!r.ok) return { actor: fb.id, actor_used: fb.id, limit_applied: limit, primary_error: why, error: r.error }
  return { actor: fb.id, actor_used: fb.id, limit_applied: limit, primary_error: why, fallback_input: fbInput, ...(await answer(r.run, limit)) }
}

export async function apify(brandId: string, args: { actor?: unknown; input?: unknown; limit?: unknown; run_id?: unknown }) {
  const runId = typeof args.run_id === 'string' ? args.run_id.trim() : ''

  // Picking up an earlier run
  if (runId) {
    const mine = (await getSnapshot<RunsDoc>(brandId, RUNS_KEY))?.runs?.find(r => r.id === runId)
    if (!mine) return { error: `No Apify run ${runId} was started for this brand.` }
    const r = await call<{ data: Run }>(`/actor-runs/${encodeURIComponent(runId)}?waitForFinish=50`)
    if (!r.ok) return { error: r.error }
    const limit = capLimit(args.limit ?? mine.limit)
    const run = r.data.data
    // The main actor failed after all: its fallback runs now
    const alias = mine.alias ? ALIASES[mine.alias] : undefined
    if (alias?.fallback && !mine.fallback && FAILED.includes(run.status ?? '')) {
      return runFallback(brandId, mine.alias!, alias, mine.input ?? {}, limit, `Apify run ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ''}`)
    }
    return { ...(alias?.fallback || mine.fallback ? { actor_used: mine.actor } : {}), ...(await answer(run, limit)) }
  }

  const name = typeof args.actor === 'string' ? args.actor.trim() : ''
  const names = Object.keys(ALIASES).join(', ')
  if (!name) return { error: `actor is required: ${names}, or an Apify actor ID such as "apify~instagram-scraper". Or pass run_id to fetch an earlier run.` }
  const key = name.toLowerCase()
  const alias = ALIASES[key]
  const actor = alias?.id ?? name.replace('/', '~')
  if (!/^[\w.-]+~[\w.-]+$/.test(actor) && !/^[A-Za-z0-9]{17}$/.test(actor)) {
    return { error: `"${name}" is not an alias (${names}) or an Apify actor ID ("username~actor-name" or the 17-character ID).` }
  }
  if (args.input !== undefined && (!args.input || typeof args.input !== 'object' || Array.isArray(args.input))) {
    return { error: 'input must be an object: the actor\'s own input, e.g. { "usernames": ["natgeo"] }.' }
  }

  const limit = capLimit(args.limit)
  const input: Input = { ...(alias?.defaults ?? {}), ...((args.input ?? {}) as Input) }
  if (alias) input[alias.maxField] = limit
  const r = await start(brandId, actor, input, limit, alias?.fallback ? { alias: key } : {})
  // The main actor wouldn't start, or its run failed: the fallback, when the alias has one
  if (alias?.fallback) {
    if (!r.ok) return runFallback(brandId, key, alias, input, limit, r.error)
    if (FAILED.includes(r.run.status ?? '')) return runFallback(brandId, key, alias, input, limit, `Apify run ${r.run.status}${r.run.statusMessage ? `: ${r.run.statusMessage}` : ''}`)
    return { actor, actor_used: actor, limit_applied: limit, ...(await answer(r.run, limit)) }
  }
  if (!r.ok) return { error: r.error }
  return { actor, limit_applied: limit, ...(await answer(r.run, limit)) }
}
