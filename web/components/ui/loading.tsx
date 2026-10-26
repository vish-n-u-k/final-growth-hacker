'use client'

import { useEffect, useRef, useState } from 'react'
import { pageInfo, PAGE_INFO_LABEL, type PageInfoId } from '@/lib/page-info'

// Every loading state in the app, in one file, so the look can be changed (or swapped out) in one
// place. Styles are the `ld-*` block in app/globals.css; the words on the cards are in
// lib/page-info.ts. Which one to use depends on how long the wait is:
//   under 0.5 s      nothing (everything here waits LOADING.showAfterMs before it appears)
//   0.5–5 s          <Skeleton>, <ListSkeleton> or <PageSkeleton> in the shape of what is coming,
//                    or <LoadingState> for a small panel; <Spinner> inside a busy button
//   over 5 s         <WaitPanel>: the steps, time left, and a "While you wait" card
// <AboutPage> is the "About this page" link, showing the same cards any time.

export const LOADING = {
  showAfterMs: 300,      // a wait shorter than this shows nothing, so the screen doesn't flicker
  slowAfterMs: 15_000,   // <LoadingState> says "Taking longer than usual" after this
  cardEveryMs: 7_000,    // how often the "While you wait" card changes
  cards: true,           // false hides the "While you wait" cards everywhere
}

/** True once `active` has been true for `ms`. Use it to hold back a loader for short waits. */
export function useShowAfter(active = true, ms = LOADING.showAfterMs) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!active) { setShow(false); return }
    const t = setTimeout(() => setShow(true), ms)
    return () => clearTimeout(t)
  }, [active, ms])
  return active && show
}

// How long `active` has been true, ticking once a second
function useElapsed(active: boolean, since?: number) {
  const start = useRef(0)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!active) return
    start.current = since ?? Date.now()
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active, since])
  return active && now ? Math.max(0, now - start.current) : 0
}

// ── Spinner ─────────────────────────────────────────────────────────────────

/** The app's one spinner. It takes the text colour around it, so it works inside any button or
 *  label: put it before the "Saving…" text. Shows straight away (it sits next to words). */
export function Spinner({ size = 13, label, className = '', style }: {
  size?: number
  label?: string       // set when the spinner stands alone, so screen readers announce it
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      className={`spinner ${className}`.trim()}
      style={{ width: size, height: size, ...style }}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}

/** A centred spinner with a line of text, for a panel or list that is still loading. Say what is
 *  happening ("Getting your follow-ups"), not "Loading". */
export function LoadingState({ children, compact, className = '', style, slowAfterMs = LOADING.slowAfterMs, onRetry }: {
  children: React.ReactNode
  compact?: boolean
  className?: string
  style?: React.CSSProperties
  slowAfterMs?: number
  onRetry?: () => void
}) {
  const show = useShowAfter()
  const slow = useElapsed(true) > slowAfterMs
  if (!show) return <div className={`loading-state loading-state--wait${compact ? ' loading-state--compact' : ''}`} style={style} aria-busy="true" />
  return (
    <div className={`loading-state${compact ? ' loading-state--compact' : ''} ${className}`.trim()} role="status" aria-live="polite" style={style}>
      <Spinner size={compact ? 14 : 18} />
      <span>{children}</span>
      {slow && <span className="ld-slow">Taking longer than usual.{onRetry && <> <button type="button" className="ld-link" onClick={onRetry}>Try again</button></>}</span>}
    </div>
  )
}

// ── Skeletons ───────────────────────────────────────────────────────────────

/** A grey block standing in for content that is on its way. */
export function Skeleton({ w, h = 12, r = 6, className = '', style }: {
  w?: number | string
  h?: number | string
  r?: number
  className?: string
  style?: React.CSSProperties
}) {
  return <span className={`skel ${className}`.trim()} aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />
}

/** The shape of a calm list: the "Start here" panel, then quiet rows of a name and one line. */
export function ListSkeleton({ rows = 3, start = true }: { rows?: number; start?: boolean }) {
  return (
    <div className="ld-list" aria-busy="true" aria-label="Loading">
      {start && <div className="ld-start"><div><Skeleton w={220} h={15} /><Skeleton w={150} h={11} /></div><Skeleton w={130} h={36} r={10} /></div>}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ld-row"><Skeleton w={[150, 120, 170, 135][i % 4]} h={14} /><Skeleton w={[300, 250, 280, 220][i % 4]} h={11} /></div>
      ))}
    </div>
  )
}

/** A whole page on its way, in the shape of the page that is coming (app/(shell)/loading.tsx). */
export function PageSkeleton({ kind }: { kind: 'tool' | 'module' | 'today' }) {
  return (
    <div className={`ld-page ld-page--${kind}`} aria-busy="true" aria-label="Loading">
      <div className="ld-head">
        {kind !== 'today' && <Skeleton w={130} h={11} />}
        <Skeleton w={kind === 'module' ? 240 : 190} h={30} r={8} />
        <Skeleton w={260} h={12} />
      </div>
      {kind === 'tool' && <div className="ld-tabs"><Skeleton w={52} h={14} /><Skeleton w={84} h={14} /></div>}
      <ListSkeleton rows={kind === 'tool' ? 3 : kind === 'today' ? 4 : 5} />
    </div>
  )
}

// ── Long waits ──────────────────────────────────────────────────────────────

