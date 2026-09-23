'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'
import type { ReminderSuggestion } from '@/app/api/reminders/suggest/route'

type ReminderCategory = 'marketplace' | 'app-store' | 'directory' | 'profile' | 'custom'

interface Reminder {
  id: string
  title: string
  description: string | null
  category: string
  intervalDays: number
  lastDoneAt: string | null
  nextDueAt: string
  snoozedUntil: string | null
  enabled: boolean
  isPreset: boolean
  createdAt: string | null
}

interface DraftState {
  open: boolean
  loading: boolean
  to: string
  subject: string
  body: string       // HTML — source of truth for sending
  editingHtml: boolean
  sending: boolean
  error: string | null
}

interface BrandProfile {
  name: string
  websiteType: string | null
  industry: string | null
  targetAudience: string | null
}

const CAT_CLASS: Record<string, string> = {
  marketplace: 'rm-cat-marketplace',
  'app-store': 'rm-cat-appstore',
  directory:   'rm-cat-directory',
  profile:     'rm-cat-profile',
  outreach:    'rm-cat-outreach',
  custom:      'rm-cat-custom',
}

const CATEGORIES: ReminderCategory[] = ['marketplace', 'app-store', 'directory', 'profile', 'custom']

function daysUntil(isoDate: string): number {
  return Math.round((new Date(isoDate).getTime() - Date.now()) / 86400000)
}

function isSnoozed(r: Reminder): boolean {
  return !!r.snoozedUntil && new Date(r.snoozedUntil).getTime() > Date.now()
}

function groupReminders(list: Reminder[]) {
  const byDate = (a: Reminder, b: Reminder) => new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime()
  const active = list.filter(r => r.enabled && !isSnoozed(r))
  return {
    overdue:  active.filter(r => daysUntil(r.nextDueAt) < 0).sort(byDate),
    thisWeek: active.filter(r => { const d = daysUntil(r.nextDueAt); return d >= 0 && d <= 7 }).sort(byDate),
    upcoming: active.filter(r => daysUntil(r.nextDueAt) > 7).sort(byDate),
    snoozed:  list.filter(r => r.enabled && isSnoozed(r)).sort(byDate),
    disabled: list.filter(r => !r.enabled),
  }
}

