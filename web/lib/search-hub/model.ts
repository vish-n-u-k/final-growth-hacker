// Search & AI page (/search-ai), built from the approved preview design-previews/tools-cleanup/search-seo-geo.html.
// Shapes the Search Agent's saved data into the two tabs. Pure (no I/O): the server page and the
// browser use the same code.
//
// SEO: one card per page we read (homepage + main pages) with the search it targets, its Google
// position, and a status: Needs a change (update the page / change the keyword), Testing (a change is
// running, with a know-by date), Working, Waiting.
// GEO: one card per buyer question with who each AI assistant named, and a status: Not named,
// Testing, Named.
//
// Tests: a change (found at a check, or "I've made this change") is judged 6 weeks after it went live
// (first sign after 2). SEO: up 5+ places, or now on page 1 → working; up 1-4 → 2 more weeks (once);
// no move → needs a change. GEO: named in half the answers or more (average of the last 3 checks) →
// working; better than before → 2 more weeks (once); else not named.

import type { AiAnswer, SearchAgentData, SiteChange, SitePage } from '@/lib/agents/store'
import { judgeKeyword, kwKey, findSwap, type KeywordView, type Swap } from './verdict'

const DAY = 86_400_000
const WEEK = 7 * DAY
export const TEST_WEEKS = 6
export const FIRST_SIGN_WEEKS = 2
export const EXTRA_WEEKS = 2

export type SeoStatus = 'change' | 'refresh' | 'test' | 'working' | 'wait' | 'none'
export type GeoStatus = 'missing' | 'test' | 'named'
export type Zone = 'p1' | 'close' | 'far' | 'none'
export const zoneOf = (r: number | null): Zone => (r === null ? 'none' : r <= 10 ? 'p1' : r <= 30 ? 'close' : 'far')

export interface TestView {
  id: string
  what: string
  at: string
  by: SiteChange['by']
  firstSign: string
  knowBy: string
  progress: number              // 0..1 of the way to knowBy
  before: number | null
  now: number | null
  moved: number | null          // seo: places up (positive = better); geo: percentage points
  extended: boolean
}
export interface PageView {
  path: string
  url: string
  title: string
  h1: string
  h2s: string[]
  meta: string
  keyword: string | null
  kw: KeywordView | null
  status: SeoStatus
  why: string
  test: TestView | null
  swap: Swap | null             // change: the search to target instead
  sugg: SitePage['sugg'] | null // new wording, when written for this keyword and status
  // The searches Google really shows this page for (Search Console, else DataForSEO), best first
  real: { keyword: string; rank: number; impressions: number | null; clicks: number | null; volume: number | null }[]
  // Where the page stands: its target search if found, else the best search it really shows for
  stand: { keyword: string; rank: number | null }
  volume: number | null         // searches a month for the target (0 = too few to measure)
  difficulty: number | null
}
export interface QuestionView {
  question: string
  engines: { engine: string; hits: number; samples: number }[]
  hits: number
  samples: number
  instead: string[]
  cited: { domain: string; n: number }[]
  status: GeoStatus
  test: TestView | null
  trend: { at: string; pct: number | null }[]
  keyword: string | null        // the page keyword it's closest to
  todo: { title: string; why: string; href?: string }[]
}
export interface AddView { keyword: string; volume: number; difficulty: number | null; where: string }
export interface SeoGeoModel {
  pages: PageView[]
  adds: AddView[]
  questions: QuestionView[]
  geo: { pct: number | null; named: number; total: number; rival: string | null; cited: string | null }
  checkedAt: string | null
  source: 'gsc' | 'labs'
}

