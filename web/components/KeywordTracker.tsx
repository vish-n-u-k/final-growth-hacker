'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { GscKeywordRow, SuggestionRow, TrackedWithGsc } from '@/app/api/keywords/route'

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function DeltaChip({ value }: { value: number | null }) {
  if (value === null || value === 0) return <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>—</span>
  const improved = value > 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 600, color: improved ? 'var(--green-bright)' : '#f87171' }}>
      {improved ? '▲' : '▼'} {Math.abs(value).toFixed(1)}
    </span>
  )
}

function IntentBadge({ intent }: { intent: string | null }) {
  if (!intent) return null
  const map: Record<string, { bg: string; color: string }> = {
    informational: { bg: 'rgba(147,197,253,0.12)', color: '#93c5fd' },
    commercial:    { bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24' },
    transactional: { bg: 'rgba(74,222,128,0.12)',  color: '#4ade80' },
  }
  const s = map[intent] ?? { bg: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }
  return (
    <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
      {intent}
    </span>
  )
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source || source === 'ai_suggested') return null
  const label = source === 'site_scan' ? 'Site Scan' : source === 'gsc_import' ? 'GSC' : source
  const color = source === 'gsc_import' ? '#34d399' : '#93c5fd'
  const bg = source === 'gsc_import' ? 'rgba(52,211,153,0.1)' : 'rgba(147,197,253,0.1)'
  return (
    <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: bg, color, letterSpacing: '0.02em' }}>
      {label}
    </span>
  )
}

function SpinnerIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10"/>
    </svg>
  )
}

function GscConnectForm({ onConnected }: { onConnected: () => void }) {
  const [clientEmail, setClientEmail] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!clientEmail.trim() || !privateKey.trim()) { setErr('Both fields are required.'); return }
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/settings/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'gsc_api', fields: { client_email: clientEmail.trim(), private_key: privateKey.trim() } }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to save')
      onConnected()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Unknown error') }
    finally { setSaving(false) }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)',
    background: 'rgba(255,255,255,0.03)', color: 'var(--text)', fontSize: 13,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ borderRadius: 12, border: '1px solid var(--line)', background: 'var(--card)', padding: '28px 32px', maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--gold)', flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
          <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Connect Google Search Console</h2>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24, lineHeight: 1.55 }}>
        Uses a service account key — no OAuth needed.
      </p>
      <ol style={{ margin: '0 0 24px', padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          <>Go to <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green-bright)' }}>Google Cloud → Service Accounts</a> → Create service account</>,
          <>Keys tab → Add Key → JSON → download the file</>,
          <>Copy <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>client_email</code> and <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>private_key</code></>,
          <>In <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green-bright)' }}>Search Console</a> → Settings → Users → add the service account as Full user</>,
        ].map((step, i) => <li key={i} style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{step}</li>)}
      </ol>
      <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }}>Service Account Email</label>
          <input type="text" value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="myapp@myproject.iam.gserviceaccount.com" style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--green)')} onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }}>Private Key</label>
          <textarea value={privateKey} onChange={e => setPrivateKey(e.target.value)} placeholder={'-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----'}
            rows={5} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--green)')} onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')} />
        </div>
        {err && <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>{err}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="submit" disabled={saving} style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'inherit' }}>
            {saving ? 'Connecting…' : 'Connect GSC'}
          </button>
          <a href="/settings?tab=integrations" style={{ fontSize: 12.5, color: 'var(--text-dim)', textDecoration: 'none' }}>Manage in Settings →</a>
        </div>
      </form>
    </div>
  )
}

