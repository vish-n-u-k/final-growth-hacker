'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ToolHeader from '@/components/ToolHeader'
import { Spinner } from '@/components/ui/spinner'
import { Stars, competitorLabel, fmtDate, firstName, initials, reviewHref, saveReview, step } from '@/components/lead-finder/ui'
import type { SavedReview, SavedScan } from '@/lib/lead-finder/saved'

// Competitor Leads, step two: reach out to one reviewer in two steps, each saved as it's done
// (app/api/lead-finder/step). The list already said how well they fit (shown on the left), so
// the steps start at the work:
//   1 · Their email   looked up, or typed in
//   2 · Review & send the short email written for them, sent from the user's Gmail

const STEPS = ['Their email', 'Review & send']
const textToHtml = (t: string) => t.trim().split(/\n{2,}/).map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('')
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

export default function ReachOut({ review: initial, scan, brandName, gmailConnected, next }: {
  review: SavedReview
  scan: SavedScan | null
  brandName: string
  gmailConnected: boolean
  next: { id: string; name: string } | null   // the next good fit not contacted yet
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
    // Opened straight from a link before the fit was checked: check it quietly for the side panel
    if (r.fit === undefined) once('assess', () => { step<{ review: SavedReview }>({ op: 'assess', leadId: r.id }).then(x => setR(prev => ({ ...prev, fit: x.review.fit, why: x.review.why, pains: x.review.pains }))).catch(() => {}) })
    if (stepNo === 1 && !r.contactChecked) once('contact', () => run('contact', `Looking for ${name}'s email address…`))
    if (stepNo === 2 && !r.draft) once('draft', () => run('draft', `Writing a short, personal email to ${name}…`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepNo])

  function retry() {
    if (stepNo === 1) run('contact', `Looking for ${name}'s email address…`)
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
  const working = busy && (
    <div className="ro-working" aria-live="polite">
      <Spinner size={16} /><span>{busy}</span>
      <i /><i style={{ width: '82%' }} /><i style={{ width: '64%' }} />
    </div>
  )
  const problem = error && !busy && (
    <div className="ro-error" role="alert"><span>{error}</span>{!sending && <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>Try again</button>}</div>
  )
  const fitTone = r.fit === undefined ? '' : r.fit >= 7 ? 'good' : r.fit >= 5 ? 'mid' : 'low'
  const fitLabel = r.fit === undefined ? '' : r.fit >= 7 ? 'Good fit' : r.fit >= 5 ? 'Partial fit' : 'Weak fit'

  const fitBlock = r.fit !== undefined && (
    <div className={`ro-fit ro-fit--${fitTone}`}>
      <div className="ro-fit-top"><b>{fitLabel}</b><span>{r.fit}/10</span></div>
      <div className="ro-fit-meter" aria-hidden="true"><i style={{ width: `${r.fit * 10}%` }} /></div>
      {r.why && <p>{r.why}</p>}
      {!!r.pains?.length && <div className="cl-pains">{r.pains.map(p => <span key={p}>{p}</span>)}</div>}
    </div>
  )

  // Each step: a plain question as its title, its content, and its actions in a footer
  let title: string, hint: string | null = null, content: React.ReactNode, actions: React.ReactNode = null
  if (done) {
    title = ''
    content = (
      <div className="ro-done">
        <div className="ro-done-tick" aria-hidden="true">✓</div>
        <h3 className="ro-title">Email sent to {name}</h3>
        <p>Sent from your Gmail to <b>{r.email}</b>{r.sentAt ? ` on ${fmtDate(r.sentAt)}` : ''}. We’ll remind you to follow up in 5 days if they don’t reply. It’s also in Email Outreach.</p>
        {r.draft && (
          <div className="ro-mail ro-mail--read">
            <div className="ro-mail-row"><span>To</span><b>{r.email}</b></div>
            <div className="ro-mail-row"><span>Subject</span><b>{r.draft.subject}</b></div>
            <div className="ro-mail-body">{hi}{'\n\n'}{r.draft.body}</div>
          </div>
        )}
      </div>
    )
    actions = <>
      <Link key="reviews" className="btn btn-ghost ro-back" href="/lead-finder">← Back to reviews</Link>
      {next && <Link className="btn btn-primary" href={reviewHref(next.id)}>Next review: {firstName(next.name) || next.name} →</Link>}
    </>
  } else if (stepNo === 1) {
    title = `Where should it go?`
    hint = r.email ? null : r.contactChecked ? null : `Looking for a public email for ${name}.`
    content = working || <>
      {problem}
      {r.email ? (
        <div className="ro-found">
          <span className="ro-found-ic" aria-hidden="true">✉</span>
          <div>
            <b>Found {name}’s email</b>
            <span>on {r.website ? <a className="th-link" href={r.website} target="_blank" rel="noopener noreferrer">their website ↗</a> : 'their website'} · {r.verified ? 'verified' : 'not verified, so double-check it'}</span>
          </div>
        </div>
      ) : r.contactChecked && (
        <div className="ro-found ro-found--none">
          <span className="ro-found-ic" aria-hidden="true">?</span>
          <div>
            <b>No public email found</b>
            <span>{scan?.platform !== 'shopify' ? 'Trustpilot reviewers are often people, not businesses. ' : ''}If you know it, from their {r.reviewUrl ? <a className="th-link" href={r.reviewUrl} target="_blank" rel="noopener noreferrer">review ↗</a> : 'review'}{r.website ? <> or <a className="th-link" href={r.website} target="_blank" rel="noopener noreferrer">website ↗</a></> : null}, paste it below.</span>
          </div>
        </div>
      )}
      <form id="ro-to" className="ro-field" onSubmit={e => { e.preventDefault(); if (validEmail(to)) { saveEdits(); setStepNo(2) } }}>
        <label htmlFor="ro-to-in">Email address</label>
        <input id="ro-to-in" type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.com" autoFocus={!r.email} />
      </form>
    </>
    if (!busy) actions = <>
      {r.status !== 'skipped'
        ? <button key="skip" className="btn btn-ghost ro-back" type="button" onClick={notAFit}>Skip: not a fit</button>
        : <span key="sp" className="ro-back" />}
      <button key="continue" className="btn btn-primary" type="submit" form="ro-to" disabled={!validEmail(to)}>Continue →</button>
    </>
  } else {
    title = 'Check the email, then send it'
    hint = 'Short and plain, sent from your Gmail. It doesn’t mention their review. Edit anything you like.'
    content = working || <>
      {problem}
      <form id="ro-mail" className="ro-mail" onSubmit={send} onBlur={saveEdits}>
        <label className="ro-mail-row"><span>To</span><input type="email" required value={to} onChange={e => setTo(e.target.value)} /></label>
        <label className="ro-mail-row"><span>Subject</span><input required value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <textarea className="ro-mail-body" aria-label="Message" required rows={11} value={body} onChange={e => setBody(e.target.value)} />
        <div className="ro-mail-tools">
          <button className="btn btn-ghost btn-sm" type="button" disabled={sending} onClick={() => run('draft', `Writing a new email to ${name}…`)}>↻ Rewrite</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* ignore */ } }}>{copied ? '✓ Copied' : 'Copy'}</button>
          <span className="cl-muted">Follow-up reminder in 5 days</span>
        </div>
      </form>
    </>
    if (!busy) actions = <>
      <button key="back2" className="btn btn-ghost ro-back" type="button" onClick={() => setStepNo(1)}>← Back</button>
      {gmailConnected
        ? <button key="send" className="btn btn-primary" type="submit" form="ro-mail" disabled={sending || !validEmail(to)}>{sending ? <><Spinner />Sending…</> : 'Send email →'}</button>
        : <Link className="btn btn-primary" href="/gmail-hub">Connect Gmail to send</Link>}
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
      <nav className="ro-crumbs" aria-label="Breadcrumb">
        <Link className="th-link" href="/lead-finder">← Competitor Leads</Link>
        {scan && <><span aria-hidden="true">/</span><span>{competitorLabel(scan.competitor)}</span></>}
        <span aria-hidden="true">/</span><b>{r.name}</b>
      </nav>

      <div className="ro">
        {/* Who they are and what they said; stays in view on wide screens */}
        <aside className="ro-side">
          <div className="ro-person">
            <span className="cl-av" aria-hidden="true">{initials(r.name)}</span>
            <div>
              <h2>{r.name}</h2>
              <div className="cl-lead-sub"><Stars n={r.rating} />{r.date && <span>{fmtDate(r.date)}</span>}</div>
            </div>
          </div>
          <blockquote className="ro-quote">“{r.text}”</blockquote>
          <div className="ro-src">
            {scan && <span>Review of <b>{competitorLabel(scan.competitor)}</b> on {scan.platform === 'shopify' ? 'the Shopify App Store' : 'Trustpilot'}</span>}
            {r.reviewUrl && <a className="th-link" href={r.reviewUrl} target="_blank" rel="noopener noreferrer">Read it ↗</a>}
          </div>
          {fitBlock}
        </aside>

        <section className="ro-main">
          <ol className="ro-steps" aria-label="Steps">
            {STEPS.map((label, i) => {
              const n = i + 1
              const state = done || n < stepNo ? 'past' : n === stepNo ? 'on' : 'todo'
              return (
                <li key={label} className={`ro-step ro-step--${state}`} aria-current={state === 'on' ? 'step' : undefined}>
                  <span className="ro-step-n">{state === 'past' ? '✓' : n}</span><span className="ro-step-l">{label}</span>
                </li>
              )
            })}
          </ol>
          <div className="ro-card">
            {title && <h3 className="ro-title">{title}</h3>}
            {hint && <p className="ro-hint">{hint}</p>}
            {content}
            {actions && <div key={done ? 'done' : stepNo} className="ro-actions">{actions}</div>}
          </div>
        </section>
      </div>
    </div>
  )
}