export default function RemindersPage({
  initialReminders,
  brandProfile,
}: {
  initialReminders: Reminder[]
  brandProfile: BrandProfile
}) {
  const router = useRouter()
  const [reminders, setReminders] = useState<Reminder[]>(initialReminders)
  const [loading, setLoading] = useState(false)
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ title: '', category: 'custom' as ReminderCategory, intervalDays: '30' })
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: '', description: '', intervalDays: '30' })

  // AI suggestions state
  const [suggestions, setSuggestions] = useState<ReminderSuggestion[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [addingIds, setAddingIds] = useState<Set<number>>(new Set())
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set())

  // Outreach follow-up compose state
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})

  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenu])

  useEffect(() => {
    if (sessionStorage.getItem('reminders_suggested')) return
    sessionStorage.setItem('reminders_suggested', '1')
    fetchSuggestions()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function reload() {
    const res = await fetch('/api/reminders')
    if (res.ok) setReminders((await res.json()).reminders)
  }

  async function markDone(id: string) {
    setDoneIds(s => new Set(s).add(id))
    await fetch(`/api/reminders/${id}/done`, { method: 'POST' })
    await reload()
    setDoneIds(s => { const n = new Set(s); n.delete(id); return n })
  }

  async function snooze(id: string) {
    setOpenMenu(null)
    await fetch(`/api/reminders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snooze: true }) })
    await reload()
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    setOpenMenu(null)
    await fetch(`/api/reminders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
    await reload()
  }

  async function deleteReminder(id: string) {
    setOpenMenu(null)
    if (!confirm('Delete this reminder?')) return
    await fetch(`/api/reminders/${id}`, { method: 'DELETE' })
    await reload()
  }

  async function addReminder() {
    if (!addForm.title.trim()) return
    setLoading(true)
    await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: addForm.title, category: addForm.category, intervalDays: parseInt(addForm.intervalDays, 10) }),
    })
    setAddForm({ title: '', category: 'custom', intervalDays: '30' })
    setShowAdd(false)
    setLoading(false)
    await reload()
  }

  async function saveEdit(id: string) {
    await fetch(`/api/reminders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editForm.title, intervalDays: parseInt(editForm.intervalDays, 10) }),
    })
    setEditId(null)
    await reload()
  }

  async function reseed() {
    setLoading(true)
    await fetch('/api/reminders/seed', { method: 'POST' })
    await reload()
    setLoading(false)
  }

  async function fetchSuggestions() {
    setSuggestLoading(true)
    setSuggestError(null)
    setSuggestions([])
    setAddedIds(new Set())
    try {
      const res = await fetch('/api/reminders/suggest', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`)
      setSuggestions(data.suggestions ?? [])
    } catch {
      setSuggestError('Could not generate suggestions. Try again.')
    } finally {
      setSuggestLoading(false)
    }
  }

  async function addSuggestion(s: ReminderSuggestion, idx: number) {
    setAddingIds(prev => new Set(prev).add(idx))
    await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: s.title, category: s.category, intervalDays: s.intervalDays }),
    })
    setAddingIds(prev => { const n = new Set(prev); n.delete(idx); return n })
    setAddedIds(prev => new Set(prev).add(idx))
    await reload()
  }

  function setDraft(id: string, patch: Partial<DraftState>) {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } as DraftState }))
  }

  async function draftFollowup(id: string) {
    setDraft(id, { open: true, loading: true, error: null, to: '', subject: '', body: '', editingHtml: false, sending: false })
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
      setDraft(id, { loading: false, error: e instanceof Error ? e.message : 'Failed to generate draft' })
    }
  }

  async function sendFollowup(id: string) {
    const d = drafts[id]
    if (!d || !d.body.trim()) return
    setDraft(id, { sending: true, error: null })
    try {
      const res = await fetch('/api/gmail/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: d.to, subject: d.subject, body: d.body, followUpDays: 5 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`)
      await markDone(id)
      setDrafts(prev => { const n = { ...prev }; delete n[id]; return n })
    } catch (e) {
      setDraft(id, { sending: false, error: e instanceof Error ? e.message : 'Send failed' })
    }
  }

  const groups = groupReminders(reminders)
  const totalActive = groups.overdue.length + groups.thisWeek.length + groups.upcoming.length
  const showSuggestPanel = suggestLoading || suggestions.length > 0 || suggestError !== null

  // ── Card ──────────────────────────────────────────────────────────────────

  function ReminderCard({ r }: { r: Reminder }) {
    const days = daysUntil(r.nextDueAt)
    const isEditing = editId === r.id
    const isDoing = doneIds.has(r.id)
    const draft = drafts[r.id]

    if (isEditing) {
      return (
        <div className="rm-card rm-card-editing">
          <input className="rm-input" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} placeholder="Title" autoFocus />
          <div className="rm-edit-row" style={{ marginTop: 10 }}>
            <span className="rm-edit-label">Repeat every</span>
            <input type="number" min="1" className="rm-input rm-input-num" value={editForm.intervalDays} onChange={e => setEditForm(f => ({ ...f, intervalDays: e.target.value }))} />
            <span className="rm-edit-label">days</span>
          </div>
          <div className="rm-edit-actions">
            <button className="rm-btn-primary" onClick={() => saveEdit(r.id)}>Save</button>
            <button className="rm-btn-ghost" onClick={() => setEditId(null)}>Cancel</button>
          </div>
        </div>
      )
    }

    // ── Outreach card ────────────────────────────────────────────────────────

    if (r.category === 'outreach') {
      const recipient = r.title.replace(/^Follow up:\s*/i, '').trim()
      const desc = r.description ?? ''
      const subject = desc.split('\n')[0].replace(/^Re:\s*/i, '').trim()
      const daysSince = r.createdAt
        ? Math.max(1, Math.round((Date.now() - new Date(r.createdAt).getTime()) / 86400000))
        : r.intervalDays

      return (
        <div className={`rm-card rm-card-outreach${days < 0 ? ' rm-card-overdue' : days <= 2 ? ' rm-card-urgent' : days <= 7 ? ' rm-card-soon' : ''}`}>
          {/* Top row: due badge + kebab menu */}
          <div className="rm-card-row" style={{ paddingBottom: 8 }}>
            <span className={`rm-cat-badge ${CAT_CLASS['outreach']}`}>outreach</span>
            <div className="rm-card-right" style={{ marginLeft: 'auto' }}>
              {days < 0
                ? <span className="rm-due rm-due-overdue">{Math.abs(days)}d overdue</span>
                : days === 0
                  ? <span className="rm-due rm-due-today">today</span>
                  : days <= 2
                    ? <span className="rm-due rm-due-urgent">in {days}d</span>
                    : <span className="rm-due">in {days}d</span>
              }
              <div className="rm-menu-wrap">
                <button className="rm-kebab" onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === r.id ? null : r.id) }}>&#8942;</button>
                {openMenu === r.id && (
                  <div className="rm-menu" onClick={e => e.stopPropagation()}>
                    <button onClick={() => { setEditId(r.id); setEditForm({ title: r.title, description: r.description ?? '', intervalDays: String(r.intervalDays) }); setOpenMenu(null) }}>Edit</button>
                    <button onClick={() => snooze(r.id)}>Snooze 7 days</button>
                    <button onClick={() => toggleEnabled(r.id, !r.enabled)}>{r.enabled ? 'Disable' : 'Enable'}</button>
                    <button className="rm-menu-delete" onClick={() => deleteReminder(r.id)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recipient + subject info */}
          <div className="rm-outreach-meta">
            <span className="rm-outreach-recipient">{recipient}</span>
            {subject && <span className="rm-outreach-subject">{subject}</span>}
            <span className="rm-outreach-days">Sent {daysSince} day{daysSince !== 1 ? 's' : ''} ago · no reply</span>
          </div>

          {/* Action buttons */}
          <div className="rm-outreach-actions">
            <button
              className="rm-btn-draft-followup"
              onClick={() => draftFollowup(r.id)}
              disabled={draft?.loading || draft?.sending || isDoing}
            >
              {draft?.loading ? 'Drafting…' : 'Draft Follow-Up'}
            </button>
            <button
              className="rm-btn-got-reply"
              onClick={() => markDone(r.id)}
              disabled={isDoing || draft?.sending}
            >
              {isDoing ? '…' : 'Got a reply'}
            </button>
          </div>

          {/* Inline compose panel */}
          {draft?.open && (
            <div className="rm-compose">
              {draft.loading && (
                <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>Generating draft…</span>
              )}
              {!draft.loading && (
                <>
                  <div className="rm-compose-field">
                    <label className="rm-compose-label">To</label>
                    <input
                      className="rm-compose-input"
                      value={draft.to}
                      onChange={e => setDraft(r.id, { to: e.target.value })}
                      placeholder="recipient@example.com"
                    />
                  </div>
                  <div className="rm-compose-field">
                    <label className="rm-compose-label">Subject</label>
                    <input
                      className="rm-compose-input"
                      value={draft.subject}
                      onChange={e => setDraft(r.id, { subject: e.target.value })}
                      placeholder="Re: …"
                    />
                  </div>
                  <div className="rm-compose-field">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label className="rm-compose-label" style={{ marginBottom: 0 }}>Body</label>
                      <button
                        style={{ fontSize: 10.5, color: 'var(--text-faint)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 9px', cursor: 'pointer', fontFamily: 'inherit' }}
                        onClick={() => setDraft(r.id, { editingHtml: !draft.editingHtml })}
                      >
                        {draft.editingHtml ? 'Preview' : 'Source'}
                      </button>
                    </div>
                    {draft.editingHtml ? (
                      <textarea
                        className="rm-compose-textarea"
                        value={draft.body}
                        onChange={e => setDraft(r.id, { body: e.target.value })}
                        style={{ fontFamily: 'monospace', fontSize: 12.5, minHeight: 120 }}
                      />
                    ) : (
                      <div
                        className="rm-compose-preview"
                        dangerouslySetInnerHTML={{ __html: draft.body }}
                      />
                    )}
                  </div>
                  <div className="rm-compose-actions">
                    <button
                      className="rm-btn-send-followup"
                      onClick={() => sendFollowup(r.id)}
                      disabled={draft.sending || !draft.to.trim() || !draft.body.trim()}
                    >
                      {draft.sending ? 'Sending…' : 'Send'}
                    </button>
                    <button
                      className="rm-btn-ghost"
                      style={{ height: 32, fontSize: 13 }}
                      onClick={() => { markDone(r.id); setDrafts(prev => { const n = { ...prev }; delete n[r.id]; return n }) }}
                      disabled={draft.sending || isDoing}
                    >
                      Mark done, don't send
                    </button>
                    <button
                      className="rm-btn-ghost"
                      style={{ height: 32, fontSize: 13 }}
                      onClick={() => setDrafts(prev => { const n = { ...prev }; delete n[r.id]; return n })}
                      disabled={draft.sending}
                    >
                      Cancel
                    </button>
                    {draft.error && <span className="rm-compose-error">{draft.error}</span>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )
    }

    // ── Standard card ────────────────────────────────────────────────────────

    return (
      <div className={`rm-card${days < 0 ? ' rm-card-overdue' : days <= 2 ? ' rm-card-urgent' : days <= 7 ? ' rm-card-soon' : ''}`}>
        <div className="rm-card-row">
          <button
            className={`rm-check${isDoing ? ' rm-check-spinning' : ''}`}
            onClick={() => markDone(r.id)}
            title="Mark as done"
            disabled={isDoing}
          >
            {isDoing
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polyline points="20 6 9 17 4 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          </button>

          <span className="rm-card-title">{r.title}</span>
          <span className={`rm-cat-badge ${CAT_CLASS[r.category] ?? 'rm-cat-custom'}`}>{r.category}</span>
          <span className="rm-card-meta">{r.intervalDays}d</span>

          <div className="rm-card-right">
            {days < 0
              ? <span className="rm-due rm-due-overdue">{Math.abs(days)}d overdue</span>
              : days === 0
                ? <span className="rm-due rm-due-today">today</span>
                : days <= 2
                  ? <span className="rm-due rm-due-urgent">in {days}d</span>
                  : <span className="rm-due">in {days}d</span>
            }
            <div className="rm-menu-wrap">
              <button className="rm-kebab" onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === r.id ? null : r.id) }}>&#8942;</button>
              {openMenu === r.id && (
                <div className="rm-menu" onClick={e => e.stopPropagation()}>
                  <button onClick={() => { setEditId(r.id); setEditForm({ title: r.title, description: r.description ?? '', intervalDays: String(r.intervalDays) }); setOpenMenu(null) }}>Edit</button>
                  <button onClick={() => snooze(r.id)}>Snooze 7 days</button>
                  <button onClick={() => toggleEnabled(r.id, !r.enabled)}>{r.enabled ? 'Disable' : 'Enable'}</button>
                  <button className="rm-menu-delete" onClick={() => deleteReminder(r.id)}>Delete</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Section ───────────────────────────────────────────────────────────────

  function Section({ title, accent, items }: { title: string; accent?: string; items: Reminder[] }) {
    if (items.length === 0) return null
    return (
      <div className="rm-section">
        <div className="rm-section-hd">
          {accent && <span className="rm-section-dot" style={{ background: accent }} />}
          {title}
          <span className="rm-section-count">{items.length}</span>
        </div>
        <div className="rm-section-body">
          {items.map(r => <ReminderCard key={r.id} r={r} />)}
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <header>
        <div className="md-header-inner">
          <div className="logo" style={{ cursor: 'pointer' }} onClick={() => router.push('/dashboard')}>
            <span className="mark"><img src="/growjinlogo.svg" alt="" /></span>
            GrowJin
          </div>
          <div className="md-header-actions">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="wrap">
        {/* Page header */}
        <div className="st-page-hd" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <button
              onClick={() => router.push('/dashboard')}
              title="Back to dashboard"
              style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--text)', cursor: 'pointer', flexShrink: 0, marginTop: 4 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div>
              <h1 className="st-page-title">Reminders</h1>
              <p className="st-page-sub">
                {brandProfile.name}
                {brandProfile.industry ? ` · ${brandProfile.industry}` : ''}
                {brandProfile.websiteType ? ` · ${brandProfile.websiteType}` : ''}
                {totalActive > 0 ? ` · ${totalActive} active` : ''}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 6 }}>
            <button className="rm-btn-ghost" onClick={reseed} disabled={loading}>Reset presets</button>
            <button
              className="rm-btn-suggest"
              onClick={() => { sessionStorage.removeItem('reminders_suggested'); fetchSuggestions() }}
              disabled={suggestLoading}
            >
              {suggestLoading
                ? <><span className="rm-suggest-spinner" />Thinking…</>
                : <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    Suggest for {brandProfile.name}
                  </>
              }
            </button>
            <button className="rm-btn-primary" onClick={() => setShowAdd(true)}>+ Add</button>
          </div>
        </div>

        <div style={{ paddingTop: 28, paddingBottom: 80 }}>

          {/* AI Suggestions panel */}
          {showSuggestPanel && (
            <div className="rm-suggest-panel">
              <div className="rm-suggest-panel-hd">
                <div>
                  <span className="rm-suggest-panel-title">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    AI suggestions for {brandProfile.name}
                  </span>
                  {brandProfile.industry && <span className="rm-suggest-panel-sub">{brandProfile.industry}{brandProfile.websiteType ? ` · ${brandProfile.websiteType}` : ''}</span>}
                </div>
                <button className="rm-modal-close" onClick={() => { setSuggestions([]); setSuggestError(null) }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                </button>
              </div>

              {suggestLoading && (
                <div className="rm-suggest-loading">
                  <span className="rm-suggest-spinner rm-suggest-spinner-lg" />
                  <span>Analysing your brand profile…</span>
                </div>
              )}

              {suggestError && (
                <div className="rm-suggest-error">{suggestError}</div>
              )}

              {suggestions.length > 0 && (
                <div className="rm-suggest-list">
                  {suggestions.map((s, idx) => {
                    const added = addedIds.has(idx)
                    const adding = addingIds.has(idx)
                    return (
                      <div key={idx} className={`rm-suggest-card${added ? ' rm-suggest-card-added' : ''}`}>
                        <span className="rm-suggest-card-title">{s.title}</span>
                        <span className={`rm-cat-badge ${CAT_CLASS[s.category] ?? 'rm-cat-custom'}`}>{s.category}</span>
                        <span className="rm-suggest-card-meta">{s.intervalDays}d</span>
                        <div className="rm-suggest-actions">
                          {added
                            ? <span className="rm-suggest-yes rm-suggest-yes-done">Added</span>
                            : <>
                                <button
                                  className="rm-suggest-yes"
                                  onClick={() => !adding && addSuggestion(s, idx)}
                                  disabled={adding}
                                >
                                  {adding ? '…' : 'Yes'}
                                </button>
                                <button
                                  className="rm-suggest-no"
                                  onClick={() => setSuggestions(prev => prev.filter((_, i) => i !== idx))}
                                >
                                  No
                                </button>
                              </>
                          }
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {reminders.length === 0 && !showSuggestPanel && (
            <div className="rm-empty-state">
              <div className="rm-empty-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
              </div>
              <p className="rm-empty-title">No reminders yet</p>
              <p className="rm-empty-sub">Let AI suggest personalized reminders based on your brand, or add your own.</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="rm-btn-suggest" onClick={fetchSuggestions}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  Suggest for {brandProfile.name}
                </button>
                <button className="rm-btn-ghost" onClick={reseed}>Use presets</button>
              </div>
            </div>
          )}

          <Section title="Overdue" accent="#dc2626" items={groups.overdue} />
          <Section title="Due this week" accent="#d97706" items={groups.thisWeek} />
          <Section title="Upcoming" items={groups.upcoming} />
          <Section title="Snoozed" items={groups.snoozed} />
          <Section title="Disabled" items={groups.disabled} />
        </div>
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="rm-overlay" onClick={() => setShowAdd(false)}>
          <div className="rm-modal" onClick={e => e.stopPropagation()}>
            <div className="rm-modal-hd">
              <span>New reminder</span>
              <button className="rm-modal-close" onClick={() => setShowAdd(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="rm-field">
              <label className="rm-label">Title</label>
              <input className="rm-input" value={addForm.title} onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Update Etsy listings" autoFocus />
            </div>
            <div className="rm-field-row">
              <div className="rm-field" style={{ flex: 1 }}>
                <label className="rm-label">Category</label>
                <select className="rm-input rm-select" value={addForm.category} onChange={e => setAddForm(f => ({ ...f, category: e.target.value as ReminderCategory }))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="rm-field" style={{ width: 120 }}>
                <label className="rm-label">Every (days)</label>
                <input type="number" min="1" className="rm-input" value={addForm.intervalDays} onChange={e => setAddForm(f => ({ ...f, intervalDays: e.target.value }))} />
              </div>
            </div>
            <div className="rm-modal-actions">
              <button className="rm-btn-primary" onClick={addReminder} disabled={loading || !addForm.title.trim()}>Add reminder</button>
              <button className="rm-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
