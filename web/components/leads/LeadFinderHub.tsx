'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ToolHeader from '@/components/ToolHeader'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/email-outreach/shared'
import { DemoSwitch, LiveProgress } from '@/components/tool-ui'
import { fmtAgo, fmtDate, useAgentApi } from '@/components/agents/shared'
import OwnListFlow from '@/components/agents/OwnListFlow'
import { competitorLabel, firstName, initials, saveReview, step } from '@/components/lead-finder/ui'
import type { Lead, LeadAgentData, LeadSettings } from '@/lib/agents/store'
import type { Platform, SavedReview, SavedScan } from '@/lib/lead-finder/saved'
import { MAX_SCORED, buildItems, buildSources, byFit, isForum, mergeReviews, rivalId, type Item, type Source } from './model'
import { IcpFields } from '@/components/agents/IcpFields'
import { platformOf } from '@/lib/agents/profiles'

// Lead Finder: every place leads come from on one board. The buttons at the top are the sources
// (Google Maps, each competitor's unhappy reviewers, Reddit, Hacker News, your own lists); the panel
// under them changes with the source picked; the board is To do → Contacted → Replied. An item opens
// in a drawer on the right with everything needed to act on it, and finishing one opens the next.
// Lead Agent items go through /api/agents/lead, competitor reviewers through /api/lead-finder/*:
// this page only joins the two (components/leads/model.ts).

export interface RivalScan { scan: SavedScan; reviews: SavedReview[] }
export interface LeadFinderFlags { dataforseo: boolean; trustpilot: boolean; hunter: boolean; hunterOut?: boolean; gmail: boolean; demo: boolean; demoForced: boolean }

type Panel =
  | { kind: 'item'; key: string }
  | { kind: 'settings' } | { kind: 'add' } | { kind: 'aside' } | { kind: 'about' } | { kind: 'caught-up' }

const PLATFORM: Record<Platform, string> = { trustpilot: 'Trustpilot', shopify: 'Shopify App Store' }
const PROGRESS = ['Checking replies', 'Searching Google Maps', 'Finding companies like your customers', 'Searching Reddit and Hacker News', 'Checking who’s a good fit', 'Writing the emails and replies']
// ANY = anywhere: companies and stores from every country (Google searches use the US as their place)
const COUNTRIES: [string, string][] = [['ANY', 'Anywhere'], ['US', 'United States'], ['IN', 'India'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['AE', 'UAE'], ['SG', 'Singapore']]
const BATCH = 6
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())
const textToHtml = (t: string) => t.trim().split(/\n{2,}/).map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('')
const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()
const subreddit = (url: string) => url.match(/reddit\.com\/r\/([^/]+)/i)?.[1]
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

// ── Small pieces ────────────────────────────────────────────────────────────

