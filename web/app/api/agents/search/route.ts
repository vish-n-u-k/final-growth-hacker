import { NextRequest, NextResponse } from 'next/server'
import { agentAccess } from '@/lib/agents/access'
import { demoForced, withDemo } from '@/lib/agents/demo'
import { loadBrandContext } from '@/lib/agents/context'
import { LOCATION_CODES } from '@/lib/agents/dataforseo'
import { runSearchResearch, runSearchWrite, searchFallback, setTopicStatus, refreshToTopic, ideaToTopic, tidySearchData } from '@/lib/agents/search-agent'
import { readSearchData, updateSearchData, type AgentTask, type SearchSettings, type Topic } from '@/lib/agents/store'
import { readDemoSwitch, saveDemoSwitch } from '@/lib/agents/store'
import { runLinkOpportunities, sendLinkPitch, updateLink } from '@/lib/agents/link-opportunities'
import { taskToPitch, writeDescription } from '@/lib/agents/task-help'
import { clearSignals } from '@/lib/signals'
import { ensureTracked, HOLD_DAYS, kwKey } from '@/lib/search-hub/verdict'
import { newId, suggestWording } from '@/lib/search-hub/pages'
import { buildSeoGeo } from '@/lib/search-hub/model'

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
  const d = await readSearchData(a.brandId)
  return NextResponse.json({ data: d ? await tidySearchData(a.brandId, b, d).catch(() => d) : searchFallback(b)() })
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
    id?: string; email?: string; subject?: string; body?: string; to?: string
    area?: string; path?: string; question?: string; what?: string
    inputs?: { example?: unknown; number?: unknown; opinion?: unknown }
  }
  // What only the business knows, typed before writing (each optional, kept short)
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 600) : undefined)
  const inputs = body.inputs ? { example: text(body.inputs.example), number: text(body.inputs.number), opinion: text(body.inputs.opinion) } : undefined

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
        const seeds = lines(s.seeds, 10, 60)
        // Typed-in keywords are kept as they are; an emptied list goes back to the agent
        if (seeds && seeds.join('\n') !== d.settings.seeds.join('\n')) {
          d.settings.seeds = seeds
          d.settings.seedsBy = seeds.length ? 'user' : 'auto'
        }
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
      const result = await runSearchWrite(brandId, typeof body.keyword === 'string' ? body.keyword : undefined, inputs)
      return NextResponse.json({ result, data: await readSearchData(brandId) })
    }
    case 'improve': {
      // A "Refresh a page" to-do becomes a page to rewrite (opened on the page, written from there)
      if (!body.key) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
      const r = await refreshToTopic(brandId, body.key)
      return NextResponse.json({ ...(r.ok ? { keyword: r.keyword } : { error: r.message }), data: await readSearchData(brandId) })
    }
    case 'idea': {
      // Keywords tab: "Write about this" turns a keyword idea into a post to write
      if (!body.keyword) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
      const r = await ideaToTopic(brandId, body.keyword)
      return NextResponse.json({ ...(r.ok ? {} : { error: r.message }), data: await readSearchData(brandId) })
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
    // ── Search & AI page (/search-ai): the tracked keywords ──
    case 'kw_add': case 'kw_swap': case 'kw_drop': case 'kw_keep': case 'kw_restore': {
      const k = kwKey(String(body.keyword ?? '')).slice(0, 80)
      const to = kwKey(String(body.to ?? '')).slice(0, 80)
      if (!k || (body.op === 'kw_swap' && !to)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
      const at = new Date().toISOString()
      const data = await updateSearchData(brandId, fallback, d => {
        ensureTracked(d)
        const list = d.tracked!
        const find = (x: string) => list.find(t => t.keyword === x)
        const add = (x: string, extra: Partial<NonNullable<typeof d.tracked>[number]> = {}) => {
          const t = find(x)
          if (t) Object.assign(t, { status: 'active', droppedAt: undefined, swappedTo: undefined, heldUntil: undefined }, extra)
          else list.push({ keyword: x, addedAt: at, by: 'user', status: 'active', ...extra })
        }
        const t = find(k)
        if (body.op === 'kw_add' || body.op === 'kw_restore') add(k)
        else if (body.op === 'kw_drop' && t) Object.assign(t, { status: 'dropped', droppedAt: at })
        else if (body.op === 'kw_keep' && t) t.heldUntil = new Date(Date.now() + HOLD_DAYS * 86_400_000).toISOString()
        else if (body.op === 'kw_swap') {
          if (t) Object.assign(t, { status: 'dropped', droppedAt: at, swappedTo: to })
          add(to, { swappedFrom: k })
        }
      })
      const msg = { kw_add: `Tracking “${k}”. We judge it after 6 weeks.`, kw_restore: `Tracking “${k}” again.`, kw_drop: `Stopped tracking “${k}”.`, kw_keep: `Keeping “${k}”. We look again in 4 weeks.`, kw_swap: `Swapped. Tracking “${to}” from today.` }[body.op]
      return NextResponse.json({ data, message: msg })
    }
    case 'kw_rewrite': {
      // A keyword whose page slipped: its page becomes a page to rewrite, written next with op 'write'
      const k = kwKey(String(body.keyword ?? ''))
      if (!k) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
      let keyword = k
      const data = await updateSearchData(brandId, fallback, d => {
        const snap = [...(d.rankHistory ?? [])].reverse().find(s => s.rows[k]?.url)
        const url = snap?.rows[k]?.url ?? d.ranks?.rows.find(r => kwKey(r.keyword) === k)?.url
        const t = d.topics.find(x => kwKey(x.keyword) === k)
        if (t) {
          keyword = t.keyword
          Object.assign(t, { status: 'picked', kind: url ? 'improve' : t.kind, pageUrl: url ?? t.pageUrl, blogId: undefined })
        } else {
          const idea = d.ideas?.rows.find(i => kwKey(i.keyword) === k)
          d.topics.push({
            keyword: k, volume: idea?.volume ?? 0, difficulty: idea?.difficulty ?? null, cpc: idea?.cpc ?? null,
            why: 'Its page slipped on Google. Rewrite it to win the place back.', status: 'picked', pickedAt: new Date().toISOString(),
            ...(url ? { kind: 'improve' as const, pageUrl: url } : { kind: 'new' as const }),
          })
        }
      })
      return NextResponse.json({ data, keyword })
    }
    // ── Search & AI page: changes being tested, and new wording for a page ──
    case 'change_add': {
      // "I've made this change": starts the 6-week clock. A page that switches to a new search keeps it.
      const area: 'seo' | 'geo' = body.area === 'geo' ? 'geo' : 'seo'
      const what = String(body.what ?? '').trim().slice(0, 80) || 'Your change'
      const at = new Date().toISOString()
      let error: string | null = null
      const data = await updateSearchData(brandId, fallback, d => {
        const model = buildSeoGeo(d, b)
        if (area === 'seo') {
          const page = (d.pages ?? []).find(x => x.path === body.path)
          const to = kwKey(String(body.to ?? body.keyword ?? page?.keyword ?? '')).slice(0, 80)
          if (!page || !to) { error = 'Pick a page and the search it should win.'; return }
          if (to !== page.keyword) { page.keyword = to; page.keywordBy = 'user' }
          page.sugg = undefined
          ensureTracked(d)
          if (!d.tracked!.some(t => t.keyword === to)) d.tracked!.push({ keyword: to, addedAt: at, by: 'user', status: 'active' })
          const rank = d.ranks?.rows.find(r => kwKey(r.keyword) === to)?.rank ?? model.pages.find(x => x.path === page.path)?.kw?.now ?? null
          for (const c of d.changes ?? []) if (c.status === 'testing' && c.area === 'seo' && c.path === page.path) c.status = 'stopped'
          d.changes = [...(d.changes ?? []), { id: newId(), area, path: page.path, keyword: to, what, at, by: 'user' as const, before: rank, status: 'testing' as const }].slice(-40)
        } else {
          const q = model.questions.find(x => x.question === body.question)
          if (!q) { error = 'That question isn’t in this week’s answers.'; return }
          for (const c of d.changes ?? []) if (c.status === 'testing' && c.area === 'geo' && c.question === q.question) c.status = 'stopped'
          d.changes = [...(d.changes ?? []), { id: newId(), area, question: q.question, what, at, by: 'user' as const, before: q.samples ? Math.round((100 * q.hits) / q.samples) : 0, status: 'testing' as const }].slice(-40)
        }
      })
      if (error) return NextResponse.json({ error, data })
      return NextResponse.json({ data, message: `Testing from today. You’ll know by ${new Date(Date.now() + 42 * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.` })
    }
    case 'change_stop': {
      const data = await updateSearchData(brandId, fallback, d => {
        const c = (d.changes ?? []).find(x => x.id === body.id)
        if (c) c.status = 'stopped'
      })
      return NextResponse.json({ data, message: 'Test stopped.' })
    }
    case 'page_suggest': {
      // New title / H1 / H2s / description for a page that needs a change, written once per keyword and verdict
      const d0 = await readSearchData(brandId)
      const page = d0?.pages?.find(x => x.path === body.path)
      const view = d0 ? buildSeoGeo(d0, b).pages.find(x => x.path === body.path) : null
      if (!page || !view || !view.keyword || (view.status !== 'change' && view.status !== 'refresh')) return NextResponse.json({ error: 'Nothing to rewrite on this page.' }, { status: 400 })
      const target = view.swap?.keyword ?? view.keyword
      const items = await suggestWording(b, page, target, view.status === 'refresh' ? 'refresh' : 'change', view.why).catch(e => (e instanceof Error ? e.message : 'failed'))
      if (typeof items === 'string') return NextResponse.json({ error: items })
      const data = await updateSearchData(brandId, fallback, d => {
        const p = d.pages?.find(x => x.path === body.path)
        if (p) p.sugg = { for: `${view.status}:${target}`, at: new Date().toISOString(), items }
      })
      return NextResponse.json({ data })
    }
    default:
      return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
  }
}