export const ENGINES = ['chat_gpt', 'perplexity', 'gemini', 'google_ai']
export const ENGINE_NAME: Record<string, string> = { chat_gpt: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini', google_ai: 'Google' }

const iso = (t: number) => new Date(t).toISOString()

/** Edit distance between two short words (for brand typos). */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]
}
/** The brand's name, a typo of it (1 letter off; 2 for names of 6+ letters when one is added or missing), or it with a few letters stuck on. */
export function isBrandWord(w: string, brandWord: string): boolean {
  if (w.length < 4) return false
  if (w === brandWord || (w.startsWith(brandWord) && w.length - brandWord.length <= 3)) return true
  const dist = editDistance(w, brandWord)
  if (dist <= 1) return true
  // Two letters off only for longer names, and only with a letter added or missing ("fraktok"),
  // not two swapped letters, which is usually a different word ("fresco")
  return dist === 2 && brandWord.length >= 6 && w.length !== brandWord.length
}
const STOP = new Set(['the', 'and', 'for', 'with', 'what', 'how', 'can', 'are', 'does', 'there', 'that', 'your', 'best', 'good', 'tool', 'tools', 'make', 'small'])
const words = (t: string) => kwKey(t).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length > 2 && !STOP.has(w))

function testView(c: SiteChange, now: number | null, before: number | null, better: (moved: number) => 'done' | 'more' | 'no', nowMs: number): { view: TestView; verdict: 'running' | 'working' | 'failed' } {
  const at = Date.parse(c.at)
  let knowBy = at + TEST_WEEKS * WEEK
  const moved = now === null && before === null ? null
    : c.area === 'seo' ? (before === null ? (now === null ? 0 : 100 - now) : now === null ? -(100 - before) : before - now)
    : (now ?? 0) - (before ?? 0)
  let extended = false
  let verdict: 'running' | 'working' | 'failed' = 'running'
  if (nowMs >= knowBy) {
    const r = better(moved ?? 0)
    if (r === 'done') verdict = 'working'
    else if (r === 'no') verdict = 'failed'
    else {
      // Moving, but slowly: 2 more weeks, once. Still not there after that = failed.
      extended = true
      knowBy += EXTRA_WEEKS * WEEK
      if (nowMs >= knowBy) verdict = 'failed'
    }
  }
  return {
    view: {
      id: c.id, what: c.what, at: c.at, by: c.by,
      firstSign: iso(at + FIRST_SIGN_WEEKS * WEEK), knowBy: iso(knowBy),
      progress: Math.max(0.03, Math.min(1, (nowMs - at) / (knowBy - at))),
      before, now, moved, extended,
    },
    verdict,
  }
}

function questionTodo(q: Omit<QuestionView, 'todo' | 'status' | 'test' | 'trend'>, brandDomain: string, hasWriteTask: boolean, keywordPage: string | null): QuestionView['todo'] {
  const out: QuestionView['todo'] = []
  const site = q.cited.find(c => c.domain !== brandDomain && !/(^|\.)google\.|vertexaisearch|youtube\.com|wikipedia\.org/.test(c.domain))
  if (site) out.push({ title: `Get on ${site.domain}`, why: `AI cited it in ${site.n} of these answers, and it leaves you out. We find who to write to and draft the pitch.`, href: '/agents/search' })
  out.push(hasWriteTask
    ? { title: 'Write a page that answers it', why: 'A page with this exact question as its heading, and a short, direct answer in the first lines.', href: '/agents/search' }
    : { title: 'Answer it on your site', why: `Add this exact question with a two-line answer as an FAQ${keywordPage ? ` on ${keywordPage === '/' ? 'your homepage' : keywordPage}` : ''}, with FAQ markup.` })
  out.push({ title: 'Say it plainly on your homepage', why: 'One sentence AI can quote, like “<brand> is a <what you do> for <who>.”, near the top.' })
  return out
}

