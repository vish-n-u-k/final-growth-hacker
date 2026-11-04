'use client'

// Search & AI (/search-ai), built from the approved preview design-previews/tools-cleanup/search-hub.html.
// One page for Google rankings (SEO), AI answers (AEO / GEO), the tracked keywords, blog posts and site
// checks. Every tracked keyword gets a verdict each week (lib/search-hub/verdict.ts): keep, give it
// time, change (with a closer, easier search to swap in), refresh the page, or drop. Nothing changes
// without the user's OK. Same data and API as the Search Agent (/api/agents/search).
// Calm rules: a quiet top line, one level of tabs, one green button per screen (Start here, or the main
// action of an opened item), grey everywhere else. Finishing an item opens the next.

import { useMemo, useState } from 'react'
import type { SearchAgentData } from '@/lib/agents/store'
import {
  ACTION_VERDICTS, DROP_AFTER_WEEKS, ENGINE_NAME, JUDGE_AFTER_WEEKS, VERDICT_LABEL, buildHub, ensureTracked, kwKey,
  type HubTodo, type KeywordView, type Point,
} from '@/lib/search-hub/verdict'
import type { SiteChecks } from '@/lib/search-hub/site'
import { useAgentApi, fmtAgo } from '@/components/agents/shared'
import { useToast } from '@/components/email-outreach/shared'
import { DemoSwitch, LiveProgress } from '@/components/tool-ui'

type Tab = 'todo' | 'keywords' | 'ai' | 'posts'
type View = { v: 'list' } | { v: 'kw'; k: string } | { v: 'todo'; key: string } | { v: 'how' } | { v: 'settings' } | { v: 'dropped' }
export interface SearchHubFlags { gsc: boolean; dataforseo: boolean; demo: boolean; demoForced: boolean }

const fmt = (n: number) => n.toLocaleString('en-US')
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const KIND_LABEL: Record<HubTodo['kind'], string> = {
  refresh: 'Refresh', change: 'Change', drop: 'Drop', fix: 'Fix', write: 'Write', draft: 'Read', listing: 'Get cited', ads: 'Ads', site: 'Site',
}
const CTA: Record<HubTodo['kind'], string> = {
  refresh: 'Review the rewrite', change: 'Review the change', drop: 'Review', fix: 'See the fix', write: 'See the question',
  draft: 'Read the draft', listing: 'See the site', ads: 'See the tip', site: 'Open the check',
}

// ── Small charts ─────────────────────────────────────────────────────────────

// Google position: #1 at the top. A square-root scale keeps #1-#10 apart while still reaching #100.
const yRank = (r: number, top: number, h: number) => top + Math.sqrt((Math.min(r, 100) - 1) / 99) * h

