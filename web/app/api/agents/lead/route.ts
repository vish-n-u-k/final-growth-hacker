import { NextRequest, NextResponse } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { demoForced, withDemo } from '@/lib/agents/demo'
import { loadBrandContext } from '@/lib/agents/context'
import { LOCATION_CODES } from '@/lib/agents/dataforseo'
import { addLeadEmail, addLeadReply, approveLead, retireOldFinds, demoSkipDays, draftIcp, icpKey, leadFallback, pickSources, runLeadAgent, useMaybe } from '@/lib/agents/lead-agent'
import { readLeadData, updateLeadData, type Icp, type IcpKind, type LeadAgentData, type EngineInputs, type LeadSettings, type LinkedInFilters, type Rival } from '@/lib/agents/store'
import { suggestFilters } from '@/lib/leads/suggest-filters'
import { addOwnList, checkPeople, draftListEmail } from '@/lib/agents/own-list'
import { readDemoSwitch, saveDemoSwitch } from '@/lib/agents/store'
import { clearSignals } from '@/lib/signals'

export const dynamic = 'force-dynamic'
// Every request runs with the brand's demo-mode switch (lib/agents/demo.ts)
async function inDemo<T extends Response>(fn: () => Promise<T>): Promise<T | Response> {
  const a = await agentAccess()
  if (a.error) return a.error
  return withDemo(await readDemoSwitch(a.brandId), fn)
}

export const maxDuration = 300

export async function GET() { return inDemo(get) }
async function get() {
  const a = await agentAccess()
  if (a.error) return a.error
  const b = await loadBrandContext(a.brandId)
  if (!b) return NextResponse.json({ error: 'No brand' }, { status: 404 })
  return NextResponse.json({ data: (await readLeadData(a.brandId)) ?? leadFallback(b)() })
}

const KINDS: IcpKind[] = ['ecommerce', 'saas', 'local', 'creator', 'other']
const lines = (x: unknown, n: number) => (Array.isArray(x) ? x : []).map(v => String(v ?? '').trim().slice(0, 140)).filter(Boolean).slice(0, n)
function cleanIcp(cur: Icp | null | undefined, x: unknown): Icp | null | undefined {
  if (x === undefined) return cur
  if (!x || typeof x !== 'object') return null
  const c = x as Partial<Icp>
  const who = typeof c.who === 'string' ? c.who.trim().slice(0, 300) : ''
  if (!who) return null
  return {
    kind: KINDS.includes(c.kind as IcpKind) ? c.kind as IcpKind : 'other',
    who,
    marketing: typeof c.marketing === 'string' ? c.marketing.trim().slice(0, 300) : '',
    trades: lines(c.trades, 10).map(t => t.slice(0, 40)),
    fit: lines(c.fit, 6),
    notFit: lines(c.notFit, 8),
    examples: lines(c.examples, 5).map(d => d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]).filter(d => d.includes('.')),
    by: c.by === 'ai' ? 'ai' : 'user',
    ...(typeof c.quietSocial === 'boolean' ? { quietSocial: c.quietSocial } : {}),
  }
}

const words = (x: unknown) => (Array.isArray(x) ? x : typeof x === 'string' ? x.split(',') : []).map(v => String(v ?? '').trim().slice(0, 80)).filter(Boolean).slice(0, 10)
function cleanLinkedIn(cur: LinkedInFilters | null | undefined, x: unknown): LinkedInFilters | null | undefined {
  if (x === undefined) return cur
  if (!x || typeof x !== 'object') return null
  const f = x as Partial<LinkedInFilters>
  return { jobTitles: words(f.jobTitles), industries: words(f.industries), keywords: words(f.keywords), countries: words(f.countries), sizes: words(f.sizes), technologies: words(f.technologies), ...(typeof f.why === 'string' ? { why: f.why.slice(0, 300) } : {}) }
}
/** Lead Finder's search: the brief and five filters. null clears them (back to the old search). */
function cleanEngine(cur: EngineInputs | null | undefined, x: unknown): EngineInputs | null | undefined {
  if (x === undefined) return cur
  if (!x || typeof x !== 'object') return null
  const e = x as Partial<EngineInputs>
  const t = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  return {
    brief: t(e.brief, 3000), industry: t(e.industry, 200), location: t(e.location, 200),
    companySize: t(e.companySize, 100), contactRole: t(e.contactRole, 200),
    leadCount: Math.max(1, Math.min(50, Math.round(Number(e.leadCount)) || 10)),
  }
}

