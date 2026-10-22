'use client'

import { useState, useEffect } from 'react'
import type { analysisRequests } from '@/lib/db/schema'
import type { AnalysisMode } from '@/lib/modules/analysis-mode'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import AdminCosts from './AdminCosts'

type Request = typeof analysisRequests.$inferSelect

interface NoteRow {
  id: string
  userId: string
  userEmail: string
  title: string
  content: string
  tags: string[]
  pinned: boolean
  moduleType: string | null
  createdAt: string | null
  updatedAt: string | null
}

interface UserRow {
  brandId: string
  userId: string
  userEmail: string
  brandName: string
  websiteUrl: string
  moduleCount: number
  lastActive: string | null
}

interface Props {
  requests: Request[]
  gmailAddress: string | null
  gmailParam?: string
  analysisMode: AnalysisMode
  earlyAccess: string[]
}

function timeAgo(iso: Date | null): string {
  if (!iso) return '—'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

interface SendResult {
  brandName: string
  to: string
  sent: boolean
  skipped?: string
}

export default function AdminDashboard({ requests: initial, gmailAddress, gmailParam, analysisMode, earlyAccess: initialEarlyAccess }: Props) {
  const [mode, setMode] = useState<AnalysisMode>(analysisMode)
  const [modeSaving, setModeSaving] = useState(false)
  const [modeError, setModeError] = useState<string | null>(null)
  const changeMode = async (next: AnalysisMode) => {
    setModeSaving(true)
    setModeError(null)
    try {
      const res = await fetch('/api/admin/analysis-mode', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: next }) })
      const data = await res.json().catch(() => ({})) as { mode?: AnalysisMode; error?: string }
      if (!res.ok || !data.mode) throw new Error(data.error ?? `Save failed (${res.status})`)
      setMode(data.mode)
    } catch (e) {
      setModeError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setModeSaving(false)
    }
  }
  const [tab, setTab] = useState<'queue' | 'users' | 'notes' | 'costs' | 'access'>('queue')
  const [earlyAccess, setEarlyAccess] = useState<string[]>(initialEarlyAccess)
  const [accessInput, setAccessInput] = useState('')
  const [accessSaving, setAccessSaving] = useState(false)
  const [accessError, setAccessError] = useState('')
  const [requests, setRequests] = useState(initial)
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [users, setUsers] = useState<UserRow[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ sent: number; total: number; results: SendResult[] } | null>(null)
  const [sendError, setSendError] = useState('')
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [notesError, setNotesError] = useState('')
  const [notesSearch, setNotesSearch] = useState('')
  const [expandedNote, setExpandedNote] = useState<string | null>(null)

  // Replaces the whole early-access list; the server cleans it (lowercase, no duplicates).
  async function saveEarlyAccess(emails: string[]): Promise<boolean> {
    setAccessSaving(true)
    setAccessError('')
    try {
      const res = await fetch('/api/admin/early-access', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      })
      const data = await res.json() as { emails?: string[]; error?: string }
      if (!res.ok || !data.emails) { setAccessError(data.error ?? 'Failed to save'); return false }
      setEarlyAccess(data.emails)
      return true
    } catch {
      setAccessError('Network error')
      return false
    } finally {
      setAccessSaving(false)
    }
  }

  async function addEarlyAccess() {
    const added = accessInput.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
    if (added.length === 0) return
    const bad = added.filter(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    if (bad.length > 0) { setAccessError(`Not an email: ${bad.join(', ')}`); return }
    if (await saveEarlyAccess([...earlyAccess, ...added])) setAccessInput('')
  }

  const hasAccess = (email: string) => earlyAccess.includes(email.toLowerCase())
  const toggleEarlyAccess = (email: string) =>
    saveEarlyAccess(hasAccess(email) ? earlyAccess.filter(e => e !== email.toLowerCase()) : [...earlyAccess, email])

  async function handleSendDailyEmail() {
    setSending(true)
    setSendResult(null)
    setSendError('')
    try {
      const res = await fetch('/api/admin/send-daily-email', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; sent?: number; total?: number; results?: SendResult[]; error?: string }
      if (!res.ok || data.error) { setSendError(data.error ?? 'Failed to send'); return }
      setSendResult({ sent: data.sent ?? 0, total: data.total ?? 0, results: data.results ?? [] })
    } catch {
      setSendError('Network error')
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    if (tab !== 'users' || users.length > 0) return
    setUsersLoading(true)
    fetch('/api/admin/users')
      .then(r => r.json())
      .then((data: { users?: UserRow[]; error?: string }) => {
        if (data.error) setUsersError(data.error)
        else setUsers(data.users ?? [])
      })
      .catch(() => setUsersError('Failed to load users.'))
      .finally(() => setUsersLoading(false))
  }, [tab, users.length])

  useEffect(() => {
    if (tab !== 'notes' || notes.length > 0) return
    setNotesLoading(true)
    fetch('/api/admin/notes')
      .then(r => r.json())
      .then((data: { notes?: NoteRow[]; error?: string }) => {
        if (data.error) setNotesError(data.error)
        else setNotes(data.notes ?? [])
      })
      .catch(() => setNotesError('Failed to load notes.'))
      .finally(() => setNotesLoading(false))
  }, [tab, notes.length])

  const handleRun = async (req: Request) => {
    setRunning(prev => ({ ...prev, [req.id]: true }))
    setErrors(prev => ({ ...prev, [req.id]: '' }))
    try {
      const res = await fetch('/api/modules/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId: req.moduleId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErrors(prev => ({ ...prev, [req.id]: (data as { error?: string }).error ?? 'Analysis failed.' }))
        return
      }
      // Mark done in DB + send notification email
      await fetch('/api/admin/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: req.id }),
      })
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'done', completedAt: new Date() } : r))
    } catch {
      setErrors(prev => ({ ...prev, [req.id]: 'Network error.' }))
    } finally {
      setRunning(prev => ({ ...prev, [req.id]: false }))
    }
  }

  const pending = requests.filter(r => r.status === 'pending')
  const done = requests.filter(r => r.status === 'done')

  const gmailBannerMsg =
    gmailParam === 'connected' ? 'Gmail connected successfully.' :
    gmailParam === 'cancelled' ? 'Gmail connection cancelled.' :
    gmailParam === 'error'     ? 'Gmail connection failed. Please try again.' :
    null

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px', fontFamily: 'var(--font-body, sans-serif)', color: 'var(--text, #e8f3ec)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Admin</h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '1px solid var(--line, #1e3830)', paddingBottom: 0, overflowX: 'auto' }}>
        {(['queue', 'users', 'notes', 'costs', 'access'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--green, #2fbf71)' : '2px solid transparent',
              color: tab === t ? 'var(--text, #e8f3ec)' : 'var(--text-dim, #8aa897)',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              padding: '8px 16px',
              cursor: 'pointer',
              marginBottom: -1,
              textTransform: 'capitalize',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {t === 'queue' ? `Analysis Queue (${pending.length} pending)` : t === 'users' ? 'Users' : t === 'notes' ? 'Notes' : t === 'costs' ? 'AI Costs' : `Early access (${earlyAccess.length})`}
          </button>
        ))}
      </div>

      {tab === 'queue' && (
        <>
          {/* How Growth Path modules run when a user clicks Run */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            padding: '12px 16px',
            borderRadius: 8,
            background: 'var(--card, #122620)',
            border: '1px solid var(--line, #1e3830)',
            marginBottom: 12,
            fontSize: 13,
          }}>
            <span style={{ color: 'var(--text-dim, #8aa897)' }}>Module runs:</span>
            <span style={{ fontWeight: 600 }}>
              {mode === 'direct' ? 'Run straight away through the API' : 'Queued here for you to run'}
            </span>
            <button
              type="button"
              disabled={modeSaving}
              onClick={() => changeMode(mode === 'direct' ? 'queue' : 'direct')}
              style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--line, #1e3830)', borderRadius: 6, color: 'inherit', fontFamily: 'inherit', fontSize: 12, padding: '5px 12px', cursor: 'pointer' }}
            >
              {modeSaving ? 'Saving…' : mode === 'direct' ? 'Switch to queue' : 'Switch to API'}
            </button>
            {modeError && <span style={{ flexBasis: '100%', color: '#f87171', fontSize: 12 }}>{modeError}</span>}
          </div>

          {/* Gmail connection status */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderRadius: 8,
            background: 'var(--card, #122620)',
            border: '1px solid var(--line, #1e3830)',
            marginBottom: 32,
            fontSize: 13,
          }}>
            <span style={{ color: 'var(--text-dim, #8aa897)' }}>Notification Gmail:</span>
            {gmailAddress ? (
              <>
                <span style={{ color: 'var(--green, #2fbf71)', fontWeight: 600 }}>{gmailAddress}</span>
                <a
                  href="/api/admin/gmail/connect"
                  style={{ marginLeft: 'auto', color: 'var(--text-dim, #8aa897)', fontSize: 12, textDecoration: 'underline' }}
                >
                  Reconnect
                </a>
              </>
            ) : (
              <>
                <span style={{ color: '#f87171' }}>Not connected — emails will not be sent</span>
                <a
                  href="/api/admin/gmail/connect"
                  style={{
                    marginLeft: 'auto',
                    background: 'var(--green, #2fbf71)',
                    color: '#000',
                    borderRadius: 6,
                    padding: '5px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Connect Gmail
                </a>
              </>
            )}
          </div>

          {gmailBannerMsg && (
            <p style={{
              fontSize: 13,
              marginBottom: 20,
              color: gmailParam === 'connected' ? 'var(--green, #2fbf71)' : '#f87171',
            }}>
              {gmailBannerMsg}
            </p>
          )}

          {pending.length === 0 && (
            <p style={{ color: 'var(--text-dim, #8aa897)', fontSize: 14 }}>No pending requests.</p>
          )}

          {pending.length > 0 && (
            <section style={{ marginBottom: 48 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim, #8aa897)', marginBottom: 12 }}>Pending</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line, #1e3830)', color: 'var(--text-dim, #8aa897)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>User</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Brand</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Module</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Requested</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(req => (
                    <tr key={req.id} style={{ borderBottom: '1px solid var(--line, #1e3830)' }}>
                      <td style={{ padding: '10px 12px' }}>{req.userEmail}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span>{req.brandName}</span>
                        <a href={req.websiteUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: 11, color: 'var(--text-dim, #8aa897)', textDecoration: 'none' }}>
                          {req.websiteUrl}
                        </a>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span>{req.moduleName}</span>
                        <a href={`/dashboard/${req.moduleId}`} target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: 11, color: 'var(--green, #2fbf71)', textDecoration: 'none' }}>
                          View module
                        </a>
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-dim, #8aa897)' }}>{timeAgo(req.requestedAt)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {errors[req.id] && <p style={{ color: '#f87171', fontSize: 11, marginBottom: 4 }}>{errors[req.id]}</p>}
                        <button
                          onClick={() => handleRun(req)}
                          disabled={running[req.id]}
                          style={{
                            background: 'var(--green, #2fbf71)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '6px 14px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: running[req.id] ? 'not-allowed' : 'pointer',
                            opacity: running[req.id] ? 0.6 : 1,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {running[req.id] ? <><Spinner />Running…</> : 'Run Analysis'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {done.length > 0 && (
            <section>
              <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim, #8aa897)', marginBottom: 12 }}>Completed</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, opacity: 0.65 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line, #1e3830)', color: 'var(--text-dim, #8aa897)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>User</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Brand</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Module</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Requested</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {done.map(req => (
                    <tr key={req.id} style={{ borderBottom: '1px solid var(--line, #1e3830)' }}>
                      <td style={{ padding: '10px 12px' }}>{req.userEmail}</td>
                      <td style={{ padding: '10px 12px' }}>{req.brandName}</td>
                      <td style={{ padding: '10px 12px' }}>{req.moduleName}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-dim, #8aa897)' }}>{timeAgo(req.requestedAt)}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--green, #2fbf71)' }}>{timeAgo(req.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {tab === 'costs' && <AdminCosts />}

      {tab === 'notes' && (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <input
              value={notesSearch}
              onChange={e => setNotesSearch(e.target.value)}
              placeholder="Search notes…"
              style={{ flex: 1, padding: '7px 12px', background: 'var(--card, #122620)', border: '1px solid var(--line, #1e3830)', borderRadius: 7, color: 'var(--text, #e8f3ec)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
            />
            <span style={{ fontSize: 13, color: 'var(--text-dim, #8aa897)', whiteSpace: 'nowrap' }}>
              {notes.length} total
            </span>
          </div>

          {notesLoading && <LoadingState compact>Loading notes…</LoadingState>}
          {notesError && <p style={{ color: '#f87171', fontSize: 14 }}>{notesError}</p>}
          {!notesLoading && !notesError && notes.length === 0 && (
            <p style={{ color: 'var(--text-dim, #8aa897)', fontSize: 14 }}>No notes found.</p>
          )}

          {!notesLoading && notes.length > 0 && (() => {
            const q = notesSearch.toLowerCase()
            const filtered = notes.filter(n =>
              !q ||
              n.title.toLowerCase().includes(q) ||
              n.content.toLowerCase().includes(q) ||
              n.userEmail.toLowerCase().includes(q) ||
              (n.moduleType ?? '').toLowerCase().includes(q) ||
              n.tags.some(t => t.toLowerCase().includes(q))
            )
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.length === 0 && (
                  <p style={{ color: 'var(--text-dim, #8aa897)', fontSize: 14 }}>No notes match.</p>
                )}
                {filtered.map(note => (
                  <div
                    key={note.id}
                    style={{ background: 'var(--card, #122620)', border: '1px solid var(--line, #1e3830)', borderRadius: 10, padding: '12px 16px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {note.pinned && (
                            <span style={{ fontSize: 11, color: 'var(--gold, #7a5a08)', fontWeight: 600 }}>Pinned</span>
                          )}
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #e8f3ec)' }}>
                            {note.title || <span style={{ fontStyle: 'italic', color: 'var(--text-dim, #8aa897)' }}>Untitled</span>}
                          </span>
                          {note.moduleType && (
                            <span style={{ fontSize: 11, padding: '2px 8px', background: 'rgba(47,191,113,0.12)', border: '1px solid rgba(47,191,113,0.25)', borderRadius: 10, color: 'var(--green, #2fbf71)' }}>
                              {note.moduleType}
                            </span>
                          )}
                          {note.tags.map(t => (
                            <span key={t} style={{ fontSize: 11, padding: '2px 7px', background: 'rgba(47,191,113,0.08)', border: '1px solid rgba(47,191,113,0.15)', borderRadius: 10, color: 'var(--text-dim, #8aa897)' }}>
                              {t}
                            </span>
                          ))}
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-dim, #8aa897)' }}>
                          {note.userEmail} · {note.createdAt ? timeAgo(new Date(note.createdAt)) : '—'}
                        </p>
                      </div>
                      <button
                        onClick={() => setExpandedNote(expandedNote === note.id ? null : note.id)}
                        style={{ background: 'none', border: '1px solid var(--line, #1e3830)', borderRadius: 6, color: 'var(--text-dim, #8aa897)', fontSize: 12, padding: '4px 10px', cursor: 'pointer', flexShrink: 0 }}
                      >
                        {expandedNote === note.id ? 'Hide' : 'View'}
                      </button>
                    </div>
                    {expandedNote === note.id && note.content && (
                      <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-soft, #f0f6f2)', borderRadius: 7, fontSize: 13, color: 'var(--text, #e8f3ec)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {note.content}
                      </div>
                    )}
                    {expandedNote === note.id && !note.content && (
                      <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-faint, #7aaa8a)', fontStyle: 'italic' }}>No content.</p>
                    )}
                  </div>
                ))}
              </div>
            )
          })()}
        </section>
      )}

      {tab === 'access' && (
        <section>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-dim, #8aa897)', lineHeight: 1.6 }}>
            People on this list get every Growth Path module open (no &ldquo;reach 80% on the previous module&rdquo; lock)
            and the Coming soon tools (Email Outreach, Competitor Leads, the AI agents) as live tools. Changes apply on their next page load.
          </p>

          <form
            onSubmit={e => { e.preventDefault(); addEarlyAccess() }}
            style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}
          >
            <input
              type="text"
              value={accessInput}
              onChange={e => { setAccessInput(e.target.value); setAccessError('') }}
              placeholder="name@company.com (several: separate with commas)"
              aria-label="Email to give early access"
              style={{
                flex: '1 1 260px', minWidth: 0, background: 'var(--card, #122620)', border: '1px solid var(--line, #1e3830)',
                borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text, #e8f3ec)', fontFamily: 'inherit',
              }}
            />
            <button
              type="submit"
              disabled={accessSaving || !accessInput.trim()}
              style={{
                background: 'var(--green, #2fbf71)', color: '#000', border: 'none', borderRadius: 8, padding: '8px 18px',
                fontSize: 13, fontWeight: 600, cursor: accessSaving || !accessInput.trim() ? 'not-allowed' : 'pointer',
                opacity: accessSaving || !accessInput.trim() ? 0.6 : 1,
              }}
            >
              {accessSaving ? <><Spinner />Saving…</> : 'Add'}
            </button>
          </form>

          {accessError && <p style={{ fontSize: 13, color: '#f87171', margin: '0 0 12px' }}>{accessError}</p>}

          {earlyAccess.length === 0 ? (
            <p style={{ color: 'var(--text-dim, #8aa897)', fontSize: 14 }}>No one has early access yet.</p>
          ) : (
            <div style={{ border: '1px solid var(--line, #1e3830)', borderRadius: 10, overflow: 'hidden' }}>
              {earlyAccess.map((email, i) => (
                <div
                  key={email}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', fontSize: 13,
                    borderTop: i === 0 ? 'none' : '1px solid var(--line, #1e3830)',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{email}</span>
                  <button
                    onClick={() => saveEarlyAccess(earlyAccess.filter(e => e !== email))}
                    disabled={accessSaving}
                    style={{
                      background: 'none', border: '1px solid var(--line, #1e3830)', borderRadius: 6, padding: '4px 10px',
                      fontSize: 12, color: 'var(--text-dim, #8aa897)', cursor: accessSaving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'users' && (
        <section>
          {/* Send daily email */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, padding: '14px 18px', background: 'var(--card, #122620)', border: '1px solid var(--line, #1e3830)', borderRadius: 10 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text, #e8f3ec)' }}>Send daily summary email</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-dim, #8aa897)' }}>
                Sends yesterday's data to all users who have opted in with both GA4 + PostHog connected.
              </p>
            </div>
            <button
              onClick={handleSendDailyEmail}
              disabled={sending}
              style={{
                background: 'var(--green, #2fbf71)', color: '#000', border: 'none',
                borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600,
                cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.6 : 1,
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {sending ? <><Spinner />Sending…</> : 'Send now'}
            </button>
          </div>

          {sendError && (
            <p style={{ fontSize: 13, color: '#f87171', marginBottom: 16 }}>{sendError}</p>
          )}

          {sendResult && (
            <div style={{ marginBottom: 24, padding: '12px 18px', background: 'var(--card, #122620)', border: '1px solid var(--line, #1e3830)', borderRadius: 10 }}>
              <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--green, #2fbf71)' }}>
                Sent to {sendResult.sent} of {sendResult.total} opted-in users
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sendResult.results.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                    <span style={{ color: r.sent ? 'var(--green, #2fbf71)' : '#f87171', fontWeight: 600 }}>
                      {r.sent ? '✓' : '✗'}
                    </span>
                    <span style={{ color: 'var(--text, #e8f3ec)' }}>{r.brandName}</span>
                    <span style={{ color: 'var(--text-dim, #8aa897)' }}>{r.to}</span>
                    {r.skipped && <span style={{ color: 'var(--text-dim, #8aa897)', fontStyle: 'italic' }}>({r.skipped})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {usersLoading && (
            <LoadingState>Loading users…</LoadingState>
          )}
          {usersError && (
            <p style={{ color: '#f87171', fontSize: 14 }}>{usersError}</p>
          )}
          {!usersLoading && !usersError && users.length === 0 && (
            <p style={{ color: 'var(--text-dim, #8aa897)', fontSize: 14 }}>No users found.</p>
          )}
          {!usersLoading && users.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line, #1e3830)', color: 'var(--text-dim, #8aa897)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Email</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Brand</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Website</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Modules</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Last Active</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}>Early access</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500 }}></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.brandId} style={{ borderBottom: '1px solid var(--line, #1e3830)' }}>
                    <td style={{ padding: '10px 12px' }}>{u.userEmail}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{u.brandName}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <a href={u.websiteUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-dim, #8aa897)', textDecoration: 'none', fontSize: 12 }}>
                        {u.websiteUrl.replace(/^https?:\/\//, '')}
                      </a>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-dim, #8aa897)' }}>{u.moduleCount}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-dim, #8aa897)' }}>
                      {u.lastActive ? timeAgo(new Date(u.lastActive)) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {!u.userEmail.includes('@') ? <span style={{ color: 'var(--text-dim, #8aa897)' }}>—</span> : <button
                        onClick={() => toggleEarlyAccess(u.userEmail)}
                        disabled={accessSaving}
                        aria-pressed={hasAccess(u.userEmail)}
                        title={hasAccess(u.userEmail) ? 'Remove early access' : 'Give early access'}
                        style={{
                          background: hasAccess(u.userEmail) ? 'var(--green, #2fbf71)' : 'none',
                          color: hasAccess(u.userEmail) ? '#000' : 'var(--text-dim, #8aa897)',
                          border: '1px solid ' + (hasAccess(u.userEmail) ? 'var(--green, #2fbf71)' : 'var(--line, #1e3830)'),
                          borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                          cursor: accessSaving ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        {hasAccess(u.userEmail) ? 'On' : 'Off'}
                      </button>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <a
                        href={`/admin/view/${u.brandId}`}
                        style={{
                          background: 'var(--card, #122620)',
                          border: '1px solid var(--line, #1e3830)',
                          color: 'var(--green, #2fbf71)',
                          borderRadius: 6,
                          padding: '5px 12px',
                          fontSize: 12,
                          fontWeight: 600,
                          textDecoration: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        View Dashboard
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}
