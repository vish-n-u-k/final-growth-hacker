'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSmartBack } from '@/lib/useSmartBack'
import ThemeToggle from '@/components/ThemeToggle'
import { connectUrl } from '@/lib/integrations/connect-url'
import { REMINDER_CATEGORIES, type ReminderCategory, type ReminderPreset } from '@/lib/reminders/presets'
import { Spinner } from '@/components/ui/spinner'

interface Reminder {
  id: string
  title: string
  description: string | null
  category: string
  url: string | null
  intervalDays: number
  lastDoneAt: string | null
  nextDueAt: string
  snoozedUntil: string | null
  enabled: boolean
  isPreset: boolean
  createdAt: string | null
}

// An open signal: something changed in the brand's data (lib/signals)
interface Change {
  id: string
  source: string
  title: string
  detail: string | null
  action: string | null
  priority: number
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

const CATEGORIES = REMINDER_CATEGORIES

// Whole days until the date: due later today → 0, due an hour ago → -1 (overdue)
function daysUntil(isoDate: string): number {
  return Math.floor((new Date(isoDate).getTime() - Date.now()) / 86400000)
}

function isSnoozed(r: Reminder): boolean {
  return !!r.snoozedUntil && new Date(r.snoozedUntil).getTime() > Date.now()
}

function groupReminders(list: Reminder[]) {
  const byDate = (a: Reminder, b: Reminder) => new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime()
  const followups = list.filter(r => r.category === 'outreach')
  const checks = list.filter(r => r.category !== 'outreach')
  const active = checks.filter(r => r.enabled && !isSnoozed(r))
  return {
    followups: followups.filter(r => r.enabled && !isSnoozed(r)).sort(byDate),
    overdue:  active.filter(r => daysUntil(r.nextDueAt) < 0).sort(byDate),
    thisWeek: active.filter(r => { const d = daysUntil(r.nextDueAt); return d >= 0 && d <= 7 }).sort(byDate),
    upcoming: active.filter(r => daysUntil(r.nextDueAt) > 7).sort(byDate),
    snoozed:  list.filter(r => r.enabled && isSnoozed(r)).sort(byDate),
    disabled: list.filter(r => !r.enabled && !(r.category === 'outreach')),
  }
}

export default function RemindersPage({
  initialReminders,
  initialChanges,
  commonChecks,
  searchConnected,
  brandProfile,
}: {
  initialReminders: Reminder[]
  initialChanges: Change[]
  commonChecks: ReminderPreset[]
  searchConnected: boolean
  brandProfile: BrandProfile
}) {
  const router = useRouter()
  const goBack = useSmartBack('/dashboard')
  const [reminders, setReminders] = useState<Reminder[]>(initialReminders)
  const [changes, setChanges] = useState<Change[]>(initialChanges)
  const [resolving, setResolving] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ title: '', category: 'custom' as ReminderCategory, intervalDays: '30', url: '' })
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: '', description: '', intervalDays: '30', url: '' })
  const [addingCheck, setAddingCheck] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // Outreach follow-up compose state
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})

  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenu])

  // Coming back from the daily email's "Mark done" confirm page
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const done = params.get('done')
    if (!done) return
    setToast(done === '1' ? { kind: 'ok', text: 'Reminder marked done.' } : { kind: 'error', text: 'That link has expired. Mark it done here instead.' })
    params.delete('done')
    const qs = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  // Every write goes through here so a failed request is shown, not silently ignored
  async function call(url: string, init: RequestInit, failText: string): Promise<boolean> {
    try {
      const res = await fetch(url, init)
      if (res.ok) return true
      const data = await res.json().catch(() => ({}))
      setToast({ kind: 'error', text: data?.upgrade ? 'This needs GrowJin Pro.' : `${failText}${data?.error ? `: ${data.error}` : ''}` })
    } catch {
      setToast({ kind: 'error', text: `${failText}: check your connection.` })
    }
    return false
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  async function reload() {
    const res = await fetch('/api/reminders').catch(() => null)
    if (res?.ok) setReminders((await res.json()).reminders)
  }

  async function markDone(id: string) {
    setDoneIds(s => new Set(s).add(id))
    await call(`/api/reminders/${id}/done`, { method: 'POST' }, 'Could not mark it done')
    await reload()
    setDoneIds(s => { const n = new Set(s); n.delete(id); return n })
  }

  async function snooze(id: string) {
    setOpenMenu(null)
    await call(`/api/reminders/${id}`, json('PATCH', { snooze: true }), 'Could not snooze')
    await reload()
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    setOpenMenu(null)
    await call(`/api/reminders/${id}`, json('PATCH', { enabled }), enabled ? 'Could not enable' : 'Could not disable')
    await reload()
  }

  async function deleteReminder(id: string) {
    setOpenMenu(null)
    if (!confirm('Delete this reminder?')) return
    await call(`/api/reminders/${id}`, { method: 'DELETE' }, 'Could not delete')
    await reload()
  }

  async function addReminder() {
    if (!addForm.title.trim()) return
    setLoading(true)
    const ok = await call('/api/reminders', json('POST', {
      title: addForm.title,
      category: addForm.category,
      intervalDays: parseInt(addForm.intervalDays, 10),
      url: addForm.url,
    }), 'Could not add the reminder')
    setLoading(false)
    if (!ok) return
    setAddForm({ title: '', category: 'custom', intervalDays: '30', url: '' })
    setShowAdd(false)
    await reload()
  }

  async function addCommonCheck(p: ReminderPreset) {
    setAddingCheck(p.title)
    await call('/api/reminders', json('POST', { ...p, isPreset: true }), 'Could not add the check')
    await reload()
    setAddingCheck(null)
  }

  async function saveEdit(id: string) {
    const ok = await call(`/api/reminders/${id}`, json('PATCH', {
      title: editForm.title,
      intervalDays: parseInt(editForm.intervalDays, 10),
      url: editForm.url,
    }), 'Could not save')
    if (!ok) return
    setEditId(null)
    await reload()
  }

  function startEdit(r: Reminder) {
    setEditId(r.id)
    setEditForm({ title: r.title, description: r.description ?? '', intervalDays: String(r.intervalDays), url: r.url ?? '' })
    setOpenMenu(null)
  }

  // Signals are resolved like Today's alerts (same endpoint, same effect)
  async function resolveChange(id: string, status: 'done' | 'dismissed') {
    setResolving(s => new Set(s).add(id))
    const ok = await call('/api/today/complete', json('POST', { kind: 'alert', id, status }), 'Could not update')
    setResolving(s => { const n = new Set(s); n.delete(id); return n })
    if (ok) setChanges(prev => prev.filter(c => c.id !== id))
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
  const existingTitles = new Set(reminders.map(r => r.title.toLowerCase()))
  const availableChecks = commonChecks.filter(p => !existingTitles.has(p.title.toLowerCase()))

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
          {r.category !== 'outreach' && (
            <input className="rm-input" style={{ marginTop: 10 }} value={editForm.url} onChange={e => setEditForm(f => ({ ...f, url: e.target.value }))} placeholder="Link to the listing or profile (optional)" />
          )}
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
                    <button onClick={() => startEdit(r)}>Edit</button>
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
              {draft?.loading ? <><Spinner />Drafting…</> : 'Draft Follow-Up'}
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
                <span style={{ fontSize: 13, color: 'var(--text-faint)' }}><Spinner />Generating draft…</span>
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
                      {draft.sending ? <><Spinner />Sending…</> : 'Send'}
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
          {r.url && (
            <a className="rm-card-link" href={r.url} target="_blank" rel="noopener noreferrer" title={r.url}>Open ↗</a>
          )}
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
                  <button onClick={() => startEdit(r)}>Edit</button>
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

  // ── Change card (open signal) ─────────────────────────────────────────────

  function ChangeCard({ c }: { c: Change }) {
    const busy = resolving.has(c.id)
    return (
      <div className={`rm-change${c.priority >= 3 ? ' rm-change-critical' : ''}`}>
        <div className="rm-change-hd">
          <span className="rm-change-source">{c.source}</span>
          {c.priority >= 3 && <span className="rm-change-flag">Important</span>}
        </div>
        <p className="rm-change-title">{c.title}</p>
        {c.detail && <p className="rm-change-text"><span className="rm-change-label">Why now</span>{c.detail}</p>}
        {c.action && <p className="rm-change-text"><span className="rm-change-label">What to do</span>{c.action}</p>}
        <div className="rm-change-actions">
          <button className="rm-btn-primary rm-btn-sm" onClick={() => resolveChange(c.id, 'done')} disabled={busy}>
            {busy ? '…' : 'Done'}
          </button>
          <button className="rm-btn-ghost rm-btn-sm" onClick={() => resolveChange(c.id, 'dismissed')} disabled={busy}>
            Not relevant
          </button>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const nothingYet = reminders.length === 0 && changes.length === 0

  return (
    <>
      <header className="shell-dup-header">
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
              className="shell-dup-back"
              onClick={goBack}
              title="Back"
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
                {changes.length > 0 ? ` · ${changes.length} change${changes.length !== 1 ? 's' : ''} to act on` : ''}
                {groups.followups.length > 0 ? ` · ${groups.followups.length} follow-up${groups.followups.length !== 1 ? 's' : ''}` : ''}
                {totalActive > 0 ? ` · ${totalActive} recurring` : ''}
              </p>
            </div>
          </div>
          <div className="rm-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingTop: 6 }}>
            <button className="rm-btn-primary" onClick={() => setShowAdd(true)}>+ Add check</button>
          </div>
        </div>

        <div style={{ paddingTop: 28, paddingBottom: 80 }}>

          {toast && (
            <div className={`rm-toast rm-toast-${toast.kind}`} role="status">
              {toast.text}
              <button className="rm-toast-close" onClick={() => setToast(null)} aria-label="Close">×</button>
            </div>
          )}

          {/* 1. What changed — raised from the brand's own data */}
          <div className="rm-section">
            <div className="rm-section-hd">
              <span className="rm-section-dot" style={{ background: '#dc2626' }} />
              What changed
              {changes.length > 0 && <span className="rm-section-count">{changes.length}</span>}
            </div>
            <div className="rm-section-body">
              {changes.map(c => <ChangeCard key={c.id} c={c} />)}
              {changes.length === 0 && (
                <div className="rm-note">
                  {searchConnected
                    ? 'Nothing needs attention. GrowJin checks your Google Search, email DNS and ads every night and adds a card here when something drops or breaks.'
                    : <>Nothing yet. <a href={connectUrl('gsc_api')}>Connect Google Search Console</a> and GrowJin will tell you when a page loses Google clicks, ranks on page 1 but rarely gets clicked, or a search falls off the first page.</>}
                </div>
              )}
            </div>
          </div>

          {/* 2. Follow-ups — outreach emails without a reply */}
          {groups.followups.length > 0 && (
            <div className="rm-section">
              <div className="rm-section-hd">
                <span className="rm-section-dot" style={{ background: 'var(--green)' }} />
                Follow-ups
                <span className="rm-section-count">{groups.followups.length}</span>
              </div>
              <div className="rm-section-body">
                {groups.followups.map(r => <ReminderCard key={r.id} r={r} />)}
              </div>
            </div>
          )}

          {/* 3. Recurring checks — chores the user chose */}
          <Section title="Overdue checks" accent="#dc2626" items={groups.overdue} />
          <Section title="Checks due this week" accent="#d97706" items={groups.thisWeek} />
          <Section title="Upcoming checks" items={groups.upcoming} />

          {availableChecks.length > 0 && (
            <div className="rm-section">
              <div className="rm-section-hd">
                Common checks{brandProfile.websiteType ? ` for ${brandProfile.websiteType}` : ''}
              </div>
              <p className="rm-note-plain">Only add the ones for places you're actually listed. You can add the link to each listing so it's one click away.</p>
              <div className="rm-chips">
                {availableChecks.map(p => (
                  <button
                    key={p.title}
                    className="rm-chip"
                    onClick={() => addCommonCheck(p)}
                    disabled={addingCheck !== null}
                    title={`Every ${p.intervalDays} days`}
                  >
                    {addingCheck === p.title ? '…' : '+'} {p.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Section title="Snoozed" items={groups.snoozed} />
          <Section title="Disabled" items={groups.disabled} />

          {nothingYet && availableChecks.length === 0 && (
            <div className="rm-empty-state">
              <p className="rm-empty-title">No recurring checks</p>
              <p className="rm-empty-sub">Add one for anything you need to keep up to date, like a marketplace listing or a directory profile.</p>
            </div>
          )}
        </div>
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="rm-overlay" onClick={() => setShowAdd(false)}>
          <div className="rm-modal" onClick={e => e.stopPropagation()}>
            <div className="rm-modal-hd">
              <span>New recurring check</span>
              <button className="rm-modal-close" onClick={() => setShowAdd(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="rm-field">
              <label className="rm-label">Title</label>
              <input className="rm-input" value={addForm.title} onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Update Etsy listings" autoFocus />
            </div>
            <div className="rm-field">
              <label className="rm-label">Link (optional)</label>
              <input className="rm-input" value={addForm.url} onChange={e => setAddForm(f => ({ ...f, url: e.target.value }))} placeholder="https://www.etsy.com/shop/yourshop" />
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
                <input type="number" min="1" max="365" className="rm-input" value={addForm.intervalDays} onChange={e => setAddForm(f => ({ ...f, intervalDays: e.target.value }))} />
              </div>
            </div>
            <div className="rm-modal-actions">
              <button className="rm-btn-primary" onClick={addReminder} disabled={loading || !addForm.title.trim()}>Add check</button>
              <button className="rm-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