/** Competitors to read reviews of: a Trustpilot domain, or a Shopify App Store link. */
function cleanRivals(cur: Rival[] | undefined, x: unknown): Rival[] | undefined {
  if (!Array.isArray(x)) return cur
  const out: Rival[] = []
  for (const r of x) {
    const url = String((r as Rival)?.url ?? '').trim().slice(0, 300)
    if (!url) continue
    const platform = (r as Rival).platform === 'shopify' || /apps\.shopify\.com/i.test(url) ? 'shopify' : 'trustpilot'
    if (!out.some(o => o.url === url)) out.push({ platform, url })
  }
  return out.slice(0, 5)
}

/** The card changed: what was found or saved for the old one is dropped, so the next search starts afresh. */
function freshStart(d: LeadAgentData) {
  retireOldFinds(d)
  d.waiting = undefined
  d.cursor = undefined
  d.companyFilters = undefined
  d.queries = undefined
}

function cleanSettings(cur: LeadSettings, s: Partial<LeadSettings>): LeadSettings {
  const days = Array.isArray(s.followUpDays)
    ? [...new Set(s.followUpDays.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 30))].sort((x, y) => x - y).slice(0, 3)
    : cur.followUpDays
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : cur.enabled,
    customer: typeof s.customer === 'string' ? s.customer.slice(0, 600) : cur.customer,
    country: typeof s.country === 'string' && (LOCATION_CODES[s.country] || s.country === 'ANY') ? s.country : cur.country,
    sources: {
      reddit: typeof s.sources?.reddit === 'boolean' ? s.sources.reddit : cur.sources.reddit,
      reviews: typeof s.sources?.reviews === 'boolean' ? s.sources.reviews : cur.sources.reviews,
      local: typeof s.sources?.local === 'boolean' ? s.sources.local : cur.sources.local,
      companies: typeof s.sources?.companies === 'boolean' ? s.sources.companies : cur.sources.companies,
      linkedin: typeof s.sources?.linkedin === 'boolean' ? s.sources.linkedin : cur.sources.linkedin ?? false,
    },
    rivals: cleanRivals(cur.rivals, s.rivals),
    linkedin: cleanLinkedIn(cur.linkedin, s.linkedin),
    engine: cleanEngine(cur.engine, s.engine),
    competitors: Array.isArray(s.competitors)
      ? s.competitors.map(x => String(x).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]).filter(x => x.includes('.')).slice(0, 3)
      : cur.competitors,
    localQuery: typeof s.localQuery === 'string' ? s.localQuery.slice(0, 120) : cur.localQuery,
    companyQuery: typeof s.companyQuery === 'string' ? s.companyQuery.slice(0, 200) : cur.companyQuery,
    picked: cur.picked,
    dailyLimit: Number.isInteger(s.dailyLimit) ? Math.min(30, Math.max(1, s.dailyLimit!)) : cur.dailyLimit,
    followUpDays: days,
    skipEU: typeof s.skipEU === 'boolean' ? s.skipEU : cur.skipEU,
    mode: s.mode === 'auto' || s.mode === 'approve' ? s.mode : cur.mode,
    icp: cleanIcp(cur.icp, s.icp),
    useBrand: typeof s.useBrand === 'boolean' ? s.useBrand : cur.useBrand,
  }
}

// Answered by hand on a page: forum posts, seller pages, and leads with no email but a social page
const isForumLead = (l: { source: string; email?: string; dm?: unknown }) => l.source === 'reddit' || l.source === 'forum' || l.source === 'profile' || (!l.email && !!l.dm)