/** The "While you wait" card: why the page matters, a fact, a tip (lib/page-info.ts). Changes every
 *  few seconds; the dots and Next move it by hand. Shows nothing if the page has no cards. */
export function WhileYouWait({ page }: { page: PageInfoId }) {
  const { cards } = pageInfo(page, { withIntro: false })
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || cards.length < 2) return
    const t = setInterval(() => setI(n => (n + 1) % cards.length), LOADING.cardEveryMs)
    return () => clearInterval(t)
  }, [paused, cards.length])
  if (!LOADING.cards || !cards.length) return null
  const c = cards[i % cards.length]
  return (
    <aside className="ld-tip" aria-label="While you wait" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div key={i} className="ld-tip-body">
        <div className="ld-eyebrow">While you wait · {PAGE_INFO_LABEL[c.kind]}</div>
        <p>{c.text}</p>
        {c.source && <div className="ld-src">Source: {c.source}</div>}
      </div>
      {cards.length > 1 && (
        <div className="ld-tip-foot">
          <div className="ld-dots">
            {cards.map((_, n) => <button key={n} type="button" aria-label={`Card ${n + 1} of ${cards.length}`} aria-current={n === i % cards.length} onClick={() => { setI(n); setPaused(true) }} />)}
          </div>
          <button type="button" className="ld-link" onClick={() => { setI(n => (n + 1) % cards.length); setPaused(true) }}>Next</button>
        </div>
      )}
    </aside>
  )
}

export interface WaitStep { label: string; state: 'done' | 'on' | 'todo'; detail?: string }

function timeLeft(elapsed: number, expectedMs: number) {
  const left = expectedMs - elapsed
  if (left > 90_000) return `About ${Math.round(left / 60_000)} min left`
  if (left > 45_000) return 'About 1 min left'
  if (left > 0) return 'Less than a minute left'
  return 'Almost done'
}

/** A wait of more than a few seconds: what is happening now, a bar, the steps, roughly how long
 *  is left, and a "While you wait" card for the page. After twice the usual time it says so. */
export function WaitPanel({ steps, title, expectedMs = 120_000, startedAt, page, note = 'You can leave this page. It keeps going.', compact }: {
  steps: WaitStep[]
  title?: string            // defaults to the step that is running
  expectedMs?: number       // how long it usually takes
  startedAt?: number        // when it started (ms), if known; otherwise when this mounted
  page?: PageInfoId         // which cards to show
  note?: string | null
  compact?: boolean         // a single line and the bar: for a re-run over results already there
}) {
  const elapsed = useElapsed(true, startedAt)
  const total = steps.length || 1
  const done = steps.filter(s => s.state === 'done').length
  const current = steps.find(s => s.state === 'on') ?? steps.find(s => s.state === 'todo')
  // The bar moves with the steps and with time, and never reaches the end before the work does
  const pct = Math.min(95, Math.round(Math.max((done + .4) / total, elapsed / expectedMs) * 100))
  const slow = elapsed > expectedMs * 2
  return (
    <section className={`ld-wait${compact ? ' ld-wait--compact' : ''}`} role="status" aria-live="polite">
      <div className="ld-wait-top">
        <Spinner size={15} />
        <b>{title ?? `${current?.label ?? 'Finishing'}…`}</b>
        <span>{slow ? 'Taking longer than usual' : timeLeft(elapsed, expectedMs)}</span>
      </div>
      <div className="ld-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Estimated progress"><i style={{ width: `${pct}%` }} /></div>
      {!compact && steps.length > 1 && (
        <ol className="ld-steps">
          {steps.map(s => (
            <li key={s.label} className={`is-${s.state}`}>
              <span aria-hidden="true">{s.state === 'done' ? '✓' : s.state === 'on' ? '•' : '○'}</span>{s.label}{s.detail && s.state === 'done' ? <i> · {s.detail}</i> : null}
            </li>
          ))}
        </ol>
      )}
      {(note || slow) && <p className="ld-note">{slow ? 'Still working. ' : ''}{note}</p>}
      {page && !compact && <WhileYouWait page={page} />}
    </section>
  )
}

// ── About this page ─────────────────────────────────────────────────────────

/** "About this page": a quiet link that opens a side panel with the page's cards. */
export function AboutPage({ page, label = 'About this page' }: { page: PageInfoId; label?: string }) {
  const [open, setOpen] = useState(false)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const info = pageInfo(page)
  if (!info.cards.length) return null
  return (
    <>
      <button type="button" className="ld-link ld-about-link" aria-haspopup="dialog" onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className="ld-about" role="dialog" aria-modal="true" aria-labelledby="ld-about-title">
          <div className="ld-about-scrim" onClick={() => setOpen(false)} />
          <aside className="ld-about-panel">
            <button ref={close} type="button" className="ld-link ld-about-x" onClick={() => setOpen(false)}>Close</button>
            <div className="ld-eyebrow">About this page</div>
            <h2 id="ld-about-title">{info.title}</h2>
            <dl>
              {info.cards.map((c, n) => (
                <div key={n}><dt>{PAGE_INFO_LABEL[c.kind]}</dt><dd>{c.text}{c.source && <span className="ld-src">Source: {c.source}</span>}</dd></div>
              ))}
            </dl>
          </aside>
        </div>
      )}
    </>
  )
}
