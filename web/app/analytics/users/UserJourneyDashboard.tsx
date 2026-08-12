'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw, ChevronDown, ChevronUp, Globe, Zap } from 'lucide-react'

/* ── Types ──────────────────────────────────────────── */
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

interface ApiResponse {
  connected: boolean
  users: JourneyUser[]
}

/* ── Source colors ──────────────────────────────────── */
const SOURCE_COLORS: Record<string, { bg: string; color: string }> = {
  'Facebook':   { bg: '#1877f220', color: '#6495ed' },
  'Instagram':  { bg: '#e1306c20', color: '#e1306c' },
  'Google':     { bg: '#4ade8020', color: '#4ade80' },
  'LinkedIn':   { bg: '#0a66c220', color: '#60a5fa' },
  'Twitter/X':  { bg: '#ffffff15', color: '#94a3b8' },
  'YouTube':    { bg: '#ff000020', color: '#f87171' },
  'TikTok':     { bg: '#69c9d020', color: '#5eead4' },
  'Direct':     { bg: '#8aa89720', color: '#8aa897' },
}
function sourceStyle(source: string) {
  return SOURCE_COLORS[source] ?? { bg: '#a78bfa20', color: '#a78bfa' }
}

/* ── Status ─────────────────────────────────────────── */
const STATUS_STYLE = {
  active:  { bg: '#4ade8018', color: '#4ade80', label: 'Active'   },
  dormant: { bg: '#e7c87318', color: '#e7c873', label: 'Dormant'  },
  churned: { bg: '#f8717118', color: '#f87171', label: 'Churned'  },
  new:     { bg: '#a78bfa18', color: '#a78bfa', label: 'New'      },
}

/* ── Avatar ─────────────────────────────────────────── */
function Avatar({ name, email }: { name: string; email: string }) {
  const initials = name
    ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : email.slice(0, 2).toUpperCase()
  return (
    <div style={{
      width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
      background: 'var(--green)20', border: '1px solid var(--green)40',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700, color: 'var(--green)',
    }}>
      {initials}
    </div>
  )
}

/* ── Journey Trail ──────────────────────────────────── */
function JourneyTrail({ user }: { user: JourneyUser }) {
  const steps: { label: string; sub: string; color: string }[] = []

  // Step 1: source
  const ss = sourceStyle(user.source)
  steps.push({ label: user.source, sub: user.utmMedium || 'referral', color: ss.color })

  // Step 2: website visit (if we have an initial URL)
  if (user.initialUrl && user.initialUrl !== 'null' && user.initialUrl !== '') {
    let path = user.initialUrl
    try { path = new URL(user.initialUrl).pathname } catch { /* keep raw */ }
    steps.push({ label: 'Website', sub: path, color: '#60a5fa' })
  }

  // Step 3: signed up
  steps.push({ label: 'Signed up', sub: user.signedUpRel, color: '#4ade80' })

  // Step 4: activity
  if (user.totalEvents > 0) {
    steps.push({
      label: user.status === 'active' ? 'Active' : user.status === 'dormant' ? 'Gone quiet' : 'Churned',
      sub: user.lastSeenRel ? `last seen ${user.lastSeenRel}` : '',
      color: STATUS_STYLE[user.status].color,
    })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', marginTop: 10 }}>
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          <div style={{
            display: 'flex', flexDirection: 'column',
            background: `${step.color}15`, border: `1px solid ${step.color}35`,
            borderRadius: 8, padding: '5px 10px', minWidth: 0,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: step.color }}>{step.label}</span>
            {step.sub && <span style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.sub}</span>}
          </div>
          {i < steps.length - 1 && (
            <div style={{ fontSize: 14, color: 'var(--text-faint)', padding: '0 4px', flexShrink: 0 }}>→</div>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

/* ── User Row ────────────────────────────────────────── */
function UserRow({ user }: { user: JourneyUser }) {
  const [expanded, setExpanded] = useState(false)
  const ss = sourceStyle(user.source)
  const st = STATUS_STYLE[user.status]

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--line)',
      borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.15s',
    }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 14,
          padding: '14px 18px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <Avatar name={user.name} email={user.email} />

        {/* Name + email */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.name || user.email}
          </div>
          {user.name && (
            <div style={{ fontSize: 11, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.email}
            </div>
          )}
        </div>

        {/* Source badge */}
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99,
          background: ss.bg, color: ss.color, border: `1px solid ${ss.color}30`,
          flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          {user.source}
        </span>

        {/* Country */}
        {user.country && user.country !== 'null' && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Globe size={11} />
            {user.country}
          </span>
        )}

        {/* Signed up */}
        <span style={{ fontSize: 11, color: 'var(--text-dim)', flexShrink: 0, minWidth: 60, textAlign: 'right' }}>
          {user.signedUpRel}
        </span>

        {/* Events count */}
        <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, minWidth: 48, textAlign: 'right' }}>
          <Zap size={10} />
          {user.totalEvents}
        </span>

        {/* Status badge */}
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
          background: st.bg, color: st.color, border: `1px solid ${st.color}30`,
          flexShrink: 0, letterSpacing: '0.04em',
        }}>
          {st.label}
        </span>

        {expanded ? <ChevronUp size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />}
      </button>

      {expanded && (
        <div style={{ padding: '0 18px 16px', borderTop: '1px solid var(--line)' }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: 8, marginTop: 14 }}>
            Journey
          </p>
          <JourneyTrail user={user} />

          {/* Extra detail row */}
          <div style={{ display: 'flex', gap: 24, marginTop: 14, flexWrap: 'wrap' }}>
            {user.lastSeenRel && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 2 }}>Last seen</div>
                <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{user.lastSeenRel}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 2 }}>Total events</div>
              <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{user.totalEvents.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 2 }}>Page views</div>
              <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{user.pageviews.toLocaleString()}</div>
            </div>
            {user.country && user.country !== 'null' && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 2 }}>Country</div>
                <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{user.country}</div>
              </div>
            )}
            {user.initialUrl && user.initialUrl !== 'null' && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 2 }}>First landing URL</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.initialUrl}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Summary stats ──────────────────────────────────── */
