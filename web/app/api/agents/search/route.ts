import { NextRequest, NextResponse } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { demoForced, withDemo } from '@/lib/agents/demo'
import { loadBrandContext } from '@/lib/agents/context'
import { LOCATION_CODES } from '@/lib/agents/dataforseo'
import { runSearchResearch, runSearchWrite, searchFallback, setTopicStatus } from '@/lib/agents/search-agent'
import { readSearchData, updateSearchData, type AgentTask, type SearchSettings, type Topic } from '@/lib/agents/store'
import { readDemoSwitch, saveDemoSwitch } from '@/lib/agents/store'
import { runLinkOpportunities, sendLinkPitch, updateLink } from '@/lib/agents/link-opportunities'
import { taskToPitch, writeDescription } from '@/lib/agents/task-help'
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
  return NextResponse.json({ data: (await readSearchData(a.brandId)) ?? searchFallback(b)() })
}

const lines = (v: unknown, max: number, len: number) =>
  Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean).map(x => x.slice(0, len)).slice(0, max) : null

export async function POST(req: NextRequest) { return inDemo(() => post(req)) }
async function post(req: NextRequest) {
  const a = await agentAccess()
  if (a.error) return a.error
  const brandId = a.brandId
  const b = await loadBrandContext(brandId)
  if (!b) return NextResponse.json({ error: 'No brand' }, { status: 404 })
  const fallback = searchFallback(b)
  const body = await req.json().catch(() => ({})) as {
    op?: string; on?: boolean; settings?: Partial<SearchSettings>; keyword?: string; status?: string; key?: string
    id?: string; email?: string; subject?: string; body?: string
  }

  switch (body.op) {
    case 'demo': {
      if (demoForced()) return NextResponse.json({ error: 'Demo mode stays on until DataForSEO is set up.' }, { status: 400 })
      const on = body.on === true
      await saveDemoSwitch(brandId, on)
      const data = await withDemo(on, async () => (await readSearchData(brandId)) ?? fallback())
      return NextResponse.json({ data, demo: on, message: on ? 'Demo mode on: made-up data, nothing is sent.' : 'Demo mode off: real data.' })
    }
    case 'settings': {
      const s = body.settings ?? {}
      const data = await updateSearchData(brandId, fallback, d => {
        if (typeof s.enabled === 'boolean') d.settings.enabled = s.enabled
        if (typeof s.country === 'string' && LOCATION_CODES[s.country]) d.settings.country = s.country
        d.settings.seeds = lines(s.seeds, 10, 60) ?? d.settings.seeds
        d.settings.questions = lines(s.questions, 15, 200) ?? d.settings.questions
      })
      if (!data.settings.enabled) await clearSignals(brandId, 'search-agent', data.tasks.map(t => t.key)).catch(() => {})
      return NextResponse.json({ data })
    }
    case 'research': {
      const result = await runSearchResearch(brandId)
      return NextResponse.json({ result, data: await readSearchData(brandId) })
    }
    case 'write': {
      const result = await runSearchWrite(brandId, typeof body.keyword === 'string' ? body.keyword : undefined)
      return NextResponse.json({ result, data: await readSearchData(brandId) })
    }
    case 'topic': {
      const allowed: Topic['status'][] = ['approved', 'published', 'skipped', 'picked']
      if (!body.keyword || !allowed.includes(body.status as Topic['status'])) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
      await setTopicStatus(brandId, body.keyword, body.status as Topic['status'])
      return NextResponse.json({ data: await readSearchData(brandId) })
    }
    case 'task': {
      const allowed: AgentTask['status'][] = ['open', 'done', 'dismissed']
      if (!body.key || !allowed.includes(body.status as AgentTask['status'])) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
      const data = await updateSearchData(brandId, fallback, d => {
        const t = d.tasks.find(x => x.key === body.key)
        if (t) t.status = body.status as AgentTask['status']
      })
      if (body.status !== 'open') await clearSignals(brandId, 'search-agent', [body.key]).catch(() => {})
      return NextResponse.json({ data })
    }
    case 'task_copy': {
      const r = await writeDescription(brandId)
      return NextResponse.json({ ...(r.ok ? {} : { error: r.message }), data: await readSearchData(brandId) })
    }
    case 'task_pitch': {
      if (!body.key) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
      const r = await taskToPitch(brandId, body.key)
      return NextResponse.json({ ...(r.ok ? { linkId: r.linkId } : { error: r.message }), data: await readSearchData(brandId) })
    }
    case 'links': {
      const result = await runLinkOpportunities(brandId)
      return NextResponse.json({ result, data: await readSearchData(brandId) })
    }
    case 'link_send': {
      if (!body.id) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
      const r = await sendLinkPitch(brandId, body.id, {
        email: typeof body.email === 'string' ? body.email.slice(0, 200) : undefined,
        subject: typeof body.subject === 'string' ? body.subject.slice(0, 200) : undefined,
        body: typeof body.body === 'string' ? body.body.slice(0, 5000) : undefined,
      })
      return NextResponse.json({ ...(r.ok ? { message: r.message } : { error: r.message }), data: await readSearchData(brandId) })
    }
    case 'link': {
      const allowed = ['won', 'skipped', 'new']
      if (!body.id || (body.status && !allowed.includes(body.status))) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
      await updateLink(brandId, body.id, {
        status: body.status as 'won' | 'skipped' | 'new' | undefined,
        email: typeof body.email === 'string' ? body.email.slice(0, 200) : undefined,
      })
      return NextResponse.json({ data: await readSearchData(brandId) })
    }
    default:
      return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
  }
}
