'use client'

import { useState, useEffect, useCallback } from 'react'

interface DeviceInfo {
  ua?: string
  screen?: string
  viewport?: string
  dpr?: number
}

interface Report {
  id: string
  userId: string | null
  userName: string | null
  userEmail: string | null
  pageUrl: string | null
  pageTitle: string | null
  remarks: string
  severity: string
  tags: string[] | null
  deviceInfo: DeviceInfo | null
  screenshotKey: string | null
  extraScreenshotKeys: string[] | null
  status: string
  createdAt: string
  screenshot_url: string | null
  extra_screenshot_urls: string[]
}

const SEV: Record<string, { label: string; color: string }> = {
  bug:        { label: 'Bug',        color: '#dc2626' },
  suggestion: { label: 'Suggestion', color: '#d97706' },
  question:   { label: 'Question',   color: '#2563eb' },
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function BugReportsDashboard() {
  const [reports, setReports] = useState<Report[]>([])
  const [tab, setTab] = useState<'open' | 'closed' | 'all'>('open')
  const [lightbox, setLightbox] = useState<{ urls: string[]; idx: number } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/bug-reports')
    if (res.ok) {
      const data = await res.json()
      setReports(data.items)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!lightbox) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === 'ArrowRight') setLightbox(l => l && l.idx < l.urls.length - 1 ? { ...l, idx: l.idx + 1 } : l)
      if (e.key === 'ArrowLeft')  setLightbox(l => l && l.idx > 0 ? { ...l, idx: l.idx - 1 } : l)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox])

  async function setStatus(id: string, status: string) {
    await fetch(`/api/bug-reports/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setReports(prev => prev.map(r => r.id === id ? { ...r, status } : r))
  }

  async function deleteReport(id: string) {
    if (!confirm('Delete this report?')) return
    await fetch(`/api/bug-reports/${id}`, { method: 'DELETE' })
    setReports(prev => prev.filter(r => r.id !== id))
  }

  const filtered = reports.filter(r => tab === 'all' || r.status === tab)
  const counts = {
    open:   reports.filter(r => r.status === 'open').length,
    closed: reports.filter(r => r.status === 'closed').length,
    all:    reports.length,
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px', fontFamily: 'var(--font-body, system-ui, sans-serif)', color: 'var(--text)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--text)' }}>Bug Reports</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>{counts.open} open · {counts.all} total</p>
        </div>
        <a href="/admin" style={{ fontSize: 13, color: 'var(--text-dim)', textDecoration: 'none' }}>← Admin</a>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
        {(['open', 'closed', 'all'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--green)' : '2px solid transparent',
              color: tab === t ? 'var(--text)' : 'var(--text-dim)',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              padding: '8px 16px',
              cursor: 'pointer',
              marginBottom: -1,
              textTransform: 'capitalize',
            }}
          >
            {t} ({counts[t]})
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>Loading...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>No {tab === 'all' ? '' : tab} reports.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
          {filtered.map(r => {
            const sev = SEV[r.severity] ?? { label: r.severity, color: 'var(--text-dim)' }
            const allImgs = [r.screenshot_url, ...r.extra_screenshot_urls].filter(Boolean) as string[]

            return (
              <div
                key={r.id}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* Card header */}
                <div style={{ padding: '14px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: sev.color,
                  }}>
                    {sev.label}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{timeAgo(r.createdAt)}</span>
                </div>

                {/* Remarks */}
                <p style={{ margin: '0 16px 10px', fontSize: 14, lineHeight: 1.6, color: 'var(--text)', wordBreak: 'break-word' }}>
                  {r.remarks}
                </p>

                {/* Tags */}
                {r.tags && r.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '0 16px 12px' }}>
                    {r.tags.map(tag => (
                      <span key={tag} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--bg-soft)', border: '1px solid var(--line)', color: 'var(--text-dim)' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Screenshots */}
                {allImgs.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0 16px 12px' }}>
                    {allImgs.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`Screenshot ${i + 1}`}
                        onClick={() => setLightbox({ urls: allImgs, idx: i })}
                        style={{
                          height: 80,
                          width: 'auto',
                          maxWidth: 160,
                          borderRadius: 6,
                          cursor: 'zoom-in',
                          flexShrink: 0,
                          border: '1px solid var(--line)',
                          objectFit: 'cover',
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Meta */}
                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {(r.userName || r.userEmail) && (
                    <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      {[r.userName, r.userEmail].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  {r.pageUrl && (
                    <a
                      href={r.pageUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 12, color: 'var(--green)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {r.pageTitle || r.pageUrl}
                    </a>
                  )}
                  {r.deviceInfo && (
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                      {r.deviceInfo.viewport} · {r.deviceInfo.screen} · {r.deviceInfo.dpr}x
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', borderTop: '1px solid var(--line)' }}>
                  <button
                    onClick={() => setStatus(r.id, r.status === 'open' ? 'closed' : 'open')}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: 'transparent',
                      border: 'none',
                      borderRight: '1px solid var(--line)',
                      color: 'var(--text-dim)',
                      fontSize: 13,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {r.status === 'open' ? 'Mark Closed' : 'Reopen'}
                  </button>
                  <button
                    onClick={() => deleteReport(r.id)}
                    style={{
                      padding: '10px 20px',
                      background: 'transparent',
                      border: 'none',
                      color: '#dc2626',
                      fontSize: 13,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <img
            src={lightbox.urls[lightbox.idx]}
            alt="Screenshot"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '88vh', borderRadius: 8, objectFit: 'contain', boxShadow: '0 0 60px rgba(0,0,0,.5)' }}
          />
          {lightbox.urls.length > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); setLightbox(l => l && l.idx > 0 ? { ...l, idx: l.idx - 1 } : l) }}
                style={{ position: 'absolute', left: 16, background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: 24, width: 44, height: 44, borderRadius: '50%', cursor: 'pointer' }}
              >‹</button>
              <button
                onClick={e => { e.stopPropagation(); setLightbox(l => l && l.idx < l.urls.length - 1 ? { ...l, idx: l.idx + 1 } : l) }}
                style={{ position: 'absolute', right: 16, background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: 24, width: 44, height: 44, borderRadius: '50%', cursor: 'pointer' }}
              >›</button>
              <span style={{ position: 'absolute', bottom: 20, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 12, padding: '4px 12px', borderRadius: 20 }}>
                {lightbox.idx + 1} / {lightbox.urls.length}
              </span>
            </>
          )}
          <button
            onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: 18, width: 36, height: 36, borderRadius: '50%', cursor: 'pointer' }}
          >✕</button>
        </div>
      )}
    </div>
  )
}
