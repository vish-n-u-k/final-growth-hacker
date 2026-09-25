'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'

// Gmail follow-up reminders (created when an email is sent with "Follow up in N days",
// or via the bell icon in the inbox). Lists what is due and lets the user draft + send,
// snooze, or close each one — individually or in bulk.

interface Reminder {
  id: string
  title: string
  description: string | null
  category: string
  intervalDays: number
  nextDueAt: string
  snoozedUntil: string | null
  lastDoneAt: string | null
  enabled: boolean
  createdAt: string
}

interface FollowUp {
  id: string
  recipient: string
  subject: string
  createdAt: string
  dueAt: Date
  snoozed: boolean
}

interface Draft {
  loading: boolean
  sending: boolean
  open: boolean
  error: string | null
  to: string
  subject: string
  body: string
  editingHtml: boolean
  threadId: string | null
  inReplyTo: string | null
}

type Filter = 'due' | 'upcoming' | 'all'

const DAY = 86_400_000
const BATCH = 3

function toFollowUp(r: Reminder): FollowUp {
  const desc = r.description ?? ''
  const snoozeUntil = r.snoozedUntil ? new Date(r.snoozedUntil) : null
  const snoozed = !!snoozeUntil && snoozeUntil.getTime() > Date.now()
  return {
    id:        r.id,
    recipient: r.title.replace(/^Follow up:\s*/i, '').trim(),
    subject:   desc.split('\n')[0].replace(/^Re:\s*/i, '').trim(),
    createdAt: r.createdAt,
    dueAt:     snoozed ? snoozeUntil! : new Date(r.nextDueAt),
    snoozed,
  }
}