function RankSpark({ points }: { points: Point[] }) {
  const w = 90, h = 24
  if (!points.some(p => p.rank !== null)) return <svg className="sh-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><line x1="2" x2={w - 2} y1={h - 3} y2={h - 3} stroke="var(--line)" strokeDasharray="3 3" /></svg>
  const x = (i: number) => (points.length === 1 ? w - 4 : 2 + (i / (points.length - 1)) * (w - 6))
  let d = '', pen = false
  points.forEach((p, i) => { if (p.rank === null) { pen = false; return } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${yRank(p.rank, 2, h - 4).toFixed(1)}`; pen = true })
  const li = points.map(p => p.rank !== null).lastIndexOf(true)
  return (
    <svg className="sh-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={x(li)} cy={yRank(points[li].rank!, 2, h - 4)} r="2.4" fill="var(--text-dim)" />
    </svg>
  )
}

function AreaSpark({ vals }: { vals: number[] }) {
  const w = 160, h = 26
  if (vals.length < 2) return <svg className="sh-area" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><line x1="2" x2={w - 2} y1={h - 2} y2={h - 2} stroke="var(--line)" /></svg>
  const max = Math.max(...vals), min = Math.min(...vals)
  const pts = vals.map((v, i) => [2 + (i / (vals.length - 1)) * (w - 4), h - 3 - ((v - min) / (max - min || 1)) * (h - 6)])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('')
  return (
    <svg className="sh-area" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line}L${pts[pts.length - 1][0]} ${h}L2 ${h}Z`} fill="var(--line)" opacity=".6" />
      <path d={line} fill="none" stroke="var(--text-dim)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function RankChart({ points }: { points: Point[] }) {
  const W = 960, H = 220, L = 40, R = 16, T = 14, B = 26
  const x = (i: number) => (points.length === 1 ? (L + W - R) / 2 : L + (i / (points.length - 1)) * (W - L - R))
  const y = (r: number) => yRank(r, T, H - T - B)
  let d = ''
  let pen = false
  points.forEach((p, i) => { if (p.rank === null) { pen = false; return } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.rank).toFixed(1)}`; pen = true })
  const lastIdx = points.map(p => p.rank !== null).lastIndexOf(true)
  const every = Math.max(1, Math.ceil(points.length / 6))
  return (
    <svg className="sh-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Google position at each weekly check">
      {[1, 10, 30, 100].map(v => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--text-faint)">#{v}</text>
        </g>
      ))}
      {points.map((p, i) => (i % every === 0 || i === points.length - 1) && (
        <text key={p.at} x={x(i)} y={H - 6} textAnchor={points.length > 1 && i === points.length - 1 ? 'end' : points.length > 1 && i === 0 ? 'start' : 'middle'} fontSize="12" fill="var(--text-faint)">{day(p.at)}</text>
      ))}
      <path d={d} fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => p.rank !== null && <circle key={`c${p.at}`} cx={x(i)} cy={y(p.rank)} r={i === lastIdx ? 3.5 : 2} fill="var(--text-dim)" />)}
      {lastIdx >= 0
        ? <text x={x(lastIdx) - 8} y={y(points[lastIdx].rank!) - 8} textAnchor="end" fontSize="13" fontWeight="600" fill="var(--text)">#{points[lastIdx].rank}</text>
        : <text x={(W + L) / 2} y={H / 2} textAnchor="middle" fontSize="13" fill="var(--text-faint)">Not found yet</text>}
    </svg>
  )
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function SearchHubPage({ initial, brandName, site, countries, flags }: {
  initial: SearchAgentData; brandName: string; site: SiteChecks; countries: string[]; flags: SearchHubFlags
}) {
  const { data, busy, call } = useAgentApi<SearchAgentData>('/api/agents/search', initial)
  const [toast, notify] = useToast()
  const [tab, setTab] = useState<Tab>('todo')
  const [view, setView] = useState<View>({ v: 'list' })
  const [demo, setDemo] = useState(flags.demo)
  const [newKw, setNewKw] = useState('')
  const [writing, setWriting] = useState<string | null>(null)

  // Starting keywords and written topics count as tracked even before the next check saves them
  const hub = useMemo(() => {
    const d = structuredClone(data)
    ensureTracked(d)
    return buildHub(d, brandName, site.issues)
  }, [data, brandName, site.issues])
  const kwBy = useMemo(() => new Map(hub.keywords.map(k => [k.keyword, k])), [hub.keywords])
  const running = busy === 'research'
  const first = !data.lastResearchAt
  const go = (v: View) => { setView(v); window.scrollTo({ top: 0 }) }

  // Finishing an item opens the next one in the to-do list
  function next(doneKey: string, msg: string, undo?: () => void) {
    const left = hub.todos.filter(t => t.key !== doneKey)
    const fromTodo = tab === 'todo'
    if (fromTodo && left.length) {
      const n = left[0]
      go(n.keyword && n.kind !== 'draft' ? { v: 'kw', k: n.keyword } : { v: 'todo', key: n.key })
    } else go({ v: 'list' })
    notify(left.length || !fromTodo ? msg : `${msg} All caught up.`, undo)
  }

  async function kwAct(op: 'kw_swap' | 'kw_drop' | 'kw_keep', k: KeywordView) {
    const payload = op === 'kw_swap' ? { keyword: k.keyword, to: k.swap!.keyword } : { keyword: k.keyword }
    const j = await call(op, payload, `${op}:${k.keyword}`)
    if (!j || j.error) return
    const undo = op === 'kw_keep' ? undefined
      : op === 'kw_drop' ? () => { call('kw_restore', { keyword: k.keyword }) }
      : async () => { await call('kw_drop', { keyword: k.swap!.keyword }); await call('kw_restore', { keyword: k.keyword }) }
    next(`kw:${k.keyword}`, j.message ?? 'Done.', undo)
  }

  async function rewrite(k: KeywordView) {
    setWriting(k.keyword)
    const j = await call('kw_rewrite', { keyword: k.keyword }, `rewrite:${k.keyword}`) as ({ keyword?: string } & Record<string, unknown>) | null
    if (j?.keyword) await call('write', { keyword: j.keyword }, 'write')
    setWriting(null)
    next(`kw:${k.keyword}`, 'Rewrite drafted. Read it under Blog posts.')
  }

  async function taskAct(t: HubTodo, status: 'done' | 'dismissed') {
    if (!t.taskKey) return
    const j = await call('task', { key: t.taskKey, status }, `task:${t.taskKey}`)
    if (!j || j.error) return
    next(t.key, status === 'done' ? 'Marked done.' : 'Skipped.', () => { call('task', { key: t.taskKey, status: 'open' }) })
  }

  async function research() {
    go({ v: 'list' })
    await call('research', {}, 'research')
  }

  async function addKeyword(k: string) {
    const kw = kwKey(k)
    if (!kw) return
    const j = await call('kw_add', { keyword: kw }, `kw_add:${kw}`)
    if (j && !j.error) setNewKw('')
  }

  async function switchDemo(on: boolean) {
    const j = await call('demo', { on }, 'demo')
    if (j && !j.error) { setDemo(on); window.location.reload() }
  }

  // ── Header ──────────────────────────────────────────────────────────────────

  const aiReady = [site.seo?.score, site.geo?.score].filter((x): x is number => typeof x === 'number')
  function header() {
    const s = hub.stats
    return <>
      <nav className="lfp-crumbs" aria-label="Breadcrumb">Tools / Get seen</nav>
      <h1 className="lfp-title">Search &amp; AI</h1>
      <div className="lfp-line">
        <span>{running ? 'Checking…' : hub.checkedAt ? `Checked ${fmtAgo(hub.checkedAt)}` : 'Not checked yet'}{data.settings.enabled && hub.checkedAt ? ` · next check ${day(new Date(Date.parse(hub.checkedAt) + 7 * 86_400_000).toISOString())}` : ''}</span>
        <button type="button" className="lfp-link" onClick={() => go({ v: 'how' })}>How we judge keywords</button>
        <button type="button" className="lfp-link" onClick={() => go({ v: 'settings' })}>Settings</button>
        {!first && <button type="button" className="lfp-link" disabled={!!busy} onClick={research}>Check now</button>}
        {demo && <span>Demo: made-up data</span>}
      </div>
      {!flags.dataforseo && !demo && <div className="ag-note ag-note-warn">DataForSEO isn’t set up, so checks can’t run yet.</div>}
      {data.lastError && !running && <div className="ag-note ag-note-warn">The last check had a problem: {data.lastError}</div>}
      <LiveProgress agent="search" active={running || busy === 'write'} expectedMs={running ? 180_000 : 90_000}
        fallback={busy === 'write' ? ['Checking top results', 'Reading your page', 'Rewriting it', 'Saving the draft'] : ['Reading your brand', 'Checking Google rankings', 'Asking AI assistants', 'Judging your keywords']} />
      {view.v === 'list' && <>
        <div className="sh-stats">
          <div className="sh-stat">
            <span className="sh-stat-l">Clicks from Google</span>
            {s.clicks !== null
              ? <><b className="sh-stat-v">{fmt(s.clicks)}<small>in 28 days</small></b><AreaSpark vals={s.clicksTrend} /><span className="sh-stat-s">Search Console</span></>
              : <><b className="sh-stat-v sh-muted">—</b><AreaSpark vals={[]} /><span className="sh-stat-s">{flags.gsc ? 'After the next check' : <a href="/dashboard/keywords">Connect Search Console</a>}</span></>}
          </div>
          <div className="sh-stat">
            <span className="sh-stat-l">Keywords on page 1</span>
            <b className="sh-stat-v">{s.page1}<small>of {s.tracked}</small></b>
            <AreaSpark vals={s.page1Trend} />
            <span className="sh-stat-s">{s.top20 ? `${s.top20} more in the top 20` : hub.source === 'gsc' ? 'From Search Console' : 'DataForSEO’s estimate'}</span>
          </div>
          <div className="sh-stat">
            <span className="sh-stat-l">Named by AI</span>
            {s.aiPct !== null
              ? <><b className="sh-stat-v">{s.aiPct}%<small>of answers</small></b><AreaSpark vals={s.aiTrend} /><span className="sh-stat-s">4-week average, {s.aiAnswers} answers</span></>
              : <><b className="sh-stat-v sh-muted">—</b><AreaSpark vals={[]} /><span className="sh-stat-s">After the first check</span></>}
          </div>
          <div className="sh-stat">
            <span className="sh-stat-l">Site readiness</span>
            {aiReady.length
              ? <><b className="sh-stat-v">{Math.round(aiReady.reduce((a, b) => a + b, 0) / aiReady.length)}<small>/ 100</small></b><AreaSpark vals={[]} />
                <span className="sh-stat-s">{site.seo && <a href={site.seo.href}>SEO {site.seo.score}</a>}{site.seo && site.geo && ' · '}{site.geo && <a href={site.geo.href}>AI readiness {site.geo.score}</a>}</span></>
              : <><b className="sh-stat-v sh-muted">—</b><AreaSpark vals={[]} /><span className="sh-stat-s"><a href="/dashboard">Run the SEO and AI checks</a></span></>}
          </div>
        </div>
        <div className="sh-tabs" role="tablist">
          {([['todo', 'To do', hub.todos.length], ['keywords', 'Keywords', hub.keywords.length], ['ai', 'AI answers', hub.questions.length], ['posts', 'Blog posts', hub.posts.length]] as [Tab, string, number][]).map(([k, l, c]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className="sh-tab" onClick={() => setTab(k)}>{l}<small>{c}</small></button>
          ))}
        </div>
      </>}
    </>
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────

  function openTodo(t: HubTodo) {
    if (t.keyword && t.kind !== 'draft') go({ v: 'kw', k: t.keyword })
    else go({ v: 'todo', key: t.key })
  }

  function todoTab() {
    if (first) return (
      <section className="lfp-next sh-next">
        <div className="lfp-next-text">
          <b>Run the first check</b>
          <span>We check where you rank on Google, ask ChatGPT, Perplexity and Gemini about your field, and start tracking your keywords. About 3 minutes.</span>
        </div>
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={research}>Run the first check</button>
      </section>
    )
    if (!hub.todos.length) return (
      <div className="sh-done">
        <b>All caught up</b>
        <p>{data.settings.enabled ? 'We check every week and judge each keyword again.' : 'Turn on the weekly check in Settings so each keyword is judged again every week.'}</p>
        <button type="button" className="btn btn-primary" onClick={() => setTab('keywords')}>See your keywords</button>
      </div>
    )
    const [top, ...rest] = hub.todos
    return <>
      <section className="lfp-next sh-next">
        <div className="lfp-next-text">
          <b>{top.title}</b>
          <span>{top.why}</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openTodo(top)}>{CTA[top.kind]}</button>
      </section>
      {rest.length > 0 && <div className="sh-rest">
        <p className="sh-rest-h"><span>Then</span><span>{rest.length} more</span></p>
        {rest.map(t => (
          <button key={t.key} type="button" className="sh-row" onClick={() => openTodo(t)}>
            <span className="sh-kind">{KIND_LABEL[t.kind]}</span>
            <span className="sh-row-main"><b>{t.title}</b><span>{t.why}</span></span>
            <span className="sh-row-go">Open ›</span>
          </button>
        ))}
      </div>}
      <p className="sh-foot">Picked from your rankings, AI answers and site checks.</p>
    </>
  }

  function keywordsTab() {
    const count = (f: (k: KeywordView) => boolean) => hub.keywords.filter(f).length
    return <>
      <p className="sh-legend">
        <span><b>{count(k => k.verdict === 'keep')}</b> keep</span>
        <span><b>{count(k => k.verdict === 'wait')}</b> give it time</span>
        <span><b>{count(k => ACTION_VERDICTS.has(k.verdict))}</b> need a change</span>
        <button type="button" className="lfp-link" onClick={() => go({ v: 'how' })}>How we judge</button>
      </p>
      {hub.keywords.length ? <div className="sh-tbl-wrap"><table className="sh-tbl">
        <thead><tr><th>Keyword</th><th>Weekly</th><th className="num">Now</th><th className="num">Searches</th>{hub.source === 'gsc' && <th className="num">Clicks</th>}<th className="num">AI Overview</th><th>Verdict</th></tr></thead>
        <tbody>{hub.keywords.map(k => (
          <tr key={k.keyword} tabIndex={0} onClick={() => go({ v: 'kw', k: k.keyword })} onKeyDown={e => { if (e.key === 'Enter') go({ v: 'kw', k: k.keyword }) }}>
            <td className="sh-kw">{k.keyword}</td>
            <td><RankSpark points={k.points} /></td>
            <td className="num">{k.now !== null ? `#${k.now}` : <span className="sh-muted">—</span>}</td>
            <td className="num">{k.volume !== null ? fmt(k.volume) : <span className="sh-muted">—</span>}</td>
            {hub.source === 'gsc' && <td className="num">{k.clicks ?? 0}</td>}
            <td className="num">{k.ai ? `${k.ai.named} of ${k.ai.asked}` : <span className="sh-muted">—</span>}</td>
            <td><span className={`sh-verdict${ACTION_VERDICTS.has(k.verdict) ? ' is-act' : ''}`}>{VERDICT_LABEL[k.verdict]}{ACTION_VERDICTS.has(k.verdict) ? ' ›' : ''}</span></td>
          </tr>
        ))}</tbody>
      </table></div> : <p className="sh-empty">No keywords yet. The first check adds your starting keywords, or add one below.</p>}
      <form className="sh-add" onSubmit={e => { e.preventDefault(); addKeyword(newKw) }}>
        <label htmlFor="sh-add-kw">Track a keyword</label>
        <input id="sh-add-kw" value={newKw} onChange={e => setNewKw(e.target.value)} placeholder="e.g. instagram posts for etsy shops" maxLength={80} />
        <button type="submit" className="btn btn-ghost" disabled={!newKw.trim() || !!busy}>Track it</button>
      </form>
      {hub.ideas.length > 0 && <div className="sh-rest">
        <p className="sh-rest-h"><span>Ideas to track</span><span>Good fits from the last check</span></p>
        {hub.ideas.map(i => (
          <div key={i.keyword} className="sh-row is-static">
            <span className="sh-row-main"><b>{i.keyword}</b><span>{fmt(i.volume)} searches a month · {i.difficulty ? `difficulty ${i.difficulty}` : 'difficulty unknown'}</span></span>
            <button type="button" className="lfp-link" disabled={!!busy} onClick={() => addKeyword(i.keyword)}>Track it</button>
          </div>
        ))}
      </div>}
      <p className="sh-foot">
        <span>Each keyword gets {JUDGE_AFTER_WEEKS} weeks before we judge it.</span>
        {hub.dropped.length > 0 && <button type="button" className="lfp-link" onClick={() => go({ v: 'dropped' })}>Stopped tracking ({hub.dropped.length})</button>}
      </p>
    </>
  }

  function aiTab() {
    if (!hub.questions.length && !hub.overviews.length) return <p className="sh-empty">No AI answers yet. They come with the first check.</p>
    return <>
      <p className="sh-intro">Each week we ask buyer questions to ChatGPT, Perplexity and Gemini through their APIs, twice each, and read Google’s AI Overview for your keywords. A bar shows how often you were named. Answers vary, so watch the trend more than one week.</p>
      {hub.questions.map(q => {
        const hits = q.engines.reduce((t, e) => t + e.hits, 0), of = q.engines.reduce((t, e) => t + e.samples, 0)
        return (
          <div key={q.question} className="sh-q">
            <div className="sh-q-top"><b>{q.question}</b><span>Named in {hits} of {of}</span></div>
            <div className="sh-engines">{q.engines.map(e => (
              <div key={e.engine} className="sh-eng">
                <span>{ENGINE_NAME[e.engine]} · {e.samples ? `${e.hits}/${e.samples}` : 'no answer'}</span>
                <i><em style={{ width: `${e.samples ? (e.hits / e.samples) * 100 : 0}%` }} /></i>
              </div>
            ))}</div>
            {(q.instead.length > 0 || q.cited.length > 0) && <p className="sh-q-who">
              {q.instead.length > 0 && <>Named instead: {q.instead.join(', ')}</>}
              {q.instead.length > 0 && q.cited.length > 0 && ' · '}
              {q.cited.length > 0 && <>Cited: {q.cited.map(c => (c.n > 1 ? `${c.domain} (${c.n}×)` : c.domain)).join(', ')}</>}
            </p>}
          </div>
        )
      })}
      {hub.overviews.length > 0 && <div className="sh-rest">
        <p className="sh-rest-h"><span>Google AI Overviews</span><span>For your keywords</span></p>
        {hub.overviews.map(o => (
          <div key={o.keyword} className="sh-row is-static"><span className="sh-row-main"><b>{o.keyword}</b><span>{o.named ? `${brandName} is named` : `${brandName} isn’t named`}</span></span></div>
        ))}
      </div>}
      {data.description && <p className="sh-foot">How AI describes {brandName}: {data.description.issue ? data.description.issue : 'right'}</p>}
    </>
  }

  function postsTab() {
    const live = hub.posts.filter(p => p.status === 'published' || p.status === 'approved')
    const ready = hub.posts.filter(p => p.status === 'drafted' || p.status === 'writing')
    const ideas = hub.posts.filter(p => p.status === 'picked')
    if (!hub.posts.length) return <p className="sh-empty">No posts yet. Suggestions come with the first check.</p>
    const row = (p: (typeof hub.posts)[number], right: React.ReactNode, sub: string) => (
      <div key={p.keyword} className="sh-row is-static">
        <span className="sh-row-main"><b>{p.keyword}</b><span>{sub}</span></span>
        {right}
      </div>
    )
    return <>
      {live.length > 0 && <div className="sh-rest">
        <p className="sh-rest-h"><span>Published</span><span>Judged by the keyword each one targets</span></p>
        {live.map(p => row(p,
          p.verdict ? <button type="button" className="lfp-link" onClick={() => go({ v: 'kw', k: kwKey(p.keyword) })}>{VERDICT_LABEL[p.verdict]} ›</button> : <span className="sh-row-go">Not tracked</span>,
          [p.kind === 'improve' ? 'Rewrite of your page' : 'New post', p.rank !== null ? `#${p.rank} on Google` : 'not found on Google yet', p.clicks ? `${p.clicks} clicks` : null].filter(Boolean).join(' · ')))}
      </div>}
      {ready.length > 0 && <div className="sh-rest">
        <p className="sh-rest-h"><span>Ready to read</span><span>Publish them from the Search Agent</span></p>
        {ready.map(p => row(p, <a className="lfp-link" href="/agents/search">{p.status === 'writing' ? 'Writing…' : 'Read ›'}</a>, p.kind === 'improve' ? 'A rewrite of your page' : 'A new post'))}
      </div>}
      {ideas.length > 0 && <div className="sh-rest">
        <p className="sh-rest-h"><span>Suggested next</span><span>Searches you can realistically win</span></p>
        {ideas.map(p => {
          const t = data.topics.find(x => x.keyword === p.keyword)
          return row(p, <button type="button" className="lfp-link" disabled={!!busy} onClick={async () => { setWriting(p.keyword); await call('write', { keyword: p.keyword }, 'write'); setWriting(null) }}>{writing === p.keyword ? 'Writing…' : 'Write it ›'}</button>,
            [t?.volume ? `${fmt(t.volume)} searches a month` : null, t?.difficulty ? `difficulty ${t.difficulty}` : null, t?.why].filter(Boolean).join(' · '))
        })}
      </div>}
    </>
  }

  // ── Opened items ────────────────────────────────────────────────────────────

  const back = <button type="button" className="lfp-link sh-back" onClick={() => go({ v: 'list' })}>‹ Back</button>

  function keywordView(k: KeywordView) {
    const b = (op: string) => busy === `${op}:${k.keyword}`
    return <div className="sh-open">
      {back}
      <h2 className="sh-h2">“{k.keyword}”</h2>
      <p className="sh-sub">
        {k.swappedFrom ? `Swapped in for “${k.swappedFrom}”. ` : ''}Tracked for {k.weeks} week{k.weeks === 1 ? '' : 's'}{k.by === 'user' ? ' (added by you)' : ''}
        {k.url ? <> · page <a href={k.url} target="_blank" rel="noopener noreferrer">{k.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</a></> : ''}
      </p>
      <div className="sh-facts">
        <div><span>Now</span><b>{k.now !== null ? `#${k.now}` : '—'}</b></div>
        <div><span>Searches a month</span><b>{k.volume !== null ? fmt(k.volume) : '—'}</b></div>
        <div><span>Difficulty</span><b>{k.difficulty ?? '—'}</b></div>
        <div><span>{k.clicks !== null ? 'Clicks, 28 days' : 'AI Overview named you'}</span><b>{k.clicks !== null ? k.clicks : k.ai ? `${k.ai.named} of ${k.ai.asked}` : '—'}</b></div>
      </div>
      <div className="sh-chart">
        <div className="sh-chart-h"><span>Google position at each weekly check</span><span>{hub.source === 'gsc' ? 'Search Console' : 'DataForSEO’s estimate'}</span></div>
        {k.points.length ? <RankChart points={k.points} /> : <p className="sh-empty">The first point comes with the next check.</p>}
      </div>
      <div className="sh-call">
        <h3>{k.verdict === 'change' ? 'Our suggestion: change it' : k.verdict === 'refresh' ? 'Our suggestion: rewrite the page' : k.verdict === 'drop' ? 'Our suggestion: stop tracking it' : VERDICT_LABEL[k.verdict]}</h3>
        <p>{k.reason}</p>
        {k.verdict === 'change' && k.swap && <div className="sh-swap">
          <div><b>{k.keyword}</b><span>{k.volume !== null ? `${fmt(k.volume)} searches` : 'searches unknown'} · {k.difficulty !== null ? `difficulty ${k.difficulty}` : 'difficulty unknown'} · {k.now !== null ? `#${k.now}` : 'not found'}</span></div>
          <span className="sh-arrow" aria-hidden="true">→</span>
          <div><b>{k.swap.keyword}</b><span>{fmt(k.swap.volume)} searches · {k.swap.difficulty !== null ? `difficulty ${k.swap.difficulty}` : 'difficulty unknown'}{k.swap.rank !== null ? ` · you already show at #${k.swap.rank}` : ''}</span></div>
        </div>}
        {k.plan.length > 0 && k.verdict !== 'change' && <ul>{k.plan.map(p => <li key={p}>{p}</li>)}</ul>}
        {k.verdict === 'change' && !k.swap && <ul>{k.plan.map(p => <li key={p}>{p}</li>)}</ul>}
        <div className="sh-acts">
          {k.verdict === 'change' && k.swap && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => kwAct('kw_swap', k)}>{b('kw_swap') ? 'Swapping…' : 'Swap the keyword'}</button>}
          {k.verdict === 'change' && !k.swap && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => kwAct('kw_drop', k)}>Stop tracking</button>}
          {k.verdict === 'drop' && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => kwAct('kw_drop', k)}>{b('kw_drop') ? 'Stopping…' : 'Stop tracking'}</button>}
          {k.verdict === 'refresh' && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => rewrite(k)}>{writing === k.keyword ? 'Writing the rewrite…' : 'Draft the rewrite'}</button>}
          {(k.verdict === 'change' || k.verdict === 'drop') && <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => kwAct('kw_keep', k)}>Keep it 4 more weeks</button>}
          {k.verdict === 'refresh' && <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => go({ v: 'list' })}>Not now</button>}
          {!ACTION_VERDICTS.has(k.verdict) && <button type="button" className="lfp-link" disabled={!!busy} onClick={() => kwAct('kw_drop', k)}>Stop tracking it</button>}
        </div>
      </div>
    </div>
  }

  function todoView(t: HubTodo) {
    const external = t.href && t.href !== '/agents/search'
    return <div className="sh-open">
      {back}
      <span className="sh-eyebrow">{t.kind === 'site' ? t.detail : KIND_LABEL[t.kind]}</span>
      <h2 className="sh-h2">{t.title}</h2>
      <p className="sh-sub">{t.why}</p>
      <div className="sh-call">
        <h3>What to do</h3>
        <p>{t.kind === 'site' ? 'Open the check to see the fix. Some can be fixed for you.'
          : t.kind === 'draft' ? 'Read it, change what you like, and publish it from the Search Agent. We track its keyword from then on.'
          : t.kind === 'write' ? 'The Search Agent drafts the page from your product and the pages AI cites. You add one real example.'
          : t.kind === 'listing' ? 'The Search Agent finds who to write to and drafts a short pitch you send from your Gmail.'
          : t.kind === 'fix' ? 'The Search Agent writes new wording for your homepage and about page.'
          : 'Open it in the Search Agent for the details.'}</p>
        <div className="sh-acts">
          <a className="btn btn-primary" href={t.href ?? '/agents/search'}>{external ? 'Open the check' : 'Open in Search Agent'}</a>
          {t.taskKey && <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => taskAct(t, 'done')}>Mark done</button>}
          {t.taskKey && <button type="button" className="lfp-link" disabled={!!busy} onClick={() => taskAct(t, 'dismissed')}>Skip</button>}
        </div>
      </div>
    </div>
  }

  function howView() {
    const rows: [string, string][] = [
      ['Give it time', `Tracked under ${JUDGE_AFTER_WEEKS} weeks, or fewer than 3 checks. New pages take a while on Google, so we don’t judge early.`],
      ['Keep', 'On page 1, bringing clicks while in the top 30, or up 5+ places over the last 4 checks.'],
      ['Refresh page', 'It reached the top 20, then sat 3+ places below its best (5+ on DataForSEO’s estimate) on two checks in a row. The keyword is fine; the page is out of date, so we draft a rewrite.'],
      ['Change', `After ${JUDGE_AFTER_WEEKS} weeks still outside the top 30 and not climbing, usually because big sites own page 1. We suggest a closer search with lower difficulty that the same page can win.`],
      ['Drop', `Never found after ${DROP_AFTER_WEEKS} weeks, or our fit check says the people searching it aren’t your buyers.`],
    ]
    return <div className="sh-open">
      {back}
      <h2 className="sh-h2">How we judge keywords</h2>
      <p className="sh-sub">Every week we check each tracked keyword’s Google position ({flags.gsc ? 'from Search Console' : 'DataForSEO’s estimate until Search Console is connected'}), its clicks and whether Google’s AI Overview names you. Each keyword then gets one of five verdicts. Anything that needs a change becomes a to-do, and nothing changes without your OK. “Keep it 4 more weeks” holds a suggestion back.</p>
      <div className="sh-explain">{rows.map(([a, b]) => <div key={a}><b>{a}</b><p>{b}</p></div>)}</div>
      <p className="sh-foot">Your starting keywords and the topics you write are tracked by themselves. Add your own on the Keywords tab.</p>
    </div>
  }

  function settingsView() {
    return <div className="sh-open">
      {back}
      <h2 className="sh-h2">Settings</h2>
      <div className="sh-set">
        <label htmlFor="sh-on"><span><b>Check every week</b><span>Rankings, AI answers and your keywords’ verdicts</span></span>
          <input id="sh-on" type="checkbox" checked={data.settings.enabled} disabled={!!busy} onChange={e => call('settings', { settings: { enabled: e.target.checked } })} /></label>
        <label htmlFor="sh-country"><span><b>Country</b><span>For Google positions and searches a month</span></span>
          <select id="sh-country" value={data.settings.country} disabled={!!busy} onChange={e => call('settings', { settings: { country: e.target.value } })}>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <div className="sh-set-row"><span><b>Google Search Console</b><span>{flags.gsc ? 'Connected: rankings and clicks are real' : 'Not connected: rankings are DataForSEO’s estimate'}</span></span>
          <a className="lfp-link" href="/dashboard/keywords">{flags.gsc ? 'Change' : 'Connect'}</a></div>
        <div className="sh-set-row"><span><b>Starting keywords and buyer questions</b><span>{data.settings.seeds.length} keywords · {data.settings.questions.length} questions</span></span>
          <a className="lfp-link" href="/agents/search">Edit in Search Agent</a></div>
        <div className="sh-set-row"><span><b>Demo mode</b><span>Made-up data, nothing is sent</span></span>
          <DemoSwitch on={demo} forced={flags.demoForced} busy={busy === 'demo'} onChange={switchDemo} /></div>
      </div>
    </div>
  }

  function droppedView() {
    return <div className="sh-open">
      {back}
      <h2 className="sh-h2">Stopped tracking</h2>
      <p className="sh-sub">Keywords you dropped or swapped out. Bring one back any time.</p>
      <div className="sh-rest">
        {hub.dropped.map(t => (
          <div key={t.keyword} className="sh-row is-static">
            <span className="sh-row-main"><b>{t.keyword}</b><span>{t.swappedTo ? `Swapped for “${t.swappedTo}”` : 'Dropped'}{t.droppedAt ? ` on ${day(t.droppedAt)}` : ''}</span></span>
            <button type="button" className="lfp-link" disabled={!!busy} onClick={() => call('kw_restore', { keyword: t.keyword })}>Track again</button>
          </div>
        ))}
      </div>
    </div>
  }

  let body: React.ReactNode
  if (view.v === 'kw') { const k = kwBy.get(view.k); body = k ? keywordView(k) : back }
  else if (view.v === 'todo') { const t = hub.todos.find(x => x.key === view.key); body = t ? todoView(t) : back }
  else if (view.v === 'how') body = howView()
  else if (view.v === 'settings') body = settingsView()
  else if (view.v === 'dropped') body = droppedView()
  else body = tab === 'todo' ? todoTab() : tab === 'keywords' ? keywordsTab() : tab === 'ai' ? aiTab() : postsTab()

  return (
    <div className="tool-page lfp sh">
      {header()}
      {body}
      {toast}
    </div>
  )
}
