'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui/spinner'
import { competitorLabel, fmtDate, firstName, reviewHref, saveReview, step } from '@/components/lead-finder/ui'
import { useToast } from '@/components/email-outreach/shared'
import type { SavedReview, SavedScan } from '@/lib/lead-finder/saved'

// Competitor Leads, step two: reach out to one reviewer in two steps, each saved as it's done
// (app/api/lead-finder/step). Calm like the list: who they are and why on the left, one step on
// the right with one green button. After sending or skipping, the next good fit opens by itself.
//   1 · Their email   looked up, or typed in
//   2 · Review & send the short email written for them, sent from the user's Gmail

const textToHtml = (t: string) => t.trim().split(/\n{2,}/).map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('')
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

export default function ReachOut({ review: initial, scan, gmailConnected, next }: {
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
  const [toast, notify] = useToast()
  const name = firstName(r.name) || r.name
  const hi = firstName(r.name) ? `Hi ${firstName(r.name)},` : 'Hi,'
  // The saved draft is kept without the greeting, which is shown here so it can be edited
  const bare = (b: string) => (b.startsWith(`${hi}\n\n`) ? b.slice(hi.length + 2) : b)

  const [to, setTo] = useState(initial.email ?? '')
  const [subject, setSubject] = useState(initial.draft?.subject ?? '')
  const [body, setBody] = useState(initial.draft ? `${hi}\n\n${initial.draft.body}` : '')
  const [sending, setSending] = useState(false)

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
    // Opened straight from a link before the fit was checked: check it quietly for the left side
    if (r.fit === undefined) once('assess', () => { step<{ review: SavedReview }>({ op: 'assess', leadId: r.id }).then(x => setR(prev => ({ ...prev, fit: x.review.fit, why: x.review.why, pains: x.review.pains }))).catch(() => {}) })
    if (stepNo === 1 && !r.contactChecked) once('contact', () => run('contact', `Looking for ${name}'s email address…`))
    if (stepNo === 2 && !r.draft) once('draft', () => run('draft', `Writing a short, personal email to ${name}…`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepNo])

  // Arrived here straight after sending to or skipping the one before: say so (Undo for a skip)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const done = p.get('done'), id = p.get('id'), who = p.get('name') ?? ''
    if (!done || !id) return
    window.history.replaceState(null, '', window.location.pathname)
    if (done === 'sent') notify(`Sent to ${who}`)
    else notify(`Skipped ${who}`, () => saveReview(id, { status: null }))
  }, [notify])

  function retry() {
    if (stepNo === 1) run('contact', `Looking for ${name}'s email address…`)
    else run('draft', `Writing a short, personal email to ${name}…`)
  }

  // Straight on to the next good fit, so there's never a moment of "now what?"
  function goNext(done: 'sent' | 'skipped') {
    const qs = `?done=${done}&id=${encodeURIComponent(r.id)}&name=${encodeURIComponent(name)}`
    router.push(next ? `${reviewHref(next.id)}${qs}` : `/lead-finder${qs}`)
    router.refresh()
  }

  async function skip() {
    await saveReview(r.id, { status: 'skipped' })
    goNext('skipped')
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
      await saveReview(r.id, { status: 'sent', email: to.trim(), draft: { subject, body: bare(body) } })
      goNext('sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send.')
      setSending(false)
    }
  }

  const working = busy && <div className="ca-note" aria-live="polite"><Spinner size={16} /><span>{busy}</span></div>
  const problem = error && !busy && (
    <div className="ca-note" role="alert"><span>{error}</span>{!sending && <button type="button" className="ca-link" onClick={retry}>Try again</button>}</div>
  )

  // Each step: a plain question as its title, its content, then its buttons (one green)
  let stepOf: string, title: string, hint: React.ReactNode = null, content: React.ReactNode, actions: React.ReactNode = null
  if (r.status === 'sent') {
    stepOf = 'Done'
    title = `Email sent to ${name}`
    hint = <>Sent from your Gmail{r.sentAt ? ` on ${fmtDate(r.sentAt)}` : ''}. You’ll get a reminder to follow up in 5 days if they don’t reply. It’s also in Email Outreach.</>
    content = r.draft && (
      <div className="ca-mail ca-mail--read">
        <div className="ca-mail-row"><span>To</span><b>{r.email}</b></div>
        <div className="ca-mail-row"><span>Subject</span><b>{r.draft.subject}</b></div>
        <div className="ca-mail-text">{hi}{'\n\n'}{r.draft.body}</div>
      </div>
    )
    actions = <>
      <Link className="btn btn-link" href="/lead-finder">Back to the list</Link>
      {next && <Link className="btn btn-primary ca-go" href={reviewHref(next.id)}>Next: {firstName(next.name) || next.name} →</Link>}
    </>
  } else if (stepNo === 1) {
    stepOf = 'Step 1 of 2'
    title = 'Where should it go?'
    content = working || <>
      {problem}
      <p className="ca-found">
        {r.email
          ? <>Found <b>{r.email}</b> on {r.website ? <a className="ca-link" href={r.website} target="_blank" rel="noopener noreferrer">their website ↗</a> : 'their website'}{r.verified ? '.' : ', not verified, so double-check it.'}</>
          : r.contactChecked && <>No public email found. {scan?.platform !== 'shopify' ? 'Trustpilot reviewers are often people, not businesses. ' : ''}If you know it, paste it below.</>}
      </p>
      <form id="ro-to" className="ca-field" onSubmit={e => { e.preventDefault(); if (validEmail(to)) { saveEdits(); setStepNo(2) } }}>
        <label htmlFor="ro-to-in">Email address</label>
        <input id="ro-to-in" type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.com" autoFocus={!r.email} />
      </form>
    </>
    if (!busy) actions = <>
      {r.status !== 'skipped' && <button className="btn btn-link" type="button" onClick={skip}>Skip</button>}
      <button className="btn btn-primary ca-go" type="submit" form="ro-to" disabled={!validEmail(to)}>Continue →</button>
    </>
  } else {
    stepOf = 'Step 2 of 2'
    title = 'Check the email, then send it'
    hint = 'Short and plain, from your Gmail. It doesn’t mention their review. Edit anything.'
    content = working || <>
      {problem}
      <form id="ro-mail" className="ca-mail" onSubmit={send} onBlur={saveEdits}>
        <label className="ca-mail-row"><span>To</span><input type="email" required value={to} onChange={e => setTo(e.target.value)} /></label>
        <label className="ca-mail-row"><span>Subject</span><input required value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <textarea className="ca-mail-text" aria-label="Message" required rows={11} value={body} onChange={e => setBody(e.target.value)} />
      </form>
      <p className="ca-small">If they don’t reply, you’ll get a reminder to follow up in 5 days. <button type="button" className="ca-link" disabled={sending} onClick={() => run('draft', `Writing a new email to ${name}…`)}>Write it again</button></p>
    </>
    if (!busy) actions = <>
      <button className="btn btn-link" type="button" onClick={() => setStepNo(1)}>← Back</button>
      {gmailConnected
        ? <button className="btn btn-primary ca-go" type="submit" form="ro-mail" disabled={sending || !validEmail(to)}>{sending ? <><Spinner />Sending…</> : 'Send email'}</button>
        : <Link className="btn btn-primary ca-go" href="/gmail-hub">Connect Gmail to send</Link>}
    </>
  }

  const stars = Math.max(0, Math.min(5, Math.round(r.rating)))
  return (
    <div className="tool-page ca">
      <div className="ca-top">
        <Link className="ca-link ca-back" href="/lead-finder">← Competitor Leads</Link>
      </div>
      <div className="ca-open">
        {/* Who they are and why they fit; the details live here, not on the list */}
        <aside className="ca-who">
          <h2>{r.name}</h2>
          <div className="ca-who-src">
            {stars}★{r.date && ` · ${fmtDate(r.date)}`}
            {scan && ` · ${scan.platform === 'shopify' ? 'Shopify App Store' : 'Trustpilot'} review of ${competitorLabel(scan.competitor)}`}
            {r.reviewUrl && <> · <a className="ca-link" href={r.reviewUrl} target="_blank" rel="noopener noreferrer">Read it ↗</a></>}
          </div>
          {r.why && <p className="ca-who-why">{r.why}</p>}
          <blockquote>“{r.text}”</blockquote>
        </aside>

        <section className="ca-step">
          <div className="ca-step-of">{stepOf}</div>
          <h2>{title}</h2>
          {hint && <p className="ca-hint">{hint}</p>}
          {content}
          {actions && <div key={`${r.status}:${stepNo}`} className="ca-acts">{actions}</div>}
        </section>
      </div>
      {toast}
    </div>
  )
}
