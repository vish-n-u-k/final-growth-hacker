'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ToolHeader from '@/components/ToolHeader'
import { Spinner } from '@/components/ui/spinner'
import { Stars, competitorLabel, ago, fmtDate, initials, reviewHref, step } from '@/components/lead-finder/ui'
import type { SavedReview, SavedScan } from '@/lib/lead-finder/saved'

// Competitor Leads, step one: read a competitor's newest reviews, list them, then check how well
// the brand fits each unhappy (1–3 star) reviewer a few at a time, so the best fits rise to the top
// as they're found. "Reach out" on a review opens its own page (app/(shell)/lead-finder/review/[id])
// that finds an email and writes one. Everything is saved as it happens (lib/lead-finder/saved.ts).

type Platform = 'trustpilot' | 'shopify'
type Show = 'all' | 'good' | 'new' | 'sent' | 'skipped'

const GOOD = 7         // a good fit is 7+ out of 10
const MAX_SCORED = 40  // unhappy reviewers checked per scan (time and cost)
const BATCH = 6
const PAGE_SIZE = 8     // reviews per page
const needsScore = (r: SavedReview) => r.rating <= 3 && r.fit === undefined

export default function LeadFinder({ brandName, gmailConnected, competitors = [], trustpilotReady = false, initialScan = null, initialReviews = [], history: initialHistory = [] }: {
  brandName: string
  gmailConnected: boolean
  competitors?: string[]          // the brand's known competitors, offered as one-click picks
  trustpilotReady?: boolean       // DataForSEO set up: Trustpilot can be read reliably
  initialScan?: SavedScan | null  // the latest saved scan
  initialReviews?: SavedReview[]
  history?: SavedScan[]           // earlier scans, newest first
}) {
  const [platform, setPlatform] = useState<Platform>(initialScan?.platform ?? 'trustpilot')
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<'empty' | 'running' | 'done' | 'failed'>(initialScan ? 'done' : 'empty')
  const [detail, setDetail] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [scan, setScan] = useState<SavedScan | null>(initialScan)
  const [reviews, setReviews] = useState<SavedReview[]>(initialReviews)
  const [history, setHistory] = useState<SavedScan[]>(initialHistory)
  const [loadingScan, setLoadingScan] = useState(false)
  const stopRef = useRef(false)
  // Checking fit: which scan is being checked (a new scan or switching scans stops the old one)
  const scoringFor = useRef<string | null>(null)
  const [scoring, setScoring] = useState<{ done: number; total: number } | null>(null)
  const [scoreError, setScoreError] = useState<string | null>(null)

  // Filters and sorting
  const [q, setQ] = useState('')
  // Only the relevant reviewers by default: the good fits. Everyone else is one click away.
  const [stars, setStars] = useState<number[]>([])
  const [show, setShow] = useState<Show>('good')
  const [sort, setSort] = useState<'fit' | 'new' | 'low' | 'name'>('fit')
  const [page, setPage] = useState(1)
  const listTop = useRef<HTMLDivElement>(null)
  // Back to page 1 whenever the list itself changes
  useEffect(() => { setPage(1) }, [q, stars, show, sort, scan?.id])

  async function scoreAll(scanId: string, list: SavedReview[]) {
    const todo = list.filter(needsScore).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, MAX_SCORED)
    if (!todo.length) return
    scoringFor.current = scanId
    setScoreError(null); setScoring({ done: 0, total: todo.length })
    for (let i = 0; i < todo.length; i += BATCH) {
      if (scoringFor.current !== scanId) return
      const batch = todo.slice(i, i + BATCH)
      try {
        const { reviews: scored } = await step<{ reviews: SavedReview[] }>({ op: 'score', scanId, leadIds: batch.map(x => x.id) })
        if (scoringFor.current !== scanId) return
        const byId = new Map(scored.map(x => [x.id, x]))
        setReviews(prev => prev.map(x => { const y = byId.get(x.id); return y ? { ...x, fit: y.fit, why: y.why, pains: y.pains } : x }))
      } catch (e) {
        if (scoringFor.current !== scanId) return
        setScoreError(e instanceof Error ? e.message : 'Couldn’t check some reviewers.')
        break
      }
      setScoring({ done: Math.min(i + BATCH, todo.length), total: todo.length })
    }
    if (scoringFor.current === scanId) { scoringFor.current = null; setScoring(null) }
  }

  // A scan left half-checked (page closed while checking) carries on when it's opened again
  useEffect(() => {
    if (initialScan) scoreAll(initialScan.id, initialReviews)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function reset() {
    stopRef.current = true
    scoringFor.current = null; setScoring(null)
    setPhase('empty'); setFailure(null); setInput('')
  }

  async function run(target = input) {
    const competitor = target.trim()
    if (!competitor) return
    stopRef.current = false
    const scanId = crypto.randomUUID()
    setInput(competitor); setPhase('running'); setFailure(null)
    setDetail(platform === 'trustpilot' ? `Asking for ${competitor}'s newest Trustpilot reviews` : 'Reading the Shopify App Store review pages')
    try {
      const args = { platform, url: competitor, scanId }
      let r = await step<{ scan?: SavedScan; reviews?: SavedReview[]; pending?: string }>({ op: 'reviews', ...args })
      for (let tries = 0; r.pending && tries < 45; tries++) {
        if (stopRef.current) return
        setDetail('Collecting the newest reviews (usually under a minute)')
        await new Promise(res => setTimeout(res, 4000))
        r = await step<typeof r>({ op: 'reviews_poll', taskId: r.pending, ...args })
      }
      if (stopRef.current) return
      if (r.pending) throw new Error('Reading the reviews is taking too long. Try again in a few minutes.')
      if (!r.scan || !r.reviews?.length) throw new Error(`No reviews found for ${competitor}. Check the ${platform === 'trustpilot' ? 'website or Trustpilot link' : 'App Store link'}.`)
      const s = r.scan
      setScan(s); setReviews(r.reviews); setHistory(prev => [s, ...prev.filter(x => x.id !== s.id)].slice(0, 20))
      setQ(''); setStars([]); setShow('good'); setSort('fit')
      setPhase('done')
      scoreAll(s.id, r.reviews)
    } catch (e) {
      if (stopRef.current) return
      setFailure(e instanceof Error ? e.message : 'Something went wrong.')
      setPhase('failed')
    }
  }

  async function openScan(id: string) {
    const s = history.find(x => x.id === id)
    if (!s || s.id === scan?.id) return
    setLoadingScan(true)
    try {
      const res = await fetch(`/api/lead-finder/saved?scan=${encodeURIComponent(id)}`)
      const j = await res.json() as { reviews?: SavedReview[] }
      scoringFor.current = null; setScoring(null)
      setScan(s); setPlatform(s.platform); setReviews(j.reviews ?? []); setPhase('done')
      setQ(''); setStars([]); setShow('good')
      scoreAll(s.id, j.reviews ?? [])
    } catch { /* keep the current scan */ } finally { setLoadingScan(false) }
  }

  // ── Filtering and sorting ───────────────────────────────────────────────────
  const filtersOn = !!q.trim() || stars.length > 0 || show !== 'good'
  const clearFilters = () => { setQ(''); setStars([]); setShow('good') }
  const showEveryone = () => { setQ(''); setStars([]); setShow('all') }
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = reviews.filter(r =>
      (!needle || `${r.name} ${r.text}`.toLowerCase().includes(needle)) &&
      (!stars.length || stars.includes(Math.round(r.rating))) &&
      (show === 'all' || (show === 'good' ? (r.fit ?? 0) >= GOOD : r.status === show)))
    const by: Record<typeof sort, (a: SavedReview, b: SavedReview) => number> = {
      // Checked reviewers by fit, then the rest newest first
      fit: (a, b) => (b.fit ?? -1) - (a.fit ?? -1) || (b.date ?? '').localeCompare(a.date ?? ''),
      new: (a, b) => (b.date ?? '').localeCompare(a.date ?? ''),
      low: (a, b) => a.rating - b.rating,
      name: (a, b) => a.name.localeCompare(b.name),
    }
    return [...list].sort(by[sort])
  }, [reviews, q, stars, show, sort])
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const cur = Math.min(page, pages)
  const pageItems = shown.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  function goTo(n: number) {
    setPage(n)
    listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // Page numbers to show: first, last, and the ones around the current page
  const pageNums = Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - cur) <= 1)
  const emailed = reviews.filter(r => r.status === 'sent').length
  const goodFits = reviews.filter(r => (r.fit ?? 0) >= GOOD).length
  const checked = reviews.filter(r => r.fit !== undefined).length
  const unhappy = reviews.filter(r => r.rating <= 3).length
  const count = (v: Show) => (v === 'all' ? reviews.length : v === 'good' ? goodFits : reviews.filter(r => r.status === v).length)

  // ── Views ───────────────────────────────────────────────────────────────────

  const header = (
    <ToolHeader
      icon="target"
      title="Competitor Leads"
      intro="competitorLeads"
      chips={<>
        <span className="th-chip">Beta</span>
        <span className={`th-chip ${gmailConnected ? 'th-chip--on' : 'th-chip--warn'}`}>{gmailConnected ? 'Gmail connected' : 'Gmail not connected'}</span>
      </>}
      actions={<Link href="/gmail-hub" className="th-link">Email Outreach →</Link>}
    />
  )

  const scanBar = (right: React.ReactNode) => (
    <div className="cl-scanbar">
      <span>{(phase === 'done' ? scan?.platform : platform) === 'shopify' ? 'Shopify App Store' : 'Trustpilot'} · <b>{competitorLabel((phase === 'done' ? scan?.competitor : input) ?? '')}</b></span>
      <span className="cl-grow" />
      {right}
    </div>
  )

  // A review card: who and how well they fit at the top, what they said in the middle, and the
  // status and actions in a footer, so buttons sit in the same place on every card
  function row(r: SavedReview) {
    return (
      <article key={r.id} className={`cl-rv${r.status === 'sent' ? ' cl-rv--sent' : ''}${r.status === 'skipped' ? ' cl-rv--dim' : ''}`}>
        <div className="cl-rv-head">
          <span className="cl-av" aria-hidden="true">{initials(r.name)}</span>
          <div className="cl-rv-who">
            <div className="cl-lead-name">{r.name}</div>
            <div className="cl-lead-sub">
              <Stars n={r.rating} />{r.date && <span>{fmtDate(r.date)}</span>}
              {r.reviewUrl && <a className="th-link" href={r.reviewUrl} target="_blank" rel="noopener noreferrer">Read on {scan?.platform === 'shopify' ? 'App Store' : 'Trustpilot'} ↗</a>}
            </div>
          </div>
          {r.fit !== undefined
            ? <span className={`cl-fitb cl-fitb--${r.fit >= GOOD ? 'good' : r.fit >= 5 ? 'mid' : 'low'}`}>{r.fit >= GOOD ? 'Good fit' : r.fit >= 5 ? 'Partial fit' : 'Weak fit'} · {r.fit}/10</span>
            : scoring && r.rating <= 3 && <span className="cl-fitb cl-fitb--wait"><Spinner size={10} />Checking fit</span>}
        </div>
        <div className="cl-rv-body">
          <p className="cl-rv-text">{r.text}</p>
          {r.fit !== undefined && r.why && <p className={`cl-rv-why${r.fit >= GOOD ? ' cl-rv-why--good' : ''}`}>{r.why}</p>}
        </div>
        <div className="cl-rv-foot">
          <span className="cl-rv-state">
            {r.status === 'sent' ? <span className="cl-tag cl-tag--ok">✓ Emailed{r.sentAt ? ` · ${fmtDate(r.sentAt)}` : ''}</span>
              : r.status === 'skipped' ? <span className="cl-tag">Marked not a fit</span>
              : null}
          </span>
          {r.status === 'sent'
            ? <Link className="btn btn-sm cl-btn-outline" href={reviewHref(r.id)}>View email</Link>
            : <Link className="btn btn-primary btn-sm cl-reach" href={reviewHref(r.id)}>Reach out →</Link>}
        </div>
      </article>
    )
  }

  const toolbar = (
    <div className="cl-tools" role="search">
      <input className="cl-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or review" aria-label="Search reviews" />
      <span className="cl-starf" role="group" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" aria-pressed={stars.includes(n)} onClick={() => setStars(s => (s.includes(n) ? s.filter(x => x !== n) : [...s, n]))}>{n}<span>★</span></button>
        ))}
      </span>
      <select className={`cl-sel${show !== 'all' ? ' cl-sel--on' : ''}`} value={show} onChange={e => setShow(e.target.value as Show)} aria-label="Show">
        <option value="all">Everyone ({count('all')})</option>
        <option value="good">Good fits only ({count('good')})</option>
        <option value="new">Not contacted ({count('new')})</option>
        <option value="sent">Emailed ({count('sent')})</option>
        <option value="skipped">Marked not a fit ({count('skipped')})</option>
      </select>
      <span className="cl-sep" aria-hidden="true" />
      <select className="cl-sel" value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort">
        <option value="fit">Best fit first</option>
        <option value="new">Newest first</option>
        <option value="low">Lowest rating</option>
        <option value="name">Name A–Z</option>
      </select>
    </div>
  )

  return (
    <div className="tool-page">
      {header}
      <div className="cl">
        {phase === 'empty' && (
          <section className="cl-empty">
            <div className="cl-art" aria-hidden="true">
              <div className="cl-art-rv"><Stars n={2} /><i /><i style={{ width: '70%' }} /></div>
              <span className="cl-art-ar">→</span>
              <span className="cl-art-env"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="M3.5 6l6.5 5 6.5-5" /></svg></span>
            </div>
            <h2>Turn your competitors’ unhappy customers into leads</h2>
            <p>GrowJin reads a competitor’s newest reviews, finds the unhappy customers {brandName} could actually help, and writes a short email to anyone you pick.</p>
            <form className="cl-form" onSubmit={e => { e.preventDefault(); run() }}>
              <div className="cl-seg" role="group" aria-label="Where their reviews are">
                {(['trustpilot', 'shopify'] as const).map(p => (
                  <button key={p} type="button" aria-pressed={platform === p} onClick={() => setPlatform(p)}>{p === 'trustpilot' ? 'Trustpilot' : 'Shopify App Store'}</button>
                ))}
              </div>
              <div className="cl-inrow">
                <input className="cl-in" value={input} onChange={e => setInput(e.target.value)} aria-label="Competitor"
                  placeholder={platform === 'trustpilot' ? 'competitor.com or their Trustpilot link' : 'apps.shopify.com/competitor-app'} />
                <button className="btn btn-primary cl-go" type="submit" disabled={!input.trim()}>Read reviews</button>
              </div>
              {platform === 'trustpilot' && competitors.length > 0 && (
                <div className="cl-try">Your competitors:
                  {competitors.map(c => <button key={c} type="button" onClick={() => setInput(c)}>{c}</button>)}
                </div>
              )}
              {platform === 'trustpilot' && !trustpilotReady && (
                <p className="cl-warn">Trustpilot often blocks automatic reading unless DataForSEO is set up. The Shopify App Store works either way.</p>
              )}
            </form>
            <div className="cl-fine"><span>Takes under a minute</span><span>Costs a cent or two</span><span>Nothing is sent until you approve it</span></div>
            {scan && (
              <p className="cl-back"><button type="button" className="th-link" onClick={() => setPhase('done')}>← Back to {competitorLabel(scan.competitor)}</button></p>
            )}
          </section>
        )}

        {phase === 'running' && (
          <>
            {scanBar(<button className="btn btn-ghost btn-sm" type="button" onClick={reset}>Stop</button>)}
            <div className="cl-reading" aria-live="polite"><Spinner size={16} /><div><b>Reading reviews</b><span>{detail}</span></div></div>
          </>
        )}

        {phase === 'failed' && (
          <>
            {scanBar(null)}
            <div className="cl-prob" role="alert">
              <h3>Couldn’t read the reviews</h3>
              <p>{failure}</p>
              <div className="cl-acts">
                <button className="btn btn-primary" type="button" onClick={() => run(input)}>Try again</button>
                {platform === 'trustpilot' && <button className="btn btn-ghost" type="button" onClick={() => { setPlatform('shopify'); setPhase('empty'); setInput('') }}>Use Shopify App Store</button>}
                <button className="btn btn-ghost" type="button" onClick={reset}>Back</button>
              </div>
            </div>
          </>
        )}

        {phase === 'done' && scan && (
          <>
            {scanBar(<>
              <span className="cl-muted">{scan.reviewsRead} newest reviews · read {ago(scan.scannedAt)}</span>
              {history.length > 1 && (
                <select className="cl-sel cl-hist" value={scan.id} disabled={loadingScan} onChange={e => openScan(e.target.value)} aria-label="Earlier scans">
                  {history.map(h => <option key={h.id} value={h.id}>{competitorLabel(h.competitor)} · {fmtDate(h.scannedAt)}{h.emailed ? ` · ${h.emailed} emailed` : ''}</option>)}
                </select>
              )}
              <button className="btn btn-primary cl-newscan" type="button" onClick={reset}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                Scan another competitor
              </button>
            </>)}
            {toolbar}
            {scoring && (
              <div className="cl-scoring" aria-live="polite">
                <Spinner size={14} />
                <span>Finding the best fits for {brandName} · <b>{scoring.done} of {scoring.total}</b> checked{goodFits ? ` · ${goodFits} good fit${goodFits === 1 ? '' : 's'} so far` : ''}</span>
                <span className="cl-scoring-bar"><i style={{ width: `${Math.round(scoring.done / scoring.total * 100)}%` }} /></span>
              </div>
            )}
            {scoreError && !scoring && (
              <div className="cl-scoring cl-scoring--bad" role="alert">
                <span>{scoreError}</span>
                <button type="button" className="th-link" onClick={() => scan && scoreAll(scan.id, reviews)}>Try again</button>
              </div>
            )}
            <div className="cl-count" ref={listTop}>
              {show === 'good' && !q.trim() && !stars.length ? <>
                <b>{goodFits} good fit{goodFits === 1 ? '' : 's'}</b> for {brandName}{scoring ? ' so far' : ''}, out of {reviews.length} reviews read
                {!scoring && unhappy > checked ? ` (${unhappy - checked} unhappy reviewer${unhappy - checked === 1 ? '' : 's'} not checked yet)` : ''}
                {emailed ? ` · ${emailed} emailed` : ''}
                <button type="button" onClick={showEveryone}>Show all {reviews.length} reviews</button>
              </> : <>
                Showing {shown.length} of {reviews.length} reviews
                {emailed ? ` · ${emailed} emailed` : ''}
                {filtersOn && <button type="button" onClick={clearFilters}>Back to good fits</button>}
              </>}
            </div>
            {shown.length ? <>
              {pageItems.map(row)}
              {pages > 1 && (
                <nav className="cl-pager" aria-label="Pages">
                  <span className="cl-pager-info">{(cur - 1) * PAGE_SIZE + 1}–{Math.min(cur * PAGE_SIZE, shown.length)} of {shown.length}</span>
                  <div className="cl-pager-btns">
                    <button type="button" className="btn btn-ghost btn-sm" disabled={cur === 1} onClick={() => goTo(cur - 1)}>← Previous</button>
                    {pageNums.map((n, i) => (
                      <span key={n} className="cl-pager-n">
                        {i > 0 && n - pageNums[i - 1] > 1 && <span className="cl-pager-gap" aria-hidden="true">…</span>}
                        <button type="button" className={`cl-pager-num${n === cur ? ' cl-pager-num--on' : ''}`} aria-current={n === cur ? 'page' : undefined} onClick={() => goTo(n)}>{n}</button>
                      </span>
                    ))}
                    <button type="button" className="btn btn-ghost btn-sm" disabled={cur === pages} onClick={() => goTo(cur + 1)}>Next →</button>
                  </div>
                </nav>
              )}
            </> : (
              <div className="cl-none">
                <p>{show === 'good' && scoring ? 'Checking the unhappy reviewers. Good fits show up here as they’re found.'
                  : show === 'good' && !q.trim() && !stars.length ? (unhappy
                    ? `No good fits this time: ${competitorLabel(scan.competitor)}'s unhappy reviewers complain about things ${brandName} doesn't fix. Try another competitor.`
                    : `None of ${competitorLabel(scan.competitor)}'s newest reviews are 1–3 stars, so nobody is unhappy enough to reach out to right now.`)
                  : 'No reviews match these filters.'}</p>
                {!(show === 'good' && scoring) && <div className="cl-acts cl-acts--center">
                  <button className="btn btn-primary" type="button" onClick={reset}>Scan another competitor</button>
                  <button className="btn btn-ghost" type="button" onClick={showEveryone}>Show all {reviews.length} reviews</button>
                </div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