export default function KeywordTracker({ brandName, seoAnalyzed }: { brandName: string; seoAnalyzed: boolean }) {
  const router = useRouter()
  const [hasGsc, setHasGsc] = useState(true)
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null)
  const [gscSummary, setGscSummary] = useState<{ clicks7d: number; impressions7d: number } | null>(null)
  const [gscKeywords, setGscKeywords] = useState<GscKeywordRow[]>([])
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([])
  const [tracking, setTracking] = useState<TrackedWithGsc[]>([])
  const [implemented, setImplemented] = useState<TrackedWithGsc[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<{ count: number } | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [trackingGscKw, setTrackingGscKw] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/keywords')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to fetch')
      setHasGsc(json.hasGsc)
      setLastFetchedAt(json.lastFetchedAt)
      setGscSummary(json.gscSummary ?? null)
      setGscKeywords(json.gscKeywords ?? [])
      setSuggestions(json.suggestions ?? [])
      setTracking(json.tracking ?? [])
      setImplemented(json.implemented ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleTrackGsc(keyword: string) {
    setTrackingGscKw(prev => new Set(prev).add(keyword))
    setError(null)
    try {
      const res = await fetch('/api/keywords/track-gsc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword }),
      })
      if (!res.ok) throw new Error('Failed to track keyword')
      await fetchData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setTrackingGscKw(prev => { const n = new Set(prev); n.delete(keyword); return n })
    }
  }

  async function handleScanSite() {
    setScanning(true); setError(null)
    try {
      const res = await fetch('/api/keywords/scan-site', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Scan failed')
      setScanResult({ count: json.count })
      await fetchData()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setScanning(false) }
  }

  async function handleSuggest() {
    setSuggesting(true); setError(null)
    try {
      const res = await fetch('/api/keywords/suggest', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Suggest failed')
      setSuggestions(json.suggestions ?? [])
      setSuggestionsOpen(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setSuggesting(false) }
  }

  async function handleRefresh() {
    setRefreshing(true); setError(null)
    try {
      const res = await fetch('/api/keywords/refresh', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Refresh failed')
      await fetchData()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setRefreshing(false) }
  }

  async function handleStatus(id: string, status: string) {
    setError(null)
    try {
      const res = await fetch(`/api/keywords/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Update failed')
      await fetchData()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
  }

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600,
    color: 'var(--text-dim)', background: 'var(--card)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
  }
  const tdStyle: React.CSSProperties = {
    padding: '10px 14px', fontSize: 13, color: 'var(--text)', borderBottom: '1px solid rgba(255,255,255,0.04)',
  }

  const allTracked = [...tracking, ...implemented]
  const hasSiteScan = allTracked.some(k => k.source === 'site_scan')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-body)' }}>

      {/* Header */}
      <header style={{ borderBottom: '1px solid var(--line)', background: 'var(--card)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => router.push('/dashboard')} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Dashboard
          </button>
          <span style={{ color: 'var(--line)' }}>/</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Keyword Strategy</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            {lastFetchedAt && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>GSC updated {timeAgo(lastFetchedAt)}</span>}
            <button onClick={handleRefresh} disabled={refreshing || !hasGsc} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8,
              border: '1px solid var(--green)', background: 'transparent', color: 'var(--green-bright)',
              fontSize: 13, fontWeight: 600, cursor: refreshing || !hasGsc ? 'not-allowed' : 'pointer',
              opacity: !hasGsc ? 0.5 : 1, fontFamily: 'inherit',
            }}>
              {refreshing ? <><SpinnerIcon /> Refreshing…</> : 'Refresh GSC'}
            </button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Page title */}
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.5px', marginBottom: 4 }}>Keyword Strategy</h1>
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            Track ranking changes for <strong style={{ color: 'var(--text)' }}>{brandName}</strong>
          </p>
        </div>

        {!hasGsc && <GscConnectForm onConnected={() => { setHasGsc(true); fetchData() }} />}
        {error && (
          <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* ── GSC Rankings table (Option 3) ─────────────────────────────────── */}
        {(gscKeywords.length > 0 || (hasGsc && !loading)) && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 }}>GSC Rankings</h2>
                <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                  Keywords Google is tracking your site for · click Track to monitor changes
                </p>
              </div>
              {gscSummary && (
                <div style={{ display: 'flex', gap: 20 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                    Clicks this week: <strong style={{ color: 'var(--green-bright)' }}>{gscSummary.clicks7d.toLocaleString()}</strong>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                    Impressions: <strong style={{ color: 'var(--text)' }}>{gscSummary.impressions7d.toLocaleString()}</strong>
                  </span>
                </div>
              )}
            </div>

            <div style={{ borderRadius: 12, border: '1px solid var(--line)', overflow: 'hidden' }}>
              {loading ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>Loading…</div>
              ) : gscKeywords.length === 0 ? (
                <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>No GSC data yet</p>
                  <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                    {hasGsc ? 'Click Refresh GSC to pull your first keyword snapshot.' : 'Connect Google Search Console first, then click Refresh GSC.'}
                  </p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, minWidth: 220 }}>Keyword</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Position</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Impressions</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Clicks</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>CTR</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gscKeywords.map(kw => {
                        const isTracking = trackingGscKw.has(kw.keyword)
                        const alreadyActive = kw.trackedStatus === 'tracking' || kw.trackedStatus === 'implemented'
                        return (
                          <tr key={kw.keyword}
                            onMouseEnter={e => { (e.currentTarget.style.background = 'rgba(255,255,255,0.02)') }}
                            onMouseLeave={e => { (e.currentTarget.style.background = 'transparent') }}
                          >
                            <td style={tdStyle}>{kw.keyword}</td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {kw.position.toFixed(1)}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {kw.impressions.toLocaleString()}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {kw.clicks.toLocaleString()}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {(kw.ctr * 100).toFixed(1)}%
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'right' }}>
                              {alreadyActive ? (
                                <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: 'rgba(74,222,128,0.1)', color: 'var(--green-bright)', fontWeight: 600 }}>
                                  {kw.trackedStatus === 'implemented' ? 'Done' : 'Tracking'}
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleTrackGsc(kw.keyword)}
                                  disabled={isTracking}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                    padding: '4px 12px', borderRadius: 5, border: '1px solid var(--green)',
                                    background: 'transparent', color: 'var(--green-bright)', fontSize: 12,
                                    fontWeight: 600, cursor: isTracking ? 'not-allowed' : 'pointer',
                                    opacity: isTracking ? 0.6 : 1, fontFamily: 'inherit',
                                  }}
                                >
                                  {isTracking ? <><SpinnerIcon /> Tracking…</> : 'Track'}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Track My Website card ──────────────────────────────────────────── */}
        <div style={{
          borderRadius: 12, border: `1px solid ${seoAnalyzed ? 'var(--green)' : 'var(--line)'}`,
          background: 'var(--card)', padding: '18px 22px',
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: seoAnalyzed ? 'rgba(47,191,113,0.12)' : 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: seoAnalyzed ? 'var(--green-bright)' : 'var(--text-dim)' }}>
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Track My Website</span>
              {hasSiteScan && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 20, background: 'rgba(74,222,128,0.1)', color: 'var(--green-bright)', fontWeight: 600 }}>Active</span>}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0, lineHeight: 1.4 }}>
              {seoAnalyzed
                ? hasSiteScan
                  ? 'Scanned page content for targeted keywords. Re-scan after updating your pages.'
                  : 'Scan your page title, H1, and headings to import keywords your site already targets.'
                : 'Complete the SEO audit first to enable this scan.'}
            </p>
            {scanResult && (
              <p style={{ fontSize: 11, color: 'var(--green-bright)', marginTop: 4 }}>
                {scanResult.count > 0 ? `${scanResult.count} keyword${scanResult.count !== 1 ? 's' : ''} added` : 'All keywords already tracked'}
              </p>
            )}
          </div>
          {seoAnalyzed ? (
            <button onClick={handleScanSite} disabled={scanning} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px', borderRadius: 8,
              border: 'none', background: scanning ? 'rgba(47,191,113,0.15)' : 'var(--green)',
              color: scanning ? 'var(--green-bright)' : '#fff', fontSize: 13, fontWeight: 600,
              cursor: scanning ? 'not-allowed' : 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}>
              {scanning ? <><SpinnerIcon /> Scanning…</> : hasSiteScan ? 'Re-scan' : 'Scan Site'}
            </button>
          ) : (
            <button onClick={() => router.push('/dashboard')} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
              Go to SEO Audit →
            </button>
          )}
        </div>

        {/* ── Your Keywords table (tracked + implemented) ────────────────────── */}
        {allTracked.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Your Keywords</h2>
                <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                  Keywords you are actively targeting · position data via fuzzy GSC match
                </p>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 13, color: 'var(--text-dim)' }}>
                <span>Tracking <strong style={{ color: 'var(--text)' }}>{tracking.length}</strong></span>
                <span>Done <strong style={{ color: 'var(--text)' }}>{implemented.length}</strong></span>
              </div>
            </div>
            <div style={{ borderRadius: 12, border: '1px solid var(--line)', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, minWidth: 200 }}>Keyword</th>
                      <th style={thStyle}>Status</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Position</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Change</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Impressions</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Clicks</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allTracked.map(kw => (
                      <tr key={kw.id}
                        onMouseEnter={e => { (e.currentTarget.style.background = 'rgba(255,255,255,0.02)') }}
                        onMouseLeave={e => { (e.currentTarget.style.background = 'transparent') }}
                      >
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600 }}>{kw.keyword}</span>
                            <SourceBadge source={kw.source} />
                          </div>
                          {kw.aiReason && (
                            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.4 }}>{kw.aiReason}</div>
                          )}
                        </td>
                        <td style={tdStyle}>
                          {kw.status === 'implemented'
                            ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: 'rgba(74,222,128,0.1)', color: 'var(--green-bright)', fontSize: 11, fontWeight: 600 }}>Done</span>
                            : <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: 'rgba(231,200,115,0.1)', color: 'var(--gold)', fontSize: 11, fontWeight: 600 }}>Tracking</span>
                          }
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {kw.currentPosition !== null ? kw.currentPosition.toFixed(1) : '—'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <DeltaChip value={kw.positionDelta} />
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {kw.impressions !== null ? kw.impressions.toLocaleString() : '—'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {kw.clicks !== null ? kw.clicks.toLocaleString() : '—'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {kw.status === 'tracking' && (
                              <button onClick={() => handleStatus(kw.id, 'implemented')} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--green)', background: 'transparent', color: 'var(--green-bright)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                                Mark Done
                              </button>
                            )}
                            <button onClick={() => handleStatus(kw.id, 'dismissed')} style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                              Stop
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>
              Change = position delta since tracking started · ▲ improved · Position data matched via partial GSC query overlap
            </p>
          </div>
        )}

        {/* ── AI Suggestions ─────────────────────────────────────────────────── */}
        <div style={{ borderRadius: 12, border: '1px solid var(--line)', overflow: 'hidden' }}>
          <div
            style={{ padding: '14px 20px', background: 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderBottom: suggestionsOpen ? '1px solid var(--line)' : 'none' }}
            onClick={() => setSuggestionsOpen(o => !o)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>AI Keyword Suggestions</span>
              {suggestions.length > 0 && (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(47,191,113,0.12)', color: 'var(--green-bright)', fontWeight: 600 }}>{suggestions.length}</span>
              )}
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>gap keywords to target next</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={e => { e.stopPropagation(); handleSuggest() }} disabled={suggesting} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 7, border: '1px solid var(--green)', background: 'transparent', color: 'var(--green-bright)', fontSize: 12, fontWeight: 600, cursor: suggesting ? 'not-allowed' : 'pointer', opacity: suggesting ? 0.7 : 1, fontFamily: 'inherit' }}>
                {suggesting ? <><SpinnerIcon /> Generating…</> : 'Suggest Keywords'}
              </button>
              <span style={{ fontSize: 14, color: 'var(--text-dim)', userSelect: 'none', minWidth: 14, textAlign: 'center' }}>{suggestionsOpen ? '−' : '+'}</span>
            </div>
          </div>
          {suggestionsOpen && (
            <div>
              {suggestions.length === 0 ? (
                <div style={{ padding: '36px 20px', textAlign: 'center' }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>No suggestions yet</p>
                  <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Click &quot;Suggest Keywords&quot; to get AI-recommended gap keywords.</p>
                </div>
              ) : (
                suggestions.map((s, i) => (
                  <div key={s.id} style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderBottom: i < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 180, flex: '1 1 180px' }}>{s.keyword}</span>
                    <IntentBadge intent={s.aiIntent} />
                    <span style={{ fontSize: 13, color: 'var(--text-dim)', flex: '2 1 220px', lineHeight: 1.4 }}>{s.aiReason}</span>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button onClick={() => handleStatus(s.id, 'tracking')} style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid var(--green)', background: 'transparent', color: 'var(--green-bright)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Track</button>
                      <button onClick={() => handleStatus(s.id, 'dismissed')} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Dismiss</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Empty state */}
        {allTracked.length === 0 && gscKeywords.length === 0 && !loading && (
          <div style={{ borderRadius: 12, border: '1px solid var(--line)', padding: '52px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>No keyword data yet</p>
            <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              {hasGsc ? 'Click Refresh GSC to pull your first keyword snapshot from Google Search Console.' : 'Connect Google Search Console above, then click Refresh GSC.'}
            </p>
          </div>
        )}

      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
