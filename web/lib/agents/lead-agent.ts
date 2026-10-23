// The Lead Agent. Each run (daily cron or "Run now"):
//   1. checks sent emails for replies, opt-outs and bounces, and sends due follow-ups
//   2. sends approved emails that waited for today's sending limit
//   3. finds new leads: Reddit / Hacker News posts asking for this kind of product, unhappy
//      Trustpilot reviewers of competitors, local businesses on Google Maps
//   4. scores them (Claude), finds an email (Hunter, else the company website), drafts a short
//      personal email or a forum reply, and waits for the user's OK (or sends on its own in
//      auto mode, once the user has approved 20)
// Nothing is posted on Reddit by the agent: replies are drafts the user posts by hand.

import { callAI, withAIContext } from '@/lib/ai/client'
import { sendGmailMessage, GmailSendError } from '@/lib/gmail/send'
import { getValidGmailToken } from '@/lib/gmail/token'
import { checkThreadReply } from '@/lib/gmail/reply-check'
import { openSignal, clearSignals } from '@/lib/signals'
import { fetchHtml } from '@/lib/lead-finder/reviews'
import { searchDataReady, googleResults, mapsBusinesses } from './dataforseo'
import { agentsDemo, demoReply, demoSend, setDemoContext } from './demo'
import { Progress } from './progress'
import { hunterConfigured, findEmail } from './hunter'
import { costNote } from './services'
import {
  addUsage, defaultLeadData, newMeter, readLeadData, updateLeadData,
  type Lead, type LeadAgentData, type LeadSettings, type LeadSource, type UsageMeter,
} from './store'
import { brandBlock, daysFrom, domainOf, firstName, idOf, loadBrandContext, parseJsonLoose, textToHtml, type BrandContext } from './context'

const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'])
const MIN_SCORE = 7
const MAX_NEW_PER_RUN = 12
const OPT_OUT = 'If this isn\'t relevant, just reply "no" and I won\'t email again.'

const PER_SOURCE = 10

export const leadFallback = (b: BrandContext) => () => defaultLeadData(b, b.competitors.map(c => c.domain))

const today = () => new Date().toISOString().slice(0, 10)
export const sentToday = (d: LeadAgentData) => d.sentLog.filter(t => t.slice(0, 10) === today()).length

// ── Sending ───────────────────────────────────────────────────────────────────

