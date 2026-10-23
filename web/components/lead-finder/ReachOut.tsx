'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui/spinner'
import { competitorLabel, fmtDate, firstName, reviewHref, saveReview, step } from '@/components/lead-finder/ui'
import { useToast } from '@/components/email-outreach/shared'
import type { SavedReview, SavedScan } from '@/lib/lead-finder/saved'

// Competitor Leads, step two: reach out to one reviewer in two steps, each saved as it's done
// (app/api/lead-finder/step). Laid out like design-previews/tools-cleanup/all-tools-calm.html:
// who they are and why on the left, one step on the right with one green button.
//   1 · Their email   looked up, or typed in
//   2 · Review & send the short email written for them, sent from the user's Gmail
// The list (components/LeadFinder) opens it in place and moves on to the next good fit when it's
// done. ReachOutPage is the same thing on its own page, for links straight to one reviewer.

const textToHtml = (t: string) => t.trim().split(/\n{2,}/).map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('')
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())
const GOOD = 7

export type Finish = 'sent' | 'skipped'

export default function ReachOut({ review: initial, scan, gmailConnected, onBack, onDone }: {
  review: SavedReview
  scan: SavedScan | null
  gmailConnected: boolean
  onBack: (r: SavedReview) => void                    // with what was found or written so far
  onDone: (r: SavedReview, how: Finish) => void       // after it's sent or skipped (already saved)
}) {
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
  const [skipping, setSkipping] = useState(false)
  const [copied, setCopied] = useState(false)

  async function run(op: 'contact' | 'draft', label: string) {
    setBusy(label); setError(null)
    try {
      const { review } = await step<{ review: SavedReview }>({ op, leadId: r.id })
      setR(prev => ({ ...prev, ...review, status: prev.status }))
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
    // Opened before the fit was checked: check it quietly for the left side
    if (r.fit === undefined) once('assess', () => { step<{ review: SavedReview }>({ op: 'assess', leadId: r.id }).then(x => setR(prev => ({ ...prev, fit: x.review.fit, why: x.review.why, pains: x.review.pains }))).catch(() => {}) })
    if (stepNo === 1 && !r.contactChecked) once('contact', () => run('contact', `Looking for ${name}'s email address…`))
    if (stepNo === 2 && !r.draft) once('draft', () => run('draft', `Writing a short, personal email to ${name}…`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepNo])

  function retry() {
    if (stepNo === 1) run('contact', `Looking for ${name}'s email address…`)
    else run('draft', `Writing a short, personal email to ${name}…`)
  }

  const current = (): SavedReview => ({ ...r, email: to.trim() || r.email, draft: subject || body ? { subject, body: bare(body) } : r.draft })

  function saveEdits() {
    const draft = { subject, body: bare(body) }
    if (to.trim() === (r.email ?? '') && draft.subject === (r.draft?.subject ?? '') && draft.body === (r.draft?.body ?? '')) return
    setR(prev => ({ ...prev, email: to.trim() || prev.email, draft }))
    saveReview(r.id, { email: to.trim() || undefined, draft })
  }

  async function skip() {
    setSkipping(true)
    await saveReview(r.id, { status: 'skipped' })
    onDone({ ...current(), status: 'skipped' }, 'skipped')
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
      onDone({ ...r, status: 'sent', email: to.trim(), draft, sentAt: new Date().toISOString() }, 'sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send.')
      setSending(false)
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* clipboard blocked */ }
  }

  const working = busy && <div className="ca-note" aria-live="polite"><Spinner size={16} /><span className="ca-note-text">{busy}</span></div>
  const problem = error && !busy && (
    <div className="ca-note" role="alert"><span className="ca-note-text">{error}</span>{!sending && <button type="button" className="ca-link" onClick={retry}>Try again</button>}</div>
  )
  const reviewLink = (label: string) => r.reviewUrl ? <a className="ca-link" href={r.reviewUrl} target="_blank" rel="noopener noreferrer">{label}</a> : null
  const siteLink = (label: string) => r.website ? <a className="ca-link" href={r.website} target="_blank" rel="noopener noreferrer">{label}</a> : null

  // Each step: a plain question as its title, its content, then its buttons (one green)
  let stepOf: string, title: string, hint: React.ReactNode = null, content: React.ReactNode, actions: React.ReactNode = null
  if (r.status === 'sent') {
    stepOf = 'Sent'
    title = `Email sent to ${name}`
    hint = <>Sent from your Gmail{r.sentAt ? ` on ${fmtDate(r.sentAt)}` : ''}. You’ll get a reminder to follow up in 5 days if they don’t reply. It’s also in Email Outreach.</>
    content = r.draft && (
      <div className="ca-mail">
        <div className="ca-mail-row"><span>To</span><b>{r.email}</b></div>
        <div className="ca-mail-row"><span>Subject</span><b>{r.draft.subject}</b></div>
        <div className="ca-mail-text ca-mail-text--read">{hi}{'\n\n'}{r.draft.body}</div>
      </div>
    )
    actions = <button className="btn btn-link" type="button" onClick={() => onBack(r)}>← Back to the list</button>
  } else if (stepNo === 1) {
    stepOf = 'Step 1 of 2'
    title = 'Where should it go?'
    content = working || <>
      {problem}
      {r.email
        ? <p className="ca-found">Found <b>{r.email}</b> on {siteLink('their website ↗') ?? 'their website'}{r.verified ? ' · verified.' : '. It isn’t verified, so double-check it.'}</p>
        : r.contactChecked && (
          <p className="ca-found">
            No public email found. {scan?.platform !== 'shopify' ? 'Trustpilot reviewers are often people, not businesses. ' : ''}
            If you know it, from their {reviewLink('review ↗') ?? 'review'}{r.website && <> or {siteLink('website ↗')}</>}, paste it below.
          </p>
        )}
      <form id="ro-to" className="ca-field" onSubmit={e => { e.preventDefault(); if (validEmail(to)) { saveEdits(); setStepNo(2) } }}>
        <label htmlFor="ro-to-in">Email address</label>
        <input id="ro-to-in" type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="name@business.com" autoFocus={!!r.contactChecked && !r.email} />
      </form>
    </>
    if (!busy) actions = <>
      {r.status !== 'skipped' && <button className="btn btn-link" type="button" disabled={skipping} onClick={skip}>Skip</button>}
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
      <p className="ca-small">
        If they don’t reply, you’ll get a reminder to follow up in 5 days.{' '}
        <button type="button" className="ca-link" disabled={sending} onClick={() => run('draft', `Writing a new email to ${name}…`)}>Write it again</button>{' · '}
        <button type="button" className="ca-link" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </p>
    </>
    if (!busy) actions = <>
      <button className="btn btn-link" type="button" onClick={() => setStepNo(1)}>← Back</button>
      {gmailConnected
        ? <button className="btn btn-primary ca-go" type="submit" form="ro-mail" disabled={sending || !validEmail(to)}>{sending ? <><Spinner />Sending…</> : 'Send email'}</button>
        : <Link className="btn btn-primary ca-go" href="/gmail-hub">Connect Gmail to send</Link>}
    </>
  }

  const stars = Math.max(0, Math.min(5, Math.round(r.rating)))
  const where = scan?.platform === 'shopify' ? 'Shopify App Store' : 'Trustpilot'
  return (
    <div className="ca-reach">
      <button type="button" className="ca-link ca-back" onClick={() => onBack(current())}>← Competitor Leads</button>
      <div className="ca-open">
        {/* Who they are and why they fit; the details live here, not on the list */}
        <aside className="ca-who">
          <h2>{r.name}</h2>
          <div className="ca-who-src">{where} · {stars}★{r.date && ` · ${fmtDate(r.date)}`}</div>
          {r.why && <p className="ca-who-why">{r.why}</p>}
          <blockquote>“{r.text}”</blockquote>
          <div className="ca-who-more">
            {r.fit !== undefined && <span>{r.fit >= GOOD ? 'Good fit' : r.fit >= 5 ? 'Partial fit' : 'Weak fit'} · {r.fit}/10</span>}
            {!!r.pains?.length && <span>They mention: {r.pains.join(', ')}</span>}
            {scan && <span>Review of {competitorLabel(scan.competitor)} {reviewLink('· Read it ↗')}</span>}
          </div>
        </aside>

        <section className="ca-step">
          <div className="ca-step-of">{stepOf}</div>
          <h2>{title}</h2>
          {hint && <p className="ca-hint">{hint}</p>}
          {content}
          {actions && <div key={`${r.status}:${stepNo}`} className="ca-acts">{actions}</div>}
        </section>
      </div>
    </div>
  )
}

/** The same steps on their own page (/lead-finder/review/[id]), for links straight to one reviewer. */
export function ReachOutPage({ review, scan, gmailConnected, next }: {
  review: SavedReview
  scan: SavedScan | null
  gmailConnected: boolean
  next: { id: string; name: string } | null   // the next good fit not contacted yet
}) {
  const router = useRouter()
  const [toast, notify] = useToast()

  // Arrived here straight after sending to or skipping the one before: say so (Undo for a skip)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const done = p.get('done'), id = p.get('id'), who = p.get('name') ?? ''
    if (!done || !id) return
    window.history.replaceState(null, '', window.location.pathname)
    if (done === 'sent') notify(`Sent to ${who}`)
    else notify(`Skipped ${who}`, () => saveReview(id, { status: null }))
  }, [notify])

  return (
    <div className="tool-page ca">
      <ReachOut key={review.id} review={review} scan={scan} gmailConnected={gmailConnected}
        onBack={() => router.push('/lead-finder')}
        onDone={(r, how) => {
          // Straight on to the next good fit (or back to the list, which says what happened)
          const qs = `?done=${how}&id=${encodeURIComponent(r.id)}&name=${encodeURIComponent(firstName(r.name) || r.name)}`
          router.push(next ? `${reviewHref(next.id)}${qs}` : `/lead-finder${qs}`)
        }} />
      {toast}
    </div>
  )
}
