// Lead Finder's search. Claude runs the Lead Engine prompt (engine-prompt.ts) with the dataforseo, hunter
// and apify tools (the same functions the MCP server offers) and answers with the leads as JSON, which
// are saved into the Lead Agent's list (lib/agents/store.ts) for Lead Finder's page.
//
// A search takes minutes, longer than one request may run, so it's a job saved in signal_snapshots
// ('agent:lead-engine'): each request advances it for up to ~4 minutes (advanceEngine), saving the
// conversation after every turn, and the page's status poll starts the next stretch. Spending is
// capped in code: when a cap is reached, Claude is told to stop and answer with what it has.

import Anthropic from '@anthropic-ai/sdk'
import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { TOOLS } from '@/lib/mcp/tool-registry'
import { dataforseo } from '@/lib/mcp/tools/dataforseo'
import { hunter } from '@/lib/mcp/tools/hunter'
import { apify } from '@/lib/mcp/tools/apify'
import { anthropicCostUsd } from '@/lib/ai/pricing'
import { logAnthropicUsage, withAIContext } from '@/lib/ai/client'
import { domainOf, idOf, loadBrandContext, parseJsonLoose } from '@/lib/agents/context'
import { leadFallback } from '@/lib/agents/lead-agent'
import { readLeadData, updateLeadData, type EngineInputs, type EngineRunInfo, type Lead, type MaybeLead } from '@/lib/agents/store'
import { alreadyContacted } from '@/lib/leads/contacted'
import { ENGINE_PROMPT } from './engine-prompt'

const MODEL = 'claude-opus-5-5'
const JOB_KEY = 'agent:lead-engine'
const MAX_TURNS = 40
const MAX_RUN_MS = 30 * 60_000           // a search that runs longer than this is wrapped up
const RESULT_CHARS = 6000                // one tool result as Claude sees it (the rest is cut, with a note)
const STEP_MS = 230_000                  // one request's stretch of work (routes allow 300 s)
// Spending caps per search. Tools: about $1 per 10 leads (the prompt's budget), at least $1.
// AI: Claude's own tokens. Hunter: credits are scarce (50 a month on the free plan).
const toolCap = (leads: number) => Number(process.env.LEAD_ENGINE_TOOL_CAP_USD) || Math.max(1, leads * 0.1)
const AI_CAP = Number(process.env.LEAD_ENGINE_AI_CAP_USD) || 3
const hunterCap = (leads: number) => Number(process.env.LEAD_ENGINE_HUNTER_CAP) || Math.max(10, leads * 2)

const ENGINE_TOOLS = ['dataforseo', 'hunter', 'apify']

export interface EngineLogLine { at: string; text: string }
export interface EngineJob {
  id: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  startedAt: string
  updatedAt: string
  lockUntil?: number               // another request is advancing it until then
  leadCount: number
  turns: number
  toolCalls: number
  aiUsd: number
  toolUsd: number
  hunterCredits: number
  wrapUp?: string                  // why Claude was told to stop and answer (a cap, or the user)
  messages: Anthropic.MessageParam[]
  log: EngineLogLine[]
  added?: number
  error?: string
}

/** What the page sees of a search (no conversation). */
export interface EngineStatus {
  id: string
  status: EngineJob['status']
  startedAt: string
  updatedAt: string
  turns: number
  toolCalls: number
  costUsd: number
  log: EngineLogLine[]
  added?: number
  error?: string
  wrapUp?: string
}

export const readJob = (brandId: string) => getSnapshot<EngineJob>(brandId, JOB_KEY)
const saveJob = (brandId: string, job: EngineJob) => saveSnapshot(brandId, JOB_KEY, { ...job, updatedAt: new Date().toISOString() })

export function statusOf(job: EngineJob | null): EngineStatus | null {
  if (!job) return null
  return {
    id: job.id, status: job.status, startedAt: job.startedAt, updatedAt: job.updatedAt, turns: job.turns, toolCalls: job.toolCalls,
    costUsd: Math.round((job.aiUsd + job.toolUsd) * 100) / 100, log: job.log.slice(-8), added: job.added, error: job.error, wrapUp: job.wrapUp,
  }
}

