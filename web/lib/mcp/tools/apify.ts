import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { ACTOR as B2B_ACTOR } from '@/lib/leads/linkedin-leads'
import { ACTOR_FB, ACTOR_IG } from '@/lib/leads/social-check'
import { capLimit } from './limit'

// Runs an Apify actor (GrowJin's APIFY_API_TOKEN, as the other Apify calls) and returns its raw
// dataset items. Waits up to ~60 s; a longer run comes back as { run_id, status: 'RUNNING' } and is
// picked up by calling again with that run_id. Run ids are kept per brand, so only the brand that
// started a run can read it. An alias with a fallback actor retries on it when the primary run fails.

const BASE = 'https://api.apify.com/v2'

type Input = Record<string, unknown>

interface ActorConf {
  id: string
  maxField?: string                 // the input field the actor reads as its max results
  listField?: string                // a URL list cut to `limit` (for actors with no max-results field)
  listOf?: 'strings' | 'urls'       // how that actor wants list items: plain strings or { url }
  defaults?: Input                  // set when the caller leaves them out
  priceUsd: number                  // the actor's listed price per result
  capUsd: number                    // most one run may ever charge, whatever the limit
  minMaxItems?: number              // some actors refuse a smaller max-results field / maxItems; the answer still has `limit` items
}
interface Alias extends ActorConf {
  fallback?: ActorConf & { input: (primary: Input, limit: number) => Input; note?: string }
  deprecated?: string
}