/** Sends a lead's first email now. Returns the fields to save on the lead. */
async function sendFirstEmail(brandId: string, lead: Lead, followUpDays: number[]): Promise<Partial<Lead>> {
  if (!lead.email || !lead.draft) return { error: 'No email or draft.' }
  try {
    // Demo mode: recorded as sent, nothing leaves GrowJin
    const sent = agentsDemo() ? demoSend() : await sendGmailMessage(brandId, { to: lead.email, subject: lead.draft.subject, body: textToHtml(`${lead.draft.body}\n\n${OPT_OUT}`) }, { source: 'lead-agent', toName: lead.name ?? null })
    const now = new Date().toISOString()
    return {
      status: 'sent', sentAt: now, threadId: sent.threadId, followupsSent: 0, error: undefined,
      nextFollowUpAt: followUpDays[0] ? daysFrom(now, followUpDays[0]) : undefined,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Send failed'
    if (e instanceof GmailSendError && e.code === 'suppressed') return { status: 'opted_out', error: msg }
    return { error: msg }
  }
}

/**
 * The user approved a lead's email (optionally edited): sends it now, or queues it for
 * tomorrow if today's limit is reached. Returns a short message for the page.
 */
export async function approveLead(brandId: string, leadId: string, edits?: { subject?: string; body?: string }, by: 'user' | 'auto' = 'user'): Promise<{ ok: boolean; message: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const fallback = leadFallback(b)
  const d = (await readLeadData(brandId)) ?? fallback()
  const lead = d.leads.find(l => l.id === leadId)
  if (!lead) return { ok: false, message: 'Lead not found.' }
  if (lead.status !== 'ready' && lead.status !== 'queued') return { ok: false, message: 'Already handled.' }
  const draft = lead.draft && edits ? { subject: edits.subject?.trim() || lead.draft.subject, body: edits.body?.trim() || lead.draft.body } : lead.draft
  const withDraft = { ...lead, draft }

  if (sentToday(d) >= d.settings.dailyLimit) {
    await updateLeadData(brandId, fallback, x => {
      const l = x.leads.find(y => y.id === leadId)
      if (!l) return
      Object.assign(l, { draft, status: 'queued', approvedBy: by })
      if (by === 'user') x.approvedCount += 1
    })
    return { ok: true, message: `Today's limit of ${d.settings.dailyLimit} is reached. It will go out tomorrow.` }
  }

  const patch = await sendFirstEmail(brandId, withDraft, d.settings.followUpDays)
  await updateLeadData(brandId, fallback, x => {
    const l = x.leads.find(y => y.id === leadId)
    if (!l) return
    Object.assign(l, { draft, approvedBy: by }, patch)
    if (patch.status === 'sent') x.sentLog.push(patch.sentAt!)
    if (by === 'user' && patch.status === 'sent') x.approvedCount += 1
  })
  return patch.status === 'sent'
    ? { ok: true, message: `Sent to ${lead.email}.` }
    : { ok: false, message: patch.error ?? 'Could not send.' }
}

// ── Follow-ups and replies ────────────────────────────────────────────────────

function followUpText(n: number, lead: Lead, b: BrandContext): string {
  const hi = firstName(lead.name) ? `Hi ${firstName(lead.name)},` : 'Hi,'
  return n === 0
    ? `${hi}\n\nJust bringing this back to the top of your inbox in case it got buried. Would it be worth a quick look?\n\n${b.name}`
    : `${hi}\n\nLast note from me. If ${b.name} isn't a fit right now, no problem at all. If it would help later, just reply and I'll pick it up.\n\n${b.name}`
}

async function processSentLeads(brandId: string, b: BrandContext, d: LeadAgentData, deadline: number): Promise<{ patches: Map<string, Partial<Lead>>; replies: Lead[]; error?: string }> {
  const patches = new Map<string, Partial<Lead>>()
  const replies: Lead[] = []
  const sent = d.leads.filter(l => l.status === 'sent' && l.threadId && l.email)
  if (!sent.length) return { patches, replies }
  const demo = agentsDemo()
  let token = ''
  if (!demo) {
    try {
      token = await getValidGmailToken(brandId)
    } catch (e) {
      return { patches, replies, error: e instanceof Error ? e.message : 'Gmail not connected' }
    }
  }
  for (const lead of sent) {
    if (Date.now() > deadline) break
    try {
      const firstReply = demo && !replies.length && !d.leads.some(l => l.status === 'replied')
      const r = demo ? demoReply(lead.id, lead.sentAt!, firstReply) : await checkThreadReply(brandId, token, lead.threadId!, lead.email!, Date.parse(lead.sentAt!) - 60_000)
      if (r.outcome === 'replied' || r.outcome === 'opted_out' || r.outcome === 'bounced') {
        patches.set(lead.id, { status: r.outcome, replyNote: r.note, replyIntent: r.intent, repliedAt: new Date().toISOString(), nextFollowUpAt: undefined })
        if (r.outcome === 'replied') replies.push({ ...lead, replyNote: r.note })
        continue
      }
      const due = lead.nextFollowUpAt && Date.parse(lead.nextFollowUpAt) <= Date.now()
      if (due && lead.followupsSent < d.settings.followUpDays.length && lead.draft) {
        const subject = /^re:/i.test(lead.draft.subject) ? lead.draft.subject : `Re: ${lead.draft.subject}`
        if (!demo) await sendGmailMessage(brandId, { to: lead.email!, subject, body: textToHtml(`${followUpText(lead.followupsSent, lead, b)}\n\n${OPT_OUT}`), threadId: lead.threadId }, { source: 'lead-agent', toName: lead.name ?? null })
        const n = lead.followupsSent + 1
        const next = d.settings.followUpDays[n]
        patches.set(lead.id, { followupsSent: n, nextFollowUpAt: next ? daysFrom(lead.sentAt!, next) : undefined })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Follow-up failed'
      patches.set(lead.id, e instanceof GmailSendError && e.code === 'suppressed' ? { status: 'opted_out', error: msg, nextFollowUpAt: undefined } : { error: msg })
    }
  }
  return { patches, replies }
}

// ── Finding ───────────────────────────────────────────────────────────────────

interface Candidate {
  source: LeadSource
  url: string
  title: string
  snippet: string
  name?: string
  website?: string
  phone?: string
  rating?: number | null
}

async function searchQueries(b: BrandContext, s: LeadSettings, d: LeadAgentData): Promise<string[]> {
  const key = `${s.customer}|${b.usp ?? ''}`
  if (d.queries?.for === key && d.queries.list.length) return d.queries.list
  const raw = await callAI({
    feature: 'lead-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 300,
    system: 'You write Google search phrases that find forum posts where people ask for a product like this one. Return only a JSON array of strings.',
    prompt: `${brandBlock(b)}\nCustomer: ${s.customer || b.targetAudience || 'not given'}\n\nWrite 6 short phrases (3-7 words) a potential customer would write when asking for help, e.g. "looking for a tool to", "any app that", "how do you manage". Describe the problem in their words, never the brand name.`,
  })
  const list = (parseJsonLoose<string[]>(raw, 'array') ?? []).filter(q => typeof q === 'string' && q.length > 3).slice(0, 6)
  d.queries = { for: key, list }
  return list
}

async function findReddit(queries: string[], country: string, meter: UsageMeter): Promise<Candidate[]> {
  if (!searchDataReady() || !queries.length) return []
  // Two phrases a day, rotating through the list
  const day = Math.floor(Date.now() / 86_400_000)
  const picks = [queries[day % queries.length], queries[(day + 1) % queries.length]].filter((q, i, a) => a.indexOf(q) === i)
  const results = await Promise.all(picks.map(q => googleResults(`site:reddit.com ${q}`, country, meter, { recent: true })))
  return results.flat()
    .filter(r => /reddit\.com\/r\/[^/]+\/comments\//.test(r.url))
    .map(r => ({
      source: 'reddit' as const,
      url: r.url.split('?')[0],
      title: r.title.replace(/\s*[:|-]\s*r\/\w+.*$/i, '').replace(/\s*-\s*Reddit$/i, '').trim(),
      snippet: r.description,
      name: r.url.match(/\/r\/([^/]+)\//)?.[1] ? `r/${r.url.match(/\/r\/([^/]+)\//)![1]}` : undefined,
    }))
}

async function findHackerNews(queries: string[]): Promise<Candidate[]> {
  const since = Math.floor(Date.now() / 1000) - 30 * 86400
  const q = queries[Math.floor(Date.now() / 86_400_000) % Math.max(1, queries.length)]
  if (!q) return []
  try {
    const res = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${new URLSearchParams({ query: q, tags: 'story', numericFilters: `created_at_i>${since}`, hitsPerPage: '10' })}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const j = await res.json() as { hits?: { objectID: string; title?: string; story_text?: string | null; author?: string }[] }
    return (j.hits ?? []).filter(h => h.title).map(h => ({
      source: 'forum' as const,
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      title: h.title!,
      snippet: (h.story_text ?? '').replace(/<[^>]+>/g, ' ').slice(0, 400),
      name: h.author,
    }))
  } catch {
    return []
  }
}

async function findLocal(query: string, country: string, meter: UsageMeter): Promise<Candidate[]> {
  if (!searchDataReady() || !query.trim()) return []
  const list = await mapsBusinesses(query, country, meter)
  return list
    .filter(x => !x.domain || (x.rating !== null && x.rating < 4.2) || (x.reviews !== null && x.reviews < 30))
    .slice(0, 20)
    .map(x => ({
      source: 'local' as const,
      url: x.mapsUrl ?? x.url ?? `https://www.google.com/maps/search/${encodeURIComponent(x.title)}`,
      title: x.title,
      snippet: [
        x.rating !== null ? `Rated ${x.rating}${x.reviews !== null ? ` from ${x.reviews} reviews` : ''}` : 'No rating yet',
        x.domain ? `website ${x.domain}` : 'no website',
        x.category, x.address,
      ].filter(Boolean).join(' · '),
      website: x.domain ?? undefined,
      phone: x.phone ?? undefined,
      rating: x.rating,
    }))
}

// ── Scoring and drafting ──────────────────────────────────────────────────────

interface Scored { i: number; score: number; why: string; company?: string; website?: string }

async function scoreCandidates(b: BrandContext, s: LeadSettings, list: Candidate[]): Promise<Scored[]> {
  if (!list.length) return []
  const lines = list.map((c, i) => `[${i}] (${c.source}) ${c.title}\n${c.snippet.slice(0, 350)}`).join('\n\n')
  const raw = await callAI({
    feature: 'lead-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2500,
    system: 'You qualify sales leads. Be strict: most posts are not buyers. Return only a raw JSON array.',
    prompt: `${brandBlock(b)}
Ideal customer: ${s.customer || b.targetAudience || 'not given'}

Score each item 1-10 for how likely this person or business would want ${b.name} now:
- reddit / forum: 8-10 only if they are asking for a tool or help that ${b.name} gives; 1-4 for news, rants, promotions, or other products' launches
- review: an unhappy customer of a competitor; high only if their complaint is something ${b.name} solves
- local: a business that matches the ideal customer and shows a need (no website, low rating, few reviews)

${lines}

Return [{"i":0,"score":8,"why":"one plain sentence a non-technical founder understands","company":"company name if the text names one, else omit","website":"their website domain if the text shows it, else omit"}]`,
  })
  return (parseJsonLoose<Scored[]>(raw, 'array') ?? []).filter(x => typeof x.i === 'number' && x.i >= 0 && x.i < list.length)
}

/** A mailto: address on the site's home, contact or about page (no lookup service needed). */
export async function emailFromWebsite(domain: string): Promise<string | null> {
  for (const path of ['', '/contact', '/about']) {
    const html = await fetchHtml(`https://${domain}${path}`)
    const m = html?.match(/mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)
    if (m) return m[1].toLowerCase()
  }
  return null
}

async function draftMessages(b: BrandContext, s: LeadSettings, leads: Lead[]): Promise<Map<string, { subject?: string; body?: string; reply?: string }>> {
  const out = new Map<string, { subject?: string; body?: string; reply?: string }>()
  if (!leads.length) return out
  const lines = leads.map((l, i) => {
    const kind = l.source === 'reddit' || l.source === 'forum' ? 'FORUM REPLY' : 'EMAIL'
    return `[${i}] ${kind} · ${l.source} · ${l.title}${l.name ? ` · contact: ${l.name}` : ''}\nWhat we know: ${l.snippet.slice(0, 350)}\nWhy a fit: ${l.why}`
  }).join('\n\n')
  const raw = await callAI({
    feature: 'lead-agent',
    model: 'claude-sonnet-4-6',
    maxTokens: 4000,
    system: 'You write short, personal outreach that gets replies. Plain words, no hype, no buzzwords, no emojis. Return only a raw JSON array.',
    prompt: `${brandBlock(b)}
Ideal customer: ${s.customer || b.targetAudience || 'not given'}

For each item write:
- EMAIL: "subject" (3-6 words, lower-key, mentions their situation, never clickbait) and "body" (under 90 words). Start with "Hi <first name>," if a person's name is known, else "Hi,". First line: the specific thing you noticed (their review, post or business detail). Then one sentence on how ${b.name} helps with exactly that. End with ONE small ask (e.g. "Want me to make 3 free examples for you?"). Sign off with "${b.name}". No links, no opt-out line (added automatically).
- FORUM REPLY: "reply" (under 120 words). Answer their question helpfully first with practical advice that works without any product. Then mention ${b.name} honestly as one option and say you work on it. No links, no sales tone.

${lines}

Return [{"i":0,"subject":"...","body":"..."}] or [{"i":1,"reply":"..."}]`,
  })
  for (const x of parseJsonLoose<{ i: number; subject?: string; body?: string; reply?: string }[]>(raw, 'array') ?? []) {
    if (typeof x.i === 'number' && leads[x.i]) out.set(leads[x.i].id, x)
  }
  return out
}

/** The user added an email to a good lead that had none: save it and write the first email. */
export async function addLeadEmail(brandId: string, leadId: string, email: string): Promise<{ ok: boolean; message: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const fallback = leadFallback(b)
  const d = (await readLeadData(brandId)) ?? fallback()
  const lead = d.leads.find(l => l.id === leadId)
  if (!lead) return { ok: false, message: 'Lead not found.' }
  if (lead.status !== 'needs_contact' && lead.status !== 'ready') return { ok: false, message: 'Already handled.' }
  const draft = lead.draft ?? await withAIContext({ brandId, moduleType: 'lead-agent', websiteUrl: b.websiteUrl }, async () => {
    const x = (await draftMessages(b, d.settings, [{ ...lead, email }])).get(lead.id)
    return x?.subject && x.body ? { subject: x.subject, body: x.body } : undefined
  })
  if (!draft) return { ok: false, message: 'Couldn’t write the email. Try again.' }
  await updateLeadData(brandId, fallback, x => {
    const l = x.leads.find(y => y.id === leadId)
    if (l) Object.assign(l, { email, emailVerified: false, draft, status: 'ready' })
  })
  return { ok: true, message: 'Email written.' }
}

// ── The run ───────────────────────────────────────────────────────────────────

export interface RunResult { ok: boolean; summary: string; error?: string }

export async function runLeadAgent(brandId: string, opts: { manual?: boolean; deadline?: number } = {}): Promise<RunResult> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, summary: '', error: 'Brand not found.' }
  const fallback = leadFallback(b)
  const demo = agentsDemo()
  setDemoContext({ brand: b.name, domain: b.domain, competitors: b.competitors, seeds: (b.keywords ?? '').split(',').map(x => x.trim()).filter(Boolean), round: undefined })
  // Switching between demo and real data: start the lead list afresh (settings are kept)
  const saved = await readLeadData(brandId)
  if (saved && !!saved.demo !== demo) {
    await updateLeadData(brandId, fallback, x => { x.leads = []; x.sentLog = []; x.approvedCount = 0; x.rejected = []; x.lastError = null; x.demo = demo })
  }
  const d = (await readLeadData(brandId)) ?? fallback()
  d.demo = demo
  if (!d.settings.enabled && !opts.manual) return { ok: true, summary: 'Agent is off.' }
  const deadline = opts.deadline ?? Date.now() + 240_000
  const s = d.settings
  const meter = newMeter()
  const notes: string[] = []
  const errors: string[] = []

  const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`
  const pr = new Progress(brandId, 'lead', 'Lead Agent run', [
    { key: 'replies', label: 'Checking replies', hint: 'Replies to emails you sent, and follow-ups that are due' },
    { key: 'queued', label: 'Sending queued emails', hint: 'Approved emails that waited for today\'s limit' },
    ...(s.sources.reddit ? [
      { key: 'queries', label: 'Picking search phrases', hint: 'How your buyers ask for help online' },
      { key: 'reddit', label: 'Searching Reddit & HN', hint: 'People asking for a tool like yours' },
    ] : []),
    ...(s.sources.local ? [{ key: 'local', label: 'Searching Google Maps', hint: `“${s.localQuery}”: businesses with no website or low ratings` }] : []),
    { key: 'score', label: 'Scoring leads', hint: 'How well each one fits your product' },
    { key: 'emails', label: 'Finding emails', hint: 'Hunter first, then their own website' },
    { key: 'drafts', label: 'Drafting messages', hint: 'Personal emails and forum replies for your OK' },
  ])

  return withAIContext({ brandId, moduleType: 'lead-agent', websiteUrl: b.websiteUrl }, async () => {
    // 1. Replies and follow-ups
    pr.set('replies', 'running')
    const sentBefore = d.leads.filter(l => l.status === 'sent').length
    const { patches, replies, error: gmailError } = await processSentLeads(brandId, b, d, deadline)
    if (gmailError && d.leads.some(l => l.status === 'sent')) errors.push(`Gmail: ${gmailError}`)
    if (replies.length) notes.push(`${replies.length} new repl${replies.length === 1 ? 'y' : 'ies'}`)
    const followups = [...patches.values()].filter(x => x.followupsSent !== undefined && !x.status).length
    pr.set('replies', gmailError && sentBefore ? 'error' : 'done', sentBefore
      ? { detail: `${n(replies.length, 'new reply', 'new replies')}${followups ? ` · ${n(followups, 'follow-up')}` : ''}`, note: `${n(sentBefore, 'sent email')} checked.` }
      : 'Nothing sent yet')

    // 2. Approved emails that waited for today's limit
    let sentNow = sentToday(d)
    const queued = d.leads.filter(x => x.status === 'queued').length
    const sentAtStart = sentNow
    pr.set('queued', queued ? 'running' : 'skipped', queued ? undefined : 'None waiting')
    for (const l of d.leads.filter(x => x.status === 'queued')) {
      if (sentNow >= s.dailyLimit || Date.now() > deadline) break
      const p = await sendFirstEmail(brandId, l, s.followUpDays)
      patches.set(l.id, p)
      if (p.status === 'sent') { sentNow += 1; d.sentLog.push(p.sentAt!) }
    }

    if (queued) pr.set('queued', 'done', { detail: `${sentNow - sentAtStart} sent`, note: queued > sentNow - sentAtStart ? `${queued - (sentNow - sentAtStart)} wait for tomorrow's limit.` : undefined })

    // 3. Find new leads
    const known = new Set([...d.leads.map(l => l.id), ...(d.rejected ?? [])])
    let candidates: Candidate[] = []
    try {
      const queries = s.sources.reddit ? await pr.step('queries', () => searchQueries(b, s, d), q => ({ detail: n(q.length, 'phrase'), items: q.slice(0, 4) })) : []
      // One failing source (e.g. a search error) shouldn't stop the others; it's reported on the page
      const source = <T>(label: string, p: Promise<T[]>) => p.catch(e => { errors.push(`${label}: ${e instanceof Error ? e.message : 'failed'}`); return [] as T[] })
      const fresh = (x: Candidate) => !known.has(idOf(x.url))
      const found = await Promise.all([
        s.sources.reddit ? source('Reddit search', pr.step('reddit', async () => [...await findReddit(queries, s.country, meter), ...await findHackerNews(queries)], r => ({ detail: `${r.filter(fresh).length} new posts`, items: r.filter(fresh).slice(0, 3).map(x => x.title) }))) : [],
        s.sources.local ? source('Google Maps search', pr.step('local', () => findLocal(s.localQuery, s.country, meter), r => ({ detail: n(r.length, 'business', 'businesses'), items: r.slice(0, 3).map(x => x.title) }))) : [],
      ])
      // Up to 10 new finds from each source, so a busy one (often Reddit) can't crowd out the rest
      const seen = new Set<string>()
      candidates = found.flatMap(list => list.filter(c => {
        if (known.has(idOf(c.url)) || seen.has(c.url)) return false
        seen.add(c.url)
        return true
      }).slice(0, PER_SOURCE))
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Search failed')
    }

    const fresh: Lead[] = []
    const rejected: string[] = []
    if (candidates.length && Date.now() < deadline) {
      const scored = await pr.step('score', () => scoreCandidates(b, s, candidates)).catch(() => [] as Scored[])
      const good = scored.filter(x => x.score >= MIN_SCORE).sort((x, y) => y.score - x.score).slice(0, MAX_NEW_PER_RUN)
      pr.set('score', 'done', { detail: `${good.length} of ${candidates.length} fit`, note: 'A good fit scores 7 or more out of 10.', items: good.slice(0, 3).map(g => candidates[g.i].title) })
      // Remember the ones that didn't make it so tomorrow's run doesn't pay to score them again
      const keptIdx = new Set(good.map(g => g.i))
      rejected.push(...scored.filter(x => !keptIdx.has(x.i)).map(x => idOf(candidates[x.i].url)))
      const now = new Date().toISOString()
      for (const g of good) {
        const c = candidates[g.i]
        const website = c.website || (g.website ? domainOf(g.website) : undefined)
        fresh.push({
          id: idOf(c.url), source: c.source, foundAt: now, title: c.title, url: c.url, snippet: c.snippet,
          name: c.name, company: g.company, website, phone: c.phone, rating: c.rating ?? null,
          score: g.score, why: g.why, status: 'needs_contact', followupsSent: 0,
        })
      }
      // Contact details for businesses (forum posters are answered on the post)
      const euBlocked = s.skipEU && EU.has(s.country)
      let lookups = 0
      pr.set('emails', 'running')
      for (const l of fresh) {
        if (Date.now() > deadline) break
        if (l.source === 'reddit' || l.source === 'forum' || !l.website || euBlocked) continue
        const person = l.source === 'review' ? l.name : undefined
        const found = lookups < 10 && hunterConfigured() ? await findEmail(l.website, person, meter).catch(() => null) : null
        if (found) { lookups += 1; l.email = found.email; l.emailVerified = found.verified; if (found.name && l.source !== 'review') l.name = found.name }
        else {
          const site = await emailFromWebsite(l.website).catch(() => null)
          if (site) { l.email = site; l.emailVerified = false }
        }
      }
      const businesses = fresh.filter(l => l.source === 'review' || l.source === 'local')
      if (!fresh.length) pr.set('emails', 'skipped', 'No good fits')
      else pr.set('emails', 'done', businesses.length
        ? { detail: `${businesses.filter(l => l.email).length} of ${businesses.length} found`, note: euBlocked ? 'EU leads are not emailed (your setting).' : undefined }
        : { detail: 'Not needed', note: 'Only forum posts this time: you reply on the post.' })
      // Drafts
      const toDraft = fresh.filter(l => l.email || l.source === 'reddit' || l.source === 'forum')
      if (!toDraft.length) pr.set('drafts', 'skipped', 'Nothing to draft')
      const drafts = Date.now() < deadline && toDraft.length ? await pr.step('drafts', () => draftMessages(b, s, toDraft), r => `${n(r.size, 'draft')} ready`).catch(() => new Map()) : new Map()
      for (const l of fresh) {
        const x = drafts.get(l.id)
        if (x?.reply) { l.reply = x.reply; l.status = 'ready' }
        else if (x?.subject && x.body && l.email) { l.draft = { subject: x.subject, body: x.body }; l.status = 'ready' }
      }
      notes.push(`${fresh.length} new lead${fresh.length === 1 ? '' : 's'}`)
    } else if (!errors.length) {
      notes.push('no new leads')
      pr.set('score', 'skipped', 'Nothing new')
    }

    // 4. Auto mode: send strong email leads without asking once the user has approved 20
    const autoSend = s.mode === 'auto' && d.approvedCount >= 20
    if (autoSend) {
      for (const l of fresh.filter(x => x.status === 'ready' && x.email && x.draft && x.score >= 8)) {
        if (sentNow >= s.dailyLimit || Date.now() > deadline) break
        const p = await sendFirstEmail(brandId, l, s.followUpDays)
        Object.assign(l, p, { approvedBy: 'auto' })
        if (p.status === 'sent') { sentNow += 1; d.sentLog.push(p.sentAt!) }
      }
    }

    // 5. Save (re-read so approvals made meanwhile are kept)
    const saved = await updateLeadData(brandId, fallback, x => {
      for (const [id, p] of patches) {
        const l = x.leads.find(y => y.id === id)
        if (l && (l.status === 'sent' || l.status === 'queued')) Object.assign(l, p)
      }
      const have = new Set(x.leads.map(l => l.id))
      x.leads = [...fresh.filter(l => !have.has(l.id)), ...x.leads]
      x.sentLog = [...new Set([...x.sentLog, ...d.sentLog])].sort()
      if (d.queries) x.queries = d.queries
      x.demo = demo
      if (rejected.length) x.rejected = [...(x.rejected ?? []), ...rejected]
      x.lastRunAt = new Date().toISOString()
      x.lastRunSummary = notes.join(' · ')
      x.lastError = errors.length ? errors.join(' · ') : null
    })
    await addUsage(brandId, meter).catch(() => {})
    const cost = costNote(meter)
    if (cost) notes.push(cost)

    // 6. Today cards
    const waiting = saved.leads.filter(l => l.status === 'ready').length
    try {
      if (waiting) {
        await openSignal(brandId, {
          source: 'lead-agent', signalKey: 'approvals', priority: 2, cooldownDays: 0,
          title: `${waiting} lead${waiting === 1 ? '' : 's'} ready for your OK`,
          detail: 'Your Lead Agent drafted emails and forum replies. Nothing is sent until you approve it.',
          action: 'Open the Lead Agent and approve, edit or skip each one.',
        })
      } else {
        await clearSignals(brandId, 'lead-agent', ['approvals'])
      }
      for (const r of replies) {
        await openSignal(brandId, {
          source: 'lead-agent', signalKey: `reply:${r.id}`, priority: 3,
          title: `${r.name || r.company || r.email} replied to your email`,
          detail: r.replyNote ?? '', action: 'Reply from Gmail while it\'s warm.',
        })
      }
    } catch { /* Today cards are optional */ }

    await pr.finish([notes.join(' · '), errors.join(' · ')].filter(Boolean).join(' · '))
    return { ok: !errors.length, summary: notes.join(' · '), error: errors.join(' · ') || undefined }
  }).catch(async e => {
    await pr.finish(`Stopped: ${e instanceof Error ? e.message : 'failed'}`, true)
    throw e
  })
}

/** Demo mode only: pretend `days` have passed (sent dates move back), then run, so follow-ups and replies show. */
export async function demoSkipDays(brandId: string, days: number): Promise<RunResult> {
  if (!agentsDemo()) return { ok: false, summary: '', error: 'Only available in demo mode.' }
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, summary: '', error: 'Brand not found.' }
  const back = (iso?: string) => iso ? new Date(Date.parse(iso) - days * 86_400_000).toISOString() : iso
  await updateLeadData(brandId, leadFallback(b), x => {
    for (const l of x.leads) { l.sentAt = back(l.sentAt); l.nextFollowUpAt = back(l.nextFollowUpAt); l.foundAt = back(l.foundAt)! }
    x.sentLog = x.sentLog.map(t => back(t)!)
  })
  const r = await runLeadAgent(brandId, { manual: true })
  return { ...r, summary: `Skipped ahead ${days} days · ${r.summary}` }
}
