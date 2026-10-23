import { NextRequest, NextResponse } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { demoForced, withDemo } from '@/lib/agents/demo'
import { loadBrandContext } from '@/lib/agents/context'
import { LOCATION_CODES } from '@/lib/agents/dataforseo'
import { addLeadEmail, approveLead, demoSkipDays, leadFallback, runLeadAgent } from '@/lib/agents/lead-agent'
import { readLeadData, updateLeadData, type LeadSettings } from '@/lib/agents/store'
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

function cleanSettings(cur: LeadSettings, s: Partial<LeadSettings>): LeadSettings {
  const days = Array.isArray(s.followUpDays)
    ? [...new Set(s.followUpDays.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 30))].sort((x, y) => x - y).slice(0, 3)
    : cur.followUpDays
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : cur.enabled,
    customer: typeof s.customer === 'string' ? s.customer.slice(0, 600) : cur.customer,
    country: typeof s.country === 'string' && LOCATION_CODES[s.country] ? s.country : cur.country,
    sources: {
      reddit: typeof s.sources?.reddit === 'boolean' ? s.sources.reddit : cur.sources.reddit,
      reviews: typeof s.sources?.reviews === 'boolean' ? s.sources.reviews : cur.sources.reviews,
      local: typeof s.sources?.local === 'boolean' ? s.sources.local : cur.sources.local,
    },
    competitors: Array.isArray(s.competitors)
      ? s.competitors.map(x => String(x).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]).filter(x => x.includes('.')).slice(0, 3)
      : cur.competitors,
    localQuery: typeof s.localQuery === 'string' ? s.localQuery.slice(0, 120) : cur.localQuery,
    dailyLimit: Number.isInteger(s.dailyLimit) ? Math.min(30, Math.max(1, s.dailyLimit!)) : cur.dailyLimit,
    followUpDays: days,
    skipEU: typeof s.skipEU === 'boolean' ? s.skipEU : cur.skipEU,
    mode: s.mode === 'auto' || s.mode === 'approve' ? s.mode : cur.mode,
  }
}

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
  }

  switch (body.op) {
    case 'demo': {
      if (demoForced()) return NextResponse.json({ error: 'Demo mode stays on until DataForSEO is set up.' }, { status: 400 })
      const on = body.on === true
      await saveDemoSwitch(brandId, on)
      const data = await withDemo(on, async () => (await readLeadData(brandId)) ?? fallback())
      return NextResponse.json({ data, demo: on, message: on ? 'Demo mode on: made-up leads, nothing is sent.' : 'Demo mode off: real leads.' })
    }
    case 'settings': {
      const data = await updateLeadData(brandId, fallback, d => { d.settings = cleanSettings(d.settings, body.settings ?? {}) })
      if (!data.settings.enabled) await clearSignals(brandId, 'lead-agent', ['approvals']).catch(() => {})
      return NextResponse.json({ data })
    }
    case 'run': {
      const result = await runLeadAgent(brandId, { manual: true, deadline: Date.now() + 270_000 })
      return NextResponse.json({ result, data: await readLeadData(brandId) })
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
      const ids = d.leads.filter(l => l.status === 'ready' && l.email && l.draft).map(l => l.id)
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
        if (body.op === 'restore' && l.status === 'skipped') l.status = l.reply || (l.email && l.draft) ? 'ready' : 'needs_contact'
        if (body.op === 'restore' && l.status === 'replied') delete l.handledAt
        if (body.op === 'save') {
          if (l.draft && typeof body.subject === 'string' && typeof body.body === 'string') l.draft = { subject: body.subject.slice(0, 200), body: body.body.slice(0, 4000) }
          if (typeof body.reply === 'string' && l.reply !== undefined) l.reply = body.reply.slice(0, 4000)
        }
      })
      if (!data.leads.some(l => l.status === 'ready')) await clearSignals(brandId, 'lead-agent', ['approvals']).catch(() => {})
      return NextResponse.json({ data })
    }
    default:
      return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
  }
}
