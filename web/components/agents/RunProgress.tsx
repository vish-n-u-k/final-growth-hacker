'use client'

import { useEffect, useRef, useState } from 'react'
import type { RunProgress as Run, StepStatus } from '@/lib/agents/progress'

// "What the agent is doing" popup. Opens while a run is going (`active`), polls the run's live
// steps from /api/agents/progress and stays open on the summary until closed.

const POLL_MS = 1200
// A run is matched to the click by start time (allowing some clock difference with the server)
// and by not being one this page has already seen
const SKEW_MS = 15_000

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <span className="ag-rp-spin" aria-label="Working" />
  if (status === 'done') return <span className="ag-rp-ic ag-rp-done" aria-label="Done">✓</span>
  if (status === 'warn') return <span className="ag-rp-ic ag-rp-warn" aria-label="Needs a look">!</span>
  if (status === 'error') return <span className="ag-rp-ic ag-rp-err" aria-label="Problem">!</span>
  if (status === 'skipped') return <span className="ag-rp-ic ag-rp-skip" aria-label="Skipped">–</span>
  return <span className="ag-rp-ic ag-rp-wait" aria-label="Waiting" />
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

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const finished = !!run?.finishedAt || ended
  if (!active && !open) return null
  if (!open) {
    return (
      <button type="button" className="ag-rp-pill" onClick={() => setOpen(true)}>
        <span className="ag-rp-spin" aria-hidden="true" />{title}: see what it&apos;s doing
      </button>
    )
  }

  const steps = run?.steps ?? []
  const done = steps.filter(s => s.status !== 'pending' && s.status !== 'running').length
  const start = run ? Date.parse(run.startedAt) : startedAt.current
  const end = run?.finishedAt ? Date.parse(run.finishedAt) : now
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0

  return (
    <div className="ag-rp-backdrop" onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div className="ag-rp" role="dialog" aria-modal="true" aria-labelledby="ag-rp-title">
        <div className="ag-rp-head">
          <div>
            <h2 id="ag-rp-title" className="ag-rp-title">{run?.title ?? title}</h2>
            <div className="ag-rp-sub">
              {finished ? 'Finished' : 'Working'} · {clock(end - start)}{steps.length ? ` · ${done} of ${steps.length} steps` : ''}
            </div>
          </div>
          <button type="button" className="ag-rp-x" aria-label={finished ? 'Close' : 'Hide (the agent keeps working)'} onClick={() => setOpen(false)}>×</button>
        </div>
        <div className="ag-rp-bar" aria-hidden="true"><div style={{ width: `${finished ? 100 : pct}%` }} /></div>

        {!steps.length && !finished && <p className="ag-rp-sub" style={{ margin: '14px 0 4px' }}>Starting…</p>}
        <ol className="ag-rp-steps">
          {steps.map(s => (
            <li key={s.key} className={`ag-rp-step is-${s.status}`}>
              <StepIcon status={s.status} />
              <div className="ag-rp-text">
                <div className="ag-rp-label">{s.label}</div>
                {s.detail && <div className="ag-rp-detail">{s.detail}</div>}
              </div>
            </li>
          ))}
        </ol>

        {finished && (
          <div className="ag-rp-summary">
            {run?.summary || 'Done.'}
          </div>
        )}
        <div className="ag-rp-foot">
          {!finished && <span className="ag-rp-sub">You can hide this; the agent keeps working.</span>}
          <button type="button" className={`ag-btn${finished ? ' ag-btn-primary' : ''}`} onClick={() => setOpen(false)}>{finished ? 'Close' : 'Hide'}</button>
        </div>
      </div>
    </div>
  )
}