// Field names come from each actor's input schema (GET /v2/actor-builds/{build} → inputSchema).
// A run's cost cap (Apify's maxTotalChargeUsd) is the price of `limit` results plus a margin, never
// above capUsd (sized for limit 50); MCP_APIFY_CAP_<ALIAS> (e.g. MCP_APIFY_CAP_META_ADS=0.05) overrides capUsd.
// A cap above what's left of the account's monthly usage makes Apify refuse the run (402).
const B2B: Alias = { id: B2B_ACTOR, maxField: 'totalResults', priceUsd: 0.002, capUsd: 0.2 }
const ALIASES: Record<string, Alias> = {
  b2b_database: B2B,
  linkedin: { ...B2B, deprecated: 'The "linkedin" alias is now "b2b_database" and will be removed.' },
  instagram: { id: ACTOR_IG, maxField: 'resultsLimit', priceUsd: 0.012, capUsd: 0.65 },
  facebook: { id: ACTOR_FB, maxField: 'resultsLimit', priceUsd: 0.01, capUsd: 0.5 },
  // $0.008 a company
  linkedin_company: { id: 'dev_fusion~Linkedin-Company-Scraper', listField: 'profileUrls', listOf: 'strings', priceUsd: 0.008, capUsd: 0.45 },
  // $0.0075 a profile; reads Google results, never logs into LinkedIn
  linkedin_people: {
    id: 'themineworks~linkedin-employees', maxField: 'maxResults', priceUsd: 0.0075, capUsd: 0.4,
    defaults: { proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['GOOGLE_SERP'] } },
  },
  // $0.00075 an ad. It refuses a `count` under 10 ("Maximum charged results… at least 10"), so it's
  // asked for 10 and the answer is cut to `limit`.
  // The fallback is $0.0058 an ad and takes startUrls / resultsLimit / activeStatus.
  meta_ads: {
    id: 'curious_coder~facebook-ads-library-scraper', maxField: 'count', listField: 'urls', listOf: 'urls', priceUsd: 0.00075, capUsd: 0.1, minMaxItems: 10,
    fallback: {
      id: 'apify~facebook-ads-scraper', maxField: 'resultsLimit', listField: 'startUrls', listOf: 'urls', priceUsd: 0.0058, capUsd: 0.3,
      input: (p) => {
        const active = p['scrapePageAds.activeStatus']
        return { startUrls: p.urls ?? p.startUrls, ...(active === 'active' || active === 'inactive' ? { activeStatus: active } : {}) }
      },
    },
  },
  // $0.0018 a product (+ $0.0018 when it has a public email). The fallback is $0.011 a launch and
  // reads daily leaderboards only (startDate / endDate, or leaderboard URLs); getDetails adds makers, hunters and websites.
  producthunt: {
    // Emails are what the leads need, so they're looked for unless the caller turns them off
    id: 'maximedupre~product-hunt-scraper', maxField: 'maxNbItemsToScrape', priceUsd: 0.0036, capUsd: 0.2,
    defaults: { target: 'daily', shouldCollectProductDetailsAndEmails: true },
    fallback: {
      id: 'runtime~producthunt-scraper', maxField: 'maxResults', priceUsd: 0.011, capUsd: 0.6,
      input: (p) => {
        const urls = Array.isArray(p.productHuntPageUrls)
          ? p.productHuntPageUrls.map(u => (typeof u === 'string' ? u : (u as { url?: unknown })?.url)).filter((u): u is string => typeof u === 'string' && !!u.trim())
            // A product slug becomes its page
            .map(u => (/^https?:\/\//.test(u) ? u : `https://www.producthunt.com/products/${u.trim()}`))
          : []
        const day = typeof p.startDate === 'string' ? p.startDate : null
        return {
          getDetails: true,
          // Its end date defaults to yesterday, the primary's to the start date
          ...(day ? { startDate: day, endDate: typeof p.endDate === 'string' ? p.endDate : day } : urls.length ? { startUrls: urls.join('\n') } : {}),
        }
      },
      note: 'Fallback actor reads daily leaderboards only (the startDate-endDate range, else yesterday); topics, categories and upvote filters are not applied.',
    },
  },
}
const OTHER_CAP_USD = 0.5   // actors called by ID; MCP_APIFY_CAP_DEFAULT overrides
// Wait for the run this long: with the dataset read after it, the answer must beat the MCP client's 60 s timeout
const WAIT_SECS = 45

function capFor(alias: string | null, conf: ActorConf | null, limit: number, isFallback = false): number {
  const env = process.env[`MCP_APIFY_CAP_${(alias ?? 'DEFAULT').toUpperCase()}${isFallback ? '_FALLBACK' : ''}`]
  const n = Number(env)
  const ceiling = env && Number.isFinite(n) && n > 0 ? n : conf ? conf.capUsd : OTHER_CAP_USD
  if (!conf) return ceiling
  return Math.min(ceiling, Math.round((conf.priceUsd * limit * 1.5 + 0.02) * 1000) / 1000)
}

/** The caller's input with our defaults, the URL list in the actor's form and cut to `limit`, and the max-results field set. */
function inputFor(conf: ActorConf, given: Input, limit: number): Input {
  const max = Math.max(limit, conf.minMaxItems ?? 0)
  const input: Input = { ...conf.defaults, ...given }
  if (conf.listField && Array.isArray(input[conf.listField])) {
    input[conf.listField] = (input[conf.listField] as unknown[]).slice(0, limit).map(v => {
      const url = typeof v === 'string' ? v : (v as { url?: unknown })?.url
      if (typeof url !== 'string') return v
      return conf.listOf === 'strings' ? url : { ...(typeof v === 'object' ? v : {}), url }
    })
  }
  if (conf.maxField) input[conf.maxField] = max
  return input
}

const RUNS_KEY = 'mcp:apify-runs'
interface RunRecord { id: string; actor: string; limit: number; at: string; alias?: string; input?: Input; fellBack?: boolean; fallbackRunId?: string }
type RunsDoc = { runs: RunRecord[] }

async function saveRun(brandId: string, rec: RunRecord) {
  const runs = ((await getSnapshot<RunsDoc>(brandId, RUNS_KEY))?.runs ?? []).filter(r => r.id !== rec.id)
  await saveSnapshot(brandId, RUNS_KEY, { runs: [rec, ...runs].slice(0, 200) })
}

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
      const error = `Apify ${res.status}: ${e?.message ?? (typeof json === 'string' ? json.slice(0, 300) : 'request refused')}${e?.type ? ` (${e.type})` : ''}`
      console.error('[mcp-apify]', path.split('?')[0], error)
      return { ok: false, error, status: res.status }
    }
    return { ok: true, data: json as T, headers: res.headers }
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    console.error('[mcp-apify]', path.split('?')[0], 'failed:', e)
    return { ok: false, error: timedOut ? 'Apify did not answer in time. Try again.' : 'Could not reach Apify. Try again in a minute.', status: 0 }
  }
}

