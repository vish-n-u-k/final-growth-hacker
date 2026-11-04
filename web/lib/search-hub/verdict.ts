// Search & AI page (/search-ai): every tracked keyword is judged from its weekly history, and the
// page's to-dos, numbers and lists are shaped here from the Search Agent's saved data. Pure functions
// (no I/O), so the server page and the browser use the same code.
//
// Verdicts, checked in this order (thresholds below):
// - Refresh page: it reached the top 20, then sat 3+ places (5 on DataForSEO's estimate) below its
//   best on two checks in a row. The keyword is fine; the page needs a rewrite.
// - Keep: on page 1, or getting clicks while in the top 30, or up 5+ places over the last 4 checks.
// - Give it time: tracked under 6 weeks, or fewer than 3 checks.
// - Drop: not your buyers (the fit check said so), or never found after 8 weeks.
// - Change: after 6 weeks still outside the top 30 and not climbing: a closer, easier search is offered.
// - Anything else (#11-#30, steady): Keep.
// "Keep it" on a suggested change or drop holds the keyword for 4 weeks.

import type { AgentTask, AiAnswer, IdeaRow, RankRow, RankSnapshot, SearchAgentData, Topic, TrackedKeyword } from '@/lib/agents/store'

export type Verdict = 'keep' | 'wait' | 'change' | 'refresh' | 'drop'
export const VERDICT_LABEL: Record<Verdict, string> = { keep: 'Keep', wait: 'Give it time', change: 'Change', refresh: 'Refresh page', drop: 'Drop' }
export const ACTION_VERDICTS = new Set<Verdict>(['change', 'refresh', 'drop'])

const DAY = 86_400_000
const WEEK = 7 * DAY
export const JUDGE_AFTER_WEEKS = 6
export const DROP_AFTER_WEEKS = 8
export const HOLD_DAYS = 28
const MAX_TRACKED = 25
const HISTORY_KEEP = 16

export const kwKey = (k: string) => k.toLowerCase().replace(/\s+/g, ' ').trim()

// ── Which keywords are tracked ───────────────────────────────────────────────

/** Adds the starting keywords and the blog topics being written or published to the tracked list.
 *  A keyword the user dropped is never added back by itself. Returns true when something was added. */
export function ensureTracked(d: SearchAgentData, now = new Date()): boolean {
  const list = d.tracked ?? (d.tracked = [])
  const known = new Set(list.map(t => t.keyword))
  const want = [
    ...d.settings.seeds,
    ...d.topics.filter(t => t.status === 'drafted' || t.status === 'approved' || t.status === 'published' || t.status === 'writing').map(t => t.keyword),
  ].map(kwKey).filter(Boolean)
  let added = false
  for (const k of want) {
    if (known.has(k) || list.filter(t => t.status === 'active').length >= MAX_TRACKED) continue
    list.push({ keyword: k, addedAt: now.toISOString(), by: 'auto', status: 'active' })
    known.add(k)
    added = true
  }
  return added
}

/** One research's numbers for every tracked keyword, added to the history (last 16 kept). */
export function recordSnapshot(d: SearchAgentData, rows: RankRow[], source: 'gsc' | 'labs', answers: AiAnswer[], now = new Date()) {
  const byKw = new Map(rows.map(r => [kwKey(r.keyword), r]))
  const overview = new Map(answers.filter(a => a.engine === 'google_ai' && !a.error).map(a => [kwKey(a.question), a.mentioned]))
  const snap: RankSnapshot = { at: now.toISOString(), source, rows: {} }
  if (source === 'gsc') snap.clicks = rows.reduce((t, r) => t + (r.clicks ?? 0), 0)
  for (const t of (d.tracked ?? []).filter(x => x.status === 'active')) {
    const r = byKw.get(t.keyword)
    snap.rows[t.keyword] = {
      rank: r ? r.rank : null,
      ...(r?.url ? { url: r.url } : {}),
      ...(r?.clicks !== undefined ? { clicks: r.clicks } : {}),
      ...(r?.impressions !== undefined ? { impressions: r.impressions } : {}),
      ...(overview.has(t.keyword) ? { ai: overview.get(t.keyword) } : {}),
    }
  }
  d.rankHistory = [...(d.rankHistory ?? []), snap].slice(-HISTORY_KEEP)
}

// ── Judging one keyword ──────────────────────────────────────────────────────

