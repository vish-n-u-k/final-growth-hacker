'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ToolHeader from '@/components/ToolHeader'
import { Spinner } from '@/components/ui/spinner'
import { Stars, competitorLabel, ago, fmtDate, initials, reviewHref, saveReview, step } from '@/components/lead-finder/ui'
import { useToast } from '@/components/email-outreach/shared'
import { Card, ListTools, Tabs, Tag } from '@/components/tool-ui'
import type { SavedReview, SavedScan } from '@/lib/lead-finder/saved'

// Competitor Leads, step one: read a competitor's newest reviews, list them, then check how well
// the brand fits each unhappy (1–3 star) reviewer a few at a time, so the best fits rise to the top
// as they're found. "Reach out" on a review opens its own page (app/(shell)/lead-finder/review/[id])
// that finds an email and writes one. Everything is saved as it happens (lib/lead-finder/saved.ts).

type Platform = 'trustpilot' | 'shopify'
type TabKey = 'good' | 'sent' | 'nofit'

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

  // Filters and sorting
  const [q, setQ] = useState('')
  // Good fits first; who was emailed and who isn't a fit are the other two tabs
  const [stars, setStars] = useState('')
  const [tab, setTab] = useState<TabKey>('good')
  const [page, setPage] = useState(1)
  const [earlier, setEarlier] = useState(false)
  const [toast, notify] = useToast()
  const listTop = useRef<HTMLDivElement>(null)
  // Back to page 1 whenever the list itself changes
  useEffect(() => { setPage(1) }, [q, stars, tab, scan?.id])

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

  function stop() {
    stopRef.current = true
    setPhase(scan ? 'done' : 'empty'); setFailure(null)
  }

  async function run(target = input) {
    const competitor = target.trim()
    if (!competitor) return
    stopRef.current = false
    scoringFor.current = null; setScoring(null); setEarlier(false)
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
      setQ(''); setStars(''); setTab('good')
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
      setScan(s); setPlatform(s.platform); setInput(s.competitor); setReviews(j.reviews ?? []); setPhase('done')
      setQ(''); setStars(''); setTab('good'); setEarlier(false)
      scoreAll(s.id, j.reviews ?? [])
    } catch { /* keep the current scan */ } finally { setLoadingScan(false) }
  }

  // ── Tabs, filters and pages ─────────────────────────────────────────────────
  const tabOf = (r: SavedReview): TabKey | null =>
    r.status === 'sent' ? 'sent'
    : r.status === 'skipped' ? 'nofit'
    : r.fit === undefined ? null                 // not checked yet (or a happy 4–5 star review)
    : r.fit >= GOOD ? 'good' : 'nofit'
  const inTab = useMemo(() => reviews.filter(r => tabOf(r) === tab), [reviews, tab])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return inTab
      .filter(r => (!needle || `${r.name} ${r.text} ${r.why ?? ''}`.toLowerCase().includes(needle)) && (!stars || Math.round(r.rating) === Number(stars)))
      .sort((a, b) => (tab === 'good' ? (b.fit ?? -1) - (a.fit ?? -1) : 0) || (b.date ?? '').localeCompare(a.date ?? ''))
  }, [inTab, q, stars, tab])
  const count = (k: TabKey) => reviews.filter(r => tabOf(r) === k).length
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const cur = Math.min(page, pages)
  const pageItems = shown.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  function goTo(n: number) {
    setPage(n)
    listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // Page numbers to show: first, last, and the ones around the current page
  const pageNums = Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - cur) <= 1)
  const unhappy = reviews.filter(r => r.rating <= 3).length

  function setStatus(r: SavedReview, status: 'skipped' | null) {
    setReviews(prev => prev.map(x => (x.id === r.id ? { ...x, status: status ?? 'new' } : x)))
    saveReview(r.id, { status })
  }
  function skip(r: SavedReview) {
    setStatus(r, 'skipped')
    notify(`${r.name} moved to Not a fit`, () => setStatus(r, null))
  }

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

  // The competitor box is the tool, so it stays at the top
  const scanForm = (
    <form className="tu-scan" onSubmit={e => { e.preventDefault(); run() }}>
      <div className="tu-scan-row">
        <div className="cl-seg" role="group" aria-label="Where their reviews are">
          {(['trustpilot', 'shopify'] as const).map(p => (
            <button key={p} type="button" aria-pressed={platform === p} onClick={() => setPlatform(p)}>{p === 'trustpilot' ? 'Trustpilot' : 'Shopify App Store'}</button>
          ))}
        </div>
        <input className="cl-in" value={input} onChange={e => setInput(e.target.value)} aria-label="Competitor"
          placeholder={platform === 'trustpilot' ? 'competitor.com or their Trustpilot link' : 'apps.shopify.com/competitor-app'} />
        {phase === 'running'
          ? <button className="btn btn-ghost cl-go" type="button" onClick={stop}>Stop</button>
          : <button className="btn btn-primary cl-go" type="submit" disabled={!input.trim()}>{scan && competitorLabel(input) === competitorLabel(scan.competitor) ? 'Scan again' : 'Find leads'}</button>}
      </div>
      <div className="tu-scan-sub">
        {platform === 'trustpilot' && competitors.length > 0
          ? <span className="cl-try">Your competitors:{competitors.map(c => <button key={c} type="button" onClick={() => setInput(c)}>{c}</button>)}</span>
          : <span />}
        {scan && phase !== 'running' && (
          <span className="cl-muted">
            {competitorLabel(scan.competitor)} · {scan.reviewsRead} reviews read {ago(scan.scannedAt)}
            {history.length > 1 && <> · <button type="button" className="th-link tu-linkbtn" aria-expanded={earlier} onClick={() => setEarlier(v => !v)}>Earlier scans {earlier ? '▴' : '▾'}</button></>}
          </span>
        )}
      </div>
      {platform === 'trustpilot' && !trustpilotReady && <p className="cl-warn">Trustpilot often blocks automatic reading unless DataForSEO is set up. The Shopify App Store works either way.</p>}
      {earlier && (
        <div className="tu-hist">
          {history.map(h => (
            <button key={h.id} type="button" disabled={loadingScan} aria-current={h.id === scan?.id ? 'true' : undefined} onClick={() => { openScan(h.id); setEarlier(false) }}>
              {competitorLabel(h.competitor)}<span>{fmtDate(h.scannedAt)}{h.emailed ? ` · ${h.emailed} emailed` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </form>
  )

  // A review card: who and how well they fit, why, what they said; Skip and Reach out at the bottom
  function row(r: SavedReview) {
    const t = tabOf(r)
    return (
      <Card key={r.id} av={initials(r.name)} name={r.name}
        sub={<><Stars n={r.rating} />{r.date && <span>{fmtDate(r.date)}</span>}
          {r.reviewUrl && <a className="th-link" href={r.reviewUrl} target="_blank" rel="noopener noreferrer">Read review ↗</a>}</>}
        badge={r.fit !== undefined && <span className={`cl-fitb cl-fitb--${r.fit >= GOOD ? 'good' : r.fit >= 5 ? 'mid' : 'low'}`}>{r.fit >= GOOD ? 'Good fit' : r.fit >= 5 ? 'Partial fit' : 'Weak fit'} · {r.fit}/10</span>}
        why={r.why} quote={`“${r.text}”`}
        state={r.status === 'sent' ? <Tag tone="ok">✓ Emailed{r.sentAt ? ` ${fmtDate(r.sentAt)}` : ''}</Tag> : r.status === 'skipped' ? <Tag>Marked not a fit</Tag> : null}
        onSkip={t === 'good' ? () => skip(r) : undefined}
        action={t === 'good'
          ? <Link className="btn btn-primary btn-sm cl-reach" href={reviewHref(r.id)}>Reach out →</Link>
          : <Link className="btn btn-sm cl-btn-outline" href={reviewHref(r.id)}>{t === 'sent' ? 'View email' : 'Reach out anyway'}</Link>} />
    )
  }

  const empty = tab === 'good'
    ? (scoring ? 'Checking the unhappy reviewers. Good fits show up here as they’re found.'
      : unhappy ? `No good fits this time: ${competitorLabel(scan?.competitor ?? '')}’s unhappy reviewers complain about things ${brandName} doesn’t fix. Try another competitor.`
      : `None of ${competitorLabel(scan?.competitor ?? '')}’s newest reviews are 1–3 stars, so nobody is unhappy enough to reach out to right now.`)
    : tab === 'sent' ? 'Nobody emailed yet. Emails you send from a good fit show up here.'
    : 'Nobody here. Reviewers who aren’t a fit, or that you skip, show up here.'

  return (
    <div className="tool-page">
      {header}
      <div className="cl">
        {scanForm}

        {phase === 'empty' && !scan && (
          <section className="tu-hello">
            <div className="cl-art" aria-hidden="true">
              <div className="cl-art-rv"><Stars n={2} /><i /><i style={{ width: '70%' }} /></div>
              <span className="cl-art-ar">→</span>
              <span className="cl-art-env"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="M3.5 6l6.5 5 6.5-5" /></svg></span>
            </div>
            <p>Pick a competitor above. GrowJin reads their newest reviews and lists the unhappy customers {brandName} could help, each with an email ready to send.</p>
            <div className="cl-fine"><span>Takes under a minute</span><span>Costs a cent or two</span><span>Nothing is sent until you approve it</span></div>
          </section>
        )}

        {phase === 'running' && (
          <div className="cl-reading" aria-live="polite"><Spinner size={16} /><div><b>Reading reviews</b><span>{detail}</span></div></div>
        )}

        {phase === 'failed' && (
          <div className="cl-prob" role="alert">
            <h3>Couldn’t read the reviews</h3>
            <p>{failure}</p>
            <div className="cl-acts">
              <button className="btn btn-primary" type="button" onClick={() => run(input)}>Try again</button>
              {platform === 'trustpilot' && <button className="btn btn-ghost" type="button" onClick={() => { setPlatform('shopify'); setPhase(scan ? 'done' : 'empty'); setInput('') }}>Use Shopify App Store</button>}
              {scan && <button className="btn btn-ghost" type="button" onClick={() => setPhase('done')}>Back to {competitorLabel(scan.competitor)}</button>}
            </div>
          </div>
        )}

        {(phase === 'done' || (phase === 'empty' && scan)) && scan && (
          <>
            {scoring && (
              <div className="cl-scoring" aria-live="polite">
                <Spinner size={14} />
                <span>Finding the best fits for {brandName} · <b>{scoring.done} of {scoring.total}</b> checked{count('good') ? ` · ${count('good')} good fit${count('good') === 1 ? '' : 's'} so far` : ''}</span>
                <span className="cl-scoring-bar"><i style={{ width: `${Math.round(scoring.done / scoring.total * 100)}%` }} /></span>
              </div>
            )}
            {scoreError && !scoring && (
              <div className="cl-scoring cl-scoring--bad" role="alert">
                <span>{scoreError}</span>
                <button type="button" className="th-link" onClick={() => scoreAll(scan.id, reviews)}>Try again</button>
              </div>
            )}
            <Tabs value={tab} onChange={k => { setTab(k); setQ(''); setStars('') }} tabs={[
              { key: 'good', label: 'Good fits', count: count('good') },
              { key: 'sent', label: 'Emailed', count: count('sent') },
              { key: 'nofit', label: 'Not a fit', count: count('nofit') },
            ]} />
            <div ref={listTop} className="tu-anchor" />
            <ListTools q={q} setQ={setQ} shown={shown.length} total={inTab.length} onClear={() => { setQ(''); setStars('') }}
              filter={
                <select className={`cl-sel${stars ? ' cl-sel--on' : ''}`} value={stars} onChange={e => setStars(e.target.value)} aria-label="Stars">
                  <option value="">All stars</option>
                  {[1, 2, 3].map(n => <option key={n} value={n}>{n}★</option>)}
                </select>
              } />
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
            </> : <div className="tu-empty">{inTab.length ? 'Nothing matches.' : empty}</div>}
          </>
        )}
      </div>
      {toast}
    </div>
  )
}
