'use client'

import { useEffect, useRef, useState } from 'react'
import type { RunProgress as Run, StepStatus } from '@/lib/agents/progress'
import { LeadIcon, SearchIcon } from './shared'

// "What the agent is doing" popup. Opens while a run is going (`active`), polls the run's live
// steps from /api/agents/progress and stays open on the summary until closed.

const POLL_MS = 1200
// A run is matched to the click by start time (allowing some clock difference with the server)
// and by not being one this page has already seen
const SKEW_MS = 15_000

const Check = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
)

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <span className="ag-rp-ic ag-rp-run" role="img" aria-label="Working"><span className="ag-rp-spin" /></span>
  if (status === 'done') return <span className="ag-rp-ic ag-rp-done" role="img" aria-label="Done"><Check /></span>
  if (status === 'warn') return <span className="ag-rp-ic ag-rp-warn" role="img" aria-label="Needs a look">!</span>
  if (status === 'error') return <span className="ag-rp-ic ag-rp-err" role="img" aria-label="Problem">!</span>
  if (status === 'skipped') return <span className="ag-rp-ic ag-rp-skip" role="img" aria-label="Skipped">–</span>
  return <span className="ag-rp-ic ag-rp-wait" role="img" aria-label="Waiting" />
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function RunProgress({ agent, active, title }: { agent: 'lead' | 'search'; active: boolean; title: string }) {
  const [run, setRun] = useState<Run | null>(null)
  const [open, setOpen] = useState(false)
  const [ended, setEnded] = useState(false)
  const [now, setNow] = useState(0)
  const startedAt = useRef(0)
  const gen = useRef(0)
  const seen = useRef(new Set<string>())
  const dialog = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)

  // The run saved before this page opened is old news
  useEffect(() => {
    fetch(`/api/agents/progress?agent=${agent}`, { cache: 'no-store' })
      .then(r => r.json()).then((j: { progress?: Run | null }) => { if (j.progress) seen.current.add(j.progress.runId) })
      .catch(() => {})
  }, [agent])

  // A run starts: open the popup and poll until the request ends, then read the final state once
  useEffect(() => {
    if (!active) return
    const me = ++gen.current
    startedAt.current = Date.now()
    setRun(null); setEnded(false); setOpen(true); setNow(Date.now())
    const load = async () => {
      try {
        const res = await fetch(`/api/agents/progress?agent=${agent}`, { cache: 'no-store' })
        const j = await res.json() as { progress?: Run | null }
        const p = j.progress
        if (gen.current !== me || !p || seen.current.has(p.runId) || Date.parse(p.startedAt) < startedAt.current - SKEW_MS) return
        setRun(p)
        if (p.finishedAt) seen.current.add(p.runId)
      } catch { /* try again on the next tick */ }
    }
    load()
    const poll = setInterval(load, POLL_MS)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(poll); clearInterval(tick)
      // The request finished: one last read so the summary shows
      setTimeout(async () => {
        await load()
        if (gen.current === me) { setEnded(true); setNow(Date.now()) }
      }, 300)
    }
  }, [active, agent])

  // Focus the dialog when it opens, so keyboard and screen-reader users land in it
  useEffect(() => { if (open) dialog.current?.focus() }, [open])

  // Keep the step being worked on in view (long lists scroll on phones)
  const runningKey = run?.steps.find(s => s.status === 'running')?.key
  useEffect(() => {
    if (!open || !runningKey) return
    body.current?.querySelector<HTMLElement>(`[data-step="${runningKey}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [open, runningKey])

  // Finished: bring the summary into view
  const isDone = !!run?.finishedAt
  useEffect(() => {
    if (!open || !isDone) return
    const t = setTimeout(() => body.current?.querySelector<HTMLElement>('.ag-rp-summary')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 150)
    return () => clearTimeout(t)
  }, [open, isDone])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const finished = !!run?.finishedAt || ended
  if (!active && !open) return null
  const Icon = agent === 'lead' ? LeadIcon : SearchIcon
  if (!open) {
    return (
      <button type="button" className="ag-rp-pill" onClick={() => setOpen(true)}>
        <span className="ag-rp-spin" aria-hidden="true" />
        <span className="ag-rp-pill-text">{title} is working</span>
        <span className="ag-rp-pill-cta">Show</span>
      </button>
    )
  }

  const steps = run?.steps ?? []
  const done = steps.filter(s => s.status !== 'pending' && s.status !== 'running').length
  const start = run ? Date.parse(run.startedAt) : startedAt.current
  const end = run?.finishedAt ? Date.parse(run.finishedAt) : now
  const pct = finished ? 100 : steps.length ? Math.max(4, Math.round((done / steps.length) * 100)) : 4
  const stopped = !!run?.summary?.startsWith('Stopped') || steps.some(s => s.status === 'error')
  const state = !finished ? 'working' : stopped ? 'stopped' : 'done'

  return (
    <div className="ag-rp-backdrop" onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div ref={dialog} tabIndex={-1} className={`ag-rp is-${state}`} role="dialog" aria-modal="true" aria-labelledby="ag-rp-title">
        <div className="ag-rp-grab" aria-hidden="true" />
        <header className="ag-rp-head">
          <span className="ag-rp-badge" aria-hidden="true"><Icon size={20} /></span>
          <div className="ag-rp-headtext">
            <h2 id="ag-rp-title" className="ag-rp-title">{run?.title ?? title}</h2>
            <div className="ag-rp-meta">
              <span className={`ag-rp-state is-${state}`} aria-live="polite">
                <span className="ag-rp-dot" aria-hidden="true" />{state === 'working' ? 'Working' : state === 'stopped' ? 'Stopped' : 'Finished'}
              </span>
              <span className="ag-rp-num">{clock(end - start)}</span>
              {steps.length > 0 && <span className="ag-rp-num">{done}/{steps.length} steps</span>}
            </div>
          </div>
          <button type="button" className="ag-rp-x" aria-label={finished ? 'Close' : 'Hide (the agent keeps working)'} onClick={() => setOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className={`ag-rp-bar${finished ? '' : ' is-live'}`} role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div style={{ width: `${pct}%` }} />
        </div>

        <div className="ag-rp-body" ref={body}>
          {!steps.length && !finished && (
            <ol className="ag-rp-steps" aria-hidden="true">
              {[0, 1, 2, 3].map(i => <li key={i} className="ag-rp-step is-ghost"><span className="ag-rp-ic ag-rp-wait" /><div className="ag-rp-text"><div className="ag-rp-skel" style={{ width: `${70 - i * 8}%` }} /></div></li>)}
            </ol>
          )}
          <ol className="ag-rp-steps">
            {steps.map(s => (
              <li key={s.key} data-step={s.key} className={`ag-rp-step is-${s.status}`}>
                <StepIcon status={s.status} />
                <div className="ag-rp-text">
                  <div className="ag-rp-label">{s.label}</div>
                  {s.detail && <div className="ag-rp-detail">{s.detail}</div>}
                  {s.items && s.items.length > 0 && (
                    <ul className="ag-rp-chips">
                      {s.items.map(x => <li key={x} className="ag-rp-chip" title={x}>{x}</li>)}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {finished && (
            <div className={`ag-rp-summary is-${state}`}>
              <span className="ag-rp-ic" aria-hidden="true">{state === 'stopped' ? '!' : <Check />}</span>
              <div>
                <div className="ag-rp-summary-title">{state === 'stopped' ? 'The run stopped' : 'All done'}</div>
                <div>{run?.summary || 'Finished.'}</div>
              </div>
            </div>
          )}
        </div>

        <footer className="ag-rp-foot">
          <span className="ag-rp-hint">{finished ? 'Results are on the page behind this.' : 'You can hide this. The agent keeps working.'}</span>
          <button type="button" className={`ag-btn${finished ? ' ag-btn-primary' : ''}`} onClick={() => setOpen(false)}>{finished ? 'See results' : 'Hide'}</button>
        </footer>
      </div>
    </div>
  )
}