export interface Point { at: string; rank: number | null; url?: string; clicks?: number; ai?: boolean }
export interface Swap { keyword: string; volume: number; difficulty: number | null; rank: number | null }
export interface KeywordView {
  keyword: string
  by: TrackedKeyword['by']
  addedAt: string
  weeks: number
  points: Point[]
  now: number | null
  best: number | null
  url: string | null
  clicks: number | null           // last 28 days (Search Console only)
  volume: number | null
  difficulty: number | null
  ai: { named: number; asked: number } | null   // Google AI Overviews, last 4 checks
  verdict: Verdict
  reason: string
  plan: string[]
  swap: Swap | null
  heldUntil: string | null
  swappedFrom: string | null
}

const STOP = new Set(['for', 'the', 'and', 'with', 'from', 'your', 'best', 'free', 'how', 'what', 'tool', 'tools', 'app', 'apps', 'online', 'small', 'business'])
const words = (k: string) => kwKey(k).split(' ').filter(w => w.length > 2 && !STOP.has(w))
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const place = (r: number | null) => (r === null ? 'not found' : `#${r}`)

/** A closer, easier search the same page can win: shares a real word, lower difficulty, some searches.
 *  Searches the site already shows up for come first. */
export function findSwap(keyword: string, difficulty: number | null, ideas: IdeaRow[], ranks: RankRow[], tracked: Set<string>): Swap | null {
  const mine = new Set(words(keyword))
  if (!mine.size) return null
  const rankOf = new Map(ranks.map(r => [kwKey(r.keyword), r.rank]))
  const pool = new Map<string, Swap>()
  for (const i of ideas) {
    if (i.verdict !== 'fit' && i.verdict !== 'picked' && i.verdict !== 'unchecked') continue
    pool.set(kwKey(i.keyword), { keyword: kwKey(i.keyword), volume: i.volume, difficulty: i.difficulty || null, rank: rankOf.get(kwKey(i.keyword)) ?? null })
  }
  for (const r of ranks) {
    const k = kwKey(r.keyword)
    if (!pool.has(k) && r.rank <= 40) pool.set(k, { keyword: k, volume: r.volume, difficulty: null, rank: r.rank })
  }
  const cap = difficulty === null ? 40 : difficulty - 10
  const ok = [...pool.values()].filter(c =>
    c.keyword !== kwKey(keyword) && !tracked.has(c.keyword) && c.volume >= 20
    && words(c.keyword).some(w => mine.has(w))
    && (c.difficulty === null ? c.rank !== null : c.difficulty <= cap))
  // Already showing up beats a lower difficulty; then more searches
  ok.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || (a.difficulty ?? 50) - (b.difficulty ?? 50) || b.volume - a.volume)
  return ok[0] ?? null
}