const Ic = ({ d, size = 16, sw = 2 }: { d: string; size?: number; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
)
const P = {
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pin: '<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
  noat: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/><path d="M3 3l18 18"/>',
  out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="3"/><path d="M5 15V6a3 3 0 0 1 3-3h9"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M12 12v6M9 15l3-3 3 3"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6H3v-6l2.5-8Z"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z"/>',
}

function Stars({ n, size = 11 }: { n: number; size?: number }) {
  const r = Math.max(0, Math.min(5, Math.round(n)))
  return (
    <span className="lfh-stars" aria-label={`${r} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={i <= r ? '' : 'off'} aria-hidden="true"><path d="m12 2 3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5 7.5-.7z" /></svg>
      ))}
    </span>
  )
}
const Bars = ({ n }: { n: number }) => (
  <span className="lfh-fit" title={`Fit ${n} of 4`} aria-label={`Fit ${n} of 4`}>{[1, 2, 3, 4].map(i => <i key={i} className={i <= n ? 'on' : ''} />)}</span>
)
const Dots = ({ sent, total }: { sent: number; total: number }) => (
  <span className="lfh-fu" title={`${sent} of ${total} follow-ups sent`}>{Array.from({ length: total + 1 }, (_, i) => <i key={i} className={i <= sent ? 'on' : ''} />)}</span>
)

function Coin({ s }: { s: Source }) {
  const reviews = s.type === 'rival'
  return (
    <span className="lfh-coin">
      {reviews && <span className="lfh-coin-ring" style={{ background: `conic-gradient(var(--text-faint) 0 var(--lfh-ring, 0deg), var(--line) 0)` }} />}
      {s.type === 'own'
        ? <span className="lfh-coin-face lfh-coin-face--own"><Ic d={P.list} /></span>
        : <span className="lfh-coin-face">{s.glyph}</span>}
    </span>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function LeadFinderHub({ initial, scans: initialScans, competitors, flags }: {
  initial: LeadAgentData
  scans: RivalScan[]
  competitors: string[]
  flags: LeadFinderFlags
}) {
  const { data, busy, call, toast: said } = useAgentApi<LeadAgentData>('/api/agents/lead', initial)
  const [toast, notify] = useToast()
  useEffect(() => { if (said) notify(said) }, [said, notify])
  const s = data.settings

  // Competitor reads and their reviewers, per competitor (merged across reads)
  const [scans, setScans] = useState<SavedScan[]>(() => initialScans.map(x => x.scan))
  const [reviews, setReviews] = useState<Map<string, SavedReview[]>>(() => {
    const by = new Map<string, SavedReview[][]>()
    for (const x of initialScans) {
      const id = rivalId(x.scan.platform, x.scan.competitor)
      by.set(id, [...(by.get(id) ?? []), x.reviews])
    }
    return new Map([...by].map(([k, v]) => [k, mergeReviews(v)]))
  })
  const [extra, setExtra] = useState<{ platform: Platform; competitor: string }[]>([])
  const [reading, setReading] = useState<Record<string, string>>({})   // competitor id → what it's doing
  const [checking, setChecking] = useState<string | null>(null)        // competitor whose fit is being checked

  const [demo, setDemo] = useState(flags.demo)
  const gmail = flags.gmail || demo
  const [view, setView] = useState('all')
  const [starFilter, setStarFilter] = useState<number | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [adding, setAdding] = useState(false)
  const [firstVisit, setFirstVisit] = useState(true)

  const sources = useMemo(() => buildSources(data, scans, competitors, extra), [data, scans, competitors, extra])
  const items = useMemo(() => buildItems(data, reviews), [data, reviews])
  const src = useCallback((id: string) => sources.find(x => x.id === id), [sources])
  const cur = view === 'all' ? null : src(view) ?? null
  const inView = useMemo(() => items.filter(i => view === 'all' || i.src === view), [items, view])
  const todoOf = (id: string) => items.filter(i => i.src === id && i.stage === 'todo').length
  const queue = useCallback((list: Item[]) => list.filter(i => i.stage === 'todo' && (!starFilter || (i.origin === 'rival' && Math.round(i.review.rating) === starFilter))).sort(byFit), [starFilter])
  const running = busy === 'run' || busy === 'demo_skip'

  // A source that went away (a competitor removed) falls back to All
  useEffect(() => { if (view !== 'all' && !src(view)) setView('all') }, [view, src])

  // Nothing found yet: the first visit picks where to look from the brand, then searches
  const auto = useRef(false)
  useEffect(() => {
    if (auto.current || data.lastRunAt || data.leads.length) return
    auto.current = true
    ;(async () => {
      if (!data.settings.picked) await call('pick')
      call('run')
    })()
  }, [call, data.lastRunAt, data.leads.length, data.settings.picked])

  // ── Competitors: read reviews, check fit ──────────────────────────────────

  const setRival = useCallback((id: string, fn: (list: SavedReview[]) => SavedReview[]) => {
    setReviews(prev => { const next = new Map(prev); next.set(id, fn(prev.get(id) ?? [])); return next })
  }, [])
  const patchReview = useCallback((id: string, reviewId: string, change: Partial<SavedReview>) => setRival(id, list => list.map(x => (x.id === reviewId ? { ...x, ...change } : x))), [setRival])

  const checkFit = useCallback(async (id: string, list: SavedReview[]) => {
    const todo = list.filter(r => r.rating <= 3 && r.fit === undefined && r.status === 'new')
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, MAX_SCORED)
    if (!todo.length) return
    setChecking(id)
    const byScan = new Map<string, SavedReview[]>()
    for (const r of todo) byScan.set(r.scanId, [...(byScan.get(r.scanId) ?? []), r])
    try {
      for (const [scanId, rs] of byScan) {
        for (let i = 0; i < rs.length; i += BATCH) {
          const { reviews: scored } = await step<{ reviews: SavedReview[] }>({ op: 'score', scanId, leadIds: rs.slice(i, i + BATCH).map(x => x.id) })
          const got = new Map(scored.map(x => [x.id, x]))
          setRival(id, l => l.map(x => { const y = got.get(x.id); return y ? { ...x, fit: y.fit, why: y.why, pains: y.pains } : x }))
        }
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Couldn’t check some reviewers.')
    } finally {
      setChecking(c => (c === id ? null : c))
    }
  }, [notify, setRival])

  // Reviewers left unchecked (page closed while checking) are checked when the page opens again
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current) return
    resumed.current = true
    ;(async () => { for (const [id, list] of reviews) await checkFit(id, list) })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function readRival(r: Source) {
    if (!r.platform || !r.competitor || reading[r.id]) return
    const say = (t: string) => setReading(p => ({ ...p, [r.id]: t }))
    say(r.platform === 'trustpilot' ? `Asking for ${r.name}'s newest Trustpilot reviews` : 'Reading the Shopify App Store reviews')
    try {
      const args = { platform: r.platform, url: r.competitor, scanId: crypto.randomUUID() }
      let x = await step<{ scan?: SavedScan; reviews?: SavedReview[]; pending?: string }>({ op: 'reviews', ...args })
      for (let tries = 0; x.pending && tries < 45; tries++) {
        say('Collecting the newest reviews (usually under a minute)')
        await new Promise(res => setTimeout(res, 4000))
        x = await step<typeof x>({ op: 'reviews_poll', taskId: x.pending, ...args })
      }
      if (x.pending) throw new Error('Reading the reviews is taking too long. Try again in a few minutes.')
      if (!x.scan || !x.reviews?.length) throw new Error(`No reviews found for ${r.name}. Check the ${r.platform === 'trustpilot' ? 'website' : 'App Store link'} in Add a source.`)
      const scan = x.scan, fresh = x.reviews
      const merged = mergeReviews([fresh, reviews.get(r.id) ?? []])
      setScans(p => [scan, ...p])
      setRival(r.id, () => merged)
      const unhappy = fresh.filter(y => y.rating <= 3).length
      notify(`${r.name}: ${plural(fresh.length, 'review')} read, ${unhappy} unhappy. Checking who fits…`)
      checkFit(r.id, merged)
    } catch (e) {
      notify(e instanceof Error ? e.message : `Couldn’t read ${r.name}'s reviews.`)
    } finally {
      setReading(p => { const n = { ...p }; delete n[r.id]; return n })
    }
  }

  /** The big search button: the Lead Agent's search, plus competitors not read today. */
  function searchAll() {
    for (const r of sources) {
      if (r.type !== 'rival' || (r.platform === 'trustpilot' && !flags.trustpilot)) continue
      const last = r.scans?.[0]?.scannedAt
      if (!last || Date.now() - Date.parse(last) > 86_400_000) readRival(r)
    }
    if (s.sources.local || s.sources.reddit || s.sources.companies) call('run')
  }

  // ── Acting on items ───────────────────────────────────────────────────────

  const open = panel?.kind === 'item' ? items.find(i => i.key === panel.key) ?? null : null

  /** After finishing one: the next to do in this view, or "All caught up". */
  function advance(doneKey: string) {
    const next = queue(inView.filter(i => i.key !== doneKey))[0]
    setPanel(next ? { kind: 'item', key: next.key } : { kind: 'caught-up' })
  }

  const act = (op: string, payload: Record<string, unknown>, key = `${op}:${payload.id ?? ''}`) =>
    call(op, payload, key) as Promise<{ ok?: boolean; error?: string; message?: string; data?: LeadAgentData } | null>

  function skip(i: Item) {
    if (i.origin === 'agent') {
      act('skip', { id: i.lead.id })
      notify('Skipped', () => { call('restore', { id: i.lead.id }, `restore:${i.lead.id}`) })
    } else {
      const r = i.review
      patchReview(i.src, r.id, { status: 'skipped' })
      saveReview(r.id, { status: 'skipped' })
      notify(`Skipped ${r.name}`, () => { patchReview(i.src, r.id, { status: 'new' }); saveReview(r.id, { status: null }) })
    }
    advance(i.key)
  }

  // ── Header line ───────────────────────────────────────────────────────────

  const sentToday = data.sentLog.filter(sameDay).length
  const anyReading = Object.keys(reading).length > 0
  const lastLine = running ? (data.lastRunAt ? 'Looking for new leads…' : 'Running your first search…')
    : cur?.type === 'rival' ? (reading[cur.id] ?? (cur.scans?.[0] ? `Reviews read ${fmtAgo(cur.scans[0].scannedAt)}` : 'Reviews not read yet'))
    : data.lastRunAt ? `Last search ${fmtAgo(data.lastRunAt)}` : 'Not searched yet'

  // ── Views ─────────────────────────────────────────────────────────────────

  function sourceRow() {
    const all = items.filter(i => i.stage === 'todo').length
    const btn = (x: Source) => {
      const n = todoOf(x.id)
      const rs = reviews.get(x.id) ?? []
      const ring = rs.length ? rs.filter(r => r.rating <= 3).length / rs.length * 360 : 0
      const sub = x.type === 'own' ? plural(items.filter(i => i.src === 'own').length, 'person', 'people')
        : reading[x.id] ? 'Reading…' : x.type === 'rival' && !x.scans?.length && !rs.length ? 'Not read yet' : `${n} to do`
      return (
        <button key={x.id} type="button" className={`lfh-src${x.on ? '' : ' is-off'}${reading[x.id] || (running && x.type !== 'rival' && x.type !== 'own') ? ' is-busy' : ''}`}
          aria-pressed={view === x.id} style={{ ['--lfh-ring' as string]: `${ring}deg` }}
          title={x.type === 'rival' ? 'Competitor. The red part of the ring is their unhappy reviews.' : undefined}
          onClick={() => { setView(x.id); setStarFilter(null); setAdding(false) }}>
          <Coin s={x} />
          <span className="lfh-src-t"><b>{x.name}</b><small>{x.type === 'rival' && <span className="lfh-plat-dot">{x.platform === 'shopify' ? 'App Store' : 'Trustpilot'} ·</span>}{sub}</small></span>
        </button>
      )
    }
    return (
      <nav className="lfh-srcs" aria-label="Where leads come from">
        <button type="button" className="lfh-src" aria-pressed={view === 'all'} onClick={() => { setView('all'); setStarFilter(null); setAdding(false) }}>
          <span className="lfh-coin"><span className="lfh-coin-face lfh-coin-face--all"><Ic d={P.search} /></span></span>
          <span className="lfh-src-t"><b>All</b><small>{all} to do</small></span>
        </button>
        <span className="lfh-sep" aria-hidden="true" />
        {sources.map(btn)}
        <button type="button" className="lfh-addsrc" aria-label="Add a competitor or a city" title="Add a competitor or a city" onClick={() => setPanel({ kind: 'add' })}><Ic d={P.plus} size={20} /></button>
      </nav>
    )
  }

  function hero() {
    const busyBtn = (label: string, onClick: () => void, on: boolean, disabled = false) => (
      <button type="button" className="lfh-act" disabled={on || disabled} onClick={onClick}>
        {on ? <Spinner /> : <Ic d={P.refresh} />}{on ? 'Working…' : label}
      </button>
    )
    if (!cur) {
      const counts = sources.filter(x => x.type !== 'own').map(x => ({ x, n: todoOf(x.id) })).filter(c => c.n)
      const total = counts.reduce((a, c) => a + c.n, 0)
      // One grey in fading shades: the bar shows how the people split, not which colour a source is
      const color = (x: Source) => `color-mix(in srgb, var(--text-faint) ${[90, 60, 40, 25, 15][counts.findIndex(c => c.x === x) % 5]}%, transparent)`
      return (
        <section className="lfh-hero">
          <div className={`lfh-radar${running || anyReading ? ' is-on' : ''}`}>
            <div className="lfh-sweep" />
            <button type="button" className="lfh-go" disabled={running || anyReading} onClick={searchAll} aria-label="Search every source now" title="Search every source now"><Ic d={P.search} size={22} sw={2.4} /></button>
          </div>
          <div className="lfh-grow lfh-mix">
            <p className="lfh-bigline"><b>{total}</b> {total === 1 ? 'person' : 'people'} to reach</p>
            {total > 0 && <div className="lfh-mixbar">{counts.map(c => <i key={c.x.id} style={{ width: `${c.n / total * 100}%`, background: color(c.x) }} title={`${c.x.name}: ${c.n}`} />)}</div>}
            {total > 0 && <div className="lfh-mixkey">{counts.map(c => <span key={c.x.id}><i style={{ background: color(c.x) }} />{c.x.name} {c.n}</span>)}</div>}
            <div className="lfh-meta"><Ic d={P.clock} size={14} />{s.enabled ? 'Searches Google Maps, Reddit and Hacker News every morning' : 'Searches only when you press the button'}</div>
          </div>
        </section>
      )
    }
    if (cur.type === 'rival') {
      const rs = reviews.get(cur.id) ?? []
      const hist = [1, 2, 3, 4, 5].map(n => rs.filter(r => Math.round(r.rating) === n).length)
      const max = Math.max(1, ...hist)
      return (
        <section className="lfh-hero">
          {rs.length ? (
            <div className="lfh-hist">
              {[5, 4, 3, 2, 1].map(n => (
                <button key={n} type="button" className={`lfh-hrow${n <= 3 ? ' is-bad' : ''}`} disabled={n > 3} aria-pressed={starFilter === n}
                  title={n <= 3 ? `Show only ${n}-star reviewers` : 'Happy customers: not leads'} onClick={() => setStarFilter(f => (f === n ? null : n))}>
                  <Stars n={n} size={10} /><span className="lfh-hbar"><i style={{ width: `${hist[n - 1] / max * 100}%` }} /></span><span className="lfh-hc">{hist[n - 1]}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="lfh-grow"><p className="lfh-bigline">Their unhappy customers become your leads</p><div className="lfh-meta">Reads {cur.name}&apos;s newest {PLATFORM[cur.platform ?? 'trustpilot']} reviews and checks who fits you.</div></div>
          )}
          {rs.length > 0 && <div className="lfh-bignum" title="Unhappy reviewers who fit you"><b>{todoOf(cur.id)}</b>to reach</div>}
          <div className="lfh-actbox">
            {busyBtn(rs.length ? 'Read new reviews' : 'Read their reviews', () => readRival(cur), !!reading[cur.id], !flags.trustpilot && cur.platform === 'trustpilot')}
            <div className="lfh-meta">
              <span className="lfh-pill">{PLATFORM[cur.platform ?? 'trustpilot']}</span>
              {reading[cur.id] ? <span>{reading[cur.id]}</span> : checking === cur.id ? <><Spinner /> Checking who fits…</> : cur.scans?.[0] ? <><Ic d={P.clock} size={14} />{fmtAgo(cur.scans[0].scannedAt)}</> : null}
            </div>
            {!flags.trustpilot && cur.platform === 'trustpilot' && <div className="lfh-meta lfh-warn">Trustpilot needs GrowJin&apos;s DataForSEO account, which isn&apos;t set up yet.</div>}
          </div>
        </section>
      )
    }
    if (cur.type === 'maps' || cur.type === 'companies' || cur.type === 'forum') {
      const queries = data.queries?.list ?? []
      return (
        <section className="lfh-hero">
          <span className="lfh-glyph">{cur.type === 'maps' ? <Ic d={P.pin} size={26} /> : cur.glyph}</span>
          <div className="lfh-grow lfh-col">
            {cur.type === 'maps'
              ? <MapsQuery value={s.localQuery} saving={busy === 'settings'} onSave={q => call('settings', { settings: { ...s, localQuery: q, sources: { ...s.sources, local: true } } })} />
              : cur.type === 'companies'
              ? <MapsQuery value={s.companyQuery} label="Companies to look for" placeholder="e.g. small fashion and beauty online stores" saving={busy === 'settings'} onSave={q => call('settings', { settings: { ...s, companyQuery: q, sources: { ...s.sources, companies: true } } })} />
              : <div className="lfh-query">{queries.length ? queries.slice(0, 6).map(q => <span key={q} className="lfh-chip">{q}</span>) : <span className="lfh-meta">Search phrases are written from your brand on the first search.</span>}</div>}
            <div className="lfh-meta">
              {!cur.on ? <span className="lfh-warn">Off. Turn it on in Settings.</span> : <><Ic d={P.clock} size={14} />{data.lastRunAt ? `Last search ${fmtAgo(data.lastRunAt)}` : 'Not searched yet'}</>}
              {cur.type === 'forum' && <span>· You post every reply yourself</span>}
              {cur.type === 'companies' && <span>· Online businesses, emails from Hunter</span>}
            </div>
            {cur.type === 'companies' && !flags.hunter && <div className="lfh-meta lfh-warn">Company emails need GrowJin&apos;s Hunter key, which isn&apos;t set up yet.</div>}
            {cur.type !== 'forum' && flags.hunterOut && !demo && <div className="lfh-meta lfh-warn">Hunter&apos;s email credits are used up, so new leads come without an email until they renew. You can still add one by hand.</div>}
            {cur.type !== 'companies' && !flags.dataforseo && <div className="lfh-meta lfh-warn">{cur.type === 'maps' ? 'Google Maps' : 'Reddit'} search needs GrowJin&apos;s DataForSEO account, which isn&apos;t set up yet.</div>}
          </div>
          <div className="lfh-actbox">{busyBtn('Search now', () => call('run'), running, !cur.on)}</div>
        </section>
      )
    }
    if (cur.type === 'own') {
      const mine = items.filter(i => i.src === 'own')
      return (
        <section className="lfh-hero">
          <button type="button" className="lfh-drop" onClick={() => setAdding(true)}>
            <span className="lfh-glyph lfh-glyph--own"><Ic d={P.file} size={26} /></span>
            <span><b>Paste emails or upload a file</b>CSV, Excel, PDF, Word or text. One email for everyone, with follow-ups.</span>
          </button>
          <div className="lfh-bignum"><b>{mine.length}</b>{mine.length === 1 ? 'person' : 'people'}</div>
          <div className="lfh-bignum"><b>{mine.filter(i => i.stage !== 'todo').length}</b>emailed</div>
        </section>
      )
    }
    return <section className="lfh-hero"><div className="lfh-grow"><p className="lfh-bigline">Leads from earlier searches</p><div className="lfh-meta">Competitor reviewers the Lead Agent found before Competitor Leads took that over.</div></div></section>
  }

  function tile(i: Item, first: boolean) {
    const x = src(i.src)
    const all = view === 'all'
    let av: React.ReactNode, sub: React.ReactNode, right: React.ReactNode
    if (i.origin === 'agent') {
      const l = i.lead
      av = isForum(l)
        ? <span className="lfh-av">{x?.glyph}</span>
        : <span className="lfh-av">{initials(i.name).slice(0, 1)}</span>
      sub = isForum(l) ? <>{l.source === 'reddit' && subreddit(l.url) ? `r/${subreddit(l.url)}` : l.source === 'profile' ? platformOf(l.url) : x?.name} · {fmtAgo(l.foundAt)}</>
        : l.source === 'own' ? <><Ic d={P.list} size={12} />Your list</>
        : <><Ic d={P.pin} size={12} />{l.website || l.company || 'Google Maps'}</>
      right = i.stage === 'todo' ? <>{!l.email && !isForum(l) && <span className="lfh-noemail" title="Email not found yet"><Ic d={P.noat} size={15} /></span>}{l.source !== 'own' && <Bars n={i.fit} />}</>
        : i.stage === 'contacted' ? (l.status === 'posted' ? <span className="lfh-ok" title="You posted a reply"><Ic d={P.check} /></span>
          : l.status === 'queued' ? <span className="lfh-queued" title="Approved, goes out with the next batch"><Ic d={P.clock} size={15} /></span>
          : <Dots sent={l.followupsSent} total={s.followUpDays.length} />)
        : <span className="lfh-rdot" />
    } else {
      const r = i.review
      av = <span className="lfh-av lfh-av--round">{initials(r.name)}</span>
      sub = <><Stars n={r.rating} />{all ? x?.name : r.date ? fmtDate(r.date) : ''}</>
      right = i.stage === 'todo' ? <>{r.contactChecked && !r.email && <span className="lfh-noemail" title="Email not found yet"><Ic d={P.noat} size={15} /></span>}<Bars n={i.fit} /></>
        : <span className="lfh-ok" title="Emailed"><Ic d={P.check} /></span>
    }
    const badge = all && x && i.kind === 'email' && (
      <span className="lfh-badge" title={x.name}>{x.type === 'own' ? <Ic d={P.list} size={10} /> : x.glyph}</span>
    )
    return (
      <button key={i.key} type="button" className={`lfh-tile${i.stage === 'replied' ? ' is-replied' : ''}${open?.key === i.key ? ' is-sel' : ''}`}
        onClick={() => { setFirstVisit(false); setPanel({ kind: 'item', key: i.key }) }}>
        {first && <span className="lfh-start">Start here</span>}
        <span className="lfh-avw">{av}{badge}</span>
        <span className="lfh-tile-t"><span className="lfh-name">{i.name}</span><span className="lfh-sub">{sub}</span></span>
        <span className="lfh-right">{right}</span>
      </button>
    )
  }

  function board() {
    const lanes = [
      { k: 'todo' as const, t: 'To do', ic: P.eye },
      { k: 'contacted' as const, t: 'Contacted', ic: P.send },
      { k: 'replied' as const, t: 'Replied', ic: P.reply },
    ]
    const checkingHere = inView.filter(i => i.stage === 'checking').length
    const aside = inView.filter(i => i.stage === 'done' || i.stage === 'nofit').length
    return (
      <div className="lfh-board">
        {lanes.map(L => {
          const list = L.k === 'todo' ? queue(inView) : inView.filter(i => i.stage === L.k).sort((a, b) => {
            const t = (x: Item) => x.origin === 'agent' ? (x.lead.repliedAt ?? x.lead.sentAt ?? x.lead.foundAt) : (x.review.sentAt ?? '')
            return t(b).localeCompare(t(a))
          })
          return (
            <section key={L.k} className={`lfh-lane lfh-lane--${L.k}`}>
              <div className="lfh-lane-h"><span className="lfh-lane-ic"><Ic d={L.ic} /></span><b>{L.t}</b><span className="lfh-lane-n">{list.length}</span></div>
              {L.k === 'todo' && starFilter && (
                <span className="lfh-filter"><Stars n={starFilter} /><button type="button" aria-label="Show every rating" onClick={() => setStarFilter(null)}><Ic d={P.x} size={12} /></button></span>
              )}
              {L.k === 'todo' && checkingHere > 0 && <div className="lfh-checking"><Spinner />Checking {checkingHere} unhappy reviewer{checkingHere === 1 ? '' : 's'}…</div>}
              {list.map((i, n) => tile(i, firstVisit && L.k === 'todo' && n === 0))}
              {!list.length && (
                <div className="lfh-empty"><Ic d={P.inbox} size={34} sw={1.6} />
                  {L.k === 'todo' ? (running || anyReading ? 'Looking for people…' : starFilter ? 'No one at this rating.' : 'All done here. Search again or pick another source.')
                    : L.k === 'replied' ? 'Replies land here.' : 'Nothing yet.'}
                </div>
              )}
              {L.k === 'todo' && aside > 0 && <button type="button" className="lfh-linkbtn" onClick={() => setPanel({ kind: 'aside' })}>+ {aside} not a fit or skipped</button>}
            </section>
          )
        })}
      </div>
    )
  }

  function legend() {
    const t = cur?.type
    return (
      <div className="lfh-legend">
        <span><Bars n={4} /> how good a fit</span>
        {(!t || t === 'rival') && <span><Stars n={1} /> what they gave a competitor</span>}
        {t !== 'forum' && <span><span className="lfh-noemail"><Ic d={P.noat} size={14} /></span> email not found yet</span>}
        {t !== 'forum' && t !== 'rival' && <span><Dots sent={1} total={2} /> follow-ups, stop when they reply</span>}
        {(!t || t === 'forum') && <span><span className="lfh-ok"><Ic d={P.check} size={14} /></span> posted or emailed</span>}
        {t !== 'forum' && t !== 'rival' && <span><span className="lfh-rdot" /> they replied</span>}
      </div>
    )
  }

  // ── Drawer ────────────────────────────────────────────────────────────────

  function drawer() {
    if (!panel) return null
    const close = () => setPanel(null)
    let body: React.ReactNode = null
    if (panel.kind === 'item' && open) {
      body = open.origin === 'agent'
        ? <AgentItem key={open.key} item={open} source={src(open.src)} settings={s} gmail={gmail} busy={busy} act={act} notify={notify}
            left={queue(inView).filter(x => x.key !== open.key).length}
            onSkip={() => skip(open)} onDone={() => advance(open.key)} onClose={close} />
        : <RivalItem key={open.key} item={open} source={src(open.src)} gmail={flags.gmail} notify={notify}
            left={queue(inView).filter(x => x.key !== open.key).length}
            onChange={c => patchReview(open.src, open.review.id, c)} onSkip={() => skip(open)} onDone={() => advance(open.key)} onClose={close} />
    } else if (panel.kind === 'item') {
      body = <><Head title="Gone" sub="This one was moved or removed." onClose={close} /><div className="lfh-d-body" /></>
    } else if (panel.kind === 'caught-up') {
      const other = view !== 'all' && sources.find(x => x.id !== view && todoOf(x.id) > 0)
      body = <>
        <Head onClose={close} />
        <div className="lfh-d-body"><div className="lfh-done"><span className="lfh-done-ring"><Ic d={P.check} size={40} /></span><h3>All caught up</h3><p>{cur ? `${cur.name} is done for now.` : 'Follow-ups go out by themselves.'}</p></div></div>
        <div className="lfh-d-foot">
          {other
            ? <button type="button" className="btn btn-primary lfh-grow-btn" onClick={() => { setView(other.id); setStarFilter(null); close() }}>Next: {other.name} · {todoOf(other.id)}</button>
            : <button type="button" className="btn btn-primary lfh-grow-btn" disabled={running} onClick={() => { close(); if (cur?.type === 'rival') readRival(cur); else searchAll() }}>Search again</button>}
        </div>
      </>
    } else if (panel.kind === 'aside') {
      const list = inView.filter(i => i.stage === 'done' || i.stage === 'nofit')
      body = <>
        <Head title="Set aside" sub="Bring one back if we got it wrong" onClose={close} />
        <div className="lfh-d-body">
          {list.map(i => {
            const why = i.origin === 'rival' ? (i.stage === 'nofit' ? `Fit ${i.review.fit}/10${i.review.why ? ` · ${i.review.why}` : ''}` : 'Skipped')
              : i.lead.status === 'skipped' ? 'Skipped' : i.lead.status === 'opted_out' ? 'Not interested' : i.lead.status === 'bounced' ? 'Email bounced' : 'Answered'
            const canBack = i.origin === 'rival' ? i.stage === 'done' : i.lead.status === 'skipped' || (i.lead.status === 'replied' && !!i.lead.handledAt)
            return (
              <div key={i.key} className="lfh-aside-row">
                <span className="lfh-tile-t"><span className="lfh-name">{i.name}</span><span className="lfh-sub">{why}</span></span>
                {i.stage === 'nofit' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel({ kind: 'item', key: i.key })}>Reach out anyway</button>}
                {canBack && <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                  if (i.origin === 'agent') call('restore', { id: i.lead.id }, `restore:${i.lead.id}`)
                  else { patchReview(i.src, i.review.id, { status: 'new' }); saveReview(i.review.id, { status: null }) }
                }}>Bring back</button>}
              </div>
            )
          })}
          {!list.length && <div className="lfh-empty">Nothing set aside.</div>}
        </div>
      </>
    } else if (panel.kind === 'settings') {
      body = <SettingsPanel key={s.picked?.at ?? 'none'} initial={s} saving={busy === 'settings'} picking={busy === 'pick'} onPick={() => call('pick')} gmail={flags.gmail} demo={demo} demoForced={flags.demoForced} rivals={sources.filter(x => x.type === 'rival')}
        busy={!!busy} onClose={close}
        onDemo={async on => {
          const r = await call('demo', { on }) as { demo?: boolean } | null
          if (typeof r?.demo === 'boolean') setDemo(r.demo)
        }}
        onSave={async next => { const r = await call('settings', { settings: next }); if (r?.data) { notify('Saved'); close() } }} />
    } else if (panel.kind === 'add') {
      body = <AddSource onClose={close} trustpilot={flags.trustpilot} onRival={(platform, competitor) => {
        const id = rivalId(platform, competitor)
        if (!sources.some(x => x.id === id)) setExtra(p => [...p, { platform, competitor }])
        setView(id); setStarFilter(null); close()
        const name = competitorLabel(competitor)
        readRival({ id, type: 'rival', name, glyph: name.charAt(0).toUpperCase(), hue: 0, on: true, platform, competitor, scans: [] })
      }} onCity={async q => {
        close(); setView('maps')
        const r = await call('settings', { settings: { ...s, localQuery: q, sources: { ...s.sources, local: true } } })
        if (r?.data) call('run')
      }} />
    } else if (panel.kind === 'about') {
      body = <>
        <Head title="Lead Finder" sub="How it works" onClose={close} />
        <div className="lfh-d-body">
          {[['It looks for people', 'Local businesses on Google Maps, unhappy reviewers of your competitors, and posts asking for a tool like yours.'],
            ['You check each one', 'Read why they fit and the email or reply it wrote. Change anything, then send or skip.'],
            ['Follow-ups go out by themselves', 'A couple of reminders, a few days apart. They stop as soon as someone replies.']].map(([t, d], n) => (
            <div key={t} className="lfh-about"><span className="lfh-about-n">{n + 1}</span><span><b>{t}</b><small>{d}</small></span></div>
          ))}
        </div>
        <div className="lfh-d-foot"><button type="button" className="btn btn-primary lfh-grow-btn" onClick={close}>Got it</button></div>
      </>
    }
    return (
      <>
        <div className="lfh-scrim" onClick={close} aria-hidden="true" />
        <aside className="lfh-drawer" role="dialog" aria-modal="true" aria-label="Details">{body}</aside>
      </>
    )
  }

  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel])

  return (
    <div className="tool-page lfh">
      <ToolHeader
        title="Lead Finder"
        chips={<>
          {demo ? <span className="th-chip th-chip--warn">Demo: nothing is sent</span>
            : !flags.gmail ? <span className="th-chip th-chip--warn">Gmail not connected</span> : null}
          {s.enabled && <span className="th-chip th-chip--on">Searching daily</span>}
        </>}
        meta={<><span>{lastLine}</span><button type="button" className="th-link lfh-linklike" onClick={() => setPanel({ kind: 'about' })}>About this page</button></>}
        actions={<>
          <div className="lfh-meter" title="New emails sent today out of your daily limit">
            <b>{sentToday}<small>/{s.dailyLimit}</small></b>
            <span className="lfh-meter-bar"><i style={{ width: `${Math.min(100, sentToday / Math.max(1, s.dailyLimit) * 100)}%` }} /></span>sent today
          </div>
          <button type="button" className="btn btn-ghost lfh-settings" onClick={() => setPanel({ kind: 'settings' })}><Ic d={P.sliders} />Settings</button>
        </>}
      />
      {!gmail && <div className="ag-note ag-note-warn">Connect Gmail so emails go out from your address. <a href="/api/gmail/connect">Connect Gmail</a></div>}
      {data.lastError && !running && <div className="ag-note ag-note-crit">The last search had a problem: {data.lastError}</div>}
      {sourceRow()}
      {adding ? (
        <div className="lfh-own">
          <OwnListFlow call={call} busy={busy} gmail={gmail} dailyLimit={s.dailyLimit} followUpDays={s.followUpDays} notify={notify}
            tool="Lead Finder" repliesIn="Replied" onClose={() => { setAdding(false); setView('own') }} />
        </div>
      ) : <>
        {hero()}
        <LiveProgress agent="lead" active={running} fallback={PROGRESS} />
        {board()}
        {legend()}
      </>}
      {drawer()}
      {toast}
    </div>
  )
}

