'use client'

import { useEffect, useState } from 'react'
import { Globe, UserPlus, KeyRound, Crown, UserMinus, BarChart2, Flame, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react'

interface Channel { name: string; sessions: number }
interface TopPage { page: string; sessions: number; engagementRate: number | null }

interface DailySummary {
  date: string
  brandName: string
  ga4Connected: boolean
  phConnected: boolean
  traffic: {
    visits: number
    visitsPrior: number
    channels: Channel[]
    topPage: TopPage | null
  } | null
  users: {
    signups: number
    signupsPrior: number
    signins: number
    signinsPrior: number
    becamePro: number
    becameProPrior: number
    unsubscribed: number
  } | null
  engagement: {
    dau: number
    dauPrior: number
    dauTrend: { date: string; dau: number }[]
  } | null
  flags: string[]
}

// delta_pct: null means no prior baseline → show → with no %
// prior === 0 treated as no baseline per spec
function Delta({ current, prior }: { current: number; prior: number }) {
  if (prior === 0) {
    return <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>→</span>
  }
  const pct = Math.round(((current - prior) / prior) * 100)
  if (pct === 0) return <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>→ 0%</span>
  const up = pct > 0
  return (
    <span style={{ fontSize: 12, color: up ? 'var(--green-bright)' : '#f87171', fontWeight: 500 }}>
      {up ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  )
}

const Divider = () => <div style={{ height: 1, background: 'var(--line)' }} />

export default function DailySummaryCard() {
  const [data, setData]       = useState<DailySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analytics/daily-summary')
      if (!res.ok) throw new Error(await res.text())
      setData(await res.json())
    } catch {
      setError('Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 120 }}>
      <Loader2 size={18} color='var(--text-dim)' style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  )

  if (error || !data) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 80, color: '#f87171', fontSize: 13 }}>
      {error ?? 'No data'}
    </div>
  )

  const { traffic, users, engagement } = data
  const flags = data.flags ?? []

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--line)',
      borderRadius: 12,
      overflow: 'hidden',
      maxWidth: 420,
    }}>
      {/* Header */}
      <div style={{ padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
          Daily Summary
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{data.date}</span>
          <button
            onClick={load}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 0, display: 'flex' }}
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      <Divider />

      {/* Traffic */}
      {traffic ? (
        <div style={{ padding: '12px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Globe size={14} color='var(--text-dim)' />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Website visits</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{traffic.visits}</span>
              <Delta current={traffic.visits} prior={traffic.visitsPrior} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 21 }}>
            {traffic.channels.map(ch => (
              <div key={ch.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{ch.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{ch.sessions}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text-faint)' }}>
          Connect Google Analytics to see traffic.
        </div>
      )}

      <Divider />

      {/* Users */}
      {users ? (
        <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { icon: <UserPlus size={13} color='var(--text-dim)' />, label: 'New signups',   current: users.signups,      prior: users.signupsPrior },
            { icon: <KeyRound  size={13} color='var(--text-dim)' />, label: 'Sign-ins',      current: users.signins,      prior: users.signinsPrior },
            { icon: <Crown     size={13} color='var(--gold)'     />, label: 'Became PRO',   current: users.becamePro,    prior: users.becameProPrior },
            { icon: <UserMinus size={13} color='var(--text-dim)' />, label: 'Unsubscribed', current: users.unsubscribed, prior: null as number | null },
          ].map(({ icon, label, current, prior }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                {icon}
                <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{current}</span>
                {prior !== null && <Delta current={current} prior={prior} />}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text-faint)' }}>
          Connect PostHog to see user metrics.
        </div>
      )}

      <Divider />

      {/* Engagement */}
      <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {engagement ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <BarChart2 size={13} color='var(--text-dim)' />
              <span style={{ fontSize: 13, color: 'var(--text)' }}>Daily active users</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{engagement.dau}</span>
              <Delta current={engagement.dau} prior={engagement.dauPrior} />
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Connect PostHog to see engagement.</span>
        )}

        {traffic?.topPage && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Flame size={13} color='var(--text-dim)' />
              <span style={{ fontSize: 13, color: 'var(--text)' }}>Top page</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {traffic.topPage.page} ({traffic.topPage.sessions} sessions{traffic.topPage.engagementRate != null ? `, ${traffic.topPage.engagementRate}%` : ''})
            </span>
          </div>
        )}
      </div>

      {/* Flags — up to 2, spec says cap there */}
      {flags.length > 0 && (
        <>
          <Divider />
          <div style={{ padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {flags.slice(0, 2).map((flag, i) => (
              <div key={i} style={{
                background: 'rgba(231, 200, 115, 0.07)',
                border: '1px solid rgba(231, 200, 115, 0.18)',
                borderRadius: 7,
                padding: '8px 12px',
                display: 'flex', alignItems: 'flex-start', gap: 7,
              }}>
                <AlertTriangle size={13} color='var(--gold)' style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--gold)', lineHeight: 1.5 }}>{flag}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
