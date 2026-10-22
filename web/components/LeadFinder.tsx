'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ToolHeader from '@/components/ToolHeader'
import { Spinner } from '@/components/ui/spinner'

// Competitor Leads: read a competitor's reviews, keep the unhappy reviewers, score how well the brand
// fits each one, find a contact and draft a short email. The page runs the steps one by one
// (/api/lead-finder/step) so each step shows what it is doing and leads appear as soon as they are
// scored. The last scan is kept in this browser so a reload doesn't lose it.

type Platform = 'trustpilot' | 'shopify'
type StepState = 'wait' | 'run' | 'done' | 'bad' | 'skip'
type Stage = 'scored' | 'contact' | 'contacted' | 'drafting' | 'drafted'

interface Review { company: string; reviewText: string; rating: number; reviewDate: string | null; reviewUrl: string | null }
interface Lead {
  id: string
  name: string
  rating: number
  date: string | null
  reviewUrl: string | null
  text: string
  fit: number
  why: string
  pains: string[]
  stage: Stage
  website?: string | null
  email?: string | null
  verified?: boolean
  draft?: { subject: string; body: string }
  draftError?: string
  status?: 'sent' | 'skipped'
  fresh?: boolean
}
interface Step { state: StepState; detail?: string; progress?: number }
interface Scan { platform: Platform; competitor: string; reviewsRead: number; unhappy: number; others: number; scannedAt: string }

const GOOD = 7          // a "good fit" is 7+ out of 10
const MAX_UNHAPPY = 30  // reviewers scored per scan (cost and time)
const BATCH = 6
const STORE_KEY = 'competitor-leads:last'

const STEP_TITLES = (brand: string) => [
  'Reading reviews',
  'Picking unhappy customers',
  `Scoring how well ${brand} fits each one`,
  'Finding contact emails',
  'Drafting a personal email to each',
]

const textToHtml = (t: string) => t.trim().split(/\n{2,}/).map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('')
const firstName = (n: string) => { const f = n.trim().split(/\s+/)[0]; return /^[\p{L}'-]{2,}$/u.test(f) && n.trim().includes(' ') ? f : '' }
const initials = (n: string) => n.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase() || '?'
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(iso)
}

function Stars({ n }: { n: number }) {
  const r = Math.max(0, Math.min(5, Math.round(n)))
  return <span className="cl-stars" aria-label={`${r} out of 5 stars`}>{'★'.repeat(r)}<s>{'★'.repeat(5 - r)}</s></span>
}

async function step<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/lead-finder/step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const j = await res.json().catch(() => ({})) as T & { error?: string; upgrade?: boolean }
  if (!res.ok) throw new Error(j.upgrade ? 'Competitor Leads is part of GrowJin Pro.' : j.error ?? 'That step failed. Try again.')
  return j
}

