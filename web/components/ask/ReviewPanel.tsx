'use client'

import { useEffect, useRef, useState } from 'react'
import type { Review, ReviewEvent, ReviewState } from '@/lib/ask/review'
import { Top, copy } from './AskPanel'

// "Re-analyse website" (lib/ask/review.ts): Claude reads the site like a first-time visitor and writes
// a review with fixes. Admins also see the switch for how runs go: through the Claude API straight
// away, or into the admin queue (the same switch as the admin page's "Module runs").

type Mode = 'direct' | 'queue'
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const short = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || url

function fixesText(r: Review): string {
  return [`Website review, ${day(r.at)}`, r.headline, '', ...r.fixes.map((f, i) => `${i + 1}. ${f.title} (${f.page})\n   Why: ${f.why}\n   How: ${f.how}`)].join('\n')
}

export function ReviewPanel({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<ReviewState | null>(null)
  const [mode, setMode] = useState<Mode>('direct')
  const [admin, setAdmin] = useState(false)
  const [steps, setSteps] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(0)
  const [secs, setSecs] = useState(0)
  const [error, setError] = useState('')
  const [said, setSaid] = useState('')
  const [open, setOpen] = useState<number | null>(0)
  const [modeBusy, setModeBusy] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    fetch('/api/ask/review').then(r => r.json()).then(j => { setState(j.state ?? {}); setMode(j.mode === 'queue' ? 'queue' : 'direct'); setAdmin(!!j.admin) }).catch(() => setError('Couldn’t open the review.'))
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setSecs(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(t)
  }, [running, started])

  async function changeMode(next: Mode) {
    setModeBusy(true)
    const j = await fetch('/api/ask/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'mode', mode: next }) }).then(r => r.json()).catch(() => ({}))
    setModeBusy(false)
    if (j.mode) setMode(j.mode)
  }

  async function run() {
    setError(''); setSaid(''); setSteps([]); setRunning(true); setStarted(Date.now()); setSecs(0)
    try {
      const res = await fetch('/api/ask/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'run' }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The review didn’t start.')
      if ((res.headers.get('content-type') ?? '').includes('application/json')) {
        const j = await res.json()
        if (j.queued) setState(s => ({ ...(s ?? {}), requestedAt: j.at }))
        return
      }
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim() || !alive.current) continue
          const e = JSON.parse(line) as ReviewEvent
          if (e.t === 'step') setSteps(s => [...s, e.text])
          if (e.t === 'done') { setState(s => ({ ...(s ?? {}), review: e.review, requestedAt: undefined })); setOpen(0) }
          if (e.t === 'error') setError(e.text)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The review didn’t finish. Try again.')
    } finally {
      setRunning(false)
    }
  }

  const r = state?.review
  const switchRow = admin && (
    <div className="ask-rv-mode">
      <span><b>Runs:</b> {mode === 'direct' ? 'straight away through the Claude API' : 'queued for the admin to run'}</span>
      <button type="button" className="ask-tl" disabled={modeBusy} onClick={() => changeMode(mode === 'direct' ? 'queue' : 'direct')}>
        {modeBusy ? 'Saving…' : mode === 'direct' ? 'Switch to queue' : 'Switch to API'}
      </button>
      <small>Admin only. Same switch as the admin page’s module runs. You always run straight away.</small>
    </div>
  )

  if (!state) return <div className="ask-sheet-in"><Top label="Website review" onClose={onClose} /><p className="ask-sheet-lede">{error || 'Opening…'}</p></div>

  return (
    <div className="ask-sheet-in">
      <Top label="Website review" onClose={onClose} />
      {switchRow}

      {running && (
        <>
          <h2 className="ask-sheet-h">Reading your site</h2>
          <p className="ask-sheet-lede">Claude is going through your pages like a first-time visitor. This takes 1 to 3 minutes.</p>
          <div className="ask-fill" aria-live="polite">
            <div className="ask-timer">Working on it · {secs} s</div>
            {(steps.length ? steps : ['Starting…']).map((s, i, all) => (
              <div key={i} className={`ask-fs is-${i === all.length - 1 ? 'on' : 'done'}`}><i aria-hidden="true" /><span>{s}</span></div>
            ))}
          </div>
        </>
      )}

      {!running && state.requestedAt && !r && (
        <>
          <h2 className="ask-sheet-h">Requested</h2>
          <p className="ask-sheet-lede">You asked for a review on {day(state.requestedAt)}. We’ll email you when it’s ready, and it will show here.</p>
        </>
      )}

      {!running && !r && !state.requestedAt && (
        <>
          <h2 className="ask-sheet-h">How does your site look to a new visitor?</h2>
          <p className="ask-sheet-lede">Claude reads your home page and the pages people go to next, compares you with a competitor, checks your search and visitor data, then tells you what to fix first.</p>
          <div className="ask-acts"><button type="button" className="ask-btn" onClick={run}>{!admin && mode === 'queue' ? 'Ask for a review' : 'Analyse my website'}</button></div>
        </>
      )}

      {error && <p className="ask-err" role="alert">{error}</p>}

      {!running && r && (
        <>
          <h2 className="ask-sheet-h">{r.headline}</h2>
          <p className="ask-sheet-lede">{r.firstImpression}</p>
          {state.requestedAt && <p className="ask-said">You asked for a new review on {day(state.requestedAt)}. This one is from {day(r.at)}.</p>}

          <div className="ask-ix-g">
            <div className="ask-ix-h"><span className="ask-k">What a visitor understands</span></div>
            <p className="ask-rv-p">{r.whatItIs}</p>
            {r.profileMismatch && <p className="ask-rv-p ask-rv-note">{r.profileMismatch} <a className="ask-tl" href="/settings">Update your profile</a></p>}
          </div>

          {r.scores.length > 0 && (
            <div className="ask-ix-g">
              <div className="ask-ix-h"><span className="ask-k">By area</span></div>
              <ul className="ask-rv-scores">
                {r.scores.map(s => (
                  <li key={s.area}>
                    <span className="ask-rv-a">{s.area}</span>
                    <span className="ask-rv-bar" aria-hidden="true"><i style={{ width: `${s.score * 10}%` }} /></span>
                    <b>{s.score}/10</b>
                    <small>{s.note}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="ask-ix-g">
            <div className="ask-ix-h"><span className="ask-k">Fix these · most important first</span></div>
            <ol className="ask-rv-fixes">
              {r.fixes.map((f, i) => (
                <li key={i} className={open === i ? 'is-open' : ''}>
                  <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                    <b>{f.title}</b>
                    <small>{f.area} · {f.impact} impact · {f.effort === 'quick' ? 'quick to do' : f.effort === 'big' ? 'bigger job' : 'some work'}</small>
                  </button>
                  {open === i && (
                    <div className="ask-rv-body">
                      <p><span className="ask-k">Why</span>{f.why}</p>
                      <p><span className="ask-k">How</span>{f.how}</p>
                      <p><span className="ask-k">Where</span>{/^https?:\/\//.test(f.page) ? <a className="ask-tl" href={f.page} target="_blank" rel="noreferrer">{short(f.page)}</a> : f.page}</p>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {r.working.length > 0 && (
            <div className="ask-ix-g">
              <div className="ask-ix-h"><span className="ask-k">Working well</span></div>
              <ul className="ask-rv-list">{r.working.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}

          <div className="ask-acts">
            <button type="button" className="ask-btn" onClick={async () => setSaid((await copy(fixesText(r))) ? 'Copied. Paste it to whoever runs your site.' : 'Couldn’t copy here.')}>Copy the fixes</button>
            <button type="button" className="ask-tl" onClick={run}>{!admin && mode === 'queue' ? 'Ask for a new review' : 'Re-analyse'}</button>
          </div>
          {said && <p className="ask-said" role="status">{said}</p>}
          <p className="ask-faint ask-rv-foot">{day(r.at)} · read {r.pages.length} page{r.pages.length === 1 ? '' : 's'}{r.pages.length ? `: ${r.pages.slice(0, 6).map(short).join(', ')}${r.pages.length > 6 ? '…' : ''}` : ''}</p>
        </>
      )}
    </div>
  )
}
