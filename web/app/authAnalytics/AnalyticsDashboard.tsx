'use client'

import React, { useState, useMemo, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  ArrowLeft, RefreshCw, UserPlus, LogIn, Crown, UserMinus,
  Trash2, MessageSquare, Star, TrendingDown, TrendingUp,
  Zap, ChevronDown, ArrowRight, Lock,
} from 'lucide-react'

/* ── Types ────────────────────────────────────────────── */
export interface ModuleHealth {
  name: string
  score: number
  source: string
  desc: string
  insight: string | null
  locked: boolean
}

interface PostHogData {
  posthogConnected: boolean
  signups24h: number
  signins24h: number
  dau: number
  mau: number
  retention: { day: string; rate: number }[] | null
  funnel: { stage: string; value: number }[] | null
}

/* ── Fallback data (shown while loading or when PostHog not connected) ── */
const FALLBACK_RETENTION = [
  { day: 'D0', rate: 100 }, { day: 'D1', rate: 34 }, { day: 'D3', rate: 19 },
  { day: 'D7', rate: 12 },  { day: 'D14', rate: 9 }, { day: 'D30', rate: 6 },
]

const FALLBACK_FUNNEL = [
  { stage: 'Visited site',          value: 1840 },
  { stage: 'Signed up',             value: 128  },
  { stage: 'Activated (ran audit)', value: 61   },
  { stage: 'Became PRO',            value: 4    },
]

/* ── Helpers ──────────────────────────────────────────── */
function toneColor(tone: string): string {
  if (tone === 'green')  return 'var(--green-bright)'
  if (tone === 'amber')  return 'var(--gold)'
  if (tone === 'red')    return '#f87171'
  return 'var(--text-dim)'
}

function scoreColor(score: number): string {
  if (score >= 70) return 'var(--green-bright)'
  if (score >= 40) return 'var(--gold)'
  return '#f87171'
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000)    return `${Math.round(n / 1000)}k`
  if (n >= 1_000)     return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/* ── Sub-components ───────────────────────────────────── */
function SourcePill({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.07em',
      textTransform: 'uppercase', padding: '3px 9px', borderRadius: 99,
      border: '1px solid var(--line)', color: 'var(--text-faint)',
    }}>
      {children}
    </span>
  )
}

function Delta({ value, invertGood = false }: { value: number; invertGood?: boolean }) {
  if (value === 0) return <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>— flat vs yesterday</span>
  const good = invertGood ? value < 0 : value > 0
  const Icon = value > 0 ? TrendingUp : TrendingDown
  return (
    <span style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 500, color: good ? 'var(--green-bright)' : '#f87171' }}>
      <Icon size={13} />
      {value > 0 ? '+' : ''}{value} vs yesterday
    </span>
  )
}

function ComingSoonBadge() {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
      padding: '3px 9px', borderRadius: 99,
      color: 'var(--gold)', background: '#e7c87318', border: '1px solid #e7c87330',
    }}>
      Coming soon
    </span>
  )
}