export default function LeadFinder({ brandName, gmailConnected, competitors = [], trustpilotReady = false }: {
  brandName: string
  gmailConnected: boolean
  competitors?: string[]
  trustpilotReady?: boolean
}) {
  const [platform, setPlatform] = useState<Platform>('trustpilot')
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<'empty' | 'running' | 'done' | 'failed'>('empty')
  const [steps, setSteps] = useState<Step[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [scan, setScan] = useState<Scan | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const stopRef = useRef(false)
  const titles = STEP_TITLES(brandName)

  // Filters (finished scans only)
  const [q, setQ] = useState('')
  const [minFit, setMinFit] = useState(GOOD)
  const [stars, setStars] = useState<number[]>([])
  const [contact, setContact] = useState<'any' | 'email' | 'none'>('any')
  const [sort, setSort] = useState<'fit' | 'new' | 'low' | 'name'>('fit')

  // Bring back the last scan from this browser
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { scan: Scan; leads: Lead[] } | null
      if (saved?.scan && Array.isArray(saved.leads)) {
        setScan(saved.scan); setLeads(saved.leads.map(l => ({ ...l, fresh: false }))); setPlatform(saved.scan.platform); setPhase('done')
      }
    } catch { /* nothing saved */ }
  }, [])
  const save = (s: Scan, ls: Lead[]) => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ scan: s, leads: ls })) } catch { /* storage full or blocked */ } }
  // Keep the saved copy in step with sends, skips and edits
  useEffect(() => { if (phase === 'done' && scan) save(scan, leads) }, [phase, scan, leads])

  const setStep = (i: number, s: Partial<Step>) => setSteps(prev => prev.map((x, k) => (k === i ? { ...x, ...s } : x)))
  const patchLead = (id: string, p: Partial<Lead>) => setLeads(prev => prev.map(l => (l.id === id ? { ...l, ...p } : l)))

  function reset() {
    stopRef.current = true
    setPhase('empty'); setSteps([]); setLeads([]); setScan(null); setFailure(null); setOpenId(null)
    setQ(''); setMinFit(GOOD); setStars([]); setContact('any'); setSort('fit')
    try { localStorage.removeItem(STORE_KEY) } catch { /* ignore */ }
  }

  async function run(target = input) {
    const competitor = target.trim()
    if (!competitor) return
    stopRef.current = false
    setInput(competitor); setPhase('running'); setFailure(null); setOpenId(null); setLeads([])
    setSteps(titles.map((_, i) => ({ state: i === 0 ? 'run' : 'wait' })))
    const stopped = () => stopRef.current
    let at = 0
    try {
      // 1. Reviews
      setStep(0, { detail: platform === 'trustpilot' ? `Asking for ${competitor}'s newest Trustpilot reviews` : 'Reading the Shopify App Store review pages' })
      let r = await step<{ reviews?: Review[]; pending?: string }>({ op: 'reviews', platform, url: competitor })
      for (let tries = 0; r.pending && tries < 45; tries++) {
        if (stopped()) return
        setStep(0, { detail: 'Collecting the newest reviews (usually under a minute)' })
        await new Promise(res => setTimeout(res, 4000))
        r = await step<{ reviews?: Review[]; pending?: string }>({ op: 'reviews_poll', taskId: r.pending })
      }
      if (r.pending) throw new Error('Reading the reviews is taking too long. Try again in a few minutes.')
      const reviews = r.reviews ?? []
      if (!reviews.length) throw new Error(`No reviews found for ${competitor}. Check the ${platform === 'trustpilot' ? 'website or Trustpilot link' : 'App Store link'}.`)
      setStep(0, { state: 'done', detail: `${reviews.length} reviews read` })

      // 2. Unhappy customers
      at = 1
      setStep(1, { state: 'run', detail: 'Keeping 1–3 star reviews' })
      const unhappy = reviews.filter(x => x.rating < 4).slice(0, MAX_UNHAPPY)
      setStep(1, { state: 'done', detail: `${unhappy.length} unhappy reviewer${unhappy.length === 1 ? '' : 's'}` })
      const baseScan: Scan = { platform, competitor, reviewsRead: reviews.length, unhappy: unhappy.length, others: 0, scannedAt: new Date().toISOString() }
      if (!unhappy.length) {
        setSteps(prev => prev.map((x, i) => (i > 1 ? { state: 'skip' } : x)))
        setScan(baseScan); setPhase('done'); return
      }

      // 3. Score in small batches; good fits appear as they're found
      at = 2
      let scored = 0, others = 0
      const good: Lead[] = []
      setStep(2, { state: 'run', detail: `Scored 0 of ${unhappy.length}`, progress: 0 })
      for (let b = 0; b < unhappy.length; b += BATCH) {
        if (stopped()) return
        const batch = unhappy.slice(b, b + BATCH)
        const { scored: res } = await step<{ scored: (Review & { fitScore: number; fitReason: string; painPoints: string[] })[] }>({ op: 'score', reviews: batch })
        scored += batch.length
        for (const x of res) {
          if (x.fitScore < GOOD) { others += 1; continue }
          const lead: Lead = {
            id: `${x.company}|${x.reviewDate ?? ''}|${good.length}`, name: x.company, rating: x.rating, date: x.reviewDate, reviewUrl: x.reviewUrl,
            text: x.reviewText, fit: x.fitScore, why: x.fitReason, pains: x.painPoints, stage: 'scored', fresh: true,
          }
          good.push(lead)
          setLeads(prev => [...prev, lead])
        }
        others += batch.length - res.length
        setStep(2, { detail: `Scored ${scored} of ${unhappy.length} · ${good.length} good fit${good.length === 1 ? '' : 's'} so far`, progress: Math.round(scored / unhappy.length * 100) })
      }
      setStep(2, { state: 'done', detail: `${good.length} good fit${good.length === 1 ? '' : 's'} (${GOOD}+ out of 10) · ${others} didn't fit`, progress: undefined })
      const doneScan = { ...baseScan, others }
      if (!good.length) {
        setSteps(prev => prev.map((x, i) => (i > 2 ? { state: 'skip' } : x)))
        setScan(doneScan); setPhase('done'); return
      }

      // 4. Contacts, one lead at a time
      at = 3
      let found = 0
      setStep(3, { state: 'run', detail: platform === 'shopify' ? 'Checking their store websites' : 'Trustpilot reviewers are people, so a contact is rarely public', progress: 0 })
      for (const [i, l] of good.entries()) {
        if (stopped()) return
        patchLead(l.id, { stage: 'contact', fresh: false })
        const { contact: c } = await step<{ contact: { website: string | null; email: string | null; verified: boolean } }>({ op: 'contact', platform, name: l.name })
          .catch(() => ({ contact: { website: null, email: null, verified: false } }))
        Object.assign(l, { website: c.website, email: c.email, verified: c.verified, stage: 'contacted' as Stage })
        if (c.email) found += 1
        patchLead(l.id, { website: c.website, email: c.email, verified: c.verified, stage: 'contacted' })
        setStep(3, { detail: `${found} of ${i + 1} found`, progress: Math.round((i + 1) / good.length * 100) })
      }
      setStep(3, { state: 'done', detail: `${found} of ${good.length} found`, progress: undefined })

      // 5. Drafts (also for leads without an email: an address can be added by hand)
      at = 4
      setStep(4, { state: 'run', detail: 'Writing one email at a time', progress: 0 })
      for (const [i, l] of good.entries()) {
        if (stopped()) return
        patchLead(l.id, { stage: 'drafting' })
        try {
          const { draft } = await step<{ draft: { subject: string; body: string } }>({ op: 'draft', platform, name: l.name, painPoints: l.pains, fitReason: l.why })
          l.draft = draft
          patchLead(l.id, { draft, stage: 'drafted' })
        } catch (e) {
          patchLead(l.id, { draftError: e instanceof Error ? e.message : 'Couldn’t write this one.', stage: 'drafted' })
        }
        setStep(4, { progress: Math.round((i + 1) / good.length * 100) })
      }
      setStep(4, { state: 'done', detail: `${good.filter(x => x.draft).length} emails ready to review`, progress: undefined })
      setScan(doneScan)
      setPhase('done')
    } catch (e) {
      if (stopped()) return
      const msg = e instanceof Error ? e.message : 'Something went wrong.'
      setSteps(prev => prev.map((x, i) => (i === at ? { state: 'bad', detail: msg } : i > at ? { state: 'skip' } : x)))
      setFailure(msg)
      setPhase('failed')
    }
  }

  function stop() {
    stopRef.current = true
    if (leads.length) {
      setScan({ platform, competitor: input, reviewsRead: 0, unhappy: 0, others: 0, scannedAt: new Date().toISOString() })
      setLeads(prev => prev.map(l => ({ ...l, stage: l.stage === 'contact' || l.stage === 'drafting' ? 'contacted' : l.stage })))
      setPhase('done')
    } else {
      setPhase('empty'); setSteps([])
    }
  }

  // ── Filtering and sorting ───────────────────────────────────────────────────
  const filtersOn = !!q.trim() || minFit !== GOOD || stars.length > 0 || contact !== 'any'
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = leads.filter(l =>
      (!needle || [l.name, l.text, l.why, ...l.pains].join(' ').toLowerCase().includes(needle)) &&
      l.fit >= minFit &&
      (!stars.length || stars.includes(Math.round(l.rating))) &&
      (contact === 'any' || (contact === 'email' ? !!l.email : !l.email)))
    const by: Record<typeof sort, (a: Lead, b: Lead) => number> = {
      fit: (a, b) => b.fit - a.fit,
      new: (a, b) => (b.date ?? '').localeCompare(a.date ?? ''),
      low: (a, b) => a.rating - b.rating || b.fit - a.fit,
      name: (a, b) => a.name.localeCompare(b.name),
    }
    return [...list].sort(by[sort])
  }, [leads, q, minFit, stars, contact, sort])
  const clearFilters = () => { setQ(''); setMinFit(GOOD); setStars([]); setContact('any') }

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
      actions={<>
        <Link href="/gmail-hub" className="th-link">Email Outreach →</Link>
        {phase !== 'empty' && <button className="btn btn-primary btn-sm" type="button" onClick={reset}>New scan</button>}
      </>}
    />
  )

  const scanBar = (right: React.ReactNode) => (
    <div className="cl-scanbar">
      <span>{(scan?.platform ?? platform) === 'trustpilot' ? 'Trustpilot' : 'Shopify App Store'} · <b>{scan?.competitor ?? input}</b></span>
      <span className="cl-grow" />
      {right}
    </div>
  )

  const stepsView = (
    <ol className="cl-steps" aria-live="polite">
      {steps.map((s, i) => (
        <li key={i} className={`cl-step cl-step--${s.state}`}>
          <span className="cl-dot" aria-hidden="true">{s.state === 'done' ? '✓' : s.state === 'bad' ? '!' : s.state === 'run' ? '' : i + 1}</span>
          <div>
            <div className="cl-step-t">{titles[i]}</div>
            {s.detail && <div className="cl-step-d">{s.detail}</div>}
            {s.state === 'run' && s.progress !== undefined && <div className="cl-bar"><i style={{ width: `${s.progress}%` }} /></div>}
          </div>
        </li>
      ))}
    </ol>
  )

  function leadCard(l: Lead) {
    const open = openId === l.id
    const contactLine = l.stage === 'scored' ? <span className="cl-contact cl-muted">Waiting to look for an email…</span>
      : l.stage === 'contact' ? <span className="cl-contact cl-muted"><Spinner size={11} />Looking for an email…</span>
      : l.email ? <span className="cl-contact">✉ {l.email} {l.verified ? <span className="cl-tag cl-tag--ok">Verified</span> : <span className="cl-tag cl-tag--warn">From their website</span>}</span>
      : <span className="cl-contact">No email found{l.website ? <> · <a className="th-link" href={l.website} target="_blank" rel="noopener noreferrer">open their website ↗</a></> : platform === 'trustpilot' && l.reviewUrl ? <> · <a className="th-link" href={l.reviewUrl} target="_blank" rel="noopener noreferrer">see them on Trustpilot ↗</a></> : null}</span>
    return (
      <article key={l.id} className={`cl-lead${l.fresh ? ' cl-lead--fresh' : ''}${l.status === 'skipped' ? ' cl-lead--dim' : ''}`}>
        <div className="cl-lead-top">
          <span className="cl-av" aria-hidden="true">{initials(l.name)}</span>
          <div className="cl-lead-main">
            <div className="cl-lead-name">{l.name}</div>
            <div className="cl-lead-sub"><Stars n={l.rating} />{l.date && <span>{fmtDate(l.date)}</span>}{l.reviewUrl && <a className="th-link" href={l.reviewUrl} target="_blank" rel="noopener noreferrer">Read review ↗</a>}</div>
          </div>
          <span className="cl-fit">Fit {l.fit}/10</span>
        </div>
        {l.why && <p className="cl-why">{l.why}</p>}
        {l.pains.length > 0 && <div className="cl-pains">{l.pains.map(p => <span key={p}>{p}</span>)}</div>}
        <blockquote className="cl-quote">“{l.text}”</blockquote>
        <div className="cl-lead-foot">
          {contactLine}
          {l.status === 'sent' && <span className="cl-tag cl-tag--ok">Sent · reminder in 5 days</span>}
          {l.stage === 'drafting' && <span className="cl-contact cl-muted"><Spinner size={11} />Writing the email…</span>}
          {phase !== 'running' && l.stage === 'drafted' && l.status !== 'sent' && (
            <>
              {l.status === 'skipped'
                ? <button className="btn btn-link" type="button" onClick={() => patchLead(l.id, { status: undefined })}>Undo skip</button>
                : <>
                    <button className={`btn btn-sm ${l.email ? 'btn-primary' : 'btn-ghost'}`} type="button" onClick={() => setOpenId(open ? null : l.id)}>
                      {open ? 'Close' : l.email ? 'Review email' : 'Add email'}
                    </button>
                    <button className="btn btn-link" type="button" onClick={() => { patchLead(l.id, { status: 'skipped' }); if (open) setOpenId(null) }}>Skip</button>
                  </>}
            </>
          )}
        </div>
        {open && <Editor lead={l} gmailConnected={gmailConnected} onSent={(email, d) => { patchLead(l.id, { status: 'sent', email, draft: d }); setOpenId(null) }} />}
      </article>
    )
  }

  const toolbar = (
    <div className="cl-tools" role="search">
      <input className="cl-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or review" aria-label="Search leads" />
      <select className={`cl-sel${minFit !== GOOD ? ' cl-sel--on' : ''}`} value={minFit} onChange={e => setMinFit(Number(e.target.value))} aria-label="Minimum fit">
        <option value={GOOD}>Good fits ({GOOD}+)</option>
        <option value={8}>Fit 8+</option>
        <option value={9}>Fit 9+</option>
      </select>
      <span className="cl-starf" role="group" aria-label="Star rating">
        {[1, 2, 3].map(n => (
          <button key={n} type="button" aria-pressed={stars.includes(n)} onClick={() => setStars(s => (s.includes(n) ? s.filter(x => x !== n) : [...s, n]))}>{n}<span>★</span></button>
        ))}
      </span>
      <select className={`cl-sel${contact !== 'any' ? ' cl-sel--on' : ''}`} value={contact} onChange={e => setContact(e.target.value as typeof contact)} aria-label="Contact">
        <option value="any">Anyone</option>
        <option value="email">Has an email</option>
        <option value="none">Needs a contact</option>
      </select>
      <span className="cl-sep" aria-hidden="true" />
      <select className="cl-sel" value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort">
        <option value="fit">Sort: Best fit</option>
        <option value="new">Sort: Newest review</option>
        <option value="low">Sort: Lowest rating</option>
        <option value="name">Sort: Name A–Z</option>
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
            <p>Paste a competitor’s review page. GrowJin reads the 1–3 star reviews, picks the people {brandName} would actually help, and drafts an email to each one.</p>
            <form className="cl-form" onSubmit={e => { e.preventDefault(); run() }}>
              <div className="cl-seg" role="group" aria-label="Where their reviews are">
                {(['trustpilot', 'shopify'] as const).map(p => (
                  <button key={p} type="button" aria-pressed={platform === p} onClick={() => setPlatform(p)}>{p === 'trustpilot' ? 'Trustpilot' : 'Shopify App Store'}</button>
                ))}
              </div>
              <div className="cl-inrow">
                <input className="cl-in" value={input} onChange={e => setInput(e.target.value)} aria-label="Competitor"
                  placeholder={platform === 'trustpilot' ? 'competitor.com or their Trustpilot link' : 'apps.shopify.com/competitor-app'} />
                <button className="btn btn-primary cl-go" type="submit" disabled={!input.trim()}>Find leads</button>
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
            <div className="cl-fine"><span>Takes about a minute</span><span>Costs a few cents</span><span>Nothing is sent until you approve it</span></div>
          </section>
        )}

        {phase === 'running' && (
          <>
            {scanBar(<button className="btn btn-ghost btn-sm" type="button" onClick={stop}>Stop</button>)}
            {stepsView}
            {leads.length > 0 && <h2 className="cl-h2">Good fits so far ({leads.length})</h2>}
            {leads.map(l => leadCard(l))}
          </>
        )}

        {phase === 'failed' && (
          <>
            {scanBar(null)}
            {stepsView}
            <div className="cl-prob" role="alert">
              <h3>The scan stopped</h3>
              <p>{failure}</p>
              <div className="cl-acts">
                <button className="btn btn-primary" type="button" onClick={() => run(input)}>Try again</button>
                {platform === 'trustpilot' && <button className="btn btn-ghost" type="button" onClick={() => { setPlatform('shopify'); setPhase('empty'); setInput('') }}>Use Shopify App Store</button>}
              </div>
            </div>
          </>
        )}

        {phase === 'done' && scan && (
          <>
            {scanBar(<span className="cl-muted">{[scan.reviewsRead ? `${scan.reviewsRead} reviews read` : null, `scanned ${ago(scan.scannedAt)}`].filter(Boolean).join(' · ')}</span>)}
            {leads.length === 0 ? (
              <div className="cl-none">
                <h3>{scan.unhappy === 0 ? 'No unhappy reviewers' : 'No good fits this time'}</h3>
                <p>{scan.unhappy === 0
                  ? `None of ${scan.competitor}'s recent reviews were 1–3 stars. Try another competitor.`
                  : `${scan.unhappy} unhappy reviewers, but their complaints aren't things ${brandName} solves. Try a competitor closer to what ${brandName} does.`}</p>
                <button className="btn btn-primary" type="button" onClick={reset}>Scan another competitor</button>
              </div>
            ) : (
              <>
                {toolbar}
                <div className="cl-count">
                  {filtersOn
                    ? <>Showing {shown.length} of {leads.length} <button type="button" onClick={clearFilters}>Clear filters</button></>
                    : <>{leads.length} good fit{leads.length === 1 ? '' : 's'}{scan.others ? ` · ${scan.others} other reviewer${scan.others === 1 ? '' : 's'} didn't fit ${brandName}` : ''}</>}
                </div>
                {shown.length ? shown.map(l => leadCard(l)) : (
                  <div className="cl-none"><p>No leads match these filters.</p><button className="btn btn-ghost" type="button" onClick={clearFilters}>Clear filters</button></div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Editor({ lead, gmailConnected, onSent }: { lead: Lead; gmailConnected: boolean; onSent: (email: string, d: { subject: string; body: string }) => void }) {
  const hi = firstName(lead.name) ? `Hi ${firstName(lead.name)},` : 'Hi,'
  const [to, setTo] = useState(lead.email ?? '')
  const [subject, setSubject] = useState(lead.draft?.subject ?? '')
  const [body, setBody] = useState(lead.draft ? `${hi}\n\n${lead.draft.body}` : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(lead.draftError ?? null)
  const [copied, setCopied] = useState(false)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/gmail/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), subject, body: textToHtml(body), followUpDays: 5, source: 'competitor-leads' }),
      })
      const j = await res.json().catch(() => ({})) as { error?: string; message?: string }
      if (!res.ok) throw new Error(j.message ?? j.error ?? 'Couldn’t send.')
      onSent(to.trim(), { subject, body })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="cl-editor" onSubmit={send}>
      <label>To<input type="email" required value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.com" /></label>
      <label>Subject<input required value={subject} onChange={e => setSubject(e.target.value)} /></label>
      <label>Message<textarea required rows={8} value={body} onChange={e => setBody(e.target.value)} /></label>
      {error && <p className="cl-err">{error}</p>}
      <div className="cl-acts">
        {gmailConnected
          ? <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? <><Spinner />Sending…</> : 'Send from Gmail'}</button>
          : <Link className="btn btn-primary" href="/gmail-hub">Connect Gmail to send</Link>}
        <button className="btn btn-ghost" type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* ignore */ } }}>{copied ? 'Copied' : 'Copy'}</button>
        <span className="cl-muted">We’ll remind you to follow up in 5 days if they don’t reply.</span>
      </div>
    </form>
  )
}
