'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Search, ArrowLeft, Users, Zap, TrendingUp, Globe } from 'lucide-react'
import Link from 'next/link'

/* ── Types ── */
interface JourneyUser {
  userId: string
  email: string
  name: string
  signedUpAt: string
  signedUpRel: string
  source: string
  utmMedium: string
  country: string
  initialUrl: string
  lastSeen: string | null
  lastSeenRel: string | null
  status: 'active' | 'dormant' | 'churned' | 'new'
  totalEvents: number
  pageviews: number
}

interface JourneyData {
  connected: boolean
  users: JourneyUser[]
}

/* ── Design tokens ── */
const M = {
  bg: '#FAF8F3',
  card: '#FFFFFF',
  border: '#E7E3D7',
  text: '#1E231F',
  muted: '#7A8078',
  muted2: '#9AA098',
  green: '#3E7B58',
  greenSoft: '#E7F2EA',
  amberBg: '#FBF1D8',
  amberText: '#96742A',
  red: '#C1503D',
  redSoft: '#FBEAE7',
  blueBg: '#EEF2FF',
  blueText: '#4338CA',
  shadow: '0 1px 3px rgba(30,35,31,0.07)',
  shadowMd: '0 4px 16px rgba(30,35,31,0.08)',
}

/* ── Helpers ── */
function initials(name: string, email: string): string {
  const n = name.trim()
  if (n) {
    const parts = n.split(' ')
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : n.slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

function avatarColor(str: string): string {
  const colors = [
    { bg: '#E7F2EA', color: '#3E7B58' },
    { bg: '#EEF2FF', color: '#4338CA' },
    { bg: '#FDF2F8', color: '#9D174D' },
    { bg: '#FFF7ED', color: '#C2410C' },
    { bg: '#FBF1D8', color: '#96742A' },
    { bg: '#F0F9FF', color: '#0369A1' },
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return JSON.stringify(colors[Math.abs(hash) % colors.length])
}

function sourceBadgeStyle(source: string): { bg: string; color: string } {
  const s = source.toLowerCase()
  if (s === 'direct') return { bg: '#F0EEE6', color: M.muted }
  if (s.includes('google')) return { bg: '#EEF2FF', color: '#4338CA' }
  if (s.includes('linkedin')) return { bg: '#E8F4FD', color: '#0A66C2' }
  if (s.includes('twitter') || s.includes('x')) return { bg: '#F0F0F0', color: '#14171A' }
  if (s.includes('facebook')) return { bg: '#E7F0FF', color: '#1877F2' }
  if (s.includes('instagram')) return { bg: '#FDF2F8', color: '#C13584' }
  if (s.includes('youtube')) return { bg: '#FFF2F2', color: '#FF0000' }
  if (s.includes('tiktok')) return { bg: '#F0F0F0', color: '#000000' }
  return { bg: M.greenSoft, color: M.green }
}

function statusStyle(status: string): { bg: string; color: string; label: string } {
  if (status === 'active')  return { bg: M.greenSoft, color: M.green, label: 'Active' }
  if (status === 'dormant') return { bg: M.amberBg,  color: M.amberText, label: 'Dormant' }
  if (status === 'churned') return { bg: M.redSoft,  color: M.red, label: 'Churned' }
  return { bg: M.blueBg, color: M.blueText, label: 'New' }
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    const path = u.pathname === '/' ? u.hostname : u.hostname + u.pathname
    return path.length > 32 ? path.slice(0, 32) + '…' : path
  } catch {
    return url.length > 32 ? url.slice(0, 32) + '…' : url
  }
}

/* ── Source breakdown bar ── */
function SourceBar({ users }: { users: JourneyUser[] }) {
  const counts = new Map<string, number>()
  for (const u of users) counts.set(u.source, (counts.get(u.source) ?? 0) + 1)
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const total = users.length || 1

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {sorted.map(([src, cnt]) => {
        const style = sourceBadgeStyle(src)
        const pct = Math.round((cnt / total) * 100)
        return (
          <div key={src} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 99, background: style.bg, color: style.color, fontSize: 12.5, fontWeight: 600 }}>
            {src}
            <span style={{ opacity: 0.7, fontWeight: 400 }}>{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Stat card ── */
function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ElementType }) {
  return (
    <div style={{ background: M.card, border: `1px solid ${M.border}`, borderRadius: 14, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: M.shadow }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: M.greenSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={17} color={M.green} />
      </div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: M.text, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 12, color: M.muted, marginTop: 2 }}>{label}</div>
      </div>
    </div>
  )
}

/* ── User journey row ── */
function UserRow({ user }: { user: JourneyUser }) {
  const av = JSON.parse(avatarColor(user.userId)) as { bg: string; color: string }
  const source = sourceBadgeStyle(user.source)
  const status = statusStyle(user.status)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '40px 1fr auto auto auto auto',
      gap: 16,
      alignItems: 'center',
      padding: '14px 20px',
      borderBottom: `1px solid ${M.border}`,
      background: M.card,
    }}>
      {/* Avatar */}
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: av.bg, color: av.color, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {initials(user.name, user.email)}
      </div>

      {/* Name + journey */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: M.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {user.name || user.email}
        </div>
        {user.name && (
          <div style={{ fontSize: 12, color: M.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.email}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
          {/* Source */}
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: source.bg, color: source.color }}>
            {user.source}
          </span>
          {user.initialUrl && (
            <>
              <span style={{ color: M.muted2, fontSize: 11 }}>→</span>
              <span style={{ fontSize: 11, color: M.muted, fontFamily: 'monospace' }} title={user.initialUrl}>
                {truncateUrl(user.initialUrl)}
              </span>
            </>
          )}
          {user.country && (
            <>
              <span style={{ color: M.muted2, fontSize: 11 }}>·</span>
              <span style={{ fontSize: 11, color: M.muted }}>{user.country}</span>
            </>
          )}
        </div>
      </div>

      {/* Signed up */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: M.muted }}>Signed up</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: M.text }}>{user.signedUpRel}</div>
      </div>

      {/* Last seen */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: M.muted }}>Last seen</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: M.text }}>{user.lastSeenRel ?? '—'}</div>
      </div>

      {/* Events */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: M.muted }}>Events</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: M.text }}>{user.totalEvents}</div>
      </div>

      {/* Status */}
      <div style={{ flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: status.bg, color: status.color }}>
          {status.label}
        </span>
      </div>
    </div>
  )
}