function StatCard({
  icon: Icon, iconTone, label, value, source, deltaValue, invertGood, loading, comingSoon,
}: {
  icon: React.ElementType; iconTone: string; label: string; value: string | number
  source: string; deltaValue: number; invertGood?: boolean; loading?: boolean; comingSoon?: boolean
}) {
  const color = comingSoon ? 'var(--text-faint)' : toneColor(iconTone)
  return (
    <div style={{
      background: 'var(--card)',
      border: `1px solid ${comingSoon ? 'var(--line)' : 'var(--line)'}`,
      borderRadius: 16, padding: '20px 22px',
      display: 'flex', flexDirection: 'column', gap: 16,
      opacity: comingSoon ? 0.65 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${color}1f`, color,
        }}>
          <Icon size={17} />
        </div>
        {comingSoon ? <ComingSoonBadge /> : <SourcePill>{source}</SourcePill>}
      </div>
      <div>
        <div style={{
          fontSize: 40, fontWeight: 700, lineHeight: 1, letterSpacing: '-1px',
          color: comingSoon || loading ? 'var(--text-faint)' : 'var(--text)',
          filter: comingSoon ? 'blur(6px)' : 'none',
          userSelect: comingSoon ? 'none' : 'auto',
        }}>
          {comingSoon ? '—' : loading ? '—' : typeof value === 'number' ? fmt(value) : value}
        </div>
        <div style={{ fontSize: 14, marginTop: 6, color: 'var(--text-dim)' }}>{label}</div>
      </div>
      {comingSoon
        ? <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Connect Stripe to unlock</span>
        : loading
          ? <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>loading…</span>
          : <Delta value={deltaValue} invertGood={invertGood} />
      }
    </div>
  )
}

function KpiCard({ label, value, sub, source, delta, bad, loading, comingSoon }: {
  label: string; value: string; sub: string; source: string
  delta: number; bad?: boolean; loading?: boolean; comingSoon?: boolean
}) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16,
      padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 10,
      opacity: comingSoon ? 0.65 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
          {label}
        </span>
        {comingSoon ? <ComingSoonBadge /> : <SourcePill>{source}</SourcePill>}
      </div>
      <div style={{
        fontSize: 38, fontWeight: 700, letterSpacing: '-1px', lineHeight: 1,
        color: comingSoon || loading ? 'var(--text-faint)' : 'var(--text)',
        filter: comingSoon ? 'blur(6px)' : 'none',
        userSelect: comingSoon ? 'none' : 'auto',
      }}>
        {comingSoon ? value : loading ? '—' : value}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{sub}</div>
      {comingSoon
        ? <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Connect Stripe to unlock</span>
        : loading
          ? <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>loading…</span>
          : <Delta value={delta} invertGood={bad} />
      }
    </div>
  )
}

function RetentionCurve({ data, loading }: { data: { day: string; rate: number }[]; loading: boolean }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)' }}>
            Retention curve
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 3 }}>
            Share of signed-up users still active N days after signup.
            {loading && <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <SourcePill>PostHog</SourcePill>
      </div>
      <div style={{ width: '100%', height: 200, marginTop: 24 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="retFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#5eead4" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#5eead4" stopOpacity={0}    />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tick={{ fill: 'var(--text-faint)', fontSize: 11 }} axisLine={{ stroke: 'var(--line)' }} tickLine={false} />
            <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--text-dim)' }}
              itemStyle={{ color: '#5eead4' }}
              formatter={(v) => [`${v}%`, 'Retained']}
            />
            <Area type="monotone" dataKey="rate" stroke="#5eead4" strokeWidth={2.5} fill="url(#retFill)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function FunnelCard({ data, loading }: { data: { stage: string; value: number }[]; loading: boolean }) {
  const max = data[0]?.value ?? 1
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)' }}>
            Conversion funnel
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 3 }}>
            Where users fall off between arriving and paying.
            {loading && <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <SourcePill>PostHog</SourcePill>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 24 }}>
        {data.map((f, i) => {
          const pct = Math.round((f.value / max) * 100)
          const prev = i > 0 ? data[i - 1].value : null
          const stepPct = prev ? Math.round((f.value / prev) * 100) : 100
          return (
            <div key={f.stage}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>{f.stage}</span>
                <span style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {f.value.toLocaleString()}
                  {prev && (
                    <span style={{ fontWeight: 500, fontSize: 13, color: stepPct < 30 ? '#f87171' : 'var(--text-dim)' }}>
                      {stepPct}% of prev
                    </span>
                  )}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: 'var(--line)' }}>
                <div style={{
                  height: 8, borderRadius: 99, width: `${pct}%`,
                  background: 'linear-gradient(90deg, var(--green), var(--green-bright))',
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ModuleRow({ m, expanded, onToggle, onFix }: {
  m: ModuleHealth; expanded: boolean
  onToggle: () => void; onFix: (m: ModuleHealth) => void
}) {
  const needsAttention = !m.locked && m.score < 50
  const color = m.locked ? 'var(--text-faint)' : scoreColor(m.score)
  return (
    <div style={{
      background: 'var(--card)',
      border: `1px solid ${needsAttention ? '#f8717133' : 'var(--line)'}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 14, overflow: 'hidden',
    }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 18,
          padding: '16px 20px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{
          width: 54, height: 54, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `2px solid ${color}`, color, fontSize: 13, fontWeight: 700,
        }}>
          {m.locked ? <Lock size={16} style={{ color: 'var(--text-faint)' }} /> : `${m.score}%`}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{m.name}</span>
            {needsAttention && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                padding: '3px 9px', borderRadius: 99, color: '#f87171', background: '#f8717120',
              }}>
                Needs attention
              </span>
            )}
            <SourcePill>{m.locked ? 'Locked' : m.source}</SourcePill>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>{m.desc}</p>
        </div>
        <ChevronDown size={16} style={{
          color: 'var(--text-faint)', flexShrink: 0,
          transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s',
        }} />
      </button>

      {expanded && (
        <div style={{ padding: '0 20px 18px', borderTop: '1px solid var(--line)' }}>
          {m.locked ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 16 }}>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>This module is locked — complete earlier modules to unlock it.</span>
            </div>
          ) : m.insight ? (
            <div style={{ paddingTop: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text)', margin: 0 }}>{m.insight}</p>
              <button
                onClick={(e) => { e.stopPropagation(); onFix(m) }}
                style={{
                  flexShrink: 0, fontSize: 12, fontWeight: 600, padding: '7px 16px', borderRadius: 99,
                  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                  background: 'var(--green)', color: '#06140c', border: 'none', cursor: 'pointer',
                }}
              >
                Fix now <ArrowRight size={12} />
              </button>
            </div>
          ) : (
            <p style={{ fontSize: 13, paddingTop: 16, color: 'var(--text-faint)', margin: 0 }}>
              No open issues — this module looks good.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Main component ───────────────────────────────────── */
interface Props {
  brand: { id: string; name: string }
  modules: ModuleHealth[]
}

export default function AnalyticsDashboard({ brand, modules }: Props) {
  const [range, setRange] = useState('24h')
  const [expandedModule, setExpandedModule] = useState<string | null>(null)
  const [redirectTarget, setRedirectTarget] = useState<string | null>(null)
  const [ph, setPh] = useState<PostHogData | null>(null)
  const [phLoading, setPhLoading] = useState(true)

  // Open worst module by default
  useEffect(() => {
    const worst = [...modules].filter(m => !m.locked).sort((a, b) => a.score - b.score)[0]
    if (worst) setExpandedModule(worst.name)
  }, [modules])

  // Fetch PostHog data
  useEffect(() => {
    setPhLoading(true)
    fetch(`/api/analytics/auth-dashboard?brandId=${brand.id}`)
      .then(r => r.json())
      .then((d: PostHogData) => setPh(d))
      .catch(() => setPh(null))
      .finally(() => setPhLoading(false))
  }, [brand.id])

  const worstModule = useMemo(
    () => [...modules].filter(m => !m.locked).sort((a, b) => a.score - b.score)[0],
    [modules]
  )

  const retentionData = ph?.retention ?? FALLBACK_RETENTION
  const funnelData = ph?.funnel ?? FALLBACK_FUNNEL

  // Build activity tiles — real PostHog data + Stripe (coming soon)
  const activityTiles: {
    key: string; label: string; value: string | number; delta: number
    source: string; icon: React.ElementType; tone: string
    loading?: boolean; comingSoon?: boolean; invertGood?: boolean
  }[] = [
    { key: 'signups',  label: 'New signups',         value: ph?.signups24h ?? 0, delta: 0, source: 'PostHog',  icon: UserPlus,      tone: 'green',   loading: phLoading },
    { key: 'signins',  label: 'Sign-ins',             value: ph?.signins24h ?? 0, delta: 0, source: 'PostHog',  icon: LogIn,         tone: 'green',   loading: phLoading },
    { key: 'dau',      label: 'Daily active users',   value: ph?.dau        ?? 0, delta: 0, source: 'PostHog',  icon: Crown,         tone: 'amber',   loading: phLoading },
    { key: 'mau',      label: 'Monthly active users', value: ph?.mau        ?? 0, delta: 0, source: 'PostHog',  icon: UserMinus,     tone: 'green',   loading: phLoading },
    { key: 'pro',      label: 'Became PRO',           value: 0,                   delta: 0, source: 'Stripe',   icon: Crown,         tone: 'amber',   comingSoon: true   },
    { key: 'unsub',    label: 'Unsubscribed',         value: 0,                   delta: 0, source: 'Stripe',   icon: UserMinus,     tone: 'red',     comingSoon: true, invertGood: true },
    { key: 'deleted',  label: 'Deleted account',      value: 0,                   delta: 0, source: 'Internal', icon: Trash2,        tone: 'green'  },
    { key: 'contact',  label: 'Contacted support',    value: 0,                   delta: 0, source: 'Internal', icon: MessageSquare, tone: 'neutral' },
    { key: 'reviews',  label: 'Reviews left',         value: 0,                   delta: 0, source: 'Internal', icon: Star,          tone: 'green'  },
  ]

  const avgScore = modules.filter(m => !m.locked).length > 0
    ? Math.round(modules.filter(m => !m.locked).reduce((s, m) => s + m.score, 0) / modules.filter(m => !m.locked).length)
    : 0

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>

      {redirectTarget && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px',
          borderRadius: 12, fontSize: 13, background: 'var(--green)', color: '#06140c',
        }}>
          Opening <strong style={{ marginLeft: 2 }}>{redirectTarget}</strong> →
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button style={{
              width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer',
            }}>
              <ArrowLeft size={15} />
            </button>
            <div>
              <h1 style={{
                fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
                fontFamily: 'var(--font-display, Fraunces, serif)', margin: 0,
              }}>
                User Analytics
              </h1>
              <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                {brand.name} · {ph?.posthogConnected ? 'PostHog connected' : 'PostHog not connected'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', padding: '3px', border: '1px solid var(--line)', borderRadius: 99, background: 'var(--bg-soft)' }}>
              {['24h', '7d', '30d'].map((r) => (
                <button key={r} onClick={() => setRange(r)} style={{
                  fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 99,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: range === r ? 'var(--text)' : 'transparent',
                  color: range === r ? 'var(--bg)' : 'var(--text-dim)',
                }}>
                  {r}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setPhLoading(true); fetch(`/api/analytics/auth-dashboard?brandId=${brand.id}`).then(r => r.json()).then((d: PostHogData) => setPh(d)).finally(() => setPhLoading(false)) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                padding: '7px 14px', borderRadius: 99, border: '1px solid var(--line)',
                background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer',
              }}
            >
              <RefreshCw size={12} style={{ animation: phLoading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
            </button>
          </div>
        </div>

        {/* Hero */}
        {worstModule && (
          <div style={{
            borderRadius: 16, padding: '22px 24px', marginBottom: 36,
            background: '#2fbf7112', border: '1px solid #2fbf7130',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Zap size={13} style={{ color: 'var(--green)' }} />
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--green)' }}>
                One thing to do today
              </span>
            </div>
            <h2 style={{
              fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8,
              fontFamily: 'var(--font-display, Fraunces, serif)', letterSpacing: '-0.3px',
            }}>
              Fix {worstModule.name} — it's dragging your overall score down.
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.65, margin: 0 }}>
              {worstModule.name} scores just {worstModule.score}%, the lowest of any active module.
              {worstModule.insight ? ` ${worstModule.insight}` : ' Fix the failing items to improve your overall health score.'}
            </p>
            <button
              onClick={() => setRedirectTarget(worstModule.name)}
              style={{
                marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 99,
                background: 'var(--green)', color: '#06140c', border: 'none', cursor: 'pointer',
              }}
            >
              Go to {worstModule.name} <ArrowRight size={13} />
            </button>
          </div>
        )}

        {/* Last 24 hours */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 14 }}>
            Last 24 hours
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {activityTiles.map((item) => (
              <StatCard
                key={item.key}
                icon={item.icon} iconTone={item.tone}
                label={item.label} value={item.value}
                source={item.source} deltaValue={item.delta}
                invertGood={item.key === 'unsub' || item.key === 'deleted'}
                loading={phLoading && ['signups', 'signins', 'dau', 'mau'].includes(item.key)}
              />
            ))}
          </div>
        </section>

        {/* Growth & retention KPIs */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 14 }}>
            Growth &amp; retention
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <KpiCard label="DAU" value={ph ? fmt(ph.dau) : '—'} sub="Daily active users" source="PostHog" delta={0} loading={phLoading} />
            <KpiCard label="MAU" value={ph ? fmt(ph.mau) : '—'} sub="Monthly active users" source="PostHog" delta={0} loading={phLoading} />
            <KpiCard label="New signups (24h)" value={ph ? fmt(ph.signups24h) : '—'} sub="New persons created today" source="PostHog" delta={0} loading={phLoading} />
            <KpiCard label="Module avg score" value={`${avgScore}%`} sub="Across all active modules" source="Internal" delta={0} />
            {/* Stripe — coming soon */}
            <KpiCard label="MRR" value="$0" sub="Monthly recurring revenue" source="Stripe" delta={0} comingSoon />
            <KpiCard label="ARR" value="$0" sub="Annualised run rate" source="Stripe" delta={0} comingSoon />
            <KpiCard label="Churn rate" value="0%" sub="Paid cancellations, 30d" source="Stripe" delta={0} bad comingSoon />
            <KpiCard label="Onboarding drop-off" value="0%" sub="Users who don't return after signup" source="Stripe" delta={0} bad comingSoon />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <RetentionCurve data={retentionData} loading={phLoading} />
            <FunnelCard data={funnelData} loading={phLoading} />
          </div>
        </section>

        {/* Module health */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)' }}>
              Module health
            </h2>
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {modules.filter(m => !m.locked).length} of {modules.length} active · avg {avgScore}%
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {modules.map((m) => (
              <ModuleRow
                key={m.name}
                m={m}
                expanded={expandedModule === m.name}
                onToggle={() => setExpandedModule(expandedModule === m.name ? null : m.name)}
                onFix={(mod) => setRedirectTarget(mod.name)}
              />
            ))}
          </div>
        </section>

      </div>
    </div>
  )
}