const say = (job: EngineJob, text: string) => { job.log = [...job.log, { at: new Date().toISOString(), text }].slice(-60) }

// ── Starting ──────────────────────────────────────────────────────────────────

/** Starts a search with the brief and filters saved in Settings. Returns the running job, or why not. */
export async function startEngine(brandId: string): Promise<{ job?: EngineJob; error?: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { error: 'Brand not found.' }
  const data = (await readLeadData(brandId)) ?? leadFallback(b)()
  const f: EngineInputs | null | undefined = data.settings.engine
  if (!f || (!f.brief.trim() && !f.industry.trim())) return { error: 'Tell Lead Finder who you’re looking for first (Settings).' }
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'The AI isn’t set up on this server (ANTHROPIC_API_KEY).' }
  const running = await readJob(brandId)
  if (running?.status === 'running' && Date.now() - Date.parse(running.updatedAt) < 10 * 60_000) return { job: running }

  // Domains already in the list (any status), so the search doesn't spend on them again
  const known = [...new Set(data.leads.map(l => l.website ? domainOf(l.website) : '').filter(Boolean))].slice(0, 300)
  const leadCount = Math.max(1, Math.min(50, Math.round(f.leadCount) || 10))
  const input = {
    brand: {
      name: b.name, website: b.websiteUrl, description: b.summary ?? b.usp ?? '', offer: b.usp ?? '',
      competitors: b.competitors.map(c => (c.domain ? `${c.name} (${c.domain})` : c.name)),
    },
    filters: { industry: f.industry, location: f.location, company_size: f.companySize, contact_role: f.contactRole, lead_count: leadCount },
    brief: f.brief,
    already_known: known,
    today: new Date().toISOString().slice(0, 10),
  }
  const now = new Date().toISOString()
  const job: EngineJob = {
    id: idOf(`${brandId}:${now}`), status: 'running', startedAt: now, updatedAt: now, leadCount,
    turns: 0, toolCalls: 0, aiUsd: 0, toolUsd: 0, hunterCredits: 0, log: [],
    messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
  }
  say(job, 'Reading your brief and working out what a good lead looks like')
  await saveJob(brandId, job)
  return { job }
}

/** The user stopped it: Claude answers with what it has on its next turn. */
export async function stopEngine(brandId: string) {
  const job = await readJob(brandId)
  if (!job || job.status !== 'running') return job
  job.wrapUp = 'You stopped the search'
  say(job, 'Stopping: answering with what was found so far')
  await saveJob(brandId, job)
  return job
}

// ── Tools ─────────────────────────────────────────────────────────────────────

function engineTools(): Anthropic.Tool[] {
  const list = TOOLS.filter(t => ENGINE_TOOLS.includes(t.name))
  return list.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    // One cache breakpoint after the tools: the system prompt and tools are the same every turn
    ...(i === list.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))
}

// Fields of search and page results Claude never needs (layout, images, tracking)
const NOISE = new Set(['check_url', 'xpath', 'rectangle', 'images', 'highlighted', 'about_this_result', 'amp_version', 'cache_url', 'se_domain', 'spell', 'refinement_chips', 'item_types', 'pre_snippet', 'extended_snippet', 'timestamp', 'time', 'api_version', 'path'])
function compact(v: unknown): unknown {
  if (Array.isArray(v)) {
    const out = v.map(compact).filter(x => x !== undefined)
    return out.length ? out : undefined
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (NOISE.has(k)) continue
      const c = compact(x)
      if (c !== undefined) out[k] = c
    }
    return Object.keys(out).length ? out : undefined
  }
  if (v === null || v === '') return undefined
  return v
}

