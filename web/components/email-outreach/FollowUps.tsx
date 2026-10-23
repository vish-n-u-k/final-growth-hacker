'use client'

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import {
  closeReminder, dueLabel, isDue, loadReminders, openFollowUps, reopenReminder, type FollowUp,
} from '@/lib/email-outreach/followups'
import { EmailEditor, Steps, fmtDate, initials, type Mail, type Notify } from './shared'
import { Pager, usePages } from '@/components/tool-ui'

// Email Outreach → Follow-ups: one card per email still waiting on a reply, due ones first.
// Write follow-up opens two steps on the card (check the draft, then send it into the original
// Gmail thread). Skip closes it with an Undo; Snooze pushes it back. What's due later sits in a
// short list below. Replies, opt-outs and bounces are found in Gmail and close themselves.

interface Draft extends Mail {
  step: 1 | 2
  loading: boolean
  sending: boolean
  error: string | null
  threadId: string | null
  inReplyTo: string | null
}

const BATCH = 3

export default function FollowUps({ reloadKey, notify, onCount, onNewCampaign }: {
  reloadKey: number
  notify: Notify
  onCount: (due: number) => void
  onNewCampaign: () => void
}) {
  const [rows, setRows]           = useState<FollowUp[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [drafts, setDrafts]       = useState<Record<string, Draft>>({})
  const [open, setOpen]           = useState<string | null>(null)
  const [busy, setBusy]           = useState<Set<string>>(new Set())
  const [remindAgain, setRemindAgain] = useState(5)
  const [bulkBusy, setBulkBusy]   = useState<string | null>(null)
  const [panel, setPanel]         = useState<'ai' | 'send' | null>(null)
  const [aiInstruction, setAiInstruction] = useState('')
  const [showLater, setShowLater] = useState(false)
  const [checking, setChecking]   = useState(false)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(openFollowUps(await loadReminders()))
      setError(null)
    } catch {
      setError('Could not load follow-ups')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load, reloadKey])

  const due = rows.filter(isDue)
  const later = rows.filter(f => !isDue(f))
  const duePg = usePages(due, null)
  const laterPg = usePages(later, null)
  useEffect(() => { if (!loading) onCount(due.length) }, [due.length, loading, onCount])

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } as Draft }))
  const dropDraft = (id: string) => setDrafts(prev => { const n = { ...prev }; delete n[id]; return n })
  const drafted = due.filter(f => drafts[f.id] && !drafts[f.id].loading && drafts[f.id].body)
  const undrafted = due.filter(f => !drafts[f.id])
  const locked = !!bulkBusy

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusy(prev => new Set(prev).add(id))
    try { await fn() } finally { setBusy(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  async function checkReplies() {
    setChecking(true)
    try {
      const res = await fetch('/api/gmail/followups/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }),
      })
      const c = await res.json() as { replied?: number; optedOut?: number; bounced?: number; autoReply?: number; error?: string }
      if (!res.ok) { notify(c.error ?? 'Could not check Gmail for replies'); return }
      setCheckedAt(new Date())
      const parts = [
        c.replied && `${c.replied} replied`, c.optedOut && `${c.optedOut} opted out`,
        c.bounced && `${c.bounced} bounced`, c.autoReply && `${c.autoReply} out of office (pushed back)`,
      ].filter(Boolean)
      notify(parts.length ? `${parts.join(' · ')}. Those moved to Done.` : 'No new replies')
      await load()
    } catch {
      notify('Could not check Gmail for replies')
    } finally {
      setChecking(false)
    }
  }

  async function write(id: string) {
    setDrafts(prev => ({ ...prev, [id]: {
      step: 1, loading: true, sending: false, error: null, to: '', subject: '', body: '', threadId: null, inReplyTo: null,
    } }))
    try {
      const res = await fetch('/api/gmail/draft-followup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reminderId: id }),
      })
      const data = await res.json()
      if (res.status === 409) {
        dropDraft(id)
        notify(data.error ?? 'This follow-up is no longer needed')
        await load()
        return
      }
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setDraft(id, {
        loading: false, to: data.to ?? '', subject: data.subject ?? '', body: data.body ?? '',
        threadId: data.threadId ?? null, inReplyTo: data.inReplyTo ?? null,
      })
    } catch (e) {
      setDraft(id, { loading: false, error: e instanceof Error ? e.message : 'Could not write the follow-up' })
    }
  }

  function startWriting(id: string) {
    setOpen(id)
    if (!drafts[id] || drafts[id].error) write(id)
  }

  /** Sends one drafted follow-up and closes its reminder. Doesn't reload the list. */
  async function sendOne(id: string, d: Draft): Promise<boolean> {
    if (!d.to.trim() || !d.body.trim()) { setDraft(id, { step: 1, error: 'Add who it goes to before sending' }); return false }
    setDraft(id, { sending: true, error: null })
    try {
      const res = await fetch('/api/gmail/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: d.to, subject: d.subject, body: d.body, threadId: d.threadId, inReplyTo: d.inReplyTo,
          followUpDays: remindAgain > 0 ? remindAgain : undefined, source: 'followup',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`)
      await closeReminder(id)
      dropDraft(id)
      return true
    } catch (e) {
      setDraft(id, { sending: false, error: e instanceof Error ? e.message : 'Send failed' })
      return false
    }
  }

  async function send(f: FollowUp) {
    const d = drafts[f.id]
    if (!d) return
    if (await sendOne(f.id, d)) {
      setOpen(null)
      notify(`Follow-up sent to ${f.recipient}.${remindAgain > 0 ? ` If they don't reply, it's back here in ${remindAgain} days.` : ''}`)
      await load()
    }
  }

  function skip(f: FollowUp) {
    return withBusy(f.id, async () => {
      if (!await closeReminder(f.id)) { notify('Could not skip it. Try again.'); return }
      dropDraft(f.id)
      if (open === f.id) setOpen(null)
      setRows(prev => prev.filter(r => r.id !== f.id))
      notify(`Skipped ${f.recipient}`, async () => { await reopenReminder(f.id); await load() })
    })
  }

  function snooze(f: FollowUp, days: number) {
    return withBusy(f.id, async () => {
      const ok = await fetch(`/api/reminders/${f.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snooze: true, snoozeDays: days }),
      }).then(r => r.ok).catch(() => false)
      notify(ok ? `${f.recipient} is back in ${days} day${days !== 1 ? 's' : ''}` : 'Could not snooze')
      if (open === f.id) setOpen(null)
      await load()
    })
  }

  // ── Several at once ────────────────────────────────────────────────────────

  async function bulk(label: string, fn: () => Promise<void>) {
    setBulkBusy(label)
    try { await fn() } finally { setBulkBusy(null) }
  }

  const writeAll = () => bulk(`Writing ${undrafted.length}…`, async () => {
    const ids = undrafted.map(f => f.id)
    for (let i = 0; i < ids.length; i += BATCH) await Promise.all(ids.slice(i, i + BATCH).map(write))
    notify(`Wrote ${ids.length} follow-up${ids.length !== 1 ? 's' : ''}. Check them before sending.`)
  })

  const aiEditAll = () => bulk(`Editing 0/${drafted.length}…`, async () => {
    const targets = drafted.map(f => ({ f, d: drafts[f.id] }))
    let failed = 0
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH)
      try {
        const res = await fetch('/api/gmail/followup/refine', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction: aiInstruction, emails: batch.map(t => ({ id: t.f.id, to: t.d.to, recipient: t.f.recipient, currentBody: t.d.body })) }),
        })
        if (!res.ok) throw new Error()
        const data = await res.json() as { results?: { id: string; body?: string }[] }
        for (const r of data.results ?? []) {
          if (r.body) setDraft(r.id, { body: r.body, editingHtml: false })
          else failed++
        }
      } catch {
        failed += batch.length
      }
      setBulkBusy(`Editing ${Math.min(i + BATCH, targets.length)}/${targets.length}…`)
    }
    notify(failed ? `Edited ${targets.length - failed}, ${failed} failed` : `Edited ${targets.length} follow-up${targets.length !== 1 ? 's' : ''}`)
    setPanel(null)
  })

  const sendAll = () => bulk(`Sending 0/${drafted.length}…`, async () => {
    setPanel(null)
    const targets = drafted.map(f => ({ id: f.id, d: drafts[f.id] }))
    let sent = 0
    for (const [i, t] of targets.entries()) {
      if (await sendOne(t.id, t.d)) sent++
      setBulkBusy(`Sending ${i + 1}/${targets.length}…`)
    }
    const failed = targets.length - sent
    notify(failed ? `Sent ${sent}, ${failed} failed. Open those cards to see why.` : `Sent ${sent} follow-up${sent !== 1 ? 's' : ''}`)
    await load()
  })

  // ── Views ──────────────────────────────────────────────────────────────────

  const remindSelect = (
    <label className="eo-inline">
      If no reply, remind me in
      <select className="cl-sel eo-sel-sm" value={remindAgain} onChange={e => setRemindAgain(Number(e.target.value))}>
        <option value={0}>never</option>
        <option value={3}>3 days</option>
        <option value={5}>5 days</option>
        <option value={7}>7 days</option>
      </select>
    </label>
  )

  const snoozeSelect = (f: FollowUp) => (
    <select className="cl-sel eo-sel-sm" value="" disabled={busy.has(f.id) || locked} aria-label={`Snooze ${f.recipient}`}
      onChange={e => { const n = Number(e.target.value); if (n) snooze(f, n) }}>
      <option value="">Snooze</option>
      <option value={1}>1 day</option>
      <option value={3}>3 days</option>
      <option value={7}>7 days</option>
    </select>
  )

  function card(f: FollowUp) {
    const d = drafts[f.id]
    const isOpen = open === f.id && !!d
    const tone = dueLabel(f)
    return (
      <article key={f.id} className={`cl-rv eo-card${isOpen ? ' eo-card--open' : ''}`}>
        <div className="cl-rv-head">
          <span className="cl-av" aria-hidden="true">{initials(f.recipient)}</span>
          <div className="cl-rv-who">
            <div className="cl-lead-name">{f.recipient}</div>
            <div className="cl-lead-sub"><span className="eo-ellip">{f.subject || 'No subject'}</span></div>
          </div>
          <span className={`eo-due eo-due--${tone.tone}`}>{tone.text}</span>
        </div>

        <div className="cl-rv-body">
          <p className="eo-why">
            No reply since you emailed on {fmtDate(f.createdAt)}.
            {f.status === 'auto_reply' && <span className="eo-tag" title={f.note ?? undefined}>Was out of office</span>}
            {f.status === 'untracked' && <span className="eo-tag eo-tag--warn" title="The original Gmail thread could not be found, so a reply won't close this by itself">Replies not tracked</span>}
            {d && !isOpen && !d.loading && d.body && <span className="eo-tag eo-tag--ok">Draft ready</span>}
          </p>

          {isOpen && (
            <div className="eo-flow">
              <Steps labels={['Check the draft', 'Send it']} at={d.step} />
              {d.loading ? (
                <div className="ro-working"><Spinner /><span>Writing a follow-up from your original email…</span><i /></div>
              ) : d.step === 1 ? (
                <>
                  {d.error && <div className="ro-error">{d.error}</div>}
                  {d.body && <EmailEditor mail={d} onChange={p => setDraft(f.id, p)} />}
                </>
              ) : (
                <div className="eo-review">
                  <dl>
                    <dt>To</dt><dd>{d.to}</dd>
                    <dt>Subject</dt><dd>{d.subject || '(no subject)'}</dd>
                  </dl>
                  <p className="cl-muted">It goes into the same Gmail thread as your first email, so they see both together.</p>
                  {remindSelect}
                  {d.error && <div className="ro-error">{d.error}</div>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="cl-rv-foot">
          {isOpen ? (
            d.step === 1 ? <>
              <button key="close" type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>Close</button>
              <span className="eo-foot-r">
                {!d.loading && <button key="rw" type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => write(f.id)}>↻ Rewrite</button>}
                <button key="next" type="button" className="btn btn-primary btn-sm cl-reach" disabled={d.loading || !d.body.trim()}
                  onClick={() => setDraft(f.id, { step: 2, error: null })}>Next: send →</button>
              </span>
            </> : <>
              <button key="back" type="button" className="btn btn-ghost btn-sm" disabled={d.sending} onClick={() => setDraft(f.id, { step: 1 })}>← Back</button>
              <button key="send" type="button" className="btn btn-primary btn-sm cl-reach" disabled={d.sending || locked} onClick={() => send(f)}>
                {d.sending ? <><Spinner />Sending…</> : 'Send follow-up'}
              </button>
            </>
          ) : <>
            <span className="eo-foot-l">
              <button type="button" className="btn btn-link" disabled={busy.has(f.id) || locked} onClick={() => skip(f)} title="They replied some other way, or you'd rather not follow up">Skip</button>
              {snoozeSelect(f)}
            </span>
            <button type="button" className="btn btn-primary btn-sm cl-reach" disabled={busy.has(f.id) || locked || d?.loading}
              onClick={() => startWriting(f.id)}>
              {d?.loading ? <><Spinner />Writing…</> : d?.body ? 'Review draft →' : 'Write follow-up →'}
            </button>
          </>}
        </div>
      </article>
    )
  }

  if (loading) return <div className="ro-working eo-loading"><Spinner /><span>Loading follow-ups…</span><i /></div>

  if (rows.length === 0) {
    return (
      <div className="cl-none">
        <h3>{error ? 'Could not load follow-ups' : 'No follow-ups yet'}</h3>
        <p>{error ?? 'When you send an email with “Follow up if no reply” ticked and they don’t answer, it shows up here with a follow-up ready to write.'}</p>
        {!error && <div className="cl-acts cl-acts--center"><button type="button" className="btn btn-primary" onClick={onNewCampaign}>New campaign</button></div>}
      </div>
    )
  }

  return (
    <div className="eo-fu">
      <div className="cl-scanbar eo-bar">
        <span className="cl-muted">
          {bulkBusy ? <><Spinner />{bulkBusy}</>
            : checking ? <><Spinner />Checking Gmail for replies…</>
            : checkedAt ? `Replies checked at ${checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : 'Replies close a follow-up by themselves'}
        </span>
        <button type="button" className="btn btn-link" disabled={checking || locked} onClick={checkReplies}>Check now</button>
        <span className="cl-grow" />
        {drafted.length > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={panel === 'ai'} disabled={locked} onClick={() => setPanel(p => p === 'ai' ? null : 'ai')}>
            Edit {drafted.length} drafts with AI
          </button>
        )}
        {drafted.length > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={panel === 'send'} disabled={locked} onClick={() => setPanel(p => p === 'send' ? null : 'send')}>
            Send {drafted.length} drafts
          </button>
        )}
        {undrafted.length > 1 && (
          <button type="button" className="btn btn-primary btn-sm" disabled={locked} onClick={writeAll}>Write all {undrafted.length}</button>
        )}
      </div>

      {panel === 'ai' && (
        <div className="eo-panel">
          <textarea rows={2} value={aiInstruction} onChange={e => setAiInstruction(e.target.value)}
            placeholder={'What to change in every draft, e.g. "Shorter and more casual" or "Offer a 15-minute call"'} />
          <div className="eo-panel-row">
            <span className="cl-muted">Changes the {drafted.length} written drafts.</span>
            <span className="eo-foot-r">
              <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => setPanel(null)}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={locked || !aiInstruction.trim()} onClick={aiEditAll}>Apply to {drafted.length}</button>
            </span>
          </div>
        </div>
      )}
      {panel === 'send' && (
        <div className="eo-panel eo-panel-row">
          <span>Send {drafted.length} follow-ups now?</span>
          <span className="eo-foot-r">
            {remindSelect}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel(null)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={locked} onClick={sendAll}>Yes, send {drafted.length}</button>
          </span>
        </div>
      )}

      {due.length > 0
        ? <>{duePg.items.map(card)}<Pager p={duePg} /></>
        : <div className="cl-none"><h3>You’re all caught up</h3><p>Nothing needs a follow-up today.{later.length > 0 && ` The next one is due ${dueLabel(later[0]).text.toLowerCase()}.`}</p></div>}

      {later.length > 0 && (
        <section className="eo-later">
          <button type="button" className="eo-later-toggle" aria-expanded={showLater} onClick={() => setShowLater(s => !s)}>
            Coming up <span className="eo-count">{later.length}</span><span className="cl-grow" />{showLater ? 'Hide' : 'Show'}
          </button>
          {showLater && laterPg.items.map(f => (
            <div key={f.id} className="eo-row">
              <span className="cl-av eo-av-sm" aria-hidden="true">{initials(f.recipient)}</span>
              <span className="eo-row-main"><b>{f.recipient}</b><span className="eo-ellip">{f.subject}</span></span>
              <span className={`eo-due eo-due--${dueLabel(f).tone}`}>{dueLabel(f).text}</span>
              <button type="button" className="btn btn-link" disabled={busy.has(f.id) || locked} onClick={() => skip(f)}>Skip</button>
            </div>
          ))}
          {showLater && <div className="eo-pager-in"><Pager p={laterPg} /></div>}
        </section>
      )}
    </div>
  )
}
