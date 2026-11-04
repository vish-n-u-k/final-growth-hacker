'use client'

// Search & AI (/search-ai), built from the approved preview design-previews/tools-cleanup/search-seo-geo.html
// (https://claude.ai/artifact/M8TBxFdsG4Vj5Lqxgdrhqx). Two tabs:
// - SEO: your homepage and main pages, the search each one targets, where it ranks on Google, and what
//   to change in its title / H1 / headings. Grouped by status, colour-coded.
// - GEO: buyer questions asked to ChatGPT, Perplexity, Gemini and Google's AI Overview: are you named,
//   who is instead, what to do.
// Every change (found at a check, or "I've made this change") is a test with a know-by date.
// "Recheck all keywords" runs the full check now (op 'research'); it also runs every week by itself.
// Data: the Search Agent's (/api/agents/search); shaped by lib/search-hub/model.ts.
// Colours (owner's call for this page): green working / named, blue testing, red needs a change /
// not named, grey waiting, purple keywords to add. Rank zones: green page 1, yellow close, orange far, grey not found.

import { useEffect, useMemo, useState } from 'react'
import type { SearchAgentData } from '@/lib/agents/store'
import { buildSeoGeo, ENGINE_NAME, zoneOf, TEST_WEEKS, FIRST_SIGN_WEEKS, type PageView, type QuestionView, type TestView, type SeoStatus, type GeoStatus, type Zone } from '@/lib/search-hub/model'
import type { SiteChecks } from '@/lib/search-hub/site'
import { useAgentApi, Toast } from '@/components/agents/shared'
import { DemoSwitch, LiveProgress } from '@/components/tool-ui'

type Tab = 'seo' | 'geo'
type View = { v: 'list' } | { v: 'page'; path: string } | { v: 'q'; q: string } | { v: 'how' } | { v: 'changed' } | { v: 'settings' }
export interface SearchHubFlags { gsc: boolean; dataforseo: boolean; demo: boolean; demoForced: boolean }

const fmt = (n: number) => n.toLocaleString('en-US')
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const pathName = (p: string) => (p === '/' ? 'Homepage' : p)
const rankText = (r: number | null) => (r === null ? 'not found' : `#${r}`)

// Colour per status and per rank zone (sa-c-* classes set --c / --cs)
const SEO_STATUS: Record<SeoStatus, { label: string; c: string }> = {
  change: { label: 'Needs a change', c: 'warn' }, refresh: { label: 'Needs a change', c: 'warn' },
  test: { label: 'Testing', c: 'test' }, working: { label: 'Working', c: 'good' }, wait: { label: 'Waiting', c: 'wait' }, none: { label: 'Waiting', c: 'wait' },
}
const GEO_STATUS: Record<GeoStatus, { label: string; c: string }> = { missing: { label: 'Not named', c: 'warn' }, test: { label: 'Testing', c: 'test' }, named: { label: 'Named', c: 'good' } }
const ZONES: { z: Zone; label: string; sub: string; c: string }[] = [
  { z: 'p1', label: 'Page 1', sub: '#1–10', c: 'good' },
  { z: 'close', label: 'Close', sub: '#11–30', c: 'amber' },
  { z: 'far', label: 'Far back', sub: '#31–100', c: 'orange' },
  { z: 'none', label: 'Not found', sub: 'not in top 100', c: 'wait' },
]
const zoneC = (r: number | null) => ZONES.find(z => z.z === zoneOf(r))!.c

function Legend({ items }: { items: [string, string][] }) {
  return <div className="sa-legend">{items.map(([c, l]) => <span key={l}><i className={`sa-dot sa-c-${c}`} />{l}</span>)}</div>
}
function Pill({ c, label, n }: { c: string; label: string; n?: number | string }) {
  return <span className={`sa-pill sa-c-${c}`}>{label}{n !== undefined && <b>{n}</b>}</span>
}
function Rank({ r }: { r: number | null }) {
  return <span className={`sa-rk sa-c-${zoneC(r)}`}>{r === null ? '—' : `#${r}`}</span>
}
function TestBar({ t }: { t: TestView }) {
  return <span className="sa-tb"><i><em style={{ width: `${t.progress * 100}%` }} /></i><span>Know by <b>{day(t.knowBy)}</b></span></span>
}

// Google position: #1 at the top; square-root scale keeps #1-#10 apart and still reaches #100
const yR = (r: number, top: number, h: number) => top + Math.sqrt((Math.min(r, 100) - 1) / 99) * h

