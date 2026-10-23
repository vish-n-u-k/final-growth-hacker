'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ToolIntro from '@/components/ToolIntro'
import { Spinner } from '@/components/ui/spinner'
import { competitorLabel, ago, fmtDate, reviewHref, saveReview, step } from '@/components/lead-finder/ui'
import { useToast } from '@/components/email-outreach/shared'
import { AllCaughtUp, CalmHead, Pager, QuietRow, StartHere, usePages, useShowAll } from '@/components/tool-ui'
import type { SavedReview, SavedScan } from '@/lib/lead-finder/saved'

// Competitor Leads, step one: read a competitor's newest reviews, then check how well the brand
// fits each unhappy (1–3 star) reviewer a few at a time. The page is calm: the best fit is the
// one "Start here" step, the other good fits are quiet rows, and everything else (picking the
// competitor, who was emailed, who isn't a fit) sits behind a link. Opening a reviewer goes to
// their own page (app/(shell)/lead-finder/review/[id]) that finds an email and writes one.
// Everything is saved as it happens (lib/lead-finder/saved.ts).

type Platform = 'trustpilot' | 'shopify'
type View = 'todo' | 'past' | 'nofit'

const GOOD = 7         // a good fit is 7+ out of 10
const MAX_SCORED = 40  // unhappy reviewers checked per scan (time and cost)
const BATCH = 6
const SEARCH_FROM = 8  // a search box only once the list is longer than this
const needsScore = (r: SavedReview) => r.rating <= 3 && r.fit === undefined
const byFit = (a: SavedReview, b: SavedReview) => (b.fit ?? -1) - (a.fit ?? -1) || (b.date ?? '').localeCompare(a.date ?? '')
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trim()}…` : s)

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
  const [input, setInput] = useState(initialScan?.competitor ?? '')
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

  const [view, setView] = useState<View>('todo')
  const [sheet, setSheet] = useState(false)   // "Scan another competitor"
  const [q, setQ] = useState('')
  const [toast, notify] = useToast()
  const scans = useShowAll(history, sheet, 5)
  const listTop = useRef<HTMLDivElement>(null)

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

  // Back from a reviewer's page with nobody left to open: say what happened there (with Undo for a skip)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const done = p.get('done'), id = p.get('id'), name = p.get('name') ?? ''
    if (!done || !id) return
    window.history.replaceState(null, '', window.location.pathname)
    if (done === 'sent') notify(`Sent to ${name}`)
    else notify(`Skipped ${name}`, () => { saveReview(id, { status: null }); setReviews(prev => prev.map(x => (x.id === id ? { ...x, status: 'new' } : x))) })
  }, [notify])

  function stop() {
    stopRef.current = true
    setPhase(scan ? 'done' : 'empty'); setFailure(null)
  }

  async function run(target = input) {
    const competitor = target.trim()
    if (!competitor) return
    stopRef.current = false
    scoringFor.current = null; setScoring(null); setSheet(false); setView('todo')
    const scanId = crypto.randomUUID()
    setInput(competitor); setPhase('running'); setFailure(null)
    setDetail(platform === 'trustpilot' ? `Asking for ${competitorLabel(competitor)}'s newest Trustpilot reviews` : 'Reading the Shopify App Store review pages')
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
      setQ('')
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
    if (!s || s.id === scan?.id) { setSheet(false); return }
    setLoadingScan(true)
    try {
      const res = await fetch(`/api/lead-finder/saved?scan=${encodeURIComponent(id)}`)
      const j = await res.json() as { reviews?: SavedReview[] }
      scoringFor.current = null; setScoring(null)
      setScan(s); setPlatform(s.platform); setInput(s.competitor); setReviews(j.reviews ?? []); setPhase('done')
      setQ(''); setView('todo'); setSheet(false)
      scoreAll(s.id, j.reviews ?? [])
    } catch { /* keep the current scan */ } finally { setLoadingScan(false) }
  }

  // ── Who's where ─────────────────────────────────────────────────────────────
  // To do: good fits not emailed or skipped yet, best fit first. Past: emailed or skipped.
  // Not a fit: checked, under 7.
  const good = useMemo(() => reviews.filter(r => r.status === 'new' && (r.fit ?? 0) >= GOOD).sort(byFit), [reviews])
  const past = useMemo(() => reviews.filter(r => r.status === 'sent' || r.status === 'skipped').sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? '')), [reviews])
  const nofit = useMemo(() => reviews.filter(r => r.status === 'new' && r.fit !== undefined && r.fit < GOOD).sort(byFit), [reviews])
  const unhappy = reviews.filter(r => r.rating <= 3).length
  const [first, ...rest] = good
  const needle = q.trim().toLowerCase()
  const shownRest = needle ? rest.filter(r => `${r.name} ${r.text} ${r.why ?? ''}`.toLowerCase().includes(needle)) : rest
  const pages = usePages(shownRest, [needle, scan?.id])
  const label = competitorLabel(scan?.competitor ?? input)

  function bringBack(r: SavedReview) {
    setReviews(prev => prev.map(x => (x.id === r.id ? { ...x, status: 'new' } : x)))
    saveReview(r.id, { status: null })
    notify(`${r.name} is back in your list`)
  }

  // ── Views ───────────────────────────────────────────────────────────────────

  const head = (
    <CalmHead title="Competitor Leads" line={[
      scan && phase !== 'running' ? `${label} · ${scan.reviewsRead} reviews read ${ago(scan.scannedAt)}` : null,
      scoring ? <><Spinner size={12} /> Checking reviewers · {scoring.done} of {scoring.total}</> : null,
      scoreError && !scoring && scan ? <>Couldn’t check some reviewers · <button type="button" className="ca-link" onClick={() => scoreAll(scan.id, reviews)}>Try again</button></> : null,
      scan ? <button type="button" className="ca-link" aria-expanded={sheet} onClick={() => setSheet(v => !v)}>Scan another competitor</button> : null,
    ]} />
  )

  // Picking a competitor: the whole page on a first visit, a quiet panel after that
  const scanForm = (inSheet: boolean) => (
    <form className={inSheet ? 'ca-sheet' : 'ca-pick'} onSubmit={e => { e.preventDefault(); run() }} aria-label="Pick a competitor">
      {inSheet ? <h2>Scan another competitor</h2> : <>
        <h2 className="ca-pick-title">Pick a competitor</h2>
        <p className="ca-pick-text">GrowJin reads their newest reviews and lists the unhappy customers {brandName} could help, each with an email ready for your OK. Takes under a minute. Nothing is sent until you approve it.</p>
      </>}
      <label className="ca-field">Competitor
        <input value={input} onChange={e => setInput(e.target.value)} placeholder={platform === 'trustpilot' ? 'competitor.com or their Trustpilot link' : 'apps.shopify.com/competitor-app'} autoFocus={inSheet} />
      </label>
      {platform === 'trustpilot' && competitors.length > 0 && (
        <p className="ca-small">Your competitors: {competitors.map((c, i) => <span key={c}>{i > 0 && ' · '}<button type="button" className="ca-link" onClick={() => setInput(c)}>{c}</button></span>)}</p>
      )}
      <div className="ca-opts" role="radiogroup" aria-label="Where their reviews are">
        {(['trustpilot', 'shopify'] as const).map(p => (
          <label key={p}><input type="radio" name="cl-platform" checked={platform === p} onChange={() => setPlatform(p)} />{p === 'trustpilot' ? 'Trustpilot' : 'Shopify App Store'}</label>
        ))}
      </div>
      {platform === 'trustpilot' && !trustpilotReady && <p className="ca-small">Trustpilot often blocks automatic reading unless DataForSEO is set up. The Shopify App Store works either way.</p>}
      {inSheet && history.length > 1 && (
        <div className="ca-earlier">
          <p className="ca-rest-h">Earlier scans</p>
          {scans.items.map(h => (
            <button key={h.id} type="button" className="ca-link" disabled={loadingScan} aria-current={h.id === scan?.id ? 'true' : undefined} onClick={() => openScan(h.id)}>
              {competitorLabel(h.competitor)} · {fmtDate(h.scannedAt)}{h.emailed ? ` · ${h.emailed} emailed` : ''}
            </button>
          ))}
          {scans.toggle}
        </div>
      )}
      {inSheet && <div className="ca-status">{gmailConnected ? 'Emails go out from your Gmail.' : <>Gmail isn’t connected. <Link className="ca-link" href="/gmail-hub">Connect it</Link></>}</div>}
      <div className="ca-acts">
        {inSheet && <button type="button" className="btn btn-link" onClick={() => setSheet(false)}>Close</button>}
        <button className="btn btn-primary ca-go" type="submit" disabled={!input.trim()}>Find leads</button>
      </div>
    </form>
  )

  let body: React.ReactNode
  if (phase === 'running') {
    body = (
      <div className="ca-note" aria-live="polite">
        <Spinner size={16} /><span><b>Reading {competitorLabel(input)}’s reviews</b>{detail}</span>
        <button type="button" className="ca-link" onClick={stop}>Stop</button>
      </div>
    )
  } else if (phase === 'failed') {
    body = (
      <div className="ca-empty" role="alert">
        <b>Couldn’t read the reviews</b>
        <p>{failure}</p>
        <div className="ca-acts ca-acts--center">
          {platform === 'trustpilot' && <button className="btn btn-link" type="button" onClick={() => { setPlatform('shopify'); setPhase(scan ? 'done' : 'empty'); setInput(''); if (scan) setSheet(true) }}>Use Shopify App Store</button>}
          {scan && <button className="btn btn-link" type="button" onClick={() => setPhase('done')}>Back to {label}</button>}
          <button className="btn btn-primary ca-go" type="button" onClick={() => run(input)}>Try again</button>
        </div>
      </div>
    )
  } else if (!scan) {
    body = scanForm(false)
  } else if (view !== 'todo') {
    const list = view === 'past' ? past : nofit
    body = <>
      <button type="button" className="ca-link ca-back" onClick={() => setView('todo')}>← Back to what’s left</button>
      <p className="ca-rest-h">{view === 'past' ? 'Emailed or skipped' : `Not a fit for ${brandName}`}</p>
      {list.map(r => view === 'past' && r.status === 'skipped'
        ? <QuietRow key={r.id} name={r.name} why="Skipped" go={null} after={<button type="button" className="btn btn-link" onClick={() => bringBack(r)}>Bring back</button>} />
        : <QuietRow key={r.id} href={reviewHref(r.id)} name={r.name}
            why={r.status === 'sent' ? `Emailed${r.sentAt ? ` ${fmtDate(r.sentAt)}` : ''}. A follow-up reminder comes in 5 days.` : r.why}
            go={r.status === 'sent' ? 'View email' : 'Reach out anyway'} />)}
      {!list.length && <p className="ca-small">Nobody here.</p>}
    </>
  } else {
    const more = (
      <div className="ca-more">
        {nofit.length > 0 && <button type="button" className="ca-link" onClick={() => setView('nofit')}>{nofit.length} {nofit.length === 1 ? 'wasn’t' : 'weren’t'} a fit</button>}
        {past.length > 0 && <button type="button" className="ca-link" onClick={() => setView('past')}>{past.length} emailed or skipped</button>}
      </div>
    )
    body = first ? <>
      {!gmailConnected && <div className="ca-note">Gmail isn’t connected, so emails can’t be sent yet. <Link className="ca-link" href="/gmail-hub">Connect Gmail</Link></div>}
      <StartHere
        title={`${good.length} unhappy ${label} customer${good.length === 1 ? '' : 's'} you could help`}
        sub={`Start with ${short(first.name, 40)}${good.length > 1 ? ', the best fit' : ''}.`}
        action={<Link className="btn btn-primary ca-go" href={reviewHref(first.id)}>Reach out →</Link>} />
      {rest.length > 0 && (
        <div className="ca-rest" ref={listTop}>
          <p className="ca-rest-h">Then</p>
          {rest.length > SEARCH_FROM && <input className="ca-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search" />}
          {pages.items.map(r => <QuietRow key={r.id} href={reviewHref(r.id)} name={r.name} why={r.why || r.text} />)}
          {needle && !shownRest.length && <p className="ca-small">Nothing matches.</p>}
          <Pager p={pages} top={listTop} />
        </div>
      )}
      {more}
    </> : <>
      {scoring
        ? <div className="ca-note" aria-live="polite"><Spinner size={16} /><span><b>Finding the best fits for {brandName}</b>Good fits show up here as they’re found.</span></div>
        : <AllCaughtUp
            title={past.length ? 'All caught up' : 'No good fits this time'}
            text={past.length ? `You’ve reached every good fit from ${label}’s reviews. Try another competitor.`
              : unhappy ? `${label}’s unhappy reviewers complain about things ${brandName} doesn’t fix. Try another competitor.`
              : `None of ${label}’s newest reviews are 1–3 stars, so nobody is unhappy enough to reach out to right now.`}
            action={<button type="button" className="btn btn-primary ca-go" onClick={() => setSheet(true)}>Scan another competitor</button>} />}
      {more}
    </>
  }

  return (
    <div className="tool-page ca">
      {head}
      {!scan && <ToolIntro id="competitorLeads" />}
      {/* The scan panel stands in for the list while it's open, so there's one green button */}
      {sheet && scan && phase !== 'running' ? scanForm(true) : <div className="ca-body">{body}</div>}
      {toast}
    </div>
  )
}