// ── Drawer parts ────────────────────────────────────────────────────────────

function Head({ av, title, sub, onClose }: { av?: React.ReactNode; title?: string; sub?: React.ReactNode; onClose: () => void }) {
  return (
    <div className="lfh-d-head">
      {av}
      {title && <div className="lfh-d-title"><h2>{title}</h2>{sub && <div className="lfh-d-sub">{sub}</div>}</div>}
      <button type="button" className="lfh-x" aria-label="Close" onClick={onClose}><Ic d={P.x} size={18} /></button>
    </div>
  )
}

type Act = (op: string, payload: Record<string, unknown>, key?: string) => Promise<{ ok?: boolean; error?: string; data?: LeadAgentData } | null>

function AgentItem({ item, source, settings, gmail, busy, act, notify, left, onSkip, onDone, onClose }: {
  item: Extract<Item, { origin: 'agent' }>; source?: Source; settings: LeadSettings; gmail: boolean; busy: string | null
  act: Act; notify: (m: string) => void; left: number; onSkip: () => void; onDone: () => void; onClose: () => void
}) {
  const l = item.lead
  const forum = isForum(l)
  const [to, setTo] = useState(l.email ?? '')
  const [subject, setSubject] = useState(l.draft?.subject ?? '')
  const [body, setBody] = useState(l.draft?.body ?? '')
  const [reply, setReply] = useState(l.reply ?? '')
  // A draft written after the email was added comes in with fresh data
  useEffect(() => { if (l.draft && !subject && !body) { setSubject(l.draft.subject); setBody(l.draft.body) } }, [l.draft, subject, body])
  // Emails are written when a lead is opened, not during the search
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current || forum || l.status !== 'ready' || !l.email || l.draft) return
    asked.current = true
    act('email', { id: l.id, email: l.email })
  }, [act, forum, l.id, l.status, l.email, l.draft])

  const av = forum
    ? <span className="lfh-av lfh-av--lg">{source?.glyph}</span>
    : <span className="lfh-av lfh-av--lg">{initials(item.name).slice(0, 1)}</span>
  const subLine = forum ? <>{l.source === 'profile' ? `${platformOf(l.url)} page` : source?.name} · {fmtAgo(l.foundAt)}</> : l.source === 'own' ? 'Your list' : <>{l.website ? <a className="tu-site" href={`https://${l.website.replace(/^https?:\/\//, '')}`} target="_blank" rel="noopener noreferrer">{l.website.replace(/^https?:\/\//, '')}</a> : l.company || 'Google Maps'}{l.url && <a className="th-link" href={l.url} target="_blank" rel="noopener noreferrer">See it ↗</a>}</>
  const head = <Head av={av} title={forum && l.source !== 'profile' ? (subreddit(l.url) ? `r/${subreddit(l.url)}` : source?.name) : item.name} sub={subLine} onClose={onClose} />
  const why = l.why && <div className="lfh-why"><Ic d={P.spark} /><span>{l.why}</span></div>

  // Contacted: what happened and what's next
  if (item.stage === 'contacted' || item.stage === 'done') {
    const fu = settings.followUpDays
    return <>
      {head}
      <div className="lfh-d-body">
        {l.status === 'posted' ? <div className="lfh-hint"><Ic d={P.check} size={14} />You posted a reply. Answers show up on {source?.name}.</div>
          : l.status === 'queued' ? <div className="lfh-hint"><Ic d={P.clock} size={14} />Approved. It goes out with the next batch, {settings.dailyLimit} emails a day.</div>
          : l.status === 'sent' ? (
            <div className="lfh-timeline">
              <div className="lfh-step is-done"><span className="lfh-step-p"><Ic d={P.check} size={12} /></span><span>Your email</span><span className="lfh-when">{fmtDate(l.sentAt)}</span></div>
              {fu.map((d, n) => (
                <div key={d} className={`lfh-step${l.followupsSent > n ? ' is-done' : ''}`}>
                  <span className="lfh-step-p">{l.followupsSent > n && <Ic d={P.check} size={12} />}</span><span>Follow-up {n + 1}</span>
                  <span className="lfh-when">{l.followupsSent > n ? 'Sent' : n === l.followupsSent && l.nextFollowUpAt ? fmtDate(l.nextFollowUpAt) : `Day ${d}`}</span>
                </div>
              ))}
              <div className="lfh-step"><span className="lfh-step-p" /><span className="lfh-faint">Waiting for a reply</span><span /></div>
            </div>
          ) : <div className="lfh-hint">{l.status === 'skipped' ? 'Skipped.' : l.status === 'opted_out' ? 'Not interested. Follow-ups stopped.' : l.status === 'bounced' ? 'The email bounced, so follow-ups stopped.' : 'Answered.'}</div>}
        {why}
        {l.snippet && <div className="lfh-msg lfh-msg--post">{l.snippet}</div>}
      </div>
      <div className="lfh-d-foot">
        {l.status === 'queued' && <button type="button" className="btn btn-ghost lfh-grow-btn" onClick={onSkip}>Don&apos;t send it</button>}
        {forum && l.url && <a className="btn btn-ghost lfh-grow-btn" href={l.url} target="_blank" rel="noopener noreferrer">Open post ↗</a>}
        {l.threadId && <a className="btn btn-ghost lfh-grow-btn" href={`https://mail.google.com/mail/u/0/#all/${l.threadId}`} target="_blank" rel="noopener noreferrer">Open in Gmail ↗</a>}
      </div>
    </>
  }

  // They replied: answer in Gmail, then mark it
  if (item.stage === 'replied') {
    return <>
      {head}
      <div className="lfh-d-body">
        <div className="lfh-msg lfh-msg--us"><div className="lfh-who">You · {fmtDate(l.sentAt)}</div>{l.draft?.subject ?? 'Your email'}</div>
        <div className="lfh-msg lfh-msg--them"><div className="lfh-who">{(l.name || item.name).split(/\s+/)[0]} · {fmtDate(l.repliedAt)}</div>{l.replyNote ?? 'They replied to your email.'}</div>
        <div className="lfh-hint"><Ic d={P.check} size={14} />Follow-ups stopped. Answer in Gmail, in the same thread.</div>
      </div>
      <div className="lfh-d-foot">
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={async () => { await act('handled', { id: l.id }); onDone() }}>I&apos;ve answered</button>
        {l.threadId && <a className="btn btn-primary lfh-grow-btn" href={`https://mail.google.com/mail/u/0/#all/${l.threadId}`} target="_blank" rel="noopener noreferrer">Reply in Gmail ↗</a>}
      </div>
    </>
  }

  // A forum post: check the reply, copy it, post it. A seller page: the same, as a message on their page
  if (forum) {
    const page = l.source === 'profile'
    const site = page ? platformOf(l.url) : ''
    return <>
      {head}
      <div className="lfh-d-body">
        <div className="lfh-msg lfh-msg--post"><div className="lfh-who">{l.title}</div>{l.snippet}</div>
        {why}
        <div className="lfh-msg lfh-msg--us lfh-msg--edit"><div className="lfh-who"><Ic d={P.spark} size={12} />{page ? 'Your message' : 'Your reply'}</div>
          <textarea aria-label={page ? 'Your message' : 'Your reply'} rows={7} value={reply} onChange={e => setReply(e.target.value)} />
        </div>
        {page
          ? <div className="lfh-how"><span>1 <b>Copy</b></span><span>2 <b>Open their {site} page</b></span><span>3 <b>Send it there</b></span></div>
          : <div className="lfh-how"><span>1 <b>Copy</b></span><span>2 <b>Open post</b></span><span>3 <b>Paste &amp; post</b></span></div>}
      </div>
      <div className="lfh-d-foot">
        <button type="button" className="btn btn-ghost" onClick={onSkip}>Skip</button>
        <button type="button" className="btn btn-ghost" aria-label="Copy reply" title="Copy reply" onClick={async () => {
          try { await navigator.clipboard.writeText(reply); notify(page ? 'Message copied. Send it on their page.' : 'Reply copied. Paste it on the post.') } catch { notify('Couldn’t copy. Select the text and copy it.') }
        }}><Ic d={P.copy} /></button>
        <a className="btn btn-ghost" href={l.url} target="_blank" rel="noopener noreferrer" aria-label={page ? 'Open their page' : 'Open post'} title={page ? 'Open their page' : 'Open post'}><Ic d={P.out} /></a>
        <button type="button" className="btn btn-primary lfh-grow-btn" disabled={!!busy || !reply.trim()} onClick={async () => {
          if (reply !== l.reply) await act('save', { id: l.id, reply }, `save:${l.id}`)
          await act('posted', { id: l.id })
          notify(page ? 'Marked as sent' : 'Marked as posted')
          onDone()
        }}><Ic d={P.check} />{page ? 'I sent it' : 'I posted it'}</button>
      </div>
    </>
  }

  // An email: where it goes, then the email
  const hasDraft = !!l.draft && !!l.email
  const writing = busy === `email:${l.id}`
  const sending = busy === `approve:${l.id}`
  return <>
    {head}
    <div className="lfh-d-body">
      {why}
      <div className="lfh-letter">
        <div className="lfh-to">
          {hasDraft && to === l.email
            ? <>To <b>{(l.name || item.name).split(/\s+/)[0]}</b>{l.email}<span className="lfh-found" title={l.emailVerified ? 'Verified' : 'Not verified'}><Ic d={P.check} size={14} /></span>
                <button type="button" className="lfh-tiny" onClick={() => setTo('')}>Change</button></>
            : <form className="lfh-to-form" onSubmit={async e => {
                e.preventDefault()
                if (!validEmail(to)) return
                const r = await act('email', { id: l.id, email: to })
                const fresh = r?.data?.leads.find(x => x.id === l.id)
                if (fresh?.draft) { setSubject(fresh.draft.subject); setBody(fresh.draft.body); setTo(fresh.email ?? to) }
              }}>
                <Ic d={P.mail} />
                <input type="email" aria-label="Their email" placeholder={l.email ? l.email : 'their email'} value={to} onChange={e => setTo(e.target.value)} />
                <button type="submit" className="lfh-look" disabled={!validEmail(to) || writing}>{writing ? <Spinner /> : null}{writing ? 'Writing…' : 'Use this'}</button>
              </form>}
        </div>
        {!hasDraft && !writing && <div className="lfh-nofind">{l.website ? <>No public email found. Try <a className="th-link" href={`https://${l.website.replace(/^https?:\/\//, '')}`} target="_blank" rel="noopener noreferrer">their website ↗</a>{l.phone ? ` or call ${l.phone}` : ''}.</> : 'No public email found. Paste it if you know it and the email gets written.'}</div>}
        <div className={`lfh-draft${hasDraft ? '' : ' is-locked'}`}>
          <input className="lfh-subj" aria-label="Subject" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" />
          <textarea aria-label="Email" rows={10} value={body} onChange={e => setBody(e.target.value)} placeholder="The email is written once there's an address." />
        </div>
      </div>
      <div className="lfh-hint"><Ic d={P.clock} size={14} />{settings.followUpDays.length ? `Follow-ups after ${settings.followUpDays.join(' and ')} days stop when they reply.` : 'No follow-ups.'}</div>
      {!gmail && <div className="lfh-hint lfh-warn">Connect Gmail to send. <a className="th-link" href="/api/gmail/connect">Connect Gmail</a></div>}
    </div>
    <div className="lfh-d-foot">
      <button type="button" className="btn btn-ghost" onClick={onSkip}>Skip</button>
      <button type="button" className="btn btn-primary lfh-grow-btn" disabled={!hasDraft || sending || !gmail || !subject.trim() || !body.trim()}
        onClick={async () => {
          const r = await act('approve', { id: l.id, subject, body }, `approve:${l.id}`)
          if (r && r.ok !== false && !r.error) onDone()
        }}>
        {sending ? <><Spinner />Sending…</> : <><Ic d={P.send} />Send{left > 0 && <span className="lfh-more">· {left} more</span>}</>}
      </button>
    </div>
  </>
}

function RivalItem({ item, source, gmail, notify, left, onChange, onSkip, onDone, onClose }: {
  item: Extract<Item, { origin: 'rival' }>; source?: Source; gmail: boolean; notify: (m: string) => void; left: number
  onChange: (change: Partial<SavedReview>) => void; onSkip: () => void; onDone: () => void; onClose: () => void
}) {
  const r = item.review
  const first = firstName(r.name)
  const hi = first ? `Hi ${first},` : 'Hi,'
  const [to, setTo] = useState(r.email ?? '')
  const [subject, setSubject] = useState(r.draft?.subject ?? '')
  const [body, setBody] = useState(r.draft ? `${hi}\n\n${r.draft.body}` : '')
  const [finding, setFinding] = useState(false)
  const [writing, setWriting] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bare = (b: string) => (b.startsWith(`${hi}\n\n`) ? b.slice(hi.length + 2) : b)
  const started = useRef(false)

  // Opening a reviewer looks up their email and writes the email, each once
  useEffect(() => {
    if (started.current || item.stage !== 'todo' && item.stage !== 'nofit') return
    started.current = true
    if (!r.contactChecked) {
      setFinding(true)
      step<{ review: SavedReview }>({ op: 'contact', leadId: r.id })
        .then(({ review: y }) => { onChange({ contactChecked: true, email: y.email, verified: y.verified, website: y.website }); if (y.email) setTo(t => t || y.email!) })
        .catch(e => setError(e instanceof Error ? e.message : 'Couldn’t look up their email.'))
        .finally(() => setFinding(false))
    }
    if (!r.draft) {
      setWriting(true)
      step<{ review: SavedReview }>({ op: 'draft', leadId: r.id })
        .then(({ review: y }) => { if (y.draft) { onChange({ draft: y.draft }); setSubject(y.draft.subject); setBody(`${hi}\n\n${y.draft.body}`) } })
        .catch(e => setError(e instanceof Error ? e.message : 'Couldn’t write the email.'))
        .finally(() => setWriting(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const head = <Head av={<span className="lfh-av lfh-av--lg lfh-av--round">{initials(r.name)}</span>}
    title={r.name} sub={<><Stars n={r.rating} size={12} /> on {source?.name}</>} onClose={onClose} />
  const review = (
    <div className="lfh-review">
      <span className="lfh-q" aria-hidden="true">“</span>
      <Stars n={r.rating} size={15} />
      <p>{r.text}</p>
      <div className="lfh-review-foot">{source?.name}{r.date ? ` · ${fmtDate(r.date)}` : ''}{r.reviewUrl && <a href={r.reviewUrl} target="_blank" rel="noopener noreferrer">Open ↗</a>}</div>
    </div>
  )

  if (item.stage === 'contacted' || item.stage === 'done') {
    return <>
      {head}
      <div className="lfh-d-body">
        <div className="lfh-hint"><Ic d={P.check} size={14} />{r.status === 'sent' ? `Emailed ${r.email ?? ''}${r.sentAt ? ` on ${fmtDate(r.sentAt)}` : ''}. A reminder to follow up comes in 5 days if they don’t reply. It’s also in Email Outreach.` : 'Skipped.'}</div>
        {r.draft && <div className="lfh-msg lfh-msg--us"><div className="lfh-who">{r.draft.subject}</div>{r.draft.body}</div>}
        {review}
      </div>
    </>
  }

  const ready = validEmail(to) && !!subject.trim() && !!body.trim()
  async function send() {
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/gmail/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), subject, body: textToHtml(body), followUpDays: 5, source: 'competitor-leads' }),
      })
      const j = await res.json().catch(() => ({})) as { error?: string; message?: string }
      if (!res.ok) throw new Error(j.message ?? j.error ?? 'Couldn’t send.')
      const draft = { subject, body: bare(body) }
      await saveReview(r.id, { status: 'sent', email: to.trim(), draft })
      onChange({ status: 'sent', email: to.trim(), draft, sentAt: new Date().toISOString() })
      notify(`Sent to ${r.name}`)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t send.')
    } finally {
      setSending(false)
    }
  }

  return <>
    {head}
    <div className="lfh-d-body">
      {review}
      {r.why && <div className="lfh-why"><Ic d={P.spark} /><span>{r.why}{item.stage === 'nofit' ? ` (fit ${r.fit}/10)` : ''}</span></div>}
      <div className="lfh-letter">
        <div className="lfh-to">
          {finding ? <><Spinner />Looking for {first || r.name}&apos;s email…</> : <>
            <Ic d={P.mail} />
            <input type="email" aria-label="Their email" placeholder="their email" value={to} onChange={e => setTo(e.target.value)} />
            {r.email && to === r.email && <span className="lfh-found" title={r.verified ? 'Verified' : 'Not verified, so double-check it'}><Ic d={P.check} size={14} /></span>}
          </>}
        </div>
        {!finding && r.contactChecked && !r.email && <div className="lfh-nofind">No public email found.{r.website ? <> Try <a className="th-link" href={r.website.startsWith('http') ? r.website : `https://${r.website}`} target="_blank" rel="noopener noreferrer">their website ↗</a>.</> : ' Type it if you know it.'}</div>}
        <div className={`lfh-draft${validEmail(to) ? '' : ' is-locked'}`}>
          {writing ? <div className="lfh-writing"><Spinner />Writing a short, personal email…</div> : <>
            <input className="lfh-subj" aria-label="Subject" value={subject} onChange={e => setSubject(e.target.value)} onBlur={() => saveReview(r.id, { draft: { subject, body: bare(body) } })} />
            <textarea aria-label="Email" rows={10} value={body} onChange={e => setBody(e.target.value)} onBlur={() => saveReview(r.id, { draft: { subject, body: bare(body) } })} />
          </>}
        </div>
      </div>
      {error && <div className="lfh-hint lfh-warn" role="alert">{error}</div>}
      {!gmail && <div className="lfh-hint lfh-warn">Connect Gmail to send. <a className="th-link" href="/api/gmail/connect">Connect Gmail</a></div>}
    </div>
    <div className="lfh-d-foot">
      <button type="button" className="btn btn-ghost" onClick={onSkip}>Skip</button>
      <button type="button" className="btn btn-primary lfh-grow-btn" disabled={!ready || sending || writing || !gmail} onClick={send}>
        {sending ? <><Spinner />Sending…</> : <><Ic d={P.send} />Send{left > 0 && <span className="lfh-more">· {left} more</span>}</>}
      </button>
    </div>
  </>
}

function MapsQuery({ value, saving, onSave, label = 'Google Maps search', placeholder = 'e.g. salons and cafés in Austin' }: { value: string; saving: boolean; onSave: (q: string) => void; label?: string; placeholder?: string }) {
  const [edit, setEdit] = useState(false)
  const [q, setQ] = useState(value)
  useEffect(() => setQ(value), [value])
  if (edit) {
    return (
      <form className="lfh-query" onSubmit={e => { e.preventDefault(); if (q.trim()) { onSave(q.trim()); setEdit(false) } }}>
        <input className="lfh-chipin" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={label} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !q.trim()}>Save</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQ(value); setEdit(false) }}>Cancel</button>
      </form>
    )
  }
  return (
    <div className="lfh-query">
      <span className="lfh-lab">Looking for</span>
      <button type="button" className="lfh-chip lfh-chip--edit" onClick={() => setEdit(true)} title="Change">{value || 'Add a search'}<Ic d={P.sliders} size={13} /></button>
    </div>
  )
}

