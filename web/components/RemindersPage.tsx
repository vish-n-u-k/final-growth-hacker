'use client'

import { useState, useEffect, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'
import { connectUrl } from '@/lib/integrations/connect-url'
import { REMINDER_CATEGORIES, type ReminderCategory, type ReminderPreset } from '@/lib/reminders/presets'
import { Spinner } from '@/components/ui/spinner'
import TimezoneSelect, { canonicalTimezone, deviceTimezone } from '@/components/TimezoneSelect'
import TimeField from '@/components/TimeField'
import ToolHeader from '@/components/ToolHeader'
import { utcToZoned, zonedToUtc } from '@/lib/frekto/time'
import { auditJobSource } from '@/lib/reminders/audit-source'
import type { AuditJobSuggestion } from '@/lib/reminders/audit-jobs'

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
const CATEGORY_LABELS: Record<string, string> = {
  marketplace: 'Marketplace', 'app-store': 'App store', directory: 'Directory', profile: 'Profile', outreach: 'Outreach', custom: 'Custom',
}
const categoryLabel = (c: string) => CATEGORY_LABELS[c] ?? c

// Calendar days until the date: due today (earlier or later) → 0, tomorrow → 1, yesterday → -1 (overdue)
function daysUntil(isoDate: string): number {
  const due = new Date(isoDate)
  const now = new Date()
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((dueDay - today) / 86400000)
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
  auditSuggestions = [],
  searchConnected,
  dailyEmailOn,
  brandProfile,
  defaultTimezone = null,
}: {
  initialReminders: Reminder[]
  initialChanges: Change[]
  commonChecks: ReminderPreset[]
  auditSuggestions?: AuditJobSuggestion[]
  searchConnected: boolean
  dailyEmailOn: boolean
  brandProfile: BrandProfile
  defaultTimezone?: string | null
}) {
  const router = useRouter()
  const [reminders, setReminders] = useState<Reminder[]>(initialReminders)
  const [changes, setChanges] = useState<Change[]>(initialChanges)
  const [resolving, setResolving] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [showAdd, setShowAdd] = useState(false)
  // First due: date + time in a timezone (the one chosen in Social Studio, else this device's)
  const [tz, setTz] = useState(() => canonicalTimezone(defaultTimezone ?? deviceTimezone() ?? 'UTC'))
  const [firstDate, setFirstDate] = useState('')
  const [firstTime, setFirstTime] = useState('09:00')
  const [addForm, setAddForm] = useState({ title: '', category: 'custom' as ReminderCategory, intervalDays: '30', url: '' })
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: '', description: '', intervalDays: '30', url: '' })
  const [addingCheck, setAddingCheck] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<AuditJobSuggestion[]>(auditSuggestions)
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [justAdded, setJustAdded] = useState<Reminder | null>(null) // "What happens next" popup

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

  // Creates a check and returns it (null on failure — the error is already shown)
  async function createReminder(body: Record<string, unknown>, failText: string): Promise<Reminder | null> {
    try {
      const res = await fetch('/api/reminders', json('POST', body))
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.reminder) return data.reminder as Reminder
      setToast({ kind: 'error', text: data?.upgrade ? 'This needs GrowJin Pro.' : `${failText}${data?.error ? `: ${data.error}` : ''}` })
    } catch {
      setToast({ kind: 'error', text: `${failText}: check your connection.` })
    }
    return null
  }

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

  function openAdd() {
    setFirstDate(utcToZoned(new Date(Date.now() + 3 * 864e5), tz).date)
    setShowAdd(true)
  }

  async function addReminder() {
    if (!addForm.title.trim()) return
    setLoading(true)
    const created = await createReminder({
      title: addForm.title,
      category: addForm.category,
      intervalDays: parseInt(addForm.intervalDays, 10),
      url: addForm.url,
      ...(firstDate ? { firstDueAt: zonedToUtc(firstDate, firstTime, tz).toISOString() } : {}),
    }, 'Could not add the reminder')
    setLoading(false)
    if (!created) return
    setAddForm({ title: '', category: 'custom', intervalDays: '30', url: '' })
    setShowAdd(false)
    setJustAdded(created)
    await reload()
  }

  async function addCommonCheck(p: ReminderPreset) {
    setAddingCheck(p.title)
    const created = await createReminder({ ...p, isPreset: true }, 'Could not add the check')
    if (created) setJustAdded(created)
    await reload()
    setAddingCheck(null)
  }

  // A repeat job from the audits: GrowJin fills in this time's task, the user just adds it
  async function addSuggestion(s: AuditJobSuggestion) {
    setAddingCheck(s.key)
    const created = await createReminder({ auditJob: s.key }, 'Could not add the reminder')
    if (created) {
      setSuggestions(list => list.filter(x => x.key !== s.key))
      setJustAdded(created)
    }
    await reload()
    setAddingCheck(null)
  }

  async function saveEdit(id: string) {
    // Audit reminders keep the link GrowJin set (it can point inside the app)
    const audit = !!auditJobSource(reminders.find(r => r.id === id)?.category ?? '')
    const ok = await call(`/api/reminders/${id}`, json('PATCH', {
      title: editForm.title,
      intervalDays: parseInt(editForm.intervalDays, 10),
      ...(audit ? {} : { url: editForm.url }),
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
  // Plain render functions, not components: a component declared in here is a new type on every
  // render, so React remounted the cards on each keystroke and the edit/compose inputs lost focus.

  function reminderCard(r: Reminder) {
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
          {r.category !== 'outreach' && !auditJobSource(r.category) && (
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
            <span className={`rm-cat-badge ${CAT_CLASS['outreach']}`}>{categoryLabel('outreach')}</span>
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
                <button className="rm-kebab" aria-label="More actions" aria-haspopup="menu" aria-expanded={openMenu === r.id} onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === r.id ? null : r.id) }}>&#8942;</button>
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
    // Repeat jobs from the audits say what to do this time (kept current by the server)
    const source = auditJobSource(r.category)

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
          {r.url && (r.url.startsWith('/')
            ? <a className="rm-card-link" href={r.url}>Open</a>
            : <a className="rm-card-link" href={r.url} target="_blank" rel="noopener noreferrer" title={r.url}>Open ↗</a>
          )}
          {source
            ? <span className="rm-cat-badge rm-cat-audit">{source}</span>
            : <span className={`rm-cat-badge ${CAT_CLASS[r.category] ?? 'rm-cat-custom'}`}>{categoryLabel(r.category)}</span>}
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
              <button className="rm-kebab" aria-label="More actions" aria-haspopup="menu" aria-expanded={openMenu === r.id} onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === r.id ? null : r.id) }}>&#8942;</button>
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
        {source && r.description && <p className="rm-card-desc">{r.description}</p>}
      </div>
    )
  }

  // ── Section ───────────────────────────────────────────────────────────────

  function section(title: string, items: Reminder[], accent?: string) {
    if (items.length === 0) return null
    return (
      <div className="rm-section">
        <div className="rm-section-hd">
          {accent && <span className="rm-section-dot" style={{ background: accent }} />}
          {title}
          <span className="rm-section-count">{items.length}</span>
        </div>
        <div className="rm-section-body">
          {items.map(r => <Fragment key={r.id}>{reminderCard(r)}</Fragment>)}
        </div>
      </div>
    )
  }

  // ── Change card (open signal) ─────────────────────────────────────────────

  function changeCard(c: Change) {
    const busy = resolving.has(c.id)
    return (
      <div key={c.id} className={`rm-change${c.priority >= 3 ? ' rm-change-critical' : ''}`}>
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

      <div className="tool-page">
        <ToolHeader
          icon="bell"
          title="Reminders"
          intro="reminders"
          chips={groups.overdue.length > 0 ? <span className="th-chip th-chip--warn">{groups.overdue.length} overdue</span> : null}
          meta={[
            changes.length > 0 ? `${changes.length} change${changes.length !== 1 ? 's' : ''} to act on` : null,
            groups.followups.length > 0 ? `${groups.followups.length} follow-up${groups.followups.length !== 1 ? 's' : ''}` : null,
            totalActive > 0 ? `${totalActive} recurring` : null,
          ].filter(Boolean).join(' · ') || brandProfile.name}
          actions={<button className="btn btn-primary" onClick={() => openAdd()}>+ Add check</button>}
        />
        <div>

          {toast && (
            <div className={`rm-toast rm-toast-${toast.kind}`} role="status">
              {toast.text}
              <button className="rm-toast-close" onClick={() => setToast(null)} aria-label="Close">×</button>
            </div>
          )}

          {/* 1. What changed — raised from the brand's own data */}
          <div className="rm-section">
            <div className="rm-section-hd">
              <span className="rm-section-dot" style={{ background: 'var(--crit)' }} />
              What changed
              {changes.length > 0 && <span className="rm-section-count">{changes.length}</span>}
            </div>
            <div className="rm-section-body">
              {changes.map(changeCard)}
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
                {groups.followups.map(r => <Fragment key={r.id}>{reminderCard(r)}</Fragment>)}
              </div>
            </div>
          )}

          {/* 3. Recurring checks — chores the user chose */}
          {section('Overdue checks', groups.overdue, 'var(--crit)')}
          {section('Checks due this week', groups.thisWeek, 'var(--warn)')}
          {section('Upcoming checks', groups.upcoming)}

          {suggestions.length > 0 && (
            <div className="rm-section">
              <div className="rm-section-hd">
                Suggested from your audits
                <span className="rm-section-count">{suggestions.length}</span>
              </div>
              <p className="rm-note-plain">Jobs worth repeating, based on your SEO, Content and GEO results. Each time one is due, it names exactly what to do from your latest results.</p>
              <div className="rm-section-body">
                {suggestions.map(s => (
                  <div key={s.key} className="rm-sugg">
                    <div className="rm-sugg-main">
                      <div className="rm-sugg-hd">
                        <span className="rm-sugg-title">{s.title}</span>
                        <span className="rm-cat-badge rm-cat-audit">{s.source}</span>
                        <span className="rm-card-meta">every {s.intervalDays === 7 ? 'week' : `${s.intervalDays} days`}</span>
                      </div>
                      <p className="rm-sugg-why">{s.why}</p>
                      <p className="rm-sugg-preview"><span>First up:</span> {s.preview}</p>
                    </div>
                    <button className="rm-btn-primary rm-sugg-add" onClick={() => addSuggestion(s)} disabled={addingCheck !== null}>
                      {addingCheck === s.key ? <Spinner /> : '+'} Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          {section('Snoozed', groups.snoozed)}
          {section('Disabled', groups.disabled)}

          {nothingYet && availableChecks.length === 0 && suggestions.length === 0 && (
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
                  {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                </select>
              </div>
              <div className="rm-field" style={{ width: 120 }}>
                <label className="rm-label">Every (days)</label>
                <input type="number" min="1" max="365" className="rm-input" value={addForm.intervalDays} onChange={e => setAddForm(f => ({ ...f, intervalDays: e.target.value }))} />
              </div>
            </div>
            <div className="rm-field">
              <label className="rm-label">First due</label>
              <div className="rm-when">
                <input type="date" className="rm-input rm-date" value={firstDate} min={utcToZoned(new Date(), tz).date} onChange={e => setFirstDate(e.target.value)} aria-label="First due date" />
                <TimeField value={firstTime} onChange={setFirstTime} ariaLabel="First due time" />
                <TimezoneSelect value={tz} onChange={setTz} ariaLabel="Timezone" />
              </div>
            </div>
            <div className="rm-modal-actions">
              <button className="rm-btn-primary" onClick={addReminder} disabled={loading || !addForm.title.trim()}>Add check</button>
              <button className="rm-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {/* What happens next — shown once a check is added */}
      {justAdded && (() => {
        const due = new Date(justAdded.nextDueAt)
        const dueDays = Math.max(0, Math.ceil((due.getTime() - Date.now()) / 86400000))
        const dueText = `${due.toLocaleString(undefined, { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${tz.replace(/_/g, ' ')})`
        const every = justAdded.intervalDays === 1 ? 'day' : `${justAdded.intervalDays} days`
        return (
          <div className="rm-overlay" onClick={() => setJustAdded(null)}>
            <div className="rm-modal rm-next" role="dialog" aria-labelledby="rm-next-title" onClick={e => e.stopPropagation()}>
              <div className="rm-modal-hd">
                <span id="rm-next-title">Check added</span>
                <button className="rm-modal-close" onClick={() => setJustAdded(null)} aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                </button>
              </div>
              <p className="rm-next-title">{justAdded.title}</p>
              <p className="rm-next-sub">Here&apos;s what happens next:</p>
              <ol className="rm-next-steps">
                <li>
                  <strong>First due {dueDays === 0 ? 'today' : dueDays === 1 ? 'tomorrow' : `in ${dueDays} days`}</strong>
                  <span>{dueText}. Until then it&apos;s listed with your recurring checks below.</span>
                </li>
                <li>
                  <strong>You get reminded</strong>
                  <span>
                    On the day it&apos;s due it shows on Today and is marked due here
                    {dailyEmailOn ? ', and it’s in your daily email two days before, with a Mark done link.' : '. Turn on the daily email in Settings to get it in your inbox too.'}
                  </span>
                </li>
                <li>
                  <strong>Do it, then tick ✓</strong>
                  <span>
                    {auditJobSource(justAdded.category)
                      ? 'The card says exactly what to do this time, from your latest results; Open takes you there. '
                      : justAdded.url ? 'Use Open ↗ on the card to go straight to the page. ' : 'Add a link with Edit so the page is one click away. '}
                    {justAdded.category === 'audit:blog-post' && 'It also ticks itself off when a new article shows up in your sitemap. '}
                    Ticking it schedules the next one {every} later.
                  </span>
                </li>
                <li>
                  <strong>Not now?</strong>
                  <span>Use ⋮ on the card to snooze it for 7 days, edit how often it repeats, or turn it off.</span>
                </li>
              </ol>
              <div className="rm-modal-actions">
                <button className="rm-btn-primary" onClick={() => setJustAdded(null)} autoFocus>Got it</button>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}