export function buildSeoGeo(d: SearchAgentData, brand: { name: string; domain: string }, nowDate = new Date()): SeoGeoModel {
  const nowMs = nowDate.getTime()
  const tracked = new Map((d.tracked ?? []).map(t => [t.keyword, t]))
  const changes = (d.changes ?? []).filter(c => c.status === 'testing')
  const activeTracked = new Set((d.tracked ?? []).filter(t => t.status === 'active').map(t => t.keyword))
  const history = d.rankHistory ?? []

  // ── SEO ──
  // Every search the site shows up for, by the page Google shows for it
  const pathOf = (u: string) => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/' } catch { return '' } }
  const realBy = new Map<string, PageView['real']>()
  for (const r of d.ranks?.rows ?? []) {
    const path = pathOf(r.url)
    if (!path) continue
    realBy.set(path, [...(realBy.get(path) ?? []), { keyword: kwKey(r.keyword), rank: r.rank, impressions: r.impressions ?? null, clicks: r.clicks ?? null, volume: r.volume || null }])
  }
  // Most seen first (Search Console impressions, else searches a month), then best position
  for (const list of realBy.values()) list.sort((a, b) => (b.impressions ?? b.volume ?? 0) - (a.impressions ?? a.volume ?? 0) || a.rank - b.rank)
  const brandWords = [...new Set(words(brand.name).concat(words(brand.domain.split('.')[0])))].filter(w => w.length >= 4)
  // A search for the brand, typos included: "frektok", "fraktok" and "freekto" are people looking for Frekto
  const branded = (k: string) => {
    const ws = kwKey(k).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(Boolean)
    return ws.some(w => brandWords.some(b => isBrandWord(w, b))) || brandWords.some(b => kwKey(k).replace(/[^a-z0-9]/g, '').includes(b))
  }
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

  const pages: PageView[] = (d.pages ?? []).map(p => {
    const real = (realBy.get(p.path) ?? []).slice(0, 5)
    const base = { path: p.path, url: p.url, title: p.title, h1: p.h1, h2s: p.h2s, meta: p.meta, keyword: p.keyword, sugg: null as SitePage['sugg'] | null, swap: null as Swap | null, real }
    if (!p.keyword) {
      const top = real[0]
      return { ...base, kw: null, status: 'none' as const, test: null, volume: null, difficulty: null,
        stand: { keyword: top?.keyword ?? '', rank: top?.rank ?? null },
        why: top ? `This page doesn’t aim at one search. Google shows it for “${top.keyword}” (#${top.rank}).` : 'This page doesn’t aim at a search, and that’s fine for it.' }
    }
    const t = tracked.get(p.keyword) ?? { keyword: p.keyword, addedAt: p.readAt, by: 'auto' as const, status: 'active' as const }
    const kw = judgeKeyword(t, d, nowDate)
    const volume = kw.volume ?? (p.volFor === p.keyword ? p.volume ?? null : null)
    const difficulty = kw.difficulty ?? (p.volFor === p.keyword ? p.difficulty ?? null : null)
    const found = kw.now ?? real.find(r => r.keyword === p.keyword)?.rank ?? null
    // A page aimed at a buyer's search is judged on buyers' searches, not on people typing the brand name
    const brandPage = branded(p.keyword)
    const pool = brandPage ? real : real.filter(r => !branded(r.keyword))
    const top = pool[0] ?? null
    const byName = !brandPage ? real.find(r => branded(r.keyword)) ?? null : null
    // Only searches for the brand name don't put a buyer page on page 1: it stands at "not found" for its search
    const stand = found !== null ? { keyword: p.keyword, rank: found } : top ? { keyword: top.keyword, rank: top.rank } : { keyword: p.keyword, rank: null }
    const c = [...changes].reverse().find(x => x.area === 'seo' && x.path === p.path)
    let status: SeoStatus
    let why = kw.reason
    let test: TestView | null = null
    let swap: Swap | null = null
    const vol = volume === null ? '' : volume < 10 ? ` Almost nobody searches “${p.keyword}”.` : ` “${p.keyword}” gets about ${volume.toLocaleString('en-US')} searches a month.`
    if (c) {
      const r = testView(c, found, c.before, m => (m >= 5 || (found !== null && found <= 10) ? 'done' : m >= 1 ? 'more' : 'no'), nowMs)
      test = r.view
      if (r.verdict === 'running') { status = 'test'; why = `Testing ${c.what.toLowerCase()} since ${fmtDay(c.at)}.` }
      else if (r.verdict === 'working') { status = 'working'; why = `${c.what} worked: ${c.before === null ? 'not found' : `#${c.before}`} → ${found === null ? 'not found' : `#${found}`}.` }
      else { status = 'change'; why = `${c.what} didn’t move it (${c.before === null ? 'not found' : `#${c.before}`} → ${found === null ? 'not found' : `#${found}`}) after ${TEST_WEEKS} weeks. Try different wording, or a closer search.` }
    } else if (found === null) {
      // Judged on the first check: what Google really shows the page for, and whether anyone searches the target
      if (brandPage && top && top.rank <= 10) {
        status = 'working'
        why = `People find this page by your name: #${top.rank} for “${top.keyword}”. That’s what this page is for.`
      } else if (brandPage) {
        status = 'none'
        why = `This page is for people who already know ${brand.name}: they reach it from your site or by searching your name. Nothing to change.`
      } else if (top) {
        status = 'change'
        why = `Google shows this page for “${top.keyword}” (#${top.rank}${top.impressions ? `, seen ${top.impressions.toLocaleString('en-US')} times in 28 days` : ''}), not for “${p.keyword}”.${vol} Aim the title and H1 at what it already gets, or reword them so they clearly say “${p.keyword}”.`
        swap = { keyword: top.keyword, volume: top.volume ?? 0, difficulty: null, rank: top.rank }
      } else if (volume !== null && volume < 20) {
        status = 'change'
        why = `Google doesn’t show this page for any buyer’s search yet${byName ? ` (only for your name: “${byName.keyword}”, #${byName.rank})` : ''}, and almost nobody searches “${p.keyword}” (${volume < 10 ? 'too few to measure' : `${volume} a month`}). Aim it at a search people make.`
      } else {
        status = 'wait'
        const from = new Date(Date.parse(t.addedAt) + TEST_WEEKS * WEEK).toISOString()
        why = `Google doesn’t show this page for any buyer’s search yet${byName ? ` (only for your name: “${byName.keyword}”, #${byName.rank})` : ''}.${vol} New pages and new wording take 4 to 8 weeks to show up; we judge it from ${fmtDay(from)}.`
      }
    } else {
      status = kw.verdict === 'keep' ? 'working' : kw.verdict === 'wait' ? 'wait' : kw.verdict === 'refresh' ? 'refresh' : 'change'
    }
    if (status === 'change' && !swap) swap = kw.swap ?? findSwap(p.keyword, difficulty, d.ideas?.rows ?? [], d.ranks?.rows ?? [], activeTracked)
    const sugg = p.sugg && p.sugg.for === `${status}:${swap?.keyword ?? p.keyword}` ? p.sugg : null
    return { ...base, kw, status, why, test, swap, sugg, stand, volume, difficulty }
  })

  // Keywords to add: good-fit ideas no page targets yet; next to a page that shares a word, else a new post
  const targeted = new Set([...pages.map(p => p.keyword), ...pages.map(p => p.swap?.keyword)].filter((k): k is string => !!k))
  const adds: AddView[] = (d.ideas?.rows ?? [])
    .filter(i => (i.verdict === 'fit' || i.verdict === 'picked') && !targeted.has(kwKey(i.keyword)))
    .slice(0, 6)
    .map(i => {
      const w = new Set(words(i.keyword))
      // The page whose search shares the most real words (at least two), else a new post
      const near = pages.filter(p => p.keyword).map(p => ({ p, n: words(p.keyword!).filter(x => w.has(x)).length })).filter(o => o.n >= 2).sort((a, b) => b.n - a.n)[0]?.p
      return { keyword: kwKey(i.keyword), volume: i.volume, difficulty: i.difficulty || null, where: near ? `A section (H2) on ${near.path === '/' ? 'your homepage' : near.path}` : 'A new blog post' }
    })

  // ── GEO ──
  const answers = (d.answers?.items ?? []).filter(a => !a.error)
  const byQ = new Map<string, AiAnswer[]>()
  for (const a of answers.filter(x => x.engine !== 'google_ai')) byQ.set(a.question, [...(byQ.get(a.question) ?? []), a])
  const overview = new Map(answers.filter(a => a.engine === 'google_ai').map(a => [kwKey(a.question), a]))
  const writeTasks = new Set(d.tasks.filter(t => t.kind === 'write' && t.status === 'open').map(t => t.title))
  const rivals = new Map<string, number>(), citedAll = new Map<string, number>()
  const questions: QuestionView[] = [...byQ.entries()].map(([question, list]) => {
    const qw = new Set(words(question))
    const near = pages.filter(p => p.keyword).map(p => ({ p, n: words(p.keyword!).filter(x => qw.has(x)).length })).sort((a, b) => b.n - a.n)[0]
    const keyword = near && near.n > 0 ? near.p.keyword : null
    const ov = keyword ? overview.get(keyword) : undefined
    const engines = ENGINES.map(e => {
      if (e === 'google_ai') return ov ? { engine: e, hits: ov.mentioned ? 1 : 0, samples: 1 } : { engine: e, hits: 0, samples: 0 }
      const a = list.find(x => x.engine === e)
      return { engine: e, hits: a ? (a.hits ?? (a.mentioned ? 1 : 0)) : 0, samples: a ? (a.samples ?? 1) : 0 }
    })
    const cites = new Map<string, number>()
    for (const a of list) for (const c of a.citations) if (c.domain) { cites.set(c.domain, (cites.get(c.domain) ?? 0) + 1); citedAll.set(c.domain, (citedAll.get(c.domain) ?? 0) + 1) }
    const instead = [...new Set(list.flatMap(a => [...a.brands, ...(a.others ?? [])]))].filter(n => n.toLowerCase() !== brand.name.toLowerCase())
    instead.forEach(n => rivals.set(n, (rivals.get(n) ?? 0) + 1))
    const hits = engines.reduce((t, e) => t + e.hits, 0), samples = engines.reduce((t, e) => t + e.samples, 0)
    const trend = history.filter(s => s.questions?.[question]).map(s => ({ at: s.at, pct: s.questions![question].samples ? Math.round((100 * s.questions![question].hits) / s.questions![question].samples) : null }))
    const nearPath = keyword ? pages.find(p => p.keyword === keyword)?.path ?? null : null
    const core = { question, engines, hits, samples, instead: instead.slice(0, 5), cited: [...cites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([domain, n]) => ({ domain, n })), keyword }
    const hasWrite = [...writeTasks].some(t => t.includes(question))
    let status: GeoStatus = samples && hits * 2 >= samples ? 'named' : 'missing'
    let test: TestView | null = null
    const c = [...changes].reverse().find(x => x.area === 'geo' && x.question === question)
    if (c) {
      const last3 = trend.slice(-3).map(t => t.pct).filter((x): x is number => x !== null)
      const nowPct = last3.length ? Math.round(last3.reduce((a, b) => a + b, 0) / last3.length) : null
      const r = testView(c, nowPct, c.before, m => ((nowPct ?? 0) >= 50 ? 'done' : m > 0 ? 'more' : 'no'), nowMs)
      test = r.view
      status = r.verdict === 'running' ? 'test' : r.verdict === 'working' ? 'named' : 'missing'
    }
    return { ...core, status, test, trend, todo: questionTodo(core, brand.domain, hasWrite, nearPath) }
  })
  const order: Record<GeoStatus, number> = { missing: 0, test: 1, named: 2 }
  questions.sort((a, b) => order[a.status] - order[b.status] || a.hits - b.hits)
  const counted = questions.reduce((t, q) => t + q.engines.filter(e => e.engine !== 'google_ai').reduce((s, e) => s + e.samples, 0), 0)
  const namedHits = questions.reduce((t, q) => t + q.engines.filter(e => e.engine !== 'google_ai').reduce((s, e) => s + e.hits, 0), 0)
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  return {
    pages,
    adds,
    questions,
    geo: {
      pct: counted ? Math.round((100 * namedHits) / counted) : null,
      named: questions.filter(q => q.status === 'named').length,
      total: questions.length,
      rival: top(rivals),
      cited: top(new Map([...citedAll].filter(([dmn]) => dmn !== brand.domain && !/(^|\.)google\.|vertexaisearch/.test(dmn)))),
    },
    checkedAt: d.lastResearchAt ?? null,
    source: history[history.length - 1]?.source ?? d.ranks?.source ?? 'labs',
  }
}
