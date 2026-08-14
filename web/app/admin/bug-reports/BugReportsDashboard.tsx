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
  deviceInfo: DeviceInfo | null
  screenshotKey: string | null
  extraScreenshotKeys: string[] | null
  status: string
  createdAt: string
  screenshot_url: string | null
  extra_screenshot_urls: string[]
}

const SEV_BADGE: Record<string, { label: string; color: string }> = {
  bug:        { label: 'Bug',        color: '#ef4444' },
  suggestion: { label: 'Suggestion', color: '#eab308' },
  question:   { label: 'Question',   color: '#3b82f6' },
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

  // Keyboard nav for lightbox
  useEffect(() => {
    if (!lightbox) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === 'ArrowRight') setLightbox(l => l && l.idx < l.urls.length - 1 ? { ...l, idx: l.idx + 1 } : l)
      if (e.key === 'ArrowLeft') setLightbox(l => l && l.idx > 0 ? { ...l, idx: l.idx - 1 } : l)
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

  const filtered = reports.filter(r =>
    tab === 'all' ? true : r.status === tab
  )

  const counts = {
    open:   reports.filter(r => r.status === 'open').length,
    closed: reports.filter(r => r.status === 'closed').length,
    all:    reports.length,
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #0a1410)', color: 'var(--text, #e8f3ec)', fontFamily: 'system-ui, sans-serif', padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#e8f3ec' }}>Bug Reports</h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#8aa897' }}>{counts.open} open</p>
        </div>
        <a href="/admin" style={{ fontSize: '13px', color: '#8aa897', textDecoration: 'none' }}>← Admin</a>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {(['open', 'closed', 'all'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: '1px solid',
              borderColor: tab === t ? '#2fbf71' : '#1e3a30',
              background: tab === t ? '#2fbf71' : '#122620',
              color: tab === t ? '#0a1410' : '#8aa897',
              fontWeight: tab === t ? 600 : 400,
              fontSize: '13px',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t} ({counts[t]})
          </button>
        ))}
      </div>

      {/* Cards */}
      {loading ? (
        <p style={{ color: '#8aa897' }}>Loading...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#8aa897' }}>No {tab === 'all' ? '' : tab} reports.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
          {filtered.map(r => {
            const sev = SEV_BADGE[r.severity] ?? { label: r.severity, color: '#8aa897' }
            const allImgs = [r.screenshot_url, ...r.extra_screenshot_urls].filter(Boolean) as string[]

            return (
              <div
                key={r.id}
                style={{
                  background: '#122620',
                  border: '1px solid #1e3a30',
                  borderRadius: '10px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {/* Severity + time */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ background: sev.color + '22', color: sev.color, border: `1px solid ${sev.color}55`, borderRadius: '12px', padding: '2px 10px', fontSize: '12px', fontWeight: 600 }}>
                    {sev.label}
                  </span>
                  <span style={{ fontSize: '12px', color: '#8aa897' }}>{timeAgo(r.createdAt)}</span>
                </div>

                {/* Remarks */}
                <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5, color: '#e8f3ec' }}>{r.remarks}</p>

                {/* Screenshots */}
                {allImgs.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
                    {allImgs.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`Screenshot ${i + 1}`}
                        onClick={() => setLightbox({ urls: allImgs, idx: i })}
                        style={{ height: '72px', width: 'auto', borderRadius: '6px', cursor: 'zoom-in', flexShrink: 0, border: '1px solid #1e3a30' }}
                      />
                    ))}
                  </div>
                )}

                {/* Meta */}
                <div style={{ fontSize: '12px', color: '#8aa897', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {(r.userName || r.userEmail) && (
                    <span>{r.userName ?? ''}{r.userName && r.userEmail ? ' — ' : ''}{r.userEmail ?? ''}</span>
                  )}
                  {r.pageUrl && (
                    <a href={r.pageUrl} target="_blank" rel="noreferrer" style={{ color: '#2fbf71', wordBreak: 'break-all' }}>
                      {r.pageTitle || r.pageUrl}
                    </a>
                  )}
                  {r.deviceInfo && (
                    <span>{r.deviceInfo.viewport} · {r.deviceInfo.screen} · {r.deviceInfo.dpr}x</span>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button
                    onClick={() => setStatus(r.id, r.status === 'open' ? 'closed' : 'open')}
                    style={{ flex: 1, padding: '6px', borderRadius: '6px', border: '1px solid #1e3a30', background: '#0a1410', color: '#e8f3ec', fontSize: '12px', cursor: 'pointer' }}
                  >
                    {r.status === 'open' ? 'Mark Closed' : 'Reopen'}
                  </button>
                  <button
                    onClick={() => deleteReport(r.id)}
                    style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #3f1515', background: '#200a0a', color: '#ef4444', fontSize: '12px', cursor: 'pointer' }}
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
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <button
            onClick={e => { e.stopPropagation(); setLightbox(l => l && l.idx > 0 ? { ...l, idx: l.idx - 1 } : l) }}
            style={{ position: 'absolute', left: '16px', background: 'rgba(255,255,255,.1)', border: 'none', color: '#fff', fontSize: '24px', width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer' }}
          >
            &#8249;
          </button>
          <img
            src={lightbox.urls[lightbox.idx]}
            alt="Screenshot"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px', objectFit: 'contain' }}
          />
          <button
            onClick={e => { e.stopPropagation(); setLightbox(l => l && l.idx < l.urls.length - 1 ? { ...l, idx: l.idx + 1 } : l) }}
            style={{ position: 'absolute', right: '16px', background: 'rgba(255,255,255,.1)', border: 'none', color: '#fff', fontSize: '24px', width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer' }}
          >
            &#8250;
          </button>
          <span style={{ position: 'absolute', bottom: '16px', color: '#fff', fontSize: '13px' }}>
            {lightbox.idx + 1} / {lightbox.urls.length}
          </span>
          <button
            onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: '#fff', fontSize: '24px', cursor: 'pointer' }}
          >
            &#x2715;
          </button>
        </div>
      )}
    </div>
  )
}