function SummaryBar({ users }: { users: JourneyUser[] }) {
  const total   = users.length
  const active  = users.filter(u => u.status === 'active').length
  const dormant = users.filter(u => u.status === 'dormant').length
  const churned = users.filter(u => u.status === 'churned').length

  // source breakdown
  const sourceCounts: Record<string, number> = {}
  for (const u of users) sourceCounts[u.source] = (sourceCounts[u.source] ?? 0) + 1
  const topSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 4)

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
      {[
        { label: 'Total users', value: total, color: 'var(--text)' },
        { label: 'Active',      value: active,  color: '#4ade80' },
        { label: 'Dormant',     value: dormant, color: '#e7c873' },
        { label: 'Churned',     value: churned, color: '#f87171' },
      ].map(s => (
        <div key={s.label} style={{
          background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12,
          padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{s.label}</div>
        </div>
      ))}
      {topSources.map(([src, count]) => {
        const ss = sourceStyle(src)
        return (
          <div key={src} style={{
            background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12,
            padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: ss.color, lineHeight: 1 }}>{count}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>via {src}</div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Main component ─────────────────────────────────── */
export default function UserJourneyDashboard({ brand }: { brand: { id: string; name: string } }) {
  const router = useRouter()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sourceFilter, setSourceFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [search, setSearch] = useState('')

  const load = () => {
    setLoading(true)
    fetch(`/api/analytics/user-journeys?brandId=${brand.id}`)
      .then(r => r.json())
      .then((d: ApiResponse) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [brand.id])

  const allSources = useMemo(() => {
    if (!data?.users) return []
    const set = new Set(data.users.map(u => u.source))
    return ['All', ...Array.from(set).sort()]
  }, [data])

  const filtered = useMemo(() => {
    if (!data?.users) return []
    return data.users.filter(u => {
      if (sourceFilter !== 'All' && u.source !== sourceFilter) return false
      if (statusFilter !== 'All' && u.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!u.email.toLowerCase().includes(q) && !u.name.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [data, sourceFilter, statusFilter, search])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              onClick={() => router.push('/analytics')}
              style={{
                width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer',
              }}
            >
              <ArrowLeft size={15} />
            </button>
            <div>
              <h1 style={{
                fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
                fontFamily: 'var(--font-display, Fraunces, serif)', margin: 0,
              }}>
                User Journeys
              </h1>
              <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                {brand.name} · where users come from and what they do
              </p>
            </div>
          </div>
          <button
            onClick={load}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
              padding: '7px 14px', borderRadius: 99, border: '1px solid var(--line)',
              background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer',
            }}
          >
            <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>

        {/* Not connected */}
        {!loading && data && !data.connected && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>PostHog not connected</p>
            <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Go to Settings → Integrations → PostHog to connect.</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, height: 62, opacity: 0.5 }} />
            ))}
          </div>
        )}

        {/* Loaded */}
        {!loading && data?.connected && (
          <>
            {/* Summary stats */}
            <SummaryBar users={data.users} />

            {/* Filters row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {/* Search */}
              <input
                placeholder="Search by name or email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  flex: 1, minWidth: 200, maxWidth: 280,
                  background: 'var(--card)', border: '1px solid var(--line)',
                  borderRadius: 99, padding: '7px 16px', fontSize: 12,
                  color: 'var(--text)', outline: 'none',
                }}
              />

              {/* Source filter */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {allSources.map(s => (
                  <button key={s} onClick={() => setSourceFilter(s)} style={{
                    fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 99,
                    border: '1px solid var(--line)', cursor: 'pointer', transition: 'all 0.15s',
                    background: sourceFilter === s ? 'var(--text)' : 'transparent',
                    color: sourceFilter === s ? 'var(--bg)' : 'var(--text-dim)',
                  }}>
                    {s}
                  </button>
                ))}
              </div>

              {/* Status filter */}
              <div style={{ display: 'flex', gap: 4 }}>
                {(['All', 'active', 'dormant', 'churned', 'new'] as const).map(s => {
                  const st = s === 'All' ? null : STATUS_STYLE[s]
                  return (
                    <button key={s} onClick={() => setStatusFilter(s)} style={{
                      fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 99,
                      border: `1px solid ${statusFilter === s && st ? st.color + '60' : 'var(--line)'}`,
                      cursor: 'pointer', transition: 'all 0.15s',
                      background: statusFilter === s ? (st ? st.bg : 'var(--text)') : 'transparent',
                      color: statusFilter === s ? (st ? st.color : 'var(--bg)') : 'var(--text-dim)',
                      textTransform: 'capitalize',
                    }}>
                      {s}
                    </button>
                  )
                })}
              </div>

              <span style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 4 }}>
                {filtered.length} user{filtered.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* User list */}
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-faint)', fontSize: 13 }}>
                No users match the current filters.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map(u => <UserRow key={u.userId} user={u} />)}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}
