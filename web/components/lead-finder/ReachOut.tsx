'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ToolHeader from '@/components/ToolHeader'
import { Spinner } from '@/components/ui/spinner'
import { Stars, fmtDate, firstName, initials, reviewHref, saveReview, step } from '@/components/lead-finder/ui'
import type { SavedReview, SavedScan } from '@/lib/lead-finder/saved'

// Competitor Leads, step two: reach out to one reviewer in three steps, each saved as it's done
// (app/api/lead-finder/step):
//   1 · Email them?   how well the brand fits them, and a yes / not a fit
//   2 · Their email   looked up, or typed in
//   3 · Review & send the short email written for them, sent from the user's Gmail

const STEPS = ['Email them?', 'Their email', 'Review & send']
const textToHtml = (t: string) => t.trim().split(/\n{2,}/).map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('')
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

export default function ReachOut({ review: initial, scan, brandName, gmailConnected, next }: {
  review: SavedReview
  scan: SavedScan | null
  brandName: string
  gmailConnected: boolean
  next: { id: string; name: string } | null   // the next unhappy reviewer not contacted yet
}) {
  const router = useRouter()
  const [r, setR] = useState(initial)
  const [stepNo, setStepNo] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = firstName(r.name) || r.name
  const hi = firstName(r.name) ? `Hi ${firstName(r.name)},` : 'Hi,'
  // The saved draft is kept without the greeting, which is shown here so it can be edited
  const bare = (b: string) => (b.startsWith(`${hi}\n\n`) ? b.slice(hi.length + 2) : b)

  const [to, setTo] = useState(initial.email ?? '')
  const [subject, setSubject] = useState(initial.draft?.subject ?? '')
  const [body, setBody] = useState(initial.draft ? `${hi}\n\n${initial.draft.body}` : '')
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState(false)

  async function run(op: 'assess' | 'contact' | 'draft', label: string) {
    setBusy(label); setError(null)
    try {
      const { review } = await step<{ review: SavedReview }>({ op, leadId: r.id })
      setR(review)
      if (op === 'contact' && review.email && !to) setTo(review.email)
      if (op === 'draft' && review.draft) { setSubject(review.draft.subject); setBody(`${hi}\n\n${review.draft.body}`) }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.')
    } finally {
      setBusy(null)
    }
  }

  // Each step fetches what it needs the first time it's shown
  const started = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (r.status === 'sent') return
    const once = (key: string, fn: () => void) => { if (!started.current.has(key)) { started.current.add(key); fn() } }
    if (stepNo === 1 && r.fit === undefined) once('assess', () => run('assess', `Reading the review and checking how ${brandName} could help…`))
    if (stepNo === 2 && !r.contactChecked) once('contact', () => run('contact', `Looking for ${name}'s email address…`))
    if (stepNo === 3 && !r.draft) once('draft', () => run('draft', `Writing a short, personal email to ${name}…`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepNo])

  function retry() {
    if (stepNo === 1) run('assess', `Reading the review and checking how ${brandName} could help…`)
    else if (stepNo === 2) run('contact', `Looking for ${name}'s email address…`)
    else run('draft', `Writing a short, personal email to ${name}…`)
  }

  async function notAFit() {
    await saveReview(r.id, { status: 'skipped' })
    router.push('/lead-finder')
    router.refresh()
  }

  function saveEdits() {
    const draft = { subject, body: bare(body) }
    if (to.trim() === (r.email ?? '') && draft.subject === (r.draft?.subject ?? '') && draft.body === (r.draft?.body ?? '')) return
    setR(prev => ({ ...prev, email: to.trim() || prev.email, draft }))
    saveReview(r.id, { email: to.trim() || undefined, draft })
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
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
      setR(prev => ({ ...prev, status: 'sent', email: to.trim(), draft, sentAt: new Date().toISOString() }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send.')
    } finally {
      setSending(false)
    }
  }

  const done = r.status === 'sent'
  const working = busy && <div className="cl-working"><Spinner size={16} />{busy}</div>
  const problem = error && !busy && (
    <div className="cl-err-box" role="alert"><span>{error}</span>{!sending && <button type="button" className="th-link" onClick={retry}>Try again</button>}</div>
  )

  let content: React.ReactNode
  if (done) {
    content = (
      <div className="cl-done">
        <div className="cl-done-tick" aria-hidden="true">✓</div>
        <h3>Email sent to {name}</h3>
        <p>Sent from your Gmail to <b>{r.email}</b>{r.sentAt ? ` on ${fmtDate(r.sentAt)}` : ''}. We’ll remind you to follow up in 5 days if they don’t reply. It’s also in Email Outreach.</p>
        {r.draft && <details className="cl-sent-copy"><summary>See the email</summary><b>{r.draft.subject}</b><p>{hi}</p>{r.draft.body.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</details>}
        <div className="cl-acts cl-acts--center">
          {next && <Link className="btn btn-primary" href={reviewHref(next.id)}>Next review: {firstName(next.name) || next.name} →</Link>}
          <Link className="btn btn-ghost" href="/lead-finder">Back to reviews</Link>
        </div>
      </div>
    )
  } else if (stepNo === 1) {
    content = <>
      <blockquote className="cl-quote cl-quote--full">“{r.text}”</blockquote>
      {working || problem || (r.fit !== undefined && <>
        <div className="cl-fitline"><span className={`cl-tag ${r.fit >= 7 ? 'cl-tag--ok' : ''}`}>{r.fit >= 7 ? 'Good fit' : r.fit >= 5 ? 'Partial fit' : 'Weak fit'} · {r.fit}/10</span></div>
        {r.why && <p className="cl-why">{r.why}</p>}
        {!!r.pains?.length && <div className="cl-pains">{r.pains.map(p => <span key={p}>{p}</span>)}</div>}
        {r.status === 'skipped' && <p className="cl-muted">You marked this one as not a fit earlier.</p>}
        <p className="cl-ask">Do you want to send {name} an email?</p>
        <div className="cl-acts">
          <button className="btn btn-primary" type="button" onClick={() => setStepNo(2)}>Yes, write an email</button>
          {r.status !== 'skipped' && <button className="btn btn-ghost" type="button" onClick={notAFit}>No, not a fit</button>}
        </div>
      </>)}
    </>
  } else if (stepNo === 2) {
    content = working || <>
      {problem}
      {r.email ? (
        <p className="cl-why">Found {name}’s email on {r.website ? <a className="th-link" href={r.website} target="_blank" rel="noopener noreferrer">their website ↗</a> : 'their website'}
          {' '}{r.verified ? <span className="cl-tag cl-tag--ok">Verified</span> : <span className="cl-tag cl-tag--warn">Not verified</span>}. You can change it.</p>
      ) : r.contactChecked && (
        <p className="cl-why">We couldn’t find a public email for {name}.{scan?.platform !== 'shopify' ? ' Trustpilot reviewers are often people, not businesses.' : ''} If you know it (from their {r.reviewUrl ? <a className="th-link" href={r.reviewUrl} target="_blank" rel="noopener noreferrer">review ↗</a> : 'review'}{r.website ? <> or <a className="th-link" href={r.website} target="_blank" rel="noopener noreferrer">website ↗</a></> : null}), paste it here.</p>
      )}
      <form className="cl-editor cl-editor--flat" onSubmit={e => { e.preventDefault(); if (validEmail(to)) { saveEdits(); setStepNo(3) } }}>
        <label>Email address<input type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.com" autoFocus={!r.email} /></label>
        <div className="cl-acts">
          <button className="btn btn-primary" type="submit" disabled={!validEmail(to)}>Continue</button>
          <button className="btn btn-ghost" type="button" onClick={() => setStepNo(1)}>Back</button>
        </div>
      </form>
    </>
  } else {
    content = working || <>
      {problem}
      <form className="cl-editor cl-editor--flat" onSubmit={send} onBlur={saveEdits}>
        <label>To<input type="email" required value={to} onChange={e => setTo(e.target.value)} /></label>
        <label>Subject<input required value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <label>Message<textarea required rows={10} value={body} onChange={e => setBody(e.target.value)} /></label>
        <p className="cl-muted">Plain and short, from your Gmail. It doesn’t mention their review. Edit anything you like.</p>
        <div className="cl-acts">
          {gmailConnected
            ? <button className="btn btn-primary" type="submit" disabled={sending || !validEmail(to)}>{sending ? <><Spinner />Sending…</> : 'Send email'}</button>
            : <Link className="btn btn-primary" href="/gmail-hub">Connect Gmail to send</Link>}
          <button className="btn btn-ghost" type="button" onClick={() => setStepNo(2)}>Back</button>
          <button className="btn btn-ghost" type="button" disabled={sending} onClick={() => run('draft', `Writing a new email to ${name}…`)}>Rewrite</button>
          <button className="btn btn-ghost" type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* ignore */ } }}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </form>
    </>
  }

  return (
    <div className="tool-page">
      <ToolHeader
        icon="target"
        title="Competitor Leads"
        chips={<span className={`th-chip ${gmailConnected ? 'th-chip--on' : 'th-chip--warn'}`}>{gmailConnected ? 'Gmail connected' : 'Gmail not connected'}</span>}
        actions={<Link href="/gmail-hub" className="th-link">Email Outreach →</Link>}
      />
      <div className="cl">
        <p className="cl-back"><Link className="th-link" href="/lead-finder">← All reviews{scan ? ` (${scan.competitor})` : ''}</Link></p>
        <section className="cl-ro">
          <div className="cl-ro-head">
            <span className="cl-av" aria-hidden="true">{initials(r.name)}</span>
            <div>
              <h2>{r.name}</h2>
              <div className="cl-lead-sub"><Stars n={r.rating} />{r.date && <span>{fmtDate(r.date)}</span>}{scan && <span>reviewed {scan.competitor}</span>}
                {r.reviewUrl && <a className="th-link" href={r.reviewUrl} target="_blank" rel="noopener noreferrer">Read review ↗</a>}</div>
            </div>
          </div>
          <ol className="cl-ro-bar" aria-label="Steps">
            {STEPS.map((label, i) => {
              const n = i + 1
              const state = done || n < stepNo ? 'past' : n === stepNo ? 'on' : ''
              return <li key={label} className={state} aria-current={state === 'on' ? 'step' : undefined}><i /><span>{n} · {label}</span></li>
            })}
          </ol>
          {content}
        </section>
      </div>
    </div>
  )
}