function SettingsPanel({ initial, saving, picking, gmail, demo, demoForced, rivals, busy, onSave, onPick, onDemo, onClose }: {
  initial: LeadSettings; saving: boolean; picking: boolean; onPick: () => void; gmail: boolean; demo: boolean; demoForced: boolean; rivals: Source[]; busy: boolean
  onSave: (s: LeadSettings) => void; onDemo: (on: boolean) => void; onClose: () => void
}) {
  const [s, setS] = useState(initial)
  const [days, setDays] = useState(initial.followUpDays.join(', '))
  const set = <K extends keyof LeadSettings>(k: K, v: LeadSettings[K]) => setS(x => ({ ...x, [k]: v }))
  const Sw = ({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) => (
    <button type="button" className="lfh-sw" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
  )
  return <>
    <Head title="Settings" sub="Lead Finder" onClose={onClose} />
    <form id="lfh-settings" className="lfh-d-body" onSubmit={e => { e.preventDefault(); onSave({ ...s, followUpDays: days.split(/[,\s]+/).map(Number).filter(n => n > 0) }) }}>
      <div className="lfh-set"><span className="lfh-set-t">Search every morning<small>New people wait for you. Nothing is sent without you.</small></span><Sw on={s.enabled} label="Search every morning" onChange={v => set('enabled', v)} /></div>
      <IcpFields s={s} onChange={p => setS(x => ({ ...x, ...p }))} label="lfh-field" />
      <div className="lfh-grp lfh-grp--row">Sources<button type="button" className="btn btn-ghost btn-sm" disabled={picking} onClick={onPick}>{picking ? <><Spinner />Picking…</> : 'Pick for me'}</button></div>
      {initial.picked?.why && <p className="lfh-meta">{initial.picked.why}</p>}
      <div className="lfh-set"><span className="lfh-set-t">Companies like your customers<small>{s.companyQuery || 'Online businesses that match your customer'}</small></span><Sw on={!!s.sources.companies} label="Companies like your customers" onChange={v => set('sources', { ...s.sources, companies: v })} /></div>
      {s.sources.companies && <label className="lfh-field">Who to look for<input value={s.companyQuery} onChange={e => set('companyQuery', e.target.value)} placeholder="e.g. small fashion and beauty online stores, 1-50 people" /></label>}
      <div className="lfh-set"><span className="lfh-set-t">Google Maps<small>{s.localQuery || 'Add a search, e.g. cafés in Pune'}</small></span><Sw on={s.sources.local} label="Google Maps" onChange={v => set('sources', { ...s.sources, local: v })} /></div>
      {s.sources.local && <label className="lfh-field">Google Maps search<input value={s.localQuery} onChange={e => set('localQuery', e.target.value)} placeholder="e.g. cafés in Pune" /></label>}
      <div className="lfh-set"><span className="lfh-set-t">Reddit and Hacker News<small>Posts asking for a tool like yours. You post every reply.</small></span><Sw on={s.sources.reddit} label="Reddit and Hacker News" onChange={v => set('sources', { ...s.sources, reddit: v })} /></div>
      {rivals.map(r => (
        <div key={r.id} className="lfh-set"><span className="lfh-set-t">{r.name}<small>Competitor · {PLATFORM[r.platform ?? 'trustpilot']}{r.scans?.[0] ? ` · read ${fmtAgo(r.scans[0].scannedAt)}` : ''}</small></span></div>
      ))}
      <div className="lfh-grp">Sending</div>
      <div className="lfh-set"><span className="lfh-set-t">Gmail<small>{gmail ? 'Emails go out from your Gmail' : 'Not connected'}</small></span>{gmail ? <span className="lfh-status">On</span> : <a className="btn btn-primary btn-sm" href="/api/gmail/connect">Connect</a>}</div>
      <div className="lfh-row2">
        <label className="lfh-field">New emails a day<input type="number" min={1} max={30} value={s.dailyLimit} onChange={e => set('dailyLimit', Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></label>
        <label className="lfh-field">Follow up after (days)<input value={days} onChange={e => setDays(e.target.value)} placeholder="3, 7" /></label>
      </div>
      <label className="lfh-field">Country<select value={s.country} onChange={e => set('country', e.target.value)}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
      <div className="lfh-set"><span className="lfh-set-t">Don&apos;t cold-email businesses in the EU<small>EU rules on marketing email are stricter.</small></span><Sw on={s.skipEU} label="Skip EU" onChange={v => set('skipEU', v)} /></div>
      <div className="lfh-set"><span className="lfh-set-t">Demo mode<small>Made-up Google Maps and Reddit leads. Nothing is sent. Competitor reviews stay real.</small></span><DemoSwitch on={demo} forced={demoForced} busy={busy} onChange={onDemo} /></div>
    </form>
    <div className="lfh-d-foot">
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button type="submit" form="lfh-settings" className="btn btn-primary lfh-grow-btn" disabled={saving}>{saving ? <><Spinner />Saving…</> : 'Save'}</button>
    </div>
  </>
}

function AddSource({ trustpilot, onRival, onCity, onClose }: { trustpilot: boolean; onRival: (p: Platform, c: string) => void; onCity: (q: string) => void; onClose: () => void }) {
  const [kind, setKind] = useState<'rival' | 'city'>('rival')
  const [platform, setPlatform] = useState<Platform>(trustpilot ? 'trustpilot' : 'shopify')
  const [v, setV] = useState('')
  const ok = v.trim().length >= 2
  return <>
    <Head title="Add a source" sub="Where should we look?" onClose={onClose} />
    <form id="lfh-add" className="lfh-d-body" onSubmit={e => { e.preventDefault(); if (!ok) return; if (kind === 'rival') onRival(platform, v.trim()); else onCity(v.trim()) }}>
      <div className="lfh-pick">
        <button type="button" aria-pressed={kind === 'rival'} onClick={() => setKind('rival')}><span className="lfh-pick-ic"><Stars n={1} size={18} /></span>A competitor<small>their unhappy reviewers</small></button>
        <button type="button" aria-pressed={kind === 'city'} onClick={() => setKind('city')}><span className="lfh-pick-ic"><Ic d={P.pin} size={22} /></span>A Google Maps search<small>local businesses</small></button>
      </div>
      <input className="lfh-input" autoFocus value={v} onChange={e => setV(e.target.value)} aria-label={kind === 'rival' ? 'Competitor' : 'Google Maps search'}
        placeholder={kind === 'rival' ? (platform === 'trustpilot' ? 'Their website, e.g. later.com' : 'Their App Store link, e.g. apps.shopify.com/later') : 'e.g. salons and cafés in Austin'} />
      {kind === 'rival' && (
        <div className="lfh-pick">
          {(['trustpilot', 'shopify'] as const).map(p => (
            <button key={p} type="button" aria-pressed={platform === p} disabled={p === 'trustpilot' && !trustpilot} onClick={() => setPlatform(p)}>{PLATFORM[p]}{p === 'trustpilot' && !trustpilot && <small>needs DataForSEO</small>}</button>
          ))}
        </div>
      )}
      {kind === 'city' && <div className="lfh-hint">This replaces the current Google Maps search.</div>}
    </form>
    <div className="lfh-d-foot"><button type="submit" form="lfh-add" className="btn btn-primary lfh-grow-btn" disabled={!ok}>Add &amp; search</button></div>
  </>
}