const FAILED = ['FAILED', 'ABORTED', 'TIMED-OUT', 'TIMING-OUT', 'ABORTING']

/** The run's state: its dataset items once it succeeded, an error when it failed, else RUNNING. */
async function answer(run: Run, limit: number) {
  const status = run.status ?? 'UNKNOWN'
  const base = { run_id: run.id, status, cost_usd: run.usageTotalUsd ?? null }
  if (status === 'SUCCEEDED') {
    if (!run.defaultDatasetId) return { ...base, total: 0, items: [] }
    const items = await call<unknown[]>(`/datasets/${run.defaultDatasetId}/items?clean=1&limit=${limit}`)
    if (!items.ok) return { ...base, error: items.error }
    const header = items.headers.get('x-apify-pagination-total')
    const total = header === null ? NaN : Number(header)
    return { ...base, total: Number.isFinite(total) ? total : items.data.length, items: items.data.slice(0, limit) }
  }
  if (FAILED.includes(status)) {
    return { ...base, error: `Apify run ${status}${run.statusMessage ? `: ${run.statusMessage}` : ''}` }
  }
  return { ...base, status: 'RUNNING', note: 'Still running. Call apify again with { "run_id": "' + run.id + '" } to get the results.' }
}

/** Starts one actor run (waiting up to 60 s) and records it for the brand. */
async function start(brandId: string, actor: string, input: Input, limit: number, capUsd: number, rec: Partial<RunRecord> = {}, minMaxItems = 0) {
  // maxItems / maxTotalChargeUsd cap what the run can return and bill, whatever its input says
  const q = `waitForFinish=${WAIT_SECS}&maxItems=${Math.max(limit, minMaxItems)}&maxTotalChargeUsd=${capUsd.toFixed(3)}`
  const r = await call<{ data: Run }>(`/acts/${encodeURIComponent(actor)}/runs?${q}`, { method: 'POST', body: JSON.stringify(input) })
  if (!r.ok) return r
  const run = r.data.data
  if (run.id) await saveRun(brandId, { id: run.id, actor, limit, at: new Date().toISOString(), ...rec })
  console.log(`[mcp-apify] ${actor}: run ${run.id} ${run.status} (cap $${capUsd.toFixed(3)})`)
  return { ok: true as const, run }
}

/** After the primary actor of `alias` failed: the same request on its fallback actor, or the primary's error. */
async function tryFallback(brandId: string, name: string, alias: Alias, primary: { actor: string; input: Input; error: string }, limit: number) {
  const fb = alias.fallback!
  const cap = capFor(name, fb, limit, true)
  const input = inputFor(fb, fb.input(primary.input, limit), limit)
  console.log(`[mcp-apify] ${name}: ${primary.actor} failed (${primary.error}); trying ${fb.id}`)
  const r = await start(brandId, fb.id, input, limit, cap, { alias: name, fellBack: true }, fb.minMaxItems)
  const failedFrom = { actor: primary.actor, error: primary.error }
  if (!r.ok) {
    // The fallback could not start either: the primary's error is the answer
    return { alias: name, actor_used: primary.actor, error: primary.error, fallback: { actor: fb.id, error: r.error } }
  }
  return { alias: name, actor_used: fb.id, fallback_from: failedFrom, ...(fb.note ? { fallback_note: fb.note } : {}), limit_applied: limit, cost_cap_usd: cap, ...(await answer(r.run, limit)) }
}