/** One line for the page on what a tool call does. */
function describe(name: string, input: Record<string, unknown>): string {
  if (name === 'dataforseo') {
    const ep = String(input.endpoint ?? '')
    const task = (Array.isArray(input.payload) ? input.payload[0] : input.payload) as Record<string, unknown> | undefined
    const what = String(task?.keyword ?? task?.url ?? task?.target ?? '')
    if (/serp\/google\/maps/.test(ep)) return `Searching Google Maps: “${what}”`
    if (/serp\//.test(ep)) return `Searching Google: “${what}”`
    if (/instant_pages/.test(ep)) return `Checking the site is live: ${what}`
    if (/content_parsing/.test(ep)) return `Reading a page: ${what}`
    return `DataForSEO: ${ep}`
  }
  if (name === 'hunter') {
    const p = (input.params ?? {}) as Record<string, unknown>
    return `Hunter ${String(input.action ?? '')}: ${String(p.domain ?? p.email ?? p.company ?? '')}`
  }
  if (input.run_id) return 'Collecting an Apify run'
  return `Apify ${String(input.actor ?? '')}`
}

async function runTool(brandId: string, name: string, input: Record<string, unknown>): Promise<{ result: unknown; usd: number; hunter: number }> {
  if (name === 'dataforseo') {
    const r = await dataforseo(brandId, String(input.endpoint ?? ''), input.payload, input.limit) as { cost_usd?: number }
    return { result: r, usd: Number(r.cost_usd) || 0, hunter: 0 }
  }
  if (name === 'hunter') {
    const r = await hunter(brandId, String(input.action ?? ''), input.params, input.limit) as { response?: { data?: { emails?: unknown[]; email?: string } } }
    const d = r.response?.data
    const credits = input.action === 'domain-search' ? (Array.isArray(d?.emails) ? d!.emails!.length : 0) : input.action === 'email-finder' && d?.email ? 1 : 0
    return { result: r, usd: 0, hunter: credits }
  }
  if (name === 'apify') {
    const r = await apify(brandId, { actor: input.actor, input: input.input, limit: input.limit, run_id: input.run_id }) as { cost_usd?: number | null }
    return { result: r, usd: Number(r.cost_usd) || 0, hunter: 0 }
  }
  return { result: { error: `Unknown tool ${name}` }, usd: 0, hunter: 0 }
}

/** The tool's answer as Claude sees it: empty and layout fields dropped, cut to RESULT_CHARS. */
function asText(result: unknown): string {
  const text = JSON.stringify(compact(result) ?? {})
  return text.length <= RESULT_CHARS ? text
    : `${text.slice(0, RESULT_CHARS)}… [cut: ${text.length.toLocaleString('en')} characters in all. Ask for fewer results or a narrower call if you need more.]`
}

/** The conversation with one cache breakpoint on its last block (not saved: breakpoints are per request). */
function withBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out = messages.slice()
  const last = out[out.length - 1]
  const content: Anthropic.ContentBlockParam[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content]
  const end = content.length - 1
  content[end] = { ...content[end], cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam
  out[out.length - 1] = { ...last, content }
  return out
}

// ── Running ───────────────────────────────────────────────────────────────────

/**
 * Advances a running search for up to STEP_MS: Claude's turns and its tool calls, saved after every
 * turn. Another request already advancing it (its lock) makes this a no-op. Returns the job.
 */
export async function advanceEngine(brandId: string, stepMs = STEP_MS): Promise<EngineJob | null> {
  const job = await readJob(brandId)
  if (!job || job.status !== 'running') return job
  if (job.lockUntil && job.lockUntil > Date.now()) return job
  const until = Date.now() + stepMs
  job.lockUntil = until + 60_000
  await saveJob(brandId, job)

  return withAIContext({ brandId, moduleType: 'lead-engine' }, async () => {
    const client = new Anthropic()
    const tools = engineTools()
    try {
      while (job.status === 'running' && Date.now() < until - 25_000) {
        // A cap reached, or stopped by the user: one last turn without tools, for the answer
        const cap = job.wrapUp ? null
          : job.toolUsd >= toolCap(job.leadCount) ? `The tool budget ($${toolCap(job.leadCount).toFixed(2)}) is used up`
          : job.aiUsd >= AI_CAP ? `The AI budget ($${AI_CAP.toFixed(2)}) is used up`
          : job.hunterCredits >= hunterCap(job.leadCount) ? `${hunterCap(job.leadCount)} Hunter credits are used`
          : job.turns >= MAX_TURNS ? `The search reached ${MAX_TURNS} steps`
          : Date.now() - Date.parse(job.startedAt) > MAX_RUN_MS ? 'The search ran for 30 minutes'
          : null
        if (cap) { job.wrapUp = cap; say(job, `${cap}: finishing with what was found`) }
        const messages = job.messages.slice()
        if (job.wrapUp) {
          const note = `${job.wrapUp}. Stop calling tools now and give your final answer (only the JSON object of section 8) with what you have. Say in the summary that the search stopped early and why.`
          const last = messages[messages.length - 1]
          // Added to the last user turn (after its tool results), or as its own turn
          if (last.role === 'user' && Array.isArray(last.content)) messages[messages.length - 1] = { ...last, content: [...last.content, { type: 'text', text: note }] }
          else messages.push({ role: 'user', content: note })
        }

        const res = await client.messages.create({
          model: MODEL,
          max_tokens: 16000,
          system: [{ type: 'text', text: ENGINE_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools,
          tool_choice: job.wrapUp ? { type: 'none' } : { type: 'auto' },
          messages: withBreakpoint(messages),
        })
        job.turns += 1
        job.aiUsd += anthropicCostUsd(MODEL, res.usage)
        logAnthropicUsage('lead-engine', res, brandId)
        if (job.wrapUp) job.messages = messages
        job.messages = [...job.messages, { role: 'assistant', content: res.content as unknown as Anthropic.ContentBlockParam[] }]

        if (res.stop_reason === 'refusal') {
          job.status = 'failed'; job.error = 'The AI declined to run this search. Try rewording the brief.'
          break
        }
        if (res.stop_reason === 'pause_turn') { await saveJob(brandId, job); continue }
        const calls = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
        if (res.stop_reason === 'tool_use' && calls.length && !job.wrapUp) {
          for (const c of calls) say(job, describe(c.name, (c.input ?? {}) as Record<string, unknown>))
          await saveJob(brandId, job)
          const done = await Promise.all(calls.map(async c => {
            try {
              const r = await runTool(brandId, c.name, (c.input ?? {}) as Record<string, unknown>)
              return { c, ...r, error: false }
            } catch (e) {
              return { c, result: { error: e instanceof Error ? e.message : 'The tool failed.' }, usd: 0, hunter: 0, error: true }
            }
          }))
          job.toolCalls += done.length
          job.toolUsd += done.reduce((n, d) => n + d.usd, 0)
          job.hunterCredits += done.reduce((n, d) => n + d.hunter, 0)
          job.messages = [...job.messages, {
            role: 'user',
            content: done.map(d => ({ type: 'tool_result' as const, tool_use_id: d.c.id, content: asText(d.result), ...(d.error ? { is_error: true } : {}) })),
          }]
          await saveJob(brandId, job)
          continue
        }

        // The answer
        const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map(c => c.text).join('\n')
        const answer = parseJsonLoose<EngineAnswer>(text, 'object')
        if (!answer || !Array.isArray(answer.leads)) {
          job.status = 'failed'
          job.error = res.stop_reason === 'max_tokens' ? 'The answer was too long and got cut off. Ask for fewer leads.' : 'The search finished without a list of leads the app could read.'
          await saveRun(brandId, job, null)
          break
        }
        say(job, 'Saving the leads to your list')
        job.added = await saveAnswer(brandId, job, answer)
        job.status = job.wrapUp === 'You stopped the search' ? 'stopped' : 'done'
        say(job, job.added ? `Done: ${job.added} new lead${job.added === 1 ? '' : 's'}` : 'Done: no new leads this time')
      }
    } catch (e) {
      // A failed AI call: kept running, and the next stretch tries again, unless it keeps failing
      const msg = e instanceof Anthropic.APIError ? `AI error ${e.status}: ${e.message}` : e instanceof Error ? e.message : 'failed'
      console.error('[lead-engine]', msg)
      const failures = job.log.filter(l => l.text.startsWith('A problem')).length
      say(job, `A problem: ${msg.slice(0, 160)}`)
      if (failures >= 2 || (e instanceof Anthropic.APIError && e.status && e.status < 500 && e.status !== 429)) {
        job.status = 'failed'; job.error = msg
        await saveRun(brandId, job, null)
      }
    }
    job.lockUntil = 0
    await saveJob(brandId, job)
    return job
  })
}

// ── Saving the answer ─────────────────────────────────────────────────────────

interface EngineLead {
  company?: string; what_it_does?: string; website?: string; location?: string; company_size?: string
  contact_name?: string; contact_title?: string; email?: string; email_status?: string; linkedin?: string
  socials?: { platform?: string; url?: string; activity?: string }[]
  signals?: Record<string, unknown>
  rating?: string; why?: string
  sources?: Record<string, unknown>
  not_checked?: string[]
}
interface EngineAnswer {
  profile?: EngineRunInfo['profile']
  leads: EngineLead[]
  dropped?: { company?: string; reason?: string }[]
  tool_issues?: string[]
  summary?: string
}

// The app's rating scale, best first, as the 1-10 score the list sorts by. Neutral or better is kept.
const RATINGS: [RegExp, number][] = [
  [/^very likely/i, 10], [/^likely/i, 9], [/^leaning likely/i, 8], [/^uncertain \(high\)/i, 7], [/^neutral/i, 6],
  [/^uncertain \(low\)/i, 5], [/^leaning unlikely/i, 4], [/^unlikely/i, 3], [/^very unlikely/i, 2],
]
const scoreOf = (rating?: string) => RATINGS.find(([re]) => re.test((rating ?? '').trim()))?.[1] ?? 5
const KEEP_FROM = 6
const validEmail = (e?: string) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const EMAIL_VIA: Record<string, string> = {
  verified: 'verified', found: 'found, not verified', guessed: 'guessed from the company’s email pattern, check it', generic: 'a shared inbox, no named person found',
}

async function saveAnswer(brandId: string, job: EngineJob, a: EngineAnswer): Promise<number> {
  const b = await loadBrandContext(brandId)
  if (!b) return 0
  const now = new Date().toISOString()
  const data = (await readLeadData(brandId)) ?? leadFallback(b)()
  const have = new Set([...data.leads.map(l => l.id), ...data.leads.filter(l => l.website).map(l => domainOf(l.website))])
  const emails = a.leads.map(l => str(l.email).toLowerCase()).filter(validEmail)
  const contacted = await alreadyContacted(brandId, emails).catch(() => new Set<string>())

  const fresh: Lead[] = []
  const maybe: MaybeLead[] = []
  for (const l of a.leads) {
    const company = clip(str(l.company), 80)
    const site = str(l.website)
    const domain = site ? domainOf(site) : ''
    if (!company && !domain) continue
    const id = idOf(domain ? `https://${domain}` : `engine:${company.toLowerCase()}`)
    if (have.has(id) || (domain && have.has(domain))) continue
    const email = str(l.email).toLowerCase()
    if (validEmail(email) && contacted.has(email)) continue
    have.add(id); if (domain) have.add(domain)

    const rating = clip(str(l.rating), 40) || 'Uncertain (Low)'
    const score = scoreOf(rating)
    const sources = l.sources ?? {}
    const socials = (Array.isArray(l.socials) ? l.socials : []).filter(s => s && (s.url || s.activity))
    const signals = l.signals && typeof l.signals === 'object' ? Object.entries(l.signals).filter(([, v]) => str(v)) : []
    const url = site ? (/^https?:\/\//.test(site) ? site : `https://${domain}`) : str(l.linkedin) || `https://www.google.com/search?q=${encodeURIComponent(company)}`
    const why = clip(str(l.why), 400)
    const snippet = [str(l.what_it_does), str(l.location), str(l.company_size)].filter(Boolean).join(' · ')

    if (score < KEEP_FROM) {
      maybe.push({ id, source: 'company', title: company || domain, url, snippet, website: domain || undefined, name: str(l.contact_name) || undefined, email: validEmail(email) ? email : undefined, why, reason: `Rated ${rating}`, score, at: now })
      continue
    }
    const status = str(l.email_status).toLowerCase()
    const hasEmail = validEmail(email) && status !== 'none'
    const page = socials.find(s => /instagram|facebook/i.test(str(s.platform)) && str(s.url))
    const facts = [
      str(l.what_it_does) && { k: 'Sells', v: clip(str(l.what_it_does), 160) },
      str(l.company_size) && { k: 'Size', v: str(l.company_size) },
      str(l.location) && { k: 'Location', v: str(l.location) },
      ...socials.slice(0, 4).map(s => ({ k: 'Social', v: clip([str(s.platform), str(s.activity)].filter(Boolean).join(': '), 160) })),
      ...signals.slice(0, 5).map(([k, v]) => ({ k: clip(k.replace(/_/g, ' '), 24).replace(/^./, c => c.toUpperCase()), v: clip(str(v), 160) })),
      Array.isArray(l.not_checked) && l.not_checked.length && { k: 'Not checked', v: clip(l.not_checked.map(str).filter(Boolean).join(', '), 200) },
    ].filter((f): f is { k: string; v: string } => !!f)
    fresh.push({
      id, source: 'company', foundAt: now, title: company || domain, url, snippet,
      name: str(l.contact_name) || undefined, role: str(l.contact_title) || undefined, company: company || undefined,
      website: domain || undefined, score, fitLabel: rating, why, status: hasEmail || page ? 'ready' : 'needs_contact', followupsSent: 0,
      ...(hasEmail ? { email, emailVerified: status === 'verified', emailVia: [EMAIL_VIA[status] ?? 'found', str(sources.contact) && `via ${str(sources.contact)}`].filter(Boolean).join(', ') } : {}),
      ...(!hasEmail && page ? { dm: { platform: /instagram/i.test(str(page.platform)) ? 'Instagram' : 'Facebook', url: str(page.url) } } : {}),
      ...(str(l.linkedin) ? { linkedinUrl: str(l.linkedin) } : {}),
      foundVia: clip(str(sources.discovered_via) || 'Lead Finder search', 200),
      facts: facts.length ? facts : undefined,
      notChecked: Array.isArray(l.not_checked) ? l.not_checked.map(str).filter(Boolean).slice(0, 8) : undefined,
    })
  }
  for (const d of a.dropped ?? []) {
    const name = clip(str(d.company), 80)
    if (!name) continue
    maybe.push({ id: idOf(`engine-dropped:${name.toLowerCase()}`), source: 'company', title: name, url: `https://www.google.com/search?q=${encodeURIComponent(name)}`, snippet: '', why: '', reason: clip(str(d.reason) || 'Dropped', 120), score: 3, at: now })
  }

  fresh.sort((x, y) => y.score - x.score)
  await updateLeadData(brandId, leadFallback(b), d => {
    const ids = new Set(d.leads.map(l => l.id))
    d.leads = [...fresh.filter(l => !ids.has(l.id)), ...d.leads]
    const mids = new Set(maybe.map(m => m.id))
    d.maybe = [...maybe, ...(d.maybe ?? []).filter(m => !mids.has(m.id))].slice(0, 60)
    d.lastRunAt = now
    d.lastRunSummary = clip(str(a.summary), 300)
    d.lastError = null
    d.engineRun = runInfo(job, 'done', a, fresh.length)
  })
  return fresh.length
}

function runInfo(job: EngineJob, status: EngineRunInfo['status'], a: EngineAnswer | null, added: number): EngineRunInfo {
  return {
    at: new Date().toISOString(), status,
    summary: clip(str(a?.summary) || job.error || '', 1200),
    profile: a?.profile,
    toolIssues: (a?.tool_issues ?? []).map(str).filter(Boolean).slice(0, 10),
    added, costUsd: Math.round((job.aiUsd + job.toolUsd) * 100) / 100,
    ...(job.error ? { error: job.error } : {}),
  }
}

/** A search that ended without leads: noted on the lead data so the page can say why. */
async function saveRun(brandId: string, job: EngineJob, a: EngineAnswer | null) {
  const b = await loadBrandContext(brandId)
  if (!b) return
  await updateLeadData(brandId, leadFallback(b), d => {
    d.engineRun = runInfo(job, 'failed', a, 0)
    d.lastError = job.error ?? null
  }).catch(() => {})
}