export async function POST(req: NextRequest) { return inDemo(() => post(req)) }
async function post(req: NextRequest) {
  const a = await agentAccess()
  if (a.error) return a.error
  const brandId = a.brandId
  const b = await loadBrandContext(brandId)
  if (!b) return NextResponse.json({ error: 'No brand' }, { status: 404 })
  const fallback = leadFallback(b)
  const body = await req.json().catch(() => ({})) as {
    op?: string; on?: boolean; id?: string; subject?: string; body?: string; reply?: string; email?: string; settings?: Partial<LeadSettings>
    name?: string; about?: string; examples?: string[]; people?: { email: string; name?: string; text?: string }[]; lane?: string
  }
  const people = Array.isArray(body.people) ? body.people.slice(0, 500).filter(p => p && typeof p.email === 'string') : []

  switch (body.op) {
    case 'demo': {
      if (demoForced()) return NextResponse.json({ error: 'Demo mode stays on until DataForSEO is set up.' }, { status: 400 })
      const on = body.on === true
      await saveDemoSwitch(brandId, on)
      const data = await withDemo(on, async () => (await readLeadData(brandId)) ?? fallback())
      return NextResponse.json({ data, demo: on, message: on ? 'Demo mode on: made-up leads, nothing is sent.' : 'Demo mode off: real leads.' })
    }
    case 'settings': {
      const data = await updateLeadData(brandId, fallback, d => {
        const next = cleanSettings(d.settings, body.settings ?? {})
        // Sources changed by hand: GrowJin's one-line reason no longer describes them
        const was = d.settings.sources
        if (next.picked && (next.sources.local !== was.local || next.sources.companies !== was.companies || next.sources.reddit !== was.reddit)) next.picked = { ...next.picked, why: '' }
        // A new ideal customer or "who to look for": old waiting finds and search words go
        if (icpKey(next) !== icpKey(d.settings) || next.companyQuery !== d.settings.companyQuery || next.customer !== d.settings.customer) freshStart(d)
        d.settings = next
      })
      if (!data.settings.enabled) await clearSignals(brandId, 'lead-agent', ['approvals']).catch(() => {})
      return NextResponse.json({ data })
    }
    // The ideal-customer card, drafted from the brand and the example customers given. Not saved:
    // it fills the Settings form, and Save keeps it
    // "Fill in again" drafts it the way the first one was: from the brand (and the example sites), not
    // from the old card, whose "who" is also saved as the customer line
    case 'icp_draft': {
      const cur = (await readLeadData(brandId)) ?? fallback()
      const s = cur.settings
      const fresh = s.icp && s.customer.trim() === s.icp.who.trim() ? { ...s, customer: '' } : s
      const r = await draftIcp(b, fresh, lines(body.examples, 5)).catch(() => null)
      return r ? NextResponse.json(r) : NextResponse.json({ error: 'Couldn’t describe your customer right now. Try again.' }, { status: 500 })
    }
    // GrowJin picks the sources from the brand (first visit, or "Pick for me" in Settings).
    // With no ideal-customer card yet, it drafts one first and saves it, so the pick follows it
    case 'pick': {
      const cur = (await readLeadData(brandId)) ?? fallback()
      const drafted = cur.settings.icp ? null : await draftIcp(b, cur.settings, []).catch(() => null)
      const withCard = drafted ? { ...cur.settings, icp: drafted.icp, companyQuery: drafted.companyQuery || cur.settings.companyQuery } : cur.settings
      const p = await pickSources(b, withCard).catch(() => null)
      if (!p) return NextResponse.json({ error: 'Couldn’t pick sources right now. Choose them in Change.' })
      const data = await updateLeadData(brandId, fallback, d => {
        if (drafted && !d.settings.icp) { d.settings.icp = drafted.icp; freshStart(d) }
        d.settings.sources = { ...d.settings.sources, local: p.local, companies: p.companies, reddit: p.reddit }
        if (p.localQuery) d.settings.localQuery = p.localQuery
        const query = drafted?.companyQuery || p.companyQuery
        if (query && query !== d.settings.companyQuery) { d.settings.companyQuery = query; freshStart(d) }
        d.settings.picked = { at: new Date().toISOString(), why: p.why }
      })
      return NextResponse.json({ data })
    }
    // The LinkedIn search's filters, worked out from the brand and the ideal-customer card. Not saved:
    // it fills the Settings form, and Save keeps it
    case 'linkedin_suggest': {
      const f = await suggestFilters(brandId).catch(() => null)
      return f ? NextResponse.json({ filters: f }) : NextResponse.json({ error: 'Couldn’t work out who to look for right now. Fill it in by hand.' }, { status: 500 })
    }
    case 'run': {
      // Only searches: replies, follow-ups and queued emails are left to the daily run
      const result = await runLeadAgent(brandId, { manual: true, findOnly: true, deadline: Date.now() + 270_000 })
      return NextResponse.json({ result, data: await readLeadData(brandId) })
    }
    case 'more': {
      // "Show 10 more" in one tab: the next finds, checked and drafted like a search
      const lane = body.lane === 'community' ? 'community' : 'email'
      const result = await runLeadAgent(brandId, { more: lane, deadline: Date.now() + 240_000 })
      return NextResponse.json({ result, data: await readLeadData(brandId) })
    }
    case 'use': {
      if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      const r = await useMaybe(brandId, body.id)
      return NextResponse.json({ ...(r.ok ? { message: r.message } : { error: r.message }), data: await readLeadData(brandId) }, { status: r.ok ? 200 : 400 })
    }
    case 'demo_skip': {
      const result = await demoSkipDays(brandId, 3)
      return NextResponse.json({ result, data: await readLeadData(brandId) })
    }
        case 'approve': {
      if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      const r = await approveLead(brandId, body.id, { subject: body.subject, body: body.body })
      return NextResponse.json({ ...r, data: await readLeadData(brandId) }, { status: r.ok ? 200 : 400 })
    }
    case 'approve_all': {
      const d = (await readLeadData(brandId)) ?? fallback()
      // Emails are written when a lead is opened: write the ones nobody opened before sending
      const ids = d.leads.filter(l => l.status === 'ready' && !l.reply && l.email && l.source !== 'reddit' && l.source !== 'forum').map(l => l.id)
      for (const l of d.leads.filter(x => ids.includes(x.id) && !x.draft)) await addLeadEmail(brandId, l.id, l.email!)
      let sent = 0, queued = 0
      const failed: string[] = []
      for (const id of ids) {
        const r = await approveLead(brandId, id)
        if (!r.ok) failed.push(r.message)
        else if (r.message.startsWith('Sent')) sent += 1
        else queued += 1
      }
      const message = [sent ? `${sent} sent` : null, queued ? `${queued} queued for tomorrow` : null, failed.length ? `${failed.length} failed: ${failed[0]}` : null].filter(Boolean).join(' · ')
      return NextResponse.json({ ok: !failed.length, message: message || 'Nothing to send.', data: await readLeadData(brandId) })
    }
    // "Add your own emails": who can be emailed, the one email for all, then approve all
    case 'list_check': {
      const d = (await readLeadData(brandId)) ?? fallback()
      return NextResponse.json(await checkPeople(brandId, d, people))
    }
    case 'list_draft': {
      const draft = await draftListEmail(brandId, typeof body.about === 'string' ? body.about : '')
      return draft ? NextResponse.json({ draft }) : NextResponse.json({ error: 'Couldn’t write the email. Try again.' }, { status: 500 })
    }
    case 'list_add': {
      const r = await addOwnList(brandId, {
        name: typeof body.name === 'string' ? body.name : '', about: typeof body.about === 'string' ? body.about : undefined,
        subject: typeof body.subject === 'string' ? body.subject : '', body: typeof body.body === 'string' ? body.body : '', people,
      })
      return NextResponse.json({ ...r, ...(r.ok ? {} : { error: r.message }), data: await readLeadData(brandId) }, { status: r.ok ? 200 : 400 })
    }
    // A forum reply or seller-page message, written when the lead is opened
    case 'reply': {
      if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      const r = await addLeadReply(brandId, body.id)
      return NextResponse.json({ ...(r.ok ? {} : { error: r.message }), data: await readLeadData(brandId) }, { status: r.ok ? 200 : 400 })
    }
    case 'email': {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : ''
      if (!body.id || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Add a valid email address.' }, { status: 400 })
      const r = await addLeadEmail(brandId, body.id, email)
      return NextResponse.json({ ...(r.ok ? {} : { error: r.message }), data: await readLeadData(brandId) }, { status: r.ok ? 200 : 400 })
    }
    case 'save':
    case 'skip':
    case 'handled':
    case 'posted':
    case 'restore': {
      if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      const data = await updateLeadData(brandId, fallback, d => {
        const l = d.leads.find(x => x.id === body.id)
        if (!l) return
        if (body.op === 'skip' && (l.status === 'ready' || l.status === 'needs_contact' || l.status === 'queued')) l.status = 'skipped'
        if (body.op === 'posted' && l.status === 'ready' && l.reply) l.status = 'posted'
        if (body.op === 'handled' && l.status === 'replied') l.handledAt = new Date().toISOString()
        if (body.op === 'restore' && l.status === 'skipped') { l.status = l.reply || isForumLead(l) || (l.email && l.draft) ? 'ready' : 'needs_contact'; delete l.skippedBy }
        if (body.op === 'restore' && l.status === 'replied') delete l.handledAt
        if (body.op === 'save') {
          if (l.draft && typeof body.subject === 'string' && typeof body.body === 'string') l.draft = { subject: body.subject.slice(0, 200), body: body.body.slice(0, 4000) }
          if (typeof body.reply === 'string' && (l.reply !== undefined || isForumLead(l))) l.reply = body.reply.slice(0, 4000)
        }
      })
      if (!data.leads.some(l => l.status === 'ready')) await clearSignals(brandId, 'lead-agent', ['approvals']).catch(() => {})
      return NextResponse.json({ data })
    }
    default:
      return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
  }
}