/* ── Main component ── */
export default function JourneyDashboard({ brandId, brandName }: { brandId: string; brandName: string }) {
  const [data, setData] = useState<JourneyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/analytics/user-journeys?brandId=${brandId}`)
      const json = await res.json() as JourneyData
      setData(json)
    } catch {
      setData({ connected: false, users: [] })
    } finally {
      setLoading(false)
    }
  }, [brandId])

  useEffect(() => { load() }, [load])

  const users = data?.users ?? []

  // Derived stats
  const activeCount  = users.filter(u => u.status === 'active').length
  const newCount     = users.filter(u => u.status === 'new').length
  const sources      = Array.from(new Set(users.map(u => u.source))).sort()

  // Filtered list
  const filtered = users.filter(u => {
    if (statusFilter !== 'all' && u.status !== statusFilter) return false
    if (sourceFilter !== 'all' && u.source !== sourceFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!u.email.toLowerCase().includes(q) && !u.name.toLowerCase().includes(q)) return false
    }
    return true
  })

  const topSource = users.length
    ? (() => {
        const c = new Map<string, number>()
        for (const u of users) c.set(u.source, (c.get(u.source) ?? 0) + 1)
        return Array.from(c.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
      })()
    : '—'

  return (
    <div style={{ minHeight: '100vh', background: M.bg, fontFamily: 'var(--font-body, system-ui, sans-serif)' }}>
      {/* Header */}
      <div style={{ background: M.card, borderBottom: `1px solid ${M.border}`, padding: '18px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link href="/authAnalytics" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8, border: `1px solid ${M.border}`, color: M.muted, textDecoration: 'none', flexShrink: 0 }}>
          <ArrowLeft size={16} />
        </Link>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: M.text }}>{brandName} — User Journeys</div>
          <div style={{ fontSize: 12.5, color: M.muted, marginTop: 1 }}>Where users came from, when they signed up, how active they are</div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: `1px solid ${M.border}`, background: M.card, color: M.text, fontSize: 13, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
        >
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px' }}>

        {/* Not connected state */}
        {!loading && data && !data.connected && (
          <div style={{ background: M.card, border: `1px solid ${M.border}`, borderRadius: 16, padding: '48px 32px', textAlign: 'center', boxShadow: M.shadow }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔌</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: M.text, marginBottom: 8 }}>PostHog not connected</div>
            <div style={{ fontSize: 13.5, color: M.muted, maxWidth: 380, margin: '0 auto' }}>
              Connect PostHog in your integrations settings to see user journeys and attribution data.
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 80, background: M.card, borderRadius: 12, border: `1px solid ${M.border}`, opacity: 0.6 }} />
            ))}
          </div>
        )}

        {/* Content */}
        {!loading && data?.connected && (
          <>
            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
              <Stat label="Total Users" value={users.length} icon={Users} />
              <Stat label="Active (last 7d)" value={activeCount} icon={Zap} />
              <Stat label="New Signups" value={newCount} icon={TrendingUp} />
              <Stat label="Top Source" value={topSource} icon={Globe} />
            </div>

            {/* Source breakdown */}
            {users.length > 0 && (
              <div style={{ background: M.card, border: `1px solid ${M.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 20, boxShadow: M.shadow }}>
                <div style={{ fontSize: 12, color: M.muted, marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Traffic Sources</div>
                <SourceBar users={users} />
              </div>
            )}

            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Search */}
              <div style={{ position: 'relative', flex: '1 1 220px' }}>
                <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: M.muted2, pointerEvents: 'none' }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name or email"
                  style={{ width: '100%', padding: '8px 12px 8px 34px', borderRadius: 8, border: `1px solid ${M.border}`, background: M.card, fontSize: 13, color: M.text, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Status filter */}
              <div style={{ display: 'flex', gap: 4 }}>
                {['all', 'active', 'dormant', 'churned', 'new'].map(s => {
                  const active = statusFilter === s
                  return (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      style={{ padding: '6px 13px', borderRadius: 99, border: `1px solid ${active ? M.green : M.border}`, background: active ? M.greenSoft : M.card, color: active ? M.green : M.muted, fontSize: 12.5, fontWeight: active ? 600 : 400, cursor: 'pointer', textTransform: 'capitalize' }}
                    >
                      {s}
                    </button>
                  )
                })}
              </div>

              {/* Source filter */}
              {sources.length > 1 && (
                <select
                  value={sourceFilter}
                  onChange={e => setSourceFilter(e.target.value)}
                  style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${M.border}`, background: M.card, fontSize: 13, color: M.text, cursor: 'pointer', outline: 'none' }}
                >
                  <option value="all">All sources</option>
                  {sources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>

            {/* User table */}
            <div style={{ background: M.card, border: `1px solid ${M.border}`, borderRadius: 14, overflow: 'hidden', boxShadow: M.shadow }}>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr auto auto auto auto',
                gap: 16,
                padding: '10px 20px',
                borderBottom: `1px solid ${M.border}`,
                background: M.bg,
              }}>
                <div />
                <div style={{ fontSize: 11, fontWeight: 700, color: M.muted2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>User</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: M.muted2, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>Signed up</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: M.muted2, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>Last seen</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: M.muted2, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>Events</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: M.muted2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</div>
              </div>

              {filtered.length === 0 ? (
                <div style={{ padding: '48px 32px', textAlign: 'center', color: M.muted, fontSize: 14 }}>
                  No users match your filters.
                </div>
              ) : (
                filtered.map(u => <UserRow key={u.userId} user={u} />)
              )}
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: M.muted2, textAlign: 'right' }}>
              Showing {filtered.length} of {users.length} users · PostHog (last 90 days)
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input:focus { border-color: ${M.green} !important; box-shadow: 0 0 0 3px ${M.greenSoft}; }
      `}</style>
    </div>
  )
}
