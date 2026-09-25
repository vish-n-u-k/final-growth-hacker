'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'

// Gmail follow-up reminders (created when an email is sent with "Follow up in N days",
// or via the bell icon in the inbox). Lists what is due and lets the user draft + send,
// snooze, or close each one.

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
  error: string | null
  to: string
  subject: string
  body: string
  editingHtml: boolean
  nextFollowUpDays: number
}

type Filter = 'due' | 'upcoming' | 'all'

const DAY = 86_400_000

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

export default function FollowUpsTab({ onCountChange }: { onCountChange?: (dueCount: number) => void }) {
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [filter, setFilter]       = useState<Filter>('due')
  const [drafts, setDrafts]       = useState<Record<string, Draft>>({})
  const [busy, setBusy]           = useState<Set<string>>(new Set())
  const [toast, setToast]         = useState<string | null>(null)

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

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } as Draft }))
  }

  function closeDraft(id: string) {
    setDrafts(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusy(prev => new Set(prev).add(id))
    try { await fn() } finally {
      setBusy(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  async function draftFollowUp(id: string) {
    setDrafts(prev => ({ ...prev, [id]: {
      loading: true, sending: false, error: null, to: '', subject: '', body: '', editingHtml: false, nextFollowUpDays: 5,
    } }))
    try {
      const res = await fetch('/api/gmail/draft-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reminderId: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setDraft(id, { loading: false, to: data.to ?? '', subject: data.subject ?? '', body: data.body ?? '' })
    } catch (e) {
      setDraft(id, { loading: false, error: e instanceof Error ? e.message : 'Failed to draft follow-up' })
    }
  }

  async function sendFollowUp(id: string) {
    const d = drafts[id]
    if (!d?.to.trim() || !d.body.trim()) return
    setDraft(id, { sending: true, error: null })
    try {
      const res = await fetch('/api/gmail/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: d.to, subject: d.subject, body: d.body,
          followUpDays: d.nextFollowUpDays > 0 ? d.nextFollowUpDays : undefined,
          source: 'followup',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`)
      await fetch(`/api/reminders/${id}/done`, { method: 'POST' })
      closeDraft(id)
      flash(d.nextFollowUpDays > 0
        ? `Follow-up sent. Next check-in in ${d.nextFollowUpDays} days.`
        : 'Follow-up sent.')
      await load()
    } catch (e) {
      setDraft(id, { sending: false, error: e instanceof Error ? e.message : 'Send failed' })
    }
  }

  function snooze(id: string, days: number) {
    return withBusy(id, async () => {
      const res = await fetch(`/api/reminders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snooze: true, snoozeDays: days }),
      })
      if (!res.ok) { flash('Could not snooze'); return }
      flash(`Snoozed for ${days} days`)
      await load()
    })
  }

  function markDone(id: string) {
    return withBusy(id, async () => {
      const res = await fetch(`/api/reminders/${id}/done`, { method: 'POST' })
      if (!res.ok) { flash('Could not update'); return }
      closeDraft(id)
      flash('Follow-up closed')
      await load()
    })
  }

  if (loading) {
    return <div className="gh-fu"><p className="gh-fu-empty">Loading follow-ups…</p></div>
  }

  return (
    <div className="gh-fu">
      {toast && <div className="gh-fu-toast">{toast}</div>}

      <div className="gh-fu-head">
        <div>
          <div className="gh-fu-title">Follow-ups</div>
          <p className="gh-fu-sub">
            Emails you asked to follow up on. When one is due, draft a short nudge and send it, snooze it,
            or close it if they replied. Due follow-ups also appear in your morning email.
          </p>
        </div>
        <div className="gh-fu-filters">
          {([
            ['due',      `Due now (${dueCount})`],
            ['upcoming', `Upcoming (${followUps.length - dueCount})`],
            ['all',      `All (${followUps.length})`],
          ] as [Filter, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`gh-fu-filter${filter === key ? ' active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="gh-gen-error">{error}</div>}

      {visible.length === 0 ? (
        <p className="gh-fu-empty">
          {followUps.length === 0
            ? 'No follow-ups yet. Send a campaign email with "Follow up in N days" ticked, or use the bell icon on an inbox thread.'
            : filter === 'due' ? 'Nothing due right now.' : 'Nothing here.'}
        </p>
      ) : (
        <table className="gh-cmp-table gh-fu-table">
          <thead>
            <tr>
              <th className="gh-cmp-th">Recipient</th>
              <th className="gh-cmp-th">Original subject</th>
              <th className="gh-cmp-th">Sent</th>
              <th className="gh-cmp-th">Follow up</th>
              <th className="gh-cmp-th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(f => {
              const d = drafts[f.id]
              const due = dueLabel(f)
              const isBusy = busy.has(f.id)
              return (
                <Fragment key={f.id}>
                  <tr className={`gh-cmp-tr${d ? ' expanded' : ''}`}>
                    <td className="gh-cmp-td gh-cmp-td-email">{f.recipient}</td>
                    <td className="gh-cmp-td">{f.subject || <span className="gh-cmp-td-empty">—</span>}</td>
                    <td className="gh-cmp-td gh-fu-date">{formatDate(f.createdAt)}</td>
                    <td className="gh-cmp-td">
                      <span className={`gh-fu-due gh-fu-due-${due.tone}`}>{due.text}</span>
                      <div className="gh-fu-date">{formatDate(f.dueAt)}</div>
                    </td>
                    <td className="gh-cmp-td gh-cmp-td-action">
                      <div className="gh-fu-actions">
                        {!d && (
                          <button className="gh-cmp-gen-btn" onClick={() => draftFollowUp(f.id)} disabled={isBusy}>
                            Draft follow-up
                          </button>
                        )}
                        <select
                          className="gh-fu-select"
                          value=""
                          disabled={isBusy}
                          onChange={e => { const n = Number(e.target.value); if (n) snooze(f.id, n) }}
                          title="Push this follow-up back"
                        >
                          <option value="">Snooze…</option>
                          <option value={1}>1 day</option>
                          <option value={3}>3 days</option>
                          <option value={7}>7 days</option>
                        </select>
                        <button
                          className="gh-cmp-view-btn"
                          onClick={() => markDone(f.id)}
                          disabled={isBusy}
                          title="They replied, or no follow-up needed"
                        >
                          Close
                        </button>
                      </div>
                    </td>
                  </tr>
                  {d && (
                    <tr>
                      <td colSpan={5} className="gh-cmp-td-expanded">
                        {d.loading ? (
                          <div className="gh-gen-spinner">
                            <span className="gh-spinner-dot" /><span className="gh-spinner-dot" /><span className="gh-spinner-dot" />
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
                                    rows={8}
                                    style={{ fontFamily: 'monospace', fontSize: 12.5 }}
                                    value={d.body}
                                    onChange={e => setDraft(f.id, { body: e.target.value })}
                                  />
                                ) : (
                                  <div className="gh-ee-preview" dangerouslySetInnerHTML={{ __html: d.body }} />
                                )}
                              </div>
                            </div>
                            {d.error && <div className="gh-gen-error">{d.error}</div>}
                            <div className="gh-ee-actions">
                              <button
                                className="gh-send-btn"
                                onClick={() => sendFollowUp(f.id)}
                                disabled={d.sending || !d.to.trim() || !d.body.trim()}
                              >
                                {d.sending ? 'Sending…' : 'Send follow-up'}
                              </button>
                              <label className="gh-followup-toggle">
                                If no reply, remind me again in
                                <select
                                  className="gh-followup-days"
                                  value={d.nextFollowUpDays}
                                  onChange={e => setDraft(f.id, { nextFollowUpDays: Number(e.target.value) })}
                                >
                                  <option value={0}>Don&apos;t remind</option>
                                  <option value={3}>3 days</option>
                                  <option value={5}>5 days</option>
                                  <option value={7}>7 days</option>
                                </select>
                              </label>
                              <button className="gh-dc-discard" onClick={() => draftFollowUp(f.id)} disabled={d.sending}>Regenerate</button>
                              <button className="gh-send-confirm-no" onClick={() => closeDraft(f.id)} disabled={d.sending}>Cancel</button>
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
      )}
    </div>
  )
}