function dueLabel(f: FollowUp): { text: string; tone: 'overdue' | 'today' | 'upcoming' | 'snoozed' } {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const dayDiff = Math.floor((f.dueAt.getTime() - startOfToday.getTime()) / DAY)
  if (f.snoozed) return { text: `Snoozed · ${dayDiff <= 1 ? 'tomorrow' : `in ${dayDiff} days`}`, tone: 'snoozed' }
  if (dayDiff < 0) return { text: `Overdue ${-dayDiff} day${dayDiff === -1 ? '' : 's'}`, tone: 'overdue' }
  if (dayDiff === 0) return { text: 'Due today', tone: 'today' }
  if (dayDiff === 1) return { text: 'Tomorrow', tone: 'upcoming' }
  return { text: `In ${dayDiff} days`, tone: 'upcoming' }
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const isDrafted = (d?: Draft) => !!d && !d.loading && !!d.body

export default function FollowUpsTab({ onCountChange }: { onCountChange?: (dueCount: number) => void }) {
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [filter, setFilter]       = useState<Filter>('due')
  const [drafts, setDrafts]       = useState<Record<string, Draft>>({})
  const [busy, setBusy]           = useState<Set<string>>(new Set())
  const [toast, setToast]         = useState<string | null>(null)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [remindAgainDays, setRemindAgainDays] = useState(5)

  // Bulk state
  const [bulkBusy, setBulkBusy]           = useState<string | null>(null)
  const [aiEditOpen, setAiEditOpen]       = useState(false)
  const [aiInstruction, setAiInstruction] = useState('')
  const [sendConfirm, setSendConfirm]     = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/reminders')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { reminders?: Reminder[] }
      const rows = (data.reminders ?? [])
        .filter(r => r.category === 'outreach' && r.enabled && !r.lastDoneAt && r.description?.includes('gmailThreadId:'))
        .map(toFollowUp)
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      setFollowUps(rows)
      const ids = new Set(rows.map(r => r.id))
      setSelected(prev => new Set([...prev].filter(id => ids.has(id))))
      setError(null)
    } catch {
      setError('Could not load follow-ups')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999)
  const isDue = (f: FollowUp) => !f.snoozed && f.dueAt.getTime() <= endOfToday.getTime()
  const dueCount = followUps.filter(isDue).length

  useEffect(() => { onCountChange?.(dueCount) }, [dueCount, onCountChange])

  const visible = followUps.filter(f =>
    filter === 'all' ? true : filter === 'due' ? isDue(f) : !isDue(f),
  )
  const selectedVisible    = visible.filter(f => selected.has(f.id))
  const selectedUndrafted  = selectedVisible.filter(f => !drafts[f.id])
  const selectedDrafted    = selectedVisible.filter(f => isDrafted(drafts[f.id]))
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } as Draft }))
  }

  function discardDraft(id: string) {
    setDrafts(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  function toggleSelected(id: string, on: boolean) {
    setSelected(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n })
  }

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusy(prev => new Set(prev).add(id))
    try { await fn() } finally {
      setBusy(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  async function runInBatches<T>(items: T[], fn: (item: T) => Promise<void>) {
    for (let i = 0; i < items.length; i += BATCH) {
      await Promise.all(items.slice(i, i + BATCH).map(fn))
    }
  }

  // ── Single-item actions ────────────────────────────────────────────────────

  async function draftFollowUp(id: string, open = true) {
    setDrafts(prev => ({ ...prev, [id]: {
      loading: true, sending: false, open, error: null, to: '', subject: '', body: '',
      editingHtml: false, threadId: null, inReplyTo: null,
    } }))
    try {
      const res = await fetch('/api/gmail/draft-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reminderId: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setDraft(id, {
        loading: false, to: data.to ?? '', subject: data.subject ?? '', body: data.body ?? '',
        threadId: data.threadId ?? null, inReplyTo: data.inReplyTo ?? null,
      })
    } catch (e) {
      setDraft(id, { loading: false, open: true, error: e instanceof Error ? e.message : 'Failed to draft follow-up' })
    }
  }

  /** Sends a drafted follow-up. Returns true on success. Does not reload the list. */
  async function sendOne(id: string, d: Draft): Promise<boolean> {
    if (!d.to.trim() || !d.body.trim()) {
      setDraft(id, { open: true, error: 'Add a recipient email before sending' })
      return false
    }
    setDraft(id, { sending: true, error: null })
    try {
      const res = await fetch('/api/gmail/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: d.to, subject: d.subject, body: d.body,
          threadId: d.threadId, inReplyTo: d.inReplyTo,
          followUpDays: remindAgainDays > 0 ? remindAgainDays : undefined,
          source: 'followup',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`)
      await fetch(`/api/reminders/${id}/done`, { method: 'POST' })
      discardDraft(id)
      return true
    } catch (e) {
      setDraft(id, { sending: false, open: true, error: e instanceof Error ? e.message : 'Send failed' })
      return false
    }
  }

  async function sendSingle(id: string) {
    const d = drafts[id]
    if (!d) return
    if (await sendOne(id, d)) {
      flash(remindAgainDays > 0 ? `Follow-up sent. Next check-in in ${remindAgainDays} days.` : 'Follow-up sent.')
      await load()
    }
  }

  async function snoozeIds(ids: string[], days: number) {
    const results = await Promise.all(ids.map(id => fetch(`/api/reminders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snooze: true, snoozeDays: days }),
    }).then(r => r.ok).catch(() => false)))
    return results.filter(Boolean).length
  }

  async function closeIds(ids: string[]) {
    const results = await Promise.all(ids.map(id =>
      fetch(`/api/reminders/${id}/done`, { method: 'POST' }).then(r => r.ok).catch(() => false),
    ))
    ids.forEach(discardDraft)
    return results.filter(Boolean).length
  }

  function snooze(id: string, days: number) {
    return withBusy(id, async () => {
      const ok = await snoozeIds([id], days)
      flash(ok ? `Snoozed for ${days} days` : 'Could not snooze')
      await load()
    })
  }

  function markDone(id: string) {
    return withBusy(id, async () => {
      const ok = await closeIds([id])
      flash(ok ? 'Follow-up closed' : 'Could not update')
      await load()
    })
  }

  // ── Bulk actions ───────────────────────────────────────────────────────────

  async function bulk(label: string, fn: () => Promise<void>) {
    setBulkBusy(label)
    try { await fn() } finally { setBulkBusy(null) }
  }

  function draftMany(ids: string[]) {
    return bulk(`Drafting ${ids.length}…`, async () => {
      await runInBatches(ids, id => draftFollowUp(id, false))
      flash(`Drafted ${ids.length} follow-up${ids.length !== 1 ? 's' : ''}. Review them before sending.`)
    })
  }

  function applyAiEdit() {
    const targets = selectedDrafted.map(f => ({ id: f.id, d: drafts[f.id] }))
    if (!aiInstruction.trim() || targets.length === 0) return
    return bulk(`Editing 0/${targets.length}…`, async () => {
      let failed = 0
      for (let i = 0; i < targets.length; i += BATCH) {
        const batch = targets.slice(i, i + BATCH)
        try {
          const res = await fetch('/api/gmail/followup/refine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instruction: aiInstruction,
              emails: batch.map(t => ({ id: t.id, to: t.d.to, recipient: followUps.find(f => f.id === t.id)?.recipient, currentBody: t.d.body })),
            }),
          })
          if (!res.ok) throw new Error()
          const data = await res.json() as { results?: { id: string; body?: string; error?: string }[] }
          for (const r of data.results ?? []) {
            if (r.body) setDraft(r.id, { body: r.body, editingHtml: false })
            else failed++
          }
        } catch {
          failed += batch.length
        }
        setBulkBusy(`Editing ${Math.min(i + BATCH, targets.length)}/${targets.length}…`)
      }
      flash(failed ? `Edited ${targets.length - failed}, ${failed} failed` : `Edited ${targets.length} follow-up${targets.length !== 1 ? 's' : ''}`)
      setAiEditOpen(false)
    })
  }

  function sendMany() {
    const targets = selectedDrafted.map(f => ({ id: f.id, d: drafts[f.id] }))
    setSendConfirm(false)
    return bulk(`Sending 0/${targets.length}…`, async () => {
      let sent = 0
      for (const [i, t] of targets.entries()) {
        if (await sendOne(t.id, t.d)) sent++
        setBulkBusy(`Sending ${i + 1}/${targets.length}…`)
      }
      const failed = targets.length - sent
      flash(failed ? `Sent ${sent}, ${failed} failed (see the open rows)` : `Sent ${sent} follow-up${sent !== 1 ? 's' : ''}`)
      await load()
    })
  }

  function snoozeMany(days: number) {
    const ids = selectedVisible.map(f => f.id)
    return bulk('Snoozing…', async () => {
      const ok = await snoozeIds(ids, days)
      flash(`Snoozed ${ok} follow-up${ok !== 1 ? 's' : ''} for ${days} days`)
      setSelected(new Set())
      await load()
    })
  }

  function closeMany() {
    const ids = selectedVisible.map(f => f.id)
    return bulk('Closing…', async () => {
      const ok = await closeIds(ids)
      flash(`Closed ${ok} follow-up${ok !== 1 ? 's' : ''}`)
      setSelected(new Set())
      await load()
    })
  }

  if (loading) {
    return (
      <div className="gh-fu">
        <div className="gh-fu-card"><p className="gh-fu-empty">Loading follow-ups…</p></div>
      </div>
    )
  }

  const overdueCount = followUps.filter(f => !f.snoozed && dueLabel(f).tone === 'overdue').length
  const dueUndrafted = followUps.filter(f => isDue(f) && !drafts[f.id])
  const locked = !!bulkBusy

  return (
    <div className="gh-fu">
      {toast && <div className="gh-fu-toast" role="status">{toast}</div>}

      <div className="gh-fu-card">
        <div className="gh-fu-head">
          <div className="gh-fu-head-text">
            <div className="gh-fu-title">
              Follow-ups
              {overdueCount > 0 && <span className="gh-fu-due gh-fu-due-overdue">{overdueCount} overdue</span>}
            </div>
            <p className="gh-fu-sub">
              Emails waiting on a reply. Draft a short, branded nudge that lands in the original Gmail thread,
              edit several at once with AI, then send. Close any that already replied.
            </p>
          </div>
          <div className="gh-fu-filters" role="tablist">
            {([
              ['due',      'Due now',  dueCount],
              ['upcoming', 'Upcoming', followUps.length - dueCount],
              ['all',      'All',      followUps.length],
            ] as [Filter, string, number][]).map(([key, label, count]) => (
              <button
                key={key}
                role="tab"
                aria-selected={filter === key}
                className={`gh-fu-filter${filter === key ? ' active' : ''}`}
                onClick={() => setFilter(key)}
              >
                {label}
                <span className="gh-fu-filter-count">{count}</span>
              </button>
            ))}
          </div>
        </div>

        {error && <div className="gh-fu-error">{error}</div>}

        {visible.length > 0 && (
          <div className="gh-fu-bulk">
            <div className="gh-fu-bulk-row">
              <span className="gh-fu-bulk-label">
                {bulkBusy ?? (selectedVisible.length > 0 ? `${selectedVisible.length} selected` : 'Select rows to act on several at once')}
              </span>
              <div className="gh-fu-bulk-actions">
                {selectedVisible.length === 0 ? (
                  dueUndrafted.length > 0 && (
                    <button
                      className="gh-fu-btn gh-fu-btn-primary"
                      disabled={locked}
                      onClick={() => {
                        setSelected(new Set(dueUndrafted.map(f => f.id)))
                        draftMany(dueUndrafted.map(f => f.id))
                      }}
                    >
                      Draft all due ({dueUndrafted.length})
                    </button>
                  )
                ) : (
                  <>
                    <button
                      className="gh-fu-btn gh-fu-btn-primary"
                      disabled={locked || selectedUndrafted.length === 0}
                      onClick={() => draftMany(selectedUndrafted.map(f => f.id))}
                    >
                      Draft{selectedUndrafted.length ? ` ${selectedUndrafted.length}` : ''}
                    </button>
                    <button
                      className={`gh-fu-btn${aiEditOpen ? ' active' : ''}`}
                      disabled={locked || selectedDrafted.length === 0}
                      onClick={() => { setAiEditOpen(o => !o); setSendConfirm(false) }}
                    >
                      AI edit{selectedDrafted.length ? ` ${selectedDrafted.length}` : ''}
                    </button>
                    <button
                      className="gh-fu-btn gh-fu-btn-send"
                      disabled={locked || selectedDrafted.length === 0}
                      onClick={() => { setSendConfirm(true); setAiEditOpen(false) }}
                    >
                      Send{selectedDrafted.length ? ` ${selectedDrafted.length}` : ''}
                    </button>
                    <select
                      className="gh-fu-btn gh-fu-select"
                      value=""
                      disabled={locked}
                      onChange={e => { const n = Number(e.target.value); if (n) snoozeMany(n) }}
                      aria-label="Snooze selected"
                    >
                      <option value="">Snooze</option>
                      <option value={1}>1 day</option>
                      <option value={3}>3 days</option>
                      <option value={7}>7 days</option>
                    </select>
                    <button className="gh-fu-btn" disabled={locked} onClick={closeMany}>Close</button>
                  </>
                )}
              </div>
            </div>

            {aiEditOpen && selectedDrafted.length > 0 && (
              <div className="gh-fu-panel">
                <textarea
                  className="gh-fu-textarea"
                  rows={2}
                  placeholder={'Describe the change for all selected drafts, e.g. "Shorter and more casual" or "Mention our free audit and add a button to book a call"'}
                  value={aiInstruction}
                  onChange={e => setAiInstruction(e.target.value)}
                />
                <div className="gh-fu-panel-row">
                  <span className="gh-fu-muted">
                    Applies to {selectedDrafted.length} drafted follow-up{selectedDrafted.length !== 1 ? 's' : ''}. Rows without a draft are skipped.
                  </span>
                  <div className="gh-fu-panel-btns">
                    <button className="gh-fu-btn" onClick={() => setAiEditOpen(false)} disabled={locked}>Cancel</button>
                    <button className="gh-fu-btn gh-fu-btn-primary" onClick={applyAiEdit} disabled={locked || !aiInstruction.trim()}>
                      Apply to {selectedDrafted.length}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {sendConfirm && selectedDrafted.length > 0 && (
              <div className="gh-fu-panel gh-fu-panel-row">
                <span>
                  Send {selectedDrafted.length} follow-up{selectedDrafted.length !== 1 ? 's' : ''} now?
                  {selectedUndrafted.length > 0 && <span className="gh-fu-muted"> {selectedUndrafted.length} without a draft will be skipped.</span>}
                </span>
                <div className="gh-fu-panel-btns">
                  <label className="gh-followup-toggle">
                    If no reply, remind me in
                    <select className="gh-followup-days" value={remindAgainDays} onChange={e => setRemindAgainDays(Number(e.target.value))}>
                      <option value={0}>Don&apos;t remind</option>
                      <option value={3}>3 days</option>
                      <option value={5}>5 days</option>
                      <option value={7}>7 days</option>
                    </select>
                  </label>
                  <button className="gh-fu-btn" onClick={() => setSendConfirm(false)}>Cancel</button>
                  <button className="gh-fu-btn gh-fu-btn-send" onClick={sendMany}>Yes, send all</button>
                </div>
              </div>
            )}
          </div>
        )}

        {visible.length === 0 ? (
          <div className="gh-fu-empty">
            <div className="gh-fu-empty-title">
              {followUps.length === 0 ? 'No follow-ups yet' : filter === 'due' ? 'You are all caught up' : 'Nothing here'}
            </div>
            <p>
              {followUps.length === 0
                ? 'Tick "Follow up in N days" when sending a campaign email, or use the bell icon on an inbox thread.'
                : filter === 'due'
                  ? 'No follow-ups are due today. Check Upcoming to see what is next.'
                  : 'No follow-ups match this filter.'}
            </p>
          </div>
        ) : (
          <div className="gh-fu-table-wrap">
            <table className="gh-fu-table">
              <colgroup>
                <col className="gh-fu-col-check" />
                <col className="gh-fu-col-recipient" />
                <col />
                <col className="gh-fu-col-sent" />
                <col className="gh-fu-col-due" />
                <col className="gh-fu-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th className="gh-fu-th-check">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allVisibleSelected}
                      onChange={e => setSelected(e.target.checked ? new Set(visible.map(f => f.id)) : new Set())}
                    />
                  </th>
                  <th>Recipient</th>
                  <th>Original subject</th>
                  <th>Sent</th>
                  <th>Follow up</th>
                  <th className="gh-fu-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(f => {
                  const d = drafts[f.id]
                  const due = dueLabel(f)
                  const isBusy = busy.has(f.id) || locked
                  return (
                    <Fragment key={f.id}>
                      <tr className={`gh-fu-tr${d?.open ? ' open' : ''}${selected.has(f.id) ? ' selected' : ''}`}>
                        <td className="gh-fu-td-check">
                          <input
                            type="checkbox"
                            aria-label={`Select ${f.recipient}`}
                            checked={selected.has(f.id)}
                            onChange={e => toggleSelected(f.id, e.target.checked)}
                          />
                        </td>
                        <td className="gh-fu-recipient" title={f.recipient}>{f.recipient}</td>
                        <td className="gh-fu-subject" title={f.subject || undefined}>
                          {f.subject || <span className="gh-fu-muted">No subject</span>}
                        </td>
                        <td className="gh-fu-muted">{formatDate(f.createdAt)}</td>
                        <td>
                          <span className={`gh-fu-due gh-fu-due-${due.tone}`}>{due.text}</span>
                          <div className="gh-fu-muted gh-fu-due-date">
                            {d?.loading ? 'Drafting…' : isDrafted(d) ? <span className="gh-fu-ready">Draft ready</span> : formatDate(f.dueAt)}
                          </div>
                        </td>
                        <td className="gh-fu-td-actions">
                          <div className="gh-fu-actions">
                            <button
                              className="gh-fu-btn gh-fu-btn-primary"
                              onClick={() => (d ? setDraft(f.id, { open: !d.open }) : draftFollowUp(f.id))}
                              disabled={isBusy || d?.sending}
                            >
                              {!d ? 'Draft follow-up' : d.open ? 'Hide draft' : 'Review draft'}
                            </button>
                            <select
                              className="gh-fu-btn gh-fu-select"
                              value=""
                              disabled={isBusy}
                              onChange={e => { const n = Number(e.target.value); if (n) snooze(f.id, n) }}
                              aria-label="Snooze this follow-up"
                            >
                              <option value="">Snooze</option>
                              <option value={1}>1 day</option>
                              <option value={3}>3 days</option>
                              <option value={7}>7 days</option>
                            </select>
                            <button
                              className="gh-fu-btn"
                              onClick={() => markDone(f.id)}
                              disabled={isBusy}
                              title="They replied, or no follow-up needed"
                            >
                              Close
                            </button>
                          </div>
                        </td>
                      </tr>
                      {d?.open && (
                        <tr className="gh-fu-draft-row">
                          <td colSpan={6} className="gh-fu-draft-cell">
                            {d.loading ? (
                              <div className="gh-fu-drafting">
                                <div className="gh-gen-spinner">
                                  <span className="gh-spinner-dot" /><span className="gh-spinner-dot" /><span className="gh-spinner-dot" />
                                </div>
                                Writing a follow-up from the original thread…
                              </div>
                            ) : (
                              <div className="gh-email-editor">
                                <div className="gh-ee-to-row">
                                  <span className="gh-ee-to-label">To:</span>
                                  <input
                                    className="gh-ee-to-input"
                                    value={d.to}
                                    onChange={e => setDraft(f.id, { to: e.target.value })}
                                    placeholder="recipient@email.com"
                                  />
                                </div>
                                <div className="gh-ee-fields">
                                  <div className="gh-ee-field">
                                    <label className="gh-ee-label">Subject</label>
                                    <input
                                      className="gh-ee-input"
                                      value={d.subject}
                                      onChange={e => setDraft(f.id, { subject: e.target.value })}
                                    />
                                  </div>
                                  <div className="gh-ee-field">
                                    <div className="gh-fu-body-hd">
                                      <label className="gh-ee-label" style={{ marginBottom: 0 }}>Body</label>
                                      <button className="gh-fu-src-btn" onClick={() => setDraft(f.id, { editingHtml: !d.editingHtml })}>
                                        {d.editingHtml ? 'Preview' : 'Source'}
                                      </button>
                                    </div>
                                    {d.editingHtml ? (
                                      <textarea
                                        className="gh-ee-textarea"
                                        rows={11}
                                        style={{ fontFamily: 'monospace', fontSize: 12.5 }}
                                        value={d.body}
                                        onChange={e => setDraft(f.id, { body: e.target.value })}
                                      />
                                    ) : d.body ? (
                                      <div className="gh-ee-preview" dangerouslySetInnerHTML={{ __html: d.body }} />
                                    ) : null}
                                  </div>
                                </div>
                                {d.error && <div className="gh-gen-error">{d.error}</div>}
                                <div className="gh-ee-actions">
                                  <button
                                    className="gh-send-btn"
                                    onClick={() => sendSingle(f.id)}
                                    disabled={d.sending || locked || !d.to.trim() || !d.body.trim()}
                                  >
                                    {d.sending ? 'Sending…' : 'Send follow-up'}
                                  </button>
                                  <label className="gh-followup-toggle">
                                    If no reply, remind me in
                                    <select
                                      className="gh-followup-days"
                                      value={remindAgainDays}
                                      onChange={e => setRemindAgainDays(Number(e.target.value))}
                                    >
                                      <option value={0}>Don&apos;t remind</option>
                                      <option value={3}>3 days</option>
                                      <option value={5}>5 days</option>
                                      <option value={7}>7 days</option>
                                    </select>
                                  </label>
                                  <button className="gh-dc-discard" onClick={() => draftFollowUp(f.id)} disabled={d.sending || locked}>Regenerate</button>
                                  <button className="gh-send-confirm-no" onClick={() => discardDraft(f.id)} disabled={d.sending}>Discard</button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
