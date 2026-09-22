'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'
import type { ReminderSuggestion } from '@/app/api/reminders/suggest/route'

type ReminderCategory = 'marketplace' | 'content' | 'social' | 'seo' | 'outreach' | 'ads' | 'custom'

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
}

interface BrandProfile {
  name: string
  websiteType: string | null
  industry: string | null
  targetAudience: string | null
}

const CAT_CLASS: Record<string, string> = {
  marketplace: 'rm-cat-marketplace',
  content:     'rm-cat-content',
  social:      'rm-cat-social',
  seo:         'rm-cat-seo',
  outreach:    'rm-cat-outreach',
  ads:         'rm-cat-ads',
  custom:      'rm-cat-custom',
}

const CATEGORIES: ReminderCategory[] = ['marketplace', 'content', 'social', 'seo', 'outreach', 'ads', 'custom']

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
  const [addForm, setAddForm] = useState({ title: '', description: '', category: 'custom' as ReminderCategory, intervalDays: '30' })
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: '', description: '', intervalDays: '30' })

  // AI suggestions state
  const [suggestions, setSuggestions] = useState<ReminderSuggestion[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [addingIds, setAddingIds] = useState<Set<number>>(new Set())
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set())

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
      body: JSON.stringify({ title: addForm.title, description: addForm.description || null, category: addForm.category, intervalDays: parseInt(addForm.intervalDays, 10) }),
    })
    setAddForm({ title: '', description: '', category: 'custom', intervalDays: '30' })
    setShowAdd(false)
    setLoading(false)
    await reload()
  }

  async function saveEdit(id: string) {
    await fetch(`/api/reminders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editForm.title, description: editForm.description || null, intervalDays: parseInt(editForm.intervalDays, 10) }),
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
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
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
      body: JSON.stringify({ title: s.title, description: s.description || null, category: s.category, intervalDays: s.intervalDays }),
    })
    setAddingIds(prev => { const n = new Set(prev); n.delete(idx); return n })
    setAddedIds(prev => new Set(prev).add(idx))
    await reload()
  }

  const groups = groupReminders(reminders)
  const totalActive = groups.overdue.length + groups.thisWeek.length + groups.upcoming.length
  const showSuggestPanel = suggestLoading || suggestions.length > 0 || suggestError !== null

  // ── Card ──────────────────────────────────────────────────────────────────

  function ReminderCard({ r }: { r: Reminder }) {
    const days = daysUntil(r.nextDueAt)
    const isEditing = editId === r.id
    const isDoing = doneIds.has(r.id)

    if (isEditing) {
      return (
        <div className="rm-card rm-card-editing">
          <input className="rm-input" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} placeholder="Title" autoFocus />
          <input className="rm-input" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" style={{ marginTop: 8 }} />
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

          <div className="rm-card-info">
            <div className="rm-card-title-row">
              <span className="rm-card-title">{r.title}</span>
              <span className={`rm-cat-badge ${CAT_CLASS[r.category] ?? 'rm-cat-custom'}`}>{r.category}</span>
            </div>
            {r.description && <span className="rm-card-desc">{r.description}</span>}
            <span className="rm-card-interval">every {r.intervalDays} days</span>
          </div>

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
                        <div className="rm-suggest-card-top">
                          <div className="rm-suggest-card-info">
                            <span className={`rm-cat-badge ${CAT_CLASS[s.category] ?? 'rm-cat-custom'}`}>{s.category}</span>
                            <span className="rm-suggest-card-title">{s.title}</span>
                            {s.description && <span className="rm-suggest-card-desc">{s.description}</span>}
                            <span className="rm-suggest-card-meta">every {s.intervalDays} days · {s.reason}</span>
                          </div>
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
            <div className="rm-field">
              <label className="rm-label">Description <span style={{ opacity: 0.5 }}>(optional)</span></label>
              <input className="rm-input" value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))} placeholder="Any details..." />
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