function Spark({ ranks }: { ranks: (number | null)[] }) {
  const w = 120, h = 22
  if (!ranks.some(r => r !== null)) return <svg className="sa-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><line x1="2" x2={w - 2} y1={h - 3} y2={h - 3} stroke="var(--line)" strokeDasharray="3 3" /></svg>
  const x = (i: number) => (ranks.length === 1 ? w - 4 : 2 + (i / (ranks.length - 1)) * (w - 6))
  let d = '', pen = false
  ranks.forEach((r, i) => { if (r === null) { pen = false; return } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${yR(r, 2, h - 4).toFixed(1)}`; pen = true })
  const li = ranks.map(r => r !== null).lastIndexOf(true)
  return <svg className="sa-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={d} fill="none" stroke="var(--text-dim)" strokeWidth="1.5" /><circle cx={x(li)} cy={yR(ranks[li]!, 2, h - 4)} r="2.4" fill="var(--text-dim)" /></svg>
}

function Axis({ ats, x, H }: { ats: string[]; x: (i: number) => number; H: number }) {
  const every = Math.max(1, Math.ceil(ats.length / 6))
  return <>{ats.map((a, i) => (i % every === 0 || i === ats.length - 1) && (
    <text key={a + i} x={x(i)} y={H - 6} textAnchor={ats.length > 1 && i === 0 ? 'start' : ats.length > 1 && i === ats.length - 1 ? 'end' : 'middle'} fontSize="12" fill="var(--text-faint)">{day(a)}</text>
  ))}</>
}
function Marker({ ats, x, T, H, B, t }: { ats: string[]; x: (i: number) => number; T: number; H: number; B: number; t: TestView | null }) {
  if (!t || !ats.length) return null
  let i = ats.findIndex(a => Date.parse(a) >= Date.parse(t.at))
  if (i < 0) i = ats.length - 1
  return <g><line x1={x(i)} x2={x(i)} y1={T - 12} y2={H - B} stroke="var(--sa-test)" strokeDasharray="4 4" /><text x={x(i) - 6} y={T - 2} textAnchor="end" fontSize="12" fill="var(--sa-test)">{t.what} · {day(t.at)}</text></g>
}

function RankChart({ points, test }: { points: { at: string; rank: number | null }[]; test: TestView | null }) {
  const W = 900, H = 210, L = 40, R = 16, T = 24, B = 26, n = points.length
  const x = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i / (n - 1)) * (W - L - R))
  const y = (r: number) => yR(r, T, H - T - B)
  let d = '', pen = false
  points.forEach((p, i) => { if (p.rank === null) { pen = false; return } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.rank).toFixed(1)}`; pen = true })
  const li = points.map(p => p.rank !== null).lastIndexOf(true)
  return (
    <svg className="sa-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Google position at each check">
      {([[1, 10, 'good'], [10, 30, 'amber'], [30, 100, 'orange']] as const).map(([a, b, c]) => <rect key={c} x={L} width={W - L - R} y={y(a)} height={y(b) - y(a)} fill={`var(--sa-${c}-s)`} />)}
      {[1, 10, 30, 100].map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--text-faint)">#{v}</text></g>)}
      <Axis ats={points.map(p => p.at)} x={x} H={H} />
      <Marker ats={points.map(p => p.at)} x={x} T={T} H={H} B={B} t={test} />
      <path d={d} fill="none" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => p.rank !== null && <circle key={p.at} cx={x(i)} cy={y(p.rank)} r={i === li ? 3.6 : 2.2} fill="var(--text)" />)}
      {li >= 0
        ? <text x={x(li) - 8} y={y(points[li].rank!) + 18} textAnchor="end" fontSize="13" fontWeight="600" fill="var(--text)">#{points[li].rank}</text>
        : <text x={(W + L) / 2} y={H / 2} textAnchor="middle" fontSize="13" fill="var(--text-faint)">Not in the top 100 yet</text>}
    </svg>
  )
}

function PctChart({ points, test }: { points: { at: string; pct: number | null }[]; test: TestView | null }) {
  const W = 900, H = 170, L = 40, R = 16, T = 24, B = 26, n = points.length
  const x = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i / (n - 1)) * (W - L - R))
  const y = (v: number) => T + (1 - v / 100) * (H - T - B)
  const pts = points.map((p, i) => [x(i), y(p.pct ?? 0)])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('')
  return (
    <svg className="sa-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Share of answers that named you at each check">
      {[0, 50, 100].map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--text-faint)">{v}%</text></g>)}
      <Axis ats={points.map(p => p.at)} x={x} H={H} />
      <Marker ats={points.map(p => p.at)} x={x} T={T} H={H} B={B} t={test} />
      {n > 1 && <path d={`${line}L${pts[n - 1][0]} ${y(0)}L${pts[0][0]} ${y(0)}Z`} fill="var(--sa-good-s)" />}
      <path d={line} fill="none" stroke="var(--sa-good)" strokeWidth="2" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === n - 1 ? 3.6 : 2.2} fill="var(--sa-good)" />)}
    </svg>
  )
}

/** Words of the keyword, highlighted in the page's title and headings. */
function Hl({ text, keyword }: { text: string; keyword: string | null }) {
  const w = (keyword ?? '').split(' ').filter(x => x.length > 3).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!w.length || !text) return <>{text || '—'}</>
  const re = new RegExp(`\\b(${w.join('|')})\\b`, 'gi')
  const parts = text.split(re)
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>
}

