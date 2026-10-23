'use client'

import { useEffect, useRef, useState } from 'react'
import type { RunProgress } from '@/lib/agents/progress'
import { Spinner } from '@/components/ui/spinner'

// The pieces every tool page is built from (Lead Agent, Search Agent, Competitor Leads), so they
// look and work the same: underline tabs with counts, the action bar of an agent, item cards
// (who · why · what they said, then Skip and one main button), and the two-step page an item
// opens into (the person on the left, the steps on the right, Back / Next in the footer).

export function Tabs<K extends string>({ tabs, value, onChange }: {
  tabs: { key: K; label: string; count?: number | null; hot?: boolean }[]
  value: K
  onChange: (k: K) => void
}) {
  return (
    <div className="tu-tabs" role="tablist">
      {tabs.map(t => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key}
          className={`tu-tab${value === t.key ? ' is-on' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count != null && <span className={t.hot ? 'is-hot' : undefined}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Sec({ label, count, tone }: { label: string; count: number; tone?: 'crit' }) {
  return <h3 className={`tu-sec${tone ? ` tu-sec--${tone}` : ''}`}>{label} <span>{count}</span></h3>
}

/** What the agent is set up to do, a link to change it, and its two buttons. */
export function ActionBar({ status, setup, onChange, secondary, primary }: {
  status: React.ReactNode
  setup: React.ReactNode
  onChange: () => void
  secondary: React.ReactNode
  primary: React.ReactNode
}) {
  return (
    <section className="tu-abar">
      <div className="tu-abar-ctx">
        <b>{status}</b>
        <span>{setup} · <button type="button" className="th-link tu-linkbtn" onClick={onChange}>Change</button></span>
      </div>
      <div className="tu-abar-r">{secondary}{primary}</div>
    </section>
  )
}

export function Card({ av, square, name, sub, badge, why, quote, state, onSkip, action }: {
  av: React.ReactNode
  square?: boolean
  name: React.ReactNode
  sub?: React.ReactNode
  badge?: React.ReactNode
  why?: React.ReactNode
  quote?: React.ReactNode
  state?: React.ReactNode
  onSkip?: () => void
  action?: React.ReactNode
}) {
  return (
    <article className="cl-rv tu-card">
      <div className="cl-rv-head">
        <span className={`cl-av${square ? ' tu-av-sq' : ''}`} aria-hidden="true">{av}</span>
        <div className="cl-rv-who">
          <div className="cl-lead-name">{name}</div>
          {sub && <div className="cl-lead-sub">{sub}</div>}
        </div>
        {badge}
      </div>
      {(why || quote) && (
        <div className="cl-rv-body">
          {why && <p className="tu-why">{why}</p>}
          {quote && <p className="tu-quote">{quote}</p>}
        </div>
      )}
      {(state || onSkip || action) && <div className="cl-rv-foot">
        <span className="cl-rv-state">{state}</span>
        <span className="tu-acts">
          {onSkip && <button type="button" className="btn btn-link tu-skip" onClick={onSkip}>Skip</button>}
          {action}
        </span>
      </div>}
    </article>
  )
}

export function Src({ label, tone }: { label: string; tone?: 'orange' | 'amber' | 'green' | 'red' }) {
  return <span className={`tu-src${tone ? ` tu-src--${tone}` : ''}`}>{label}</span>
}

export function Tag({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'crit' }) {
  return <span className={`tu-tag${tone ? ` tu-tag--${tone}` : ''}`}>{children}</span>
}

/** One item opened up: the person on the left, the steps and the current step on the right. */
export function Flow({ back, crumb, side, steps, at, title, hint, children, actions, stepKey }: {
  back: { label: string; onClick: () => void }
  crumb: string
  side: React.ReactNode
  steps: string[]
  at: number                 // 1-based; past the last step = finished
  title?: string
  hint?: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
  stepKey: string            // a new key per step, so a click can't land on the next step's button
}) {
  return (
    <div className="tu-flow">
      <nav className="ro-crumbs" aria-label="Breadcrumb">
        <button type="button" className="th-link tu-linkbtn" onClick={back.onClick}>← {back.label}</button>
        <span aria-hidden="true">/</span><b className="tu-ellip">{crumb}</b>
      </nav>
      <div className="ro">
        <aside className="ro-side">{side}</aside>
        <div className="ro-main">
          {steps.length > 1 && (
            <ol className="ro-steps" aria-label="Steps">
              {steps.map((label, i) => {
                const n = i + 1
                const state = n < at ? 'past' : n === at ? 'on' : 'next'
                return (
                  <li key={label} className={`ro-step ro-step--${state}`} aria-current={state === 'on' ? 'step' : undefined}>
                    <span className="ro-step-n">{state === 'past' ? '✓' : n}</span><span className="ro-step-l">{label}</span>
                  </li>
                )
              })}
            </ol>
          )}
          <section className="ro-card">
            {title && <h2 className="ro-title">{title}</h2>}
            {hint && <p className="ro-hint">{hint}</p>}
            <div className="tu-flow-body">{children}</div>
            {actions && <div key={stepKey} className="ro-actions">{actions}</div>}
          </section>
        </div>
      </div>
    </div>
  )
}

export function Side({ av, square, name, sub, quote, why, whyLabel = 'Why them' }: {
  av: React.ReactNode; square?: boolean; name: string; sub?: React.ReactNode; quote?: React.ReactNode; why?: React.ReactNode; whyLabel?: string
}) {
  return <>
    <div className="ro-person">
      <span className={`cl-av${square ? ' tu-av-sq' : ''}`} aria-hidden="true">{av}</span>
      <div style={{ minWidth: 0 }}><h2>{name}</h2>{sub && <div className="cl-lead-sub">{sub}</div>}</div>
    </div>
    {quote && <blockquote className="ro-quote">{quote}</blockquote>}
    {why && <div className="ro-fit ro-fit--good"><div className="ro-fit-top"><b>{whyLabel}</b></div><p>{why}</p></div>}
  </>
}

export function Finished({ title, text, grey }: { title: string; text: React.ReactNode; grey?: boolean }) {
  return (
    <div className="ro-done">
      <div className={`ro-done-tick${grey ? ' tu-tick-grey' : ''}`} aria-hidden="true">{grey ? '–' : '✓'}</div>
      <h3 className="ro-title">{title}</h3>
      <p>{text}</p>
    </div>
  )
}

/**
 * What the agent is doing right now, shown on the page while it runs: the steps of the live
 * run (lib/agents/progress), polled from /api/agents/progress.
 */
export function LiveProgress({ agent, active, fallback }: { agent: 'lead' | 'search'; active: boolean; fallback: string[] }) {
  const [run, setRun] = useState<RunProgress | null>(null)
  const started = useRef(0)
  useEffect(() => {
    if (!active) { setRun(null); return }
    started.current = Date.now()
    let stop = false
    const poll = async () => {
      try {
        const r = await fetch(`/api/agents/progress?agent=${agent}`)
        const j = await r.json() as { progress?: RunProgress | null }
        // Only this run: one that started around when the button was pressed
        if (!stop && j.progress && Date.parse(j.progress.startedAt) > started.current - 15_000) setRun(j.progress)
      } catch { /* keep the last one */ }
      if (!stop) setTimeout(poll, 1500)
    }
    poll()
    return () => { stop = true }
  }, [active, agent])
  if (!active) return null
  const steps = run?.steps.length ? run.steps.map(s => ({ label: s.label, state: s.status === 'running' ? 'on' : s.status === 'pending' ? '' : 'done', detail: s.detail }))
    : fallback.map((label, i) => ({ label, state: i === 0 ? 'on' : '', detail: undefined }))
  const current = steps.find(s => s.state === 'on') ?? steps.find(s => s.state === '')
  return (
    <section className="tu-prog" aria-live="polite">
      <div className="tu-prog-top"><Spinner size={16} /><b>{current?.label ?? 'Finishing'}…</b><span className="cl-muted">Usually 1–3 minutes. You can leave this page.</span></div>
      <ol>
        {steps.map(s => (
          <li key={s.label} className={s.state === 'done' ? 'is-done' : s.state === 'on' ? 'is-on' : undefined}>
            <span aria-hidden="true">{s.state === 'done' ? '✓' : s.state === 'on' ? '•' : '○'}</span> {s.label}{s.detail && s.state === 'done' ? <i> · {s.detail}</i> : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Search box and filters above a list, and "Showing x of y · Clear" when something is filtered. */
export function ListTools({ q, setQ, filter, shown, total, onClear }: {
  q: string; setQ: (v: string) => void; filter?: React.ReactNode; shown: number; total: number; onClear: () => void
}) {
  return <>
    <div className="tu-tools" role="search">
      <input className="cl-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search" />
      {filter}
    </div>
    {shown !== total && <div className="cl-count">Showing {shown} of {total} <button type="button" onClick={onClear}>Clear</button></div>}
  </>
}