export async function apify(brandId: string, args: { actor?: unknown; input?: unknown; limit?: unknown; run_id?: unknown }) {
  const runId = typeof args.run_id === 'string' ? args.run_id.trim() : ''

  // Picking up an earlier run
  if (runId) {
    const mine = (await getSnapshot<RunsDoc>(brandId, RUNS_KEY))?.runs?.find(r => r.id === runId)
    if (!mine) return { error: `No Apify run ${runId} was started for this brand.` }
    const r = await call<{ data: Run }>(`/actor-runs/${encodeURIComponent(runId)}?waitForFinish=${WAIT_SECS}`)
    if (!r.ok) return { error: r.error }
    const limit = capLimit(args.limit ?? mine.limit)
    const alias = mine.alias ? ALIASES[mine.alias] : undefined
    const res = await answer(r.data.data, limit)
    // The primary failed after the first wait: now is when its fallback runs (once)
    if (alias?.fallback && !mine.fellBack && 'error' in res && FAILED.includes(res.status)) {
      await saveRun(brandId, { ...mine, fellBack: true })
      const fb = await tryFallback(brandId, mine.alias!, alias, { actor: mine.actor, input: mine.input ?? {}, error: res.error! }, limit)
      if ('run_id' in fb && fb.run_id) await saveRun(brandId, { ...mine, fellBack: true, fallbackRunId: fb.run_id })
      return fb
    }
    return {
      ...(mine.alias ? { alias: mine.alias } : {}), actor_used: mine.actor, ...res,
      ...(mine.fallbackRunId ? { fallback_run_id: mine.fallbackRunId, note: `This run failed; its fallback is run ${mine.fallbackRunId}.` } : {}),
    }
  }

  const name = typeof args.actor === 'string' ? args.actor.trim() : ''
  const aliases = Object.keys(ALIASES).filter(a => a !== 'linkedin').join(', ')
  if (!name) return { error: `actor is required: an alias (${aliases}) or an Apify actor ID such as "apify~instagram-scraper". Or pass run_id to fetch an earlier run.` }
  const key = name.toLowerCase()
  const alias = ALIASES[key]
  const actor = alias?.id ?? name.replace('/', '~')
  if (!/^[\w.-]+~[\w.-]+$/.test(actor) && !/^[A-Za-z0-9]{17}$/.test(actor)) {
    return { error: `"${name}" is not an alias (${aliases}) or an Apify actor ID ("username~actor-name" or the 17-character ID).` }
  }
  if (args.input !== undefined && (!args.input || typeof args.input !== 'object' || Array.isArray(args.input))) {
    return { error: 'input must be an object: the actor\'s own input, e.g. { "usernames": ["natgeo"] }.' }
  }

  const limit = capLimit(args.limit)
  const given = (args.input ?? {}) as Input
  const input = alias ? inputFor(alias, given, limit) : { ...given }
  const cap = capFor(alias ? key : null, alias ?? null, limit)
  const head = { ...(alias ? { alias: key } : {}), ...(alias?.deprecated ? { deprecated: alias.deprecated } : {}) }

  const r = await start(brandId, actor, input, limit, cap, alias ? { alias: key, input: alias.fallback ? given : undefined } : {}, alias?.minMaxItems)
  if (!r.ok) {
    if (alias?.fallback) return { ...head, ...(await tryFallback(brandId, key, alias, { actor, input: given, error: r.error }, limit)) }
    return { ...head, error: r.error }
  }
  const res = await answer(r.run, limit)
  if (alias?.fallback && 'error' in res && FAILED.includes(res.status)) {
    if (r.run.id) await saveRun(brandId, { id: r.run.id, actor, limit, at: new Date().toISOString(), alias: key, fellBack: true })
    return { ...head, ...(await tryFallback(brandId, key, alias, { actor, input: given, error: res.error! }, limit)) }
  }
  return { ...head, actor_used: actor, limit_applied: limit, cost_cap_usd: cap, ...res }
}