export function judgeKeyword(t: TrackedKeyword, d: SearchAgentData, now = new Date()): KeywordView {
  const history = d.rankHistory ?? []
  const lastSource = history[history.length - 1]?.source ?? d.ranks?.source ?? 'labs'
  // Compare like with like: only the checks from the latest source
  const snaps = history.filter(s => s.source === lastSource && t.keyword in s.rows)
  const points: Point[] = snaps.map(s => ({ at: s.at, ...s.rows[t.keyword] }))
  const ranks = points.map(p => p.rank)
  const cur = ranks.length ? ranks[ranks.length - 1] : null
  const known = ranks.filter((r): r is number => r !== null)
  const best = known.length ? Math.min(...known) : null
  const last = points[points.length - 1]
  const idea = (d.ideas?.rows ?? []).find(i => kwKey(i.keyword) === t.keyword)
  const rankRow = (d.ranks?.rows ?? []).find(r => kwKey(r.keyword) === t.keyword)
  const topic = d.topics.find(x => kwKey(x.keyword) === t.keyword)
  const volume = idea?.volume ?? rankRow?.volume ?? topic?.volume ?? null
  const difficulty = (idea?.difficulty || topic?.difficulty) || null
  const weeks = Math.max(0, Math.floor((now.getTime() - Date.parse(t.addedAt)) / WEEK))
  const aiPts = points.slice(-4).filter(p => p.ai !== undefined)
  const ai = aiPts.length ? { named: aiPts.filter(p => p.ai).length, asked: aiPts.length } : null
  const gsc = lastSource === 'gsc'
  const notFound = gsc ? 'Google didn’t show you for it' : 'not in DataForSEO’s list of your rankings'
  // Movement over the last 4 checks: positive = up
  const older = points.slice(-4)[0]?.rank ?? null
  const gain = older !== null && cur !== null ? older - cur : older !== null && cur === null ? -100 : 0
  const base = {
    keyword: t.keyword, by: t.by, addedAt: t.addedAt, weeks, points, now: cur, best,
    url: last?.url ?? rankRow?.url ?? topic?.pageUrl ?? null,
    clicks: gsc && last ? (last.clicks ?? 0) : null,
    volume, difficulty, ai, swap: null as Swap | null,
    heldUntil: t.heldUntil ?? null, swappedFrom: t.swappedFrom ?? null,
  }
  const out = (verdict: Verdict, reason: string, plan: string[], swap: Swap | null = null): KeywordView => {
    // "Keep it" on a suggested change: hold it for 4 weeks
    if ((verdict === 'change' || verdict === 'drop') && t.heldUntil && Date.parse(t.heldUntil) > now.getTime()) {
      return { ...base, verdict: 'wait', reason: `You chose to keep it. We look again on ${fmtDay(t.heldUntil)}. ${reason}`, plan: [] }
    }
    return { ...base, verdict, reason, plan, swap }
  }

  if (!points.length) {
    return out('wait', 'No check yet. The first numbers come with the next weekly check.', ['Nothing to do yet.'])
  }
  // Refresh: reached the top 20, then 3+ (5+ on estimates) below its best on the last two checks
  const slip = gsc ? 3 : 5
  const prev = ranks.length > 1 ? ranks[ranks.length - 2] : undefined
  const below = (r: number | null | undefined) => r === null || (r !== undefined && best !== null && r >= best + slip)
  const bestAt = best !== null ? ranks.indexOf(best) : -1
  if (best !== null && best <= 20 && points.length >= 3 && bestAt < ranks.length - 2 && below(cur) && below(prev)) {
    return out('refresh', `Was #${best}, now ${place(cur)}${cur === null ? ` (${notFound})` : ''}. It slipped on two checks in a row, so the page has likely been passed by newer ones.`,
      ['Keep the keyword, rewrite the page.', 'Bring it up to date and answer what the top results cover that it doesn’t.', 'Add a real example from your business.'])
  }
  if (cur !== null && cur <= 10) {
    return out('keep', `On page 1 (#${cur}).${base.clicks ? ` ${base.clicks} clicks in the last 28 days.` : ''}`, cur > 3 ? ['Keep it.', 'A short FAQ on the page can help it reach the top 3.'] : ['Keep it. Nothing to change.'])
  }
  if (cur !== null && cur <= 30 && (base.clicks ?? 0) > 0) {
    return out('keep', `#${cur} and bringing clicks (${base.clicks} in 28 days).`, ['Keep it.'])
  }
  if (idea?.verdict === 'off' && weeks >= 2) {
    return out('drop', 'Our fit check says the people searching this aren’t your buyers.', ['Stop tracking it.'])
  }
  if (weeks < JUDGE_AFTER_WEEKS || points.length < 3) {
    const move = known.length >= 2 ? (gain > 0 ? ` Up ${gain} places so far.` : gain < 0 && gain > -100 ? ` Down ${-gain} places so far.` : ' Not moving yet.') : ''
    const when = new Date(Date.parse(t.addedAt) + JUDGE_AFTER_WEEKS * WEEK)
    return out('wait', `Tracked for ${weeks} week${weeks === 1 ? '' : 's'}${cur !== null ? `, now #${cur}` : ''}.${move} New pages take a while on Google, so we judge it from ${fmtDay(when.toISOString())}.`, ['Nothing to do yet.'])
  }
  if (gain >= 5) {
    return out('keep', `Climbing: up ${gain} places over the last ${Math.min(4, points.length)} checks (now #${cur}).`, ['Keep it.'])
  }
  if (!known.length && weeks >= DROP_AFTER_WEEKS) {
    return out('drop', `${weeks} weeks and never found (${notFound}).${difficulty !== null && difficulty >= 50 ? ` It’s hard to win (difficulty ${difficulty}).` : ''}`,
      ['Stop tracking it.', 'Use the slot for an easier search from the ideas list.'])
  }
  if (cur === null || cur > 30) {
    const tracked = new Set((d.tracked ?? []).filter(x => x.status === 'active').map(x => x.keyword))
    const swap = findSwap(t.keyword, difficulty, d.ideas?.rows ?? [], d.ranks?.rows ?? [], tracked)
    return out('change', `${weeks} weeks in and ${cur === null ? notFound : `stuck at #${cur}`}${best !== null && cur !== best ? ` (best #${best})` : ''}.${difficulty !== null && difficulty >= 40 ? ` Big sites own page 1 (difficulty ${difficulty}).` : ''}`,
      swap ? ['Swap it for a closer search the same page can win.'] : ['We found no easier search yet. Drop it, or keep it a few more weeks.'], swap)
  }
  return out('keep', `#${cur}, close to page 1.`, ['Keep it.', 'A rewrite that answers more of the search could move it onto page 1.'])
}

// ── The whole page ───────────────────────────────────────────────────────────

export type TodoKind = 'refresh' | 'change' | 'drop' | 'fix' | 'write' | 'draft' | 'listing' | 'ads' | 'site'
export interface HubTodo {
  key: string
  kind: TodoKind
  title: string
  why: string
  keyword?: string        // keyword to-dos: opens the keyword
  taskKey?: string        // Search Agent to-dos
  href?: string           // where the work is done
  detail?: string
}
export interface SiteIssue { key: string; label: string; detail: string; module: 'SEO' | 'AI readiness'; href: string }
export interface QuestionView {
  question: string
  engines: { engine: string; hits: number; samples: number }[]
  instead: string[]
  cited: { domain: string; n: number }[]
}
export interface PostView { keyword: string; title: string; status: Topic['status']; kind: 'new' | 'improve'; rank: number | null; verdict: Verdict | null; clicks: number | null; blogId?: string }
export interface HubModel {
  keywords: KeywordView[]
  dropped: TrackedKeyword[]
  todos: HubTodo[]
  questions: QuestionView[]
  overviews: { keyword: string; named: boolean }[]
  posts: PostView[]
  ideas: IdeaRow[]
  stats: {
    clicks: number | null; clicksTrend: number[]
    page1: number; page1Trend: number[]; tracked: number; top20: number
    aiPct: number | null; aiTrend: number[]; aiAnswers: number
  }
  source: 'gsc' | 'labs'
  checkedAt: string | null
}

const ENGINE_ORDER = ['chat_gpt', 'perplexity', 'gemini']
export const ENGINE_NAME: Record<string, string> = { chat_gpt: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini', google_ai: 'Google AI Overview' }

function questionsOf(answers: AiAnswer[], brand: string): QuestionView[] {
  const byQ = new Map<string, AiAnswer[]>()
  for (const a of answers.filter(x => x.engine !== 'google_ai' && !x.error)) byQ.set(a.question, [...(byQ.get(a.question) ?? []), a])
  return [...byQ.entries()].map(([question, list]) => {
    const cites = new Map<string, number>()
    for (const a of list) for (const c of a.citations) if (c.domain) cites.set(c.domain, (cites.get(c.domain) ?? 0) + 1)
    return {
      question,
      engines: ENGINE_ORDER.map(e => {
        const a = list.find(x => x.engine === e)
        return { engine: e, hits: a ? (a.hits ?? (a.mentioned ? 1 : 0)) : 0, samples: a ? (a.samples ?? 1) : 0 }
      }),
      instead: [...new Set(list.flatMap(a => [...a.brands, ...(a.others ?? [])]))].filter(n => n.toLowerCase() !== brand.toLowerCase()).slice(0, 5),
      cited: [...cites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([domain, n]) => ({ domain, n })),
    }
  }).sort((a, b) => a.engines.reduce((t, e) => t + e.hits, 0) - b.engines.reduce((t, e) => t + e.hits, 0))
}

const TASK_KIND: Record<AgentTask['kind'], TodoKind> = { refresh: 'refresh', fix: 'fix', write: 'write', listing: 'listing', ads: 'ads' }
const ORDER: TodoKind[] = ['refresh', 'fix', 'change', 'drop', 'draft', 'write', 'listing', 'site', 'ads']

export function buildHub(d: SearchAgentData, brand: string, site: SiteIssue[] = [], now = new Date()): HubModel {
  const tracked = d.tracked ?? []
  const keywords = tracked.filter(t => t.status === 'active').map(t => judgeKeyword(t, d, now))
    .sort((a, b) => Number(ACTION_VERDICTS.has(b.verdict)) - Number(ACTION_VERDICTS.has(a.verdict)) || (a.now ?? 999) - (b.now ?? 999))
  const todos: HubTodo[] = []
  for (const k of keywords.filter(x => ACTION_VERDICTS.has(x.verdict))) {
    todos.push({
      key: `kw:${k.keyword}`, kind: k.verdict as TodoKind, keyword: k.keyword,
      title: k.verdict === 'refresh' ? `Rewrite the page for “${k.keyword}”` : k.verdict === 'change' ? `Change “${k.keyword}”` : `Stop tracking “${k.keyword}”`,
      why: k.reason,
    })
  }
  // The Search Agent's own to-dos (a refresh for a page already covered by a keyword above is left out)
  const kwPages = new Set(keywords.filter(k => k.verdict === 'refresh' && k.url).map(k => k.url))
  for (const t of d.tasks.filter(x => x.status === 'open')) {
    if (t.kind === 'refresh' && t.url && kwPages.has(t.url)) continue
    todos.push({ key: `task:${t.key}`, kind: TASK_KIND[t.kind], taskKey: t.key, title: t.title, why: t.detail, href: '/agents/search' })
  }
  for (const t of d.topics.filter(x => x.status === 'drafted')) {
    todos.push({ key: `draft:${t.keyword}`, kind: 'draft', title: `Read the draft for “${t.keyword}”`, why: t.kind === 'improve' ? 'A rewrite of your page is ready to read.' : 'A new post is ready to read and publish.', href: '/agents/search', keyword: kwKey(t.keyword) })
  }
  for (const s of site.slice(0, 3)) todos.push({ key: `site:${s.key}`, kind: 'site', title: s.label, why: s.detail, href: s.href, detail: s.module })
  todos.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))

  const history = d.rankHistory ?? []
  const lastSource = history[history.length - 1]?.source ?? d.ranks?.source ?? 'labs'
  const same = history.filter(s => s.source === lastSource)
  const active = new Set(keywords.map(k => k.keyword))
  const page1At = (s: RankSnapshot) => Object.entries(s.rows).filter(([k, p]) => active.has(k) && p.rank !== null && p.rank <= 10).length
  const counted = d.mentionHistory.slice(-4)
  const asked = counted.reduce((t, h) => t + h.asked, 0)
  const answers = d.answers?.items ?? []

  const rankNow = new Map(keywords.map(k => [k.keyword, k]))
  const posts: PostView[] = d.topics.filter(t => t.status !== 'skipped').map(t => {
    const k = rankNow.get(kwKey(t.keyword))
    const r = k?.now ?? (d.ranks?.rows ?? []).find(x => kwKey(x.keyword) === kwKey(t.keyword))?.rank ?? null
    return { keyword: t.keyword, title: t.keyword, status: t.status, kind: t.kind ?? 'new', rank: r, verdict: k?.verdict ?? null, clicks: k?.clicks ?? null, blogId: t.blogId }
  })

  return {
    keywords,
    dropped: tracked.filter(t => t.status === 'dropped').sort((a, b) => (b.droppedAt ?? '').localeCompare(a.droppedAt ?? '')),
    todos,
    questions: questionsOf(answers, brand),
    overviews: answers.filter(a => a.engine === 'google_ai' && !a.error).map(a => ({ keyword: a.question, named: a.mentioned })),
    posts,
    ideas: (d.ideas?.rows ?? []).filter(i => (i.verdict === 'fit' || i.verdict === 'picked') && !active.has(kwKey(i.keyword))).slice(0, 8),
    stats: {
      clicks: lastSource === 'gsc' ? (same[same.length - 1]?.clicks ?? null) : null,
      clicksTrend: same.map(s => s.clicks ?? 0),
      page1: keywords.filter(k => k.now !== null && k.now <= 10).length,
      page1Trend: same.map(page1At),
      tracked: keywords.length,
      top20: keywords.filter(k => k.now !== null && k.now > 10 && k.now <= 20).length,
      aiPct: asked ? Math.round((100 * counted.reduce((t, h) => t + h.mentioned, 0)) / asked) : null,
      aiTrend: d.mentionHistory.slice(-12).map(h => (h.asked ? Math.round((100 * h.mentioned) / h.asked) : 0)),
      aiAnswers: asked,
    },
    source: lastSource,
    checkedAt: d.lastResearchAt ?? null,
  }
}