/** "Started 4 Nov · Change date": an inline date picker that saves a new start date. */
function DateEdit({ label, at, max, busy, onSave }: { label: string; at: string; max: number; busy: boolean; onSave: (date: string) => void }) {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState(at.slice(0, 10))
  const maxDay = new Date(max).toISOString().slice(0, 10)
  const minDay = new Date(max - 365 * 86_400_000).toISOString().slice(0, 10)
  if (!open) return <span className="sa-date">{label} {day(at)} · <button type="button" className="lfp-link" onClick={() => { setVal(at.slice(0, 10)); setOpen(true) }}>Change date</button></span>
  return (
    <span className="sa-date">
      <label className="sa-date-in">{label}<input type="date" value={val} min={minDay} max={maxDay} onChange={e => setVal(e.target.value)} /></label>
      <button type="button" className="btn btn-ghost sa-sm" disabled={busy || !val} onClick={() => { onSave(val); setOpen(false) }}>Save</button>
      <button type="button" className="lfp-link" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  )
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function SearchHubPage({ initial, brandName, domain, site, countries, flags, now: serverNow }: {
  initial: SearchAgentData; brandName: string; domain: string; site: SiteChecks; countries: string[]; flags: SearchHubFlags
  now: number                   // the server's time, so the first render matches (progress bars, dates)
}) {
  const { data, busy, call, toast, say: notify } = useAgentApi<SearchAgentData>('/api/agents/search', initial)
  const [tab, setTab] = useState<Tab>('seo')
  const [view, setView] = useState<View>({ v: 'list' })
  const [demo, setDemo] = useState(flags.demo)
  const [form, setForm] = useState({ area: 'seo' as Tab, path: '', what: 'New title', to: '', question: '', geoWhat: '', date: '' })
  const [picked, setPicked] = useState<Record<string, string>>({})   // page path → the easier search chosen

  useEffect(() => { try { const t = localStorage.getItem('search-ai-tab'); if (t === 'seo' || t === 'geo') setTab(t) } catch { /* fine */ } }, [])
  const pickTab = (t: Tab) => { setTab(t); setView({ v: 'list' }); try { localStorage.setItem('search-ai-tab', t) } catch { /* fine */ } }
  const go = (v: View) => { setView(v); window.scrollTo({ top: 0 }) }

  // Same "now" on the server and in the browser; it moves on after each action
  const [now, setNow] = useState(serverNow)
  useEffect(() => { if (data !== initial) setNow(Date.now()) }, [data, initial])
  const m = useMemo(() => buildSeoGeo(data, { name: brandName, domain }, new Date(now)), [data, brandName, domain, now])
  const ago = (iso: string) => {
    const mins = Math.round((now - Date.parse(iso)) / 60_000)
    return mins < 2 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : day(iso)
  }
  const knowFromToday = day(new Date(now + TEST_WEEKS * 7 * 86_400_000).toISOString())
  const running = busy === 'research'
  const first = !data.lastResearchAt && !(data.pages ?? []).length

  async function recheck() {
    go({ v: 'list' })
    const j = await call('research', {}, 'research')
    const found = (j?.data as SearchAgentData | undefined)?.changes?.filter(c => c.by === 'auto' && Date.now() - Date.parse(c.at) < 10 * 60_000) ?? []
    if (found.length) notify(`Found ${found.length} change${found.length === 1 ? '' : 's'} on your site (${found.map(c => `${c.what.toLowerCase()} on ${c.path}`).join(', ')}). Testing from today.`)
  }
  async function startTest(payload: Record<string, unknown>) {
    const j = await call('change_add', payload, 'change_add')
    if (j && !j.error) { go({ v: 'list' }) }
  }
  async function switchDemo(on: boolean) {
    const j = await call('demo', { on }, 'demo')
    if (j && !j.error) { setDemo(on); window.location.reload() }
  }
  async function draftRewrite(p: PageView) {
    if (!p.keyword) return
    const j = await call('kw_rewrite', { keyword: p.keyword }, 'rewrite') as ({ keyword?: string } & Record<string, unknown>) | null
    if (j?.keyword) { const w = await call('write', { keyword: j.keyword }, 'write'); if (w && !w.error) notify('Rewrite drafted. Read it in the Search Agent under Posts.') }
  }
  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => notify('Copied.'), () => notify('Select the text to copy it.'))
  }

  // ── Header ──────────────────────────────────────────────────────────────────

  function header() {
    return <>
      <nav className="lfp-crumbs" aria-label="Breadcrumb">Tools / Get seen</nav>
      <h1 className="lfp-title">Search &amp; AI</h1>
      <div className="sa-top">
        <div className="lfp-line">
          <span>{running ? 'Rechecking…' : m.checkedAt ? <>Checked <b>{ago(m.checkedAt)}</b></> : 'Not checked yet'}{data.settings.enabled ? ' · checks itself every week' : ' · weekly check is off'}</span>
          <button type="button" className="lfp-link" onClick={() => go({ v: 'how' })}>How this works</button>
          <button type="button" className="lfp-link" onClick={() => go({ v: 'settings' })}>Settings</button>
          {demo && <span>Demo: made-up data</span>}
        </div>
        {!first && <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={recheck}>{running ? 'Rechecking…' : 'Recheck all keywords'}</button>}
      </div>
      {!flags.dataforseo && !demo && <div className="ag-note ag-note-warn">DataForSEO isn’t set up, so rankings and AI answers can’t be checked yet.</div>}
      {data.lastError && !running && <div className="ag-note ag-note-warn">The last check had a problem: {data.lastError}</div>}
      <LiveProgress agent="search" active={running || busy === 'write'} expectedMs={running ? 180_000 : 90_000}
        fallback={busy === 'write' ? ['Checking top results', 'Reading your page', 'Rewriting it', 'Saving the draft'] : ['Reading your pages', 'Checking Google positions', 'Asking AI assistants', 'Comparing with the last check']} />
      {view.v === 'list' && !first && <div className="sa-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'seo'} className="sa-tab" onClick={() => pickTab('seo')}>SEO<small>Google</small></button>
        <button type="button" role="tab" aria-selected={tab === 'geo'} className="sa-tab" onClick={() => pickTab('geo')}>GEO<small>AI answers</small></button>
      </div>}
    </>
  }

  // ── SEO tab ─────────────────────────────────────────────────────────────────

  function seoTab() {
    const withKw = m.pages.filter(p => p.keyword || p.stand.rank !== null)
    const groups: { c: string; title: string; st: SeoStatus[]; note?: string }[] = [
      { c: 'warn', title: 'Needs a change', st: ['change', 'refresh'], note: 'We write the new wording' },
      { c: 'test', title: 'Testing', st: ['test'], note: `${TEST_WEEKS} weeks per change` },
      { c: 'good', title: 'Working', st: ['working'] },
      { c: 'wait', title: 'Waiting', st: ['wait', 'none'], note: 'Too early to judge' },
    ]
    let firstFix = true
    const card = (p: PageView) => {
      const st = SEO_STATUS[p.status]
      let foot: React.ReactNode
      if (p.status === 'test' && p.test) foot = <TestBar t={p.test} />
      else if (p.status === 'change' || p.status === 'refresh') {
        foot = firstFix ? <span className="btn btn-primary sa-sm">Fix this first →</span> : <span className="sa-act">{p.status === 'refresh' ? 'Update the page' : p.swap ? 'Change the keyword' : 'Reword the page'} →</span>
        firstFix = false
      } else if (p.status === 'working') foot = <span className="sa-ok">Keep it</span>
      else foot = <span className="sa-mute">{p.status === 'none' ? (p.keyword ? 'For people who know you (fine)' : 'No search targeted (fine)') : 'Too early to judge'}</span>
      return (
        <button key={p.path} type="button" className={`sa-card sa-c-${st.c}`} onClick={() => go({ v: 'page', path: p.path })}>
          <span className="sa-card-top"><b>{pathName(p.path)}</b>{(p.keyword || p.stand.rank !== null) && <Rank r={p.stand.rank} />}</span>
          <span className="sa-card-kw">{p.keyword ? <>Aims at “{p.keyword}”</> : (p.h1 || p.title)}</span>
          {p.stand.rank !== null && p.stand.keyword !== p.keyword && <span className="sa-card-kw sa-shows">Google shows it for “{p.stand.keyword}”</span>}
          {p.hard && p.status !== 'working' && <span className="sa-card-kw sa-hard">Too competitive{p.difficulty ? `: difficulty ${p.difficulty}` : ''}</span>}
          {p.kw && p.kw.points.length > 0 && <Spark ranks={p.kw.points.map(x => x.rank)} />}
          <span className="sa-card-foot">{foot}</span>
        </button>
      )
    }
    if (!m.pages.length) return <p className="sa-empty">We couldn’t read your pages yet. Recheck, or check your website address in your brand settings.</p>
    const counts = ZONES.map(z => ({ z, list: withKw.filter(p => zoneOf(p.stand.rank) === z.z) }))
    return <>
      <Legend items={[['good', 'Working'], ['test', 'Testing'], ['warn', 'Needs a change'], ['wait', 'Waiting'], ['new', 'To add']]} />

      <section className="sa-sec">
        <h2 className="sa-h">Where you stand on Google</h2>
        {withKw.length > 0 && <div className="sa-zbar" role="img" aria-label="Your pages by Google position">
          {counts.filter(o => o.list.length).map(o => <span key={o.z.z} className={`sa-c-${o.z.c}`} style={{ flex: o.list.length }}>{o.list.length}</span>)}
        </div>}
        <div className="sa-zones">{counts.map(o => (
          <div key={o.z.z} className={`sa-zone sa-c-${o.z.c}`}>
            <div className="sa-zone-h"><b>{o.z.label}</b><span>{o.z.sub}</span></div>
            {o.list.length ? o.list.map(p => (
              <button key={p.path} type="button" className="sa-chip" title={pathName(p.path)} onClick={() => go({ v: 'page', path: p.path })}>{p.stand.keyword || p.keyword}{p.stand.rank ? <em>#{p.stand.rank}</em> : null}</button>
            )) : <span className="sa-zone-empty">None</span>}
          </div>
        ))}</div>
        <p className="sa-src">{m.source === 'gsc' ? 'Positions from Google Search Console.' : <>Positions are DataForSEO’s estimate. <a href="/dashboard/keywords">Connect Search Console</a> for real ones.</>}</p>
      </section>

      {groups.map(g => {
        const list = m.pages.filter(p => g.st.includes(p.status))
        if (!list.length) return null
        return <section key={g.title} className="sa-sec">
          <div className="sa-gh"><Pill c={g.c} label={g.title} n={list.length} />{g.note && <span>{g.note}</span>}</div>
          <div className="sa-cards">{list.map(card)}</div>
          {g.c === 'test' && <button type="button" className="lfp-link sa-gfoot" onClick={() => { setForm(f => ({ ...f, area: 'seo' })); go({ v: 'changed' }) }}>I changed something</button>}
        </section>
      })}
      {!m.pages.some(p => p.status === 'test') && <p className="sa-src"><button type="button" className="lfp-link" onClick={() => { setForm(f => ({ ...f, area: 'seo' })); go({ v: 'changed' }) }}>I changed something</button> · title and H1 changes are also spotted by themselves at each check.</p>}

      {m.adds.length > 0 && <section className="sa-sec">
        <div className="sa-gh"><Pill c="new" label="Keywords to add" n={m.adds.length} /><span>Searches your buyers make that no page aims at yet. From DataForSEO’s keyword ideas around your starting keywords, kept only when they fit your buyers.</span></div>
        <div className="sa-cards">{m.adds.map(a => (
          <div key={a.keyword} className="sa-card sa-c-new is-static">
            <span className="sa-card-top"><b>{a.keyword}</b><span className="sa-rk sa-c-new">+</span></span>
            <span className="sa-card-kw">{fmt(a.volume)} searches a month · {a.difficulty ? `difficulty ${a.difficulty}` : 'difficulty unknown'}</span>
            <span className="sa-card-foot"><span className="sa-mute">{a.where}</span>
              <button type="button" className="lfp-link" disabled={!!busy} onClick={async () => { const j = await call('idea', { keyword: a.keyword }, 'idea'); if (j && !j.error) notify(`“${a.keyword}” added to your posts to write in the Search Agent.`) }}>Plan it</button></span>
          </div>
        ))}</div>
      </section>}
    </>
  }

  // ── GEO tab ─────────────────────────────────────────────────────────────────

  function geoTab() {
    if (!m.questions.length) return <p className="sa-empty">No AI answers yet. They come with the next check.</p>
    const tileC = m.geo.pct === null ? 'wait' : m.geo.pct >= 50 ? 'good' : m.geo.pct >= 25 ? 'amber' : 'warn'
    let firstFix = true
    const card = (q: QuestionView) => {
      const st = GEO_STATUS[q.status]
      let foot: React.ReactNode
      if (q.status === 'test' && q.test) foot = <TestBar t={q.test} />
      else if (q.status === 'named') foot = <span className="sa-ok">Keep it up</span>
      else { foot = firstFix ? <span className="btn btn-primary sa-sm">Fix this first →</span> : <span className="sa-act">{q.todo[0]?.title} →</span>; firstFix = false }
      return (
        <button key={q.question} type="button" className={`sa-card sa-c-${st.c}`} onClick={() => go({ v: 'q', q: q.question })}>
          <span className="sa-card-top"><b>{q.question}</b><span className={`sa-rk sa-c-${q.samples && q.hits * 2 >= q.samples ? 'good' : 'warn'}`}>{q.hits}/{q.samples}</span></span>
          <span className="sa-engs">{q.engines.map(e => (
            <span key={e.engine} className="sa-eg"><small>{ENGINE_NAME[e.engine]}</small>
              {e.samples ? Array.from({ length: e.samples }, (_, k) => <i key={k} className={k < e.hits ? 'y' : 'n'} />) : <em>—</em>}</span>
          ))}</span>
          <span className="sa-card-foot">{foot}</span>
        </button>
      )
    }
    const groups: { c: string; title: string; st: GeoStatus; note?: string }[] = [
      { c: 'warn', title: 'Not named', st: 'missing', note: 'Others are named instead' },
      { c: 'test', title: 'Testing', st: 'test', note: `${TEST_WEEKS} weeks per change` },
      { c: 'good', title: 'Named', st: 'named' },
    ]
    const todo = site.aiChecks.filter(c => !c.ok).length
    return <>
      <Legend items={[['good', 'Named'], ['test', 'Testing'], ['warn', 'Not named']]} />
      <section className="sa-sec">
        <h2 className="sa-h">Where you stand in AI answers</h2>
        <div className="sa-tiles">
          <div className={`sa-tile sa-c-${tileC}`}><b>{m.geo.pct === null ? '—' : `${m.geo.pct}%`}</b><span>of AI answers name you</span>{m.geo.pct !== null && <i><em style={{ width: `${m.geo.pct}%` }} /></i>}</div>
          <div className="sa-tile sa-c-good"><b>{m.geo.named} of {m.geo.total}</b><span>questions you’re named for</span></div>
          <div className="sa-tile sa-c-wait"><b>{m.geo.rival ?? '—'}</b><span>named most instead of you</span></div>
          <div className="sa-tile sa-c-wait"><b>{m.geo.cited ?? '—'}</b><span>site AI cites most</span></div>
        </div>
      </section>
      {groups.map(g => {
        const list = m.questions.filter(q => q.status === g.st)
        if (!list.length) return null
        return <section key={g.title} className="sa-sec">
          <div className="sa-gh"><Pill c={g.c} label={g.title} n={list.length} />{g.note && <span>{g.note}</span>}</div>
          <div className="sa-cards one">{list.map(card)}</div>
          {g.c === 'test' && <button type="button" className="lfp-link sa-gfoot" onClick={() => { setForm(f => ({ ...f, area: 'geo' })); go({ v: 'changed' }) }}>I changed something</button>}
        </section>
      })}
      {site.aiChecks.length > 0 && <section className="sa-sec">
        <div className="sa-gh"><Pill c={todo ? 'warn' : 'good'} label="Site ready for AI" n={`${site.aiChecks.length - todo}/${site.aiChecks.length}`} /></div>
        <div className="sa-checks">{site.aiChecks.map(c => (
          <div key={c.key} className={`sa-ck sa-c-${c.ok ? 'good' : 'warn'}`} title={c.detail}>
            <i>{c.ok ? '✓' : '!'}</i><span>{c.label}</span>{!c.ok && site.geo && <a className="lfp-link" href={site.geo.href}>Fix</a>}
          </div>
        ))}</div>
      </section>}
      <p className="sa-src">Questions are asked twice a week to ChatGPT, Perplexity and Gemini through their APIs, so the numbers show a direction, not an exact score. <a href="/agents/search">Edit the questions</a></p>
    </>
  }

  // ── Opened page ─────────────────────────────────────────────────────────────

  const back = <button type="button" className="lfp-link sa-back" onClick={() => go({ v: 'list' })}>‹ Back</button>

  function testBox(t: TestView, kind: Tab) {
    const unit = (v: number | null) => (kind === 'seo' ? rankText(v) : v === null ? '—' : `${v}%`)
    return <div className="sa-call sa-c-test">
      <h3>Testing: {t.what.charAt(0).toLowerCase() + t.what.slice(1)} since {day(t.at)}{t.by === 'auto' ? ' (spotted at a check)' : ''}</h3>
      <div className="sa-wait"><span>{day(t.at)}</span><i><em style={{ width: `${t.progress * 100}%` }} /></i><span>know by {day(t.knowBy)}</span></div>
      <p>Was {unit(t.before)}, now {unit(t.now)}. {now < Date.parse(t.firstSign)
        ? `${kind === 'seo' ? 'Google needs 1 to 2 weeks to re-read the page' : 'AI that searches the web needs 1 to 3 weeks to pick it up'}, so the first sign comes around ${day(t.firstSign)}.`
        : t.moved !== null && t.moved > 0 ? 'Moving the right way.' : 'No clear move yet.'}
        {t.extended ? ' It’s moving slowly, so we gave it 2 more weeks.' : ''} On {day(t.knowBy)} you’ll get one of three answers:</p>
      <ul>
        <li><b>Working</b>: {kind === 'seo' ? 'up 5 or more places, or on page 1' : 'named in half the answers or more'}. Keep it.</li>
        <li><b>2 more weeks</b>: moving, but slowly (once).</li>
        <li><b>Needs a change</b>: no move. We suggest something else.</li>
      </ul>
      <div className="sa-acts">
        <DateEdit label="Started" at={t.at} max={now} busy={!!busy} onSave={d => call('change_date', { id: t.id, at: d }, 'date')} />
        <button type="button" className="lfp-link" disabled={!!busy} onClick={() => call('change_stop', { id: t.id })}>Stop this test</button>
      </div>
    </div>
  }

  function pageView(p: PageView) {
    const st = SEO_STATUS[p.status]
    const options = p.alts.length ? p.alts : []
    const target = (picked[p.path] && options.some(a => a.keyword === picked[p.path]) ? picked[p.path] : null) ?? p.swap?.keyword ?? p.keyword
    let box: React.ReactNode
    if (p.status === 'test' && p.test) box = testBox(p.test, 'seo')
    else if (p.status === 'working') box = <div className="sa-call sa-c-good"><h3>Working. Keep it.</h3><p>{p.why}</p></div>
    else if (p.status === 'wait' || p.status === 'none') box = <div className="sa-call sa-c-wait"><h3>{p.keyword ? 'Give it time' : 'No search targeted'}</h3><p>{p.why}</p></div>
    else {
      const isChange = p.status === 'change'
      box = <div className="sa-call sa-c-warn">
        <h3>{isChange ? (p.swap ? 'Change the search this page targets' : 'Reword the page') : 'Update the page, keep the search'}</h3>
        <p>{p.why}</p>
        {isChange && options.length > 1 ? <div className="sa-alts" role="radiogroup" aria-label="Easier searches you can win">
          <p className="sa-alts-h">Easier searches you can win (difficulty {m.reach} or less for a site like yours). Pick one:</p>
          {options.map(a => (
            <label key={a.keyword} className={`sa-alt${target === a.keyword ? ' is-on' : ''}`}>
              <input type="radio" name={`alt-${p.path}`} checked={target === a.keyword} onChange={() => setPicked(x => ({ ...x, [p.path]: a.keyword }))} />
              <b>{a.keyword}</b><span>{fmt(a.volume)} searches a month · {a.difficulty !== null ? `difficulty ${a.difficulty}` : 'difficulty unknown'}{a.rank ? ` · you’re #${a.rank}` : ''}</span>
            </label>
          ))}
        </div> : isChange && p.swap && <p className="sa-new">Aim it at: <b>{p.swap.keyword}</b>{p.swap.rank ? ` · Google already shows you at #${p.swap.rank}` : ''}{p.swap.volume ? ` · ${fmt(p.swap.volume)} searches a month` : ''}{p.swap.difficulty ? ` · difficulty ${p.swap.difficulty}` : ''}</p>}
        {p.sugg && p.sugg.for.endsWith(`:${target}`) ? <div className="sa-sugg">{p.sugg.items.map((s, i) => (
          <div key={i}><span>{s.tag}</span><b>{s.text}{s.tag !== 'H2' && <em>now: {s.tag === 'Title' ? p.title : s.tag === 'H1' ? p.h1 : p.meta}</em>}{s.tag === 'H2' && <em>new section</em>}</b>
            <button type="button" className="lfp-link" onClick={() => copy(s.text)}>Copy</button></div>
        ))}</div> : <p><button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => call('page_suggest', { path: p.path, to: target }, 'suggest')}>{busy === 'suggest' ? 'Writing…' : `Write the new wording${target && target !== p.keyword ? ` for “${target}”` : ''}`}</button></p>}
        <p>Make the change on your site, then press the button. We start the clock and tell you by {knowFromToday} whether it worked.</p>
        <div className="sa-acts">
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => startTest({ area: 'seo', path: p.path, to: target, what: isChange ? 'New title and H1' : 'Updated page' })}>I’ve made this change</button>
          <button type="button" className="lfp-link" onClick={() => { setForm(f => ({ ...f, area: 'seo', path: p.path, to: target ?? '', what: isChange ? 'New title and H1' : 'Rewrote the page', date: '' })); go({ v: 'changed' }) }}>Made it on an earlier day?</button>
          {!isChange && <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => draftRewrite(p)}>{busy === 'write' || busy === 'rewrite' ? 'Writing…' : 'Draft the full rewrite'}</button>}
          <button type="button" className="lfp-link" onClick={() => go({ v: 'list' })}>Not now</button>
        </div>
      </div>
    }
    const points = p.kw?.points ?? []
    return <div className="sa-open">
      {back}
      <h2 className="sa-h2">{pathName(p.path)}</h2>
      <div className="sa-gh"><Pill c={st.c} label={st.label} />{p.keyword && <Rank r={p.kw?.now ?? null} />}</div>
      <p className="sa-sub">{p.keyword ? <>Aims at “{p.keyword}”{p.volume !== null ? ` · ${p.volume < 10 ? 'too few searches to measure' : `${fmt(p.volume)} searches a month`}` : ''}{p.difficulty ? ` · difficulty ${p.difficulty}${p.hard ? ' (too competitive for now)' : ''}` : ''} · </> : null}<a href={p.url} target="_blank" rel="noopener noreferrer">open the page ↗</a></p>
      {p.keyword && p.since && !p.test && <div className="sa-since"><DateEdit label="Aiming at this since" at={p.since} max={now} busy={!!busy} onSave={d => call('kw_since', { keyword: p.keyword, at: d }, 'date')} /></div>}
      <div className="sa-real">
        <h3 className="sa-real-h">Searches Google shows this page for</h3>
        {p.real.length ? <ul>{p.real.map(r => (
          <li key={r.keyword}><Rank r={r.rank} /><span>{r.keyword}</span><small>{[r.impressions !== null ? `seen ${fmt(r.impressions)}×` : null, r.clicks !== null ? `${fmt(r.clicks)} clicks` : null, r.impressions === null && r.volume ? `${fmt(r.volume)} searches a month` : null].filter(Boolean).join(' · ')}</small></li>
        ))}</ul> : <p className="sa-empty">None yet. {m.source === 'gsc' ? 'Search Console hasn’t shown this page for any search 5+ times in the last 28 days.' : 'DataForSEO doesn’t list this page for any search.'}</p>}
        {m.source === 'gsc' && p.real.length > 0 && <p className="sa-src">Last 28 days, from Search Console. “Seen” is how often it showed in results.</p>}
      </div>
      <div className="sa-says">
        <div><span>Title</span><b><Hl text={p.title} keyword={p.keyword} /></b></div>
        <div><span>H1</span><b><Hl text={p.h1} keyword={p.keyword} /></b></div>
        <div><span>H2s</span><b>{p.h2s.length ? p.h2s.map((h, i) => <span key={i}>{i > 0 && ' · '}<Hl text={h} keyword={p.keyword} /></span>) : '—'}</b></div>
        <div><span>Meta</span><b><Hl text={p.meta} keyword={p.keyword} /></b></div>
      </div>
      {p.keyword && <div className="sa-chart">
        <div className="sa-chart-h"><span>Google position at each check</span><span>{p.kw?.best ? `Best #${p.kw.best} · ` : ''}now {rankText(p.kw?.now ?? null)}</span></div>
        {points.length ? <RankChart points={points} test={p.test} /> : <p className="sa-empty">The first point comes with the next check.</p>}
      </div>}
      {box}
    </div>
  }

  // ── Opened question ─────────────────────────────────────────────────────────

  function questionView(q: QuestionView) {
    const st = GEO_STATUS[q.status]
    let box: React.ReactNode
    if (q.status === 'test' && q.test) box = testBox(q.test, 'geo')
    else if (q.status === 'named') box = <div className="sa-call sa-c-good"><h3>You’re named. Keep it up.</h3><p>Named in {q.hits} of {q.samples} answers. Keep the pages AI cites for this up to date.</p></div>
    else box = <div className="sa-call sa-c-warn">
      <h3>What to do, most useful first</h3>
      <ol>{q.todo.map(t => <li key={t.title}><b>{t.title}.</b> {t.why} <button type="button" className="lfp-link" disabled={!!busy} onClick={() => startTest({ area: 'geo', question: q.question, what: t.title })}>I’ve done this</button></li>)}</ol>
      <p>When one is done, press “I’ve done this” next to it. We start the clock and tell you by {knowFromToday} whether AI names you.</p>
      <div className="sa-acts">
        {q.todo[0]?.href
          ? <a className="btn btn-primary" href={q.todo[0].href}>{q.todo[0].title}</a>
          : <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => startTest({ area: 'geo', question: q.question, what: q.todo[0]?.title ?? 'Your change' })}>I’ve done this</button>}
        <button type="button" className="lfp-link" onClick={() => go({ v: 'list' })}>Not now</button>
      </div>
    </div>
    return <div className="sa-open">
      {back}
      <h2 className="sa-h2">“{q.question}”</h2>
      <div className="sa-gh"><Pill c={st.c} label={st.label} /></div>
      <p className="sa-sub">Named in {q.hits} of {q.samples} answers this check{q.keyword ? ` · closest page search: ${q.keyword}` : ''}</p>
      <div className="sa-engrows">
        {q.engines.map(e => (
          <div key={e.engine}><b><i className={`sa-dot sa-c-${!e.samples ? 'wait' : e.hits ? 'good' : 'warn'}`} />{e.engine === 'google_ai' ? 'Google AI Overview' : ENGINE_NAME[e.engine]}</b>
            <span>{!e.samples ? (e.engine === 'google_ai' ? 'Google showed no AI Overview for this' : 'No answer this check') : e.hits ? `Named you in ${e.hits} of ${e.samples}` : `Didn’t name you (${e.samples} of ${e.samples})`}</span></div>
        ))}
        {q.instead.length > 0 && <div><b>Named instead</b><span>{q.instead.join(', ')}</span></div>}
        {q.cited.length > 0 && <div><b>Sites AI cited</b><span>{q.cited.map(c => (c.n > 1 ? `${c.domain} (${c.n}×)` : c.domain)).join(', ')}</span></div>}
      </div>
      {q.trend.length > 0 && <div className="sa-chart">
        <div className="sa-chart-h"><span>Share of answers that named you, at each check</span><span>ChatGPT, Perplexity, Gemini</span></div>
        <PctChart points={q.trend} test={q.test} />
      </div>}
      {box}
    </div>
  }

  // ── Side views ──────────────────────────────────────────────────────────────

  function howView() {
    return <div className="sa-open">{back}
      <h2 className="sa-h2">How this works</h2>
      <p className="sa-sub">Every week, and whenever you press “Recheck all keywords”, we do four things:</p>
      <div className="sa-explain">
        <div><b>1. Read your pages</b><p>Your homepage and up to 9 main pages (from your menu and sitemap): title, H1, headings and description. From those we work out which search each page targets. A title or H1 that changed since the last check becomes a test by itself.</p></div>
        <div><b>2. Check Google</b><p>Where each page ranks for its search ({flags.gsc ? 'from Search Console' : 'DataForSEO’s estimate until Search Console is connected'}), how many people search it and how hard it is.</p></div>
        <div><b>3. Ask AI</b><p>Buyer questions, twice each to ChatGPT, Perplexity and Gemini, plus Google’s AI Overview for your pages’ searches. Who gets named and which sites get cited.</p></div>
        <div><b>4. Judge</b><p>From the first check, each page gets a status from what Google really shows it for, how many people search its target and how hard that search is: working, needs a change (with new wording written for you), or waiting when it’s simply too new. Changes you make are tested for 6 weeks. Each question: named, testing, or not named (with what to do).</p></div>
        <div><b>Too competitive?</b><p>DataForSEO rates each search 0–100 for how hard it is to reach page 1. A site like yours usually wins up to about {m.reach} (higher once you already rank on page 1 for bigger searches). A search well above that, or a very broad one, is held by much stronger sites, so we look up more specific versions of it you can win and offer them to pick from.</p></div>
        <div><b>Dates</b><p>Set a different start date on any test, or on when a page started aiming at its search, if you made the change earlier. Results are worked out from that day.</p></div>
      </div>
      <h3 className="sa-h3">When will I know if my change worked?</h3>
      <div className="sa-explain">
        <div><b>New title or H1</b><p>Google re-reads the page in 1 to 2 weeks (first sign at {FIRST_SIGN_WEEKS} weeks). <b>Answer at {TEST_WEEKS} weeks</b>: up 5+ places or on page 1 is working; moving slowly gets 2 more weeks; no move means try something else.</p></div>
        <div><b>New page or post</b><p>Takes longer: first sign at 3 to 4 weeks, a clear answer at 8 to 12.</p></div>
        <div><b>GEO change</b><p>AI that searches the web picks it up 1 to 3 weeks after Google has the page. <b>Answer at {TEST_WEEKS} weeks</b>, from the last 3 checks, because answers vary.</p></div>
        <div><b>AI’s built-in knowledge</b><p>Only changes when the AI is retrained, every few months. We don’t promise a date for this.</p></div>
      </div>
      <p className="sa-src">Rechecking more than once a week won’t make Google faster. It’s useful right after you change something, so we see it.</p>
    </div>
  }

  function changedView() {
    const pages = m.pages.filter(p => p.keyword)
    const today = new Date(now).toISOString().slice(0, 10)
    const yearAgo = new Date(now - 365 * 86_400_000).toISOString().slice(0, 10)
    const page = pages.find(p => p.path === form.path) ?? pages[0]
    return <div className="sa-open">{back}
      <h2 className="sa-h2">I changed something</h2>
      <p className="sa-sub">Title and H1 changes are also spotted by themselves at the next check. Tell us now to start the clock today, or for changes we can’t see (a new section, an FAQ, a listing on another site).</p>
      <form className="sa-form" onSubmit={e => {
        e.preventDefault()
        const at = form.date || undefined
        if (form.area === 'seo') startTest({ area: 'seo', path: page?.path, to: form.to.trim() || page?.keyword, what: form.what, at })
        else startTest({ area: 'geo', question: form.question || m.questions[0]?.question, what: form.geoWhat.trim() || 'Your change', at })
      }}>
        <label htmlFor="sa-f-area">For<select id="sa-f-area" value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value as Tab }))}><option value="seo">Google (SEO)</option><option value="geo">AI answers (GEO)</option></select></label>
        {form.area === 'seo' ? <>
          <label htmlFor="sa-f-page">Page<select id="sa-f-page" value={page?.path ?? ''} onChange={e => setForm(f => ({ ...f, path: e.target.value, to: '' }))}>{pages.map(p => <option key={p.path} value={p.path}>{p.path}</option>)}</select></label>
          <label htmlFor="sa-f-what">What changed<select id="sa-f-what" value={form.what} onChange={e => setForm(f => ({ ...f, what: e.target.value }))}>
            {['New title', 'New H1', 'New title and H1', 'New headings (H2)', 'New description', 'New section or FAQ', 'Rewrote the page'].map(o => <option key={o}>{o}</option>)}</select></label>
          <label htmlFor="sa-f-to">The search it should win<input id="sa-f-to" value={form.to || page?.keyword || ''} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} maxLength={80} /></label>
        </> : <>
          <label htmlFor="sa-f-q">Question<select id="sa-f-q" value={form.question || m.questions[0]?.question || ''} onChange={e => setForm(f => ({ ...f, question: e.target.value }))}>{m.questions.map(q => <option key={q.question} value={q.question}>{q.question}</option>)}</select></label>
          <label htmlFor="sa-f-gw">What you did<input id="sa-f-gw" value={form.geoWhat} placeholder="e.g. Added an FAQ to the homepage" onChange={e => setForm(f => ({ ...f, geoWhat: e.target.value }))} maxLength={80} /></label>
        </>}
        <label htmlFor="sa-f-date">When it went live<input id="sa-f-date" type="date" value={form.date || today} max={today} min={yearAgo} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></label>
        <p className="sa-src">Already made the change a while ago? Pick that day. We compare with the check before it, and the 6 weeks count from then.</p>
        <div className="sa-acts"><button type="submit" className="btn btn-primary" disabled={!!busy || (form.area === 'seo' ? !page : !m.questions.length)}>Start the test</button>
          <button type="button" className="lfp-link" onClick={() => go({ v: 'list' })}>Cancel</button></div>
      </form>
    </div>
  }

  function settingsView() {
    return <div className="sa-open">{back}
      <h2 className="sa-h2">Settings</h2>
      <div className="sa-set">
        <label htmlFor="sa-on"><span><b>Check every week</b><span>Your pages, Google positions and AI answers</span></span>
          <input id="sa-on" type="checkbox" checked={data.settings.enabled} disabled={!!busy} onChange={e => call('settings', { settings: { enabled: e.target.checked } })} /></label>
        <label htmlFor="sa-country"><span><b>Country</b><span>For Google positions and searches a month</span></span>
          <select id="sa-country" value={data.settings.country} disabled={!!busy} onChange={e => call('settings', { settings: { country: e.target.value } })}>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        <div className="sa-set-row"><span><b>Pages we read</b><span>{(data.pages ?? []).length ? `${(data.pages ?? []).length} pages: your homepage and main pages from your menu and sitemap` : 'Read at the next check'}</span></span></div>
        <div className="sa-set-row"><span><b>Google Search Console</b><span>{flags.gsc ? 'Connected: real positions and clicks' : 'Not connected: positions are DataForSEO’s estimate'}</span></span><a className="lfp-link" href="/dashboard/keywords">{flags.gsc ? 'Change' : 'Connect'}</a></div>
        <div className="sa-set-row"><span><b>Buyer questions for AI</b><span>{data.settings.questions.length} questions</span></span><a className="lfp-link" href="/agents/search">Edit in Search Agent</a></div>
        <div className="sa-set-row"><span><b>Demo mode</b><span>Made-up data, nothing is sent</span></span><DemoSwitch on={demo} forced={flags.demoForced} busy={busy === 'demo'} onChange={switchDemo} /></div>
      </div>
    </div>
  }

  let body: React.ReactNode
  if (first && view.v === 'list') body = (
    <section className="lfp-next sa-first">
      <div className="lfp-next-text"><b>Run the first check</b>
        <span>We read your homepage and main pages, find the search each one targets, check where you rank on Google, and ask ChatGPT, Perplexity and Gemini about your field. About 3 minutes.</span></div>
      <button type="button" className="btn btn-primary" disabled={!!busy} onClick={recheck}>{running ? 'Checking…' : 'Run the first check'}</button>
    </section>
  )
  else if (view.v === 'page') { const p = m.pages.find(x => x.path === view.path); body = p ? pageView(p) : back }
  else if (view.v === 'q') { const q = m.questions.find(x => x.question === view.q); body = q ? questionView(q) : back }
  else if (view.v === 'how') body = howView()
  else if (view.v === 'changed') body = changedView()
  else if (view.v === 'settings') body = settingsView()
  else body = tab === 'seo' ? seoTab() : geoTab()

  return (
    <div className="tool-page lfp sa">
      {header()}
      {body}
      <Toast text={toast} />
    </div>
  )
}
