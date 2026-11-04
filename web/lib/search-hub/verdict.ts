// Search & AI page (/search-ai): every tracked keyword is judged from its weekly history. Pure functions
// (no I/O), so the server page and the browser use the same code. The page itself is shaped in model.ts.
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

import type { AiAnswer, IdeaRow, RankRow, RankSnapshot, SearchAgentData, TrackedKeyword } from '@/lib/agents/store'

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
    // The searches the brand's own pages target come first (Search & AI page)
    ...(d.pages ?? []).map(p => p.keyword ?? ''),
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
  // Buyer questions: answers that named the brand (Google AI Overviews answer keywords, not questions)
  const qs: Record<string, { hits: number; samples: number }> = {}
  for (const a of answers.filter(x => x.engine !== 'google_ai' && !x.error)) {
    const cur = qs[a.question] ?? { hits: 0, samples: 0 }
    cur.hits += a.hits ?? (a.mentioned ? 1 : 0)
    cur.samples += a.samples ?? 1
    qs[a.question] = cur
  }
  if (Object.keys(qs).length) snap.questions = qs
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
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
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
