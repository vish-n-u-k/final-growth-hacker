'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts'
import {
  ArrowLeft, RefreshCw, UserPlus, LogIn, Crown, UserMinus,
  Trash2, MessageSquare, Star, TrendingDown, TrendingUp,
  Zap, ChevronDown, ArrowRight, Lock, Search, BarChart2, CheckCircle2, Circle,
} from 'lucide-react'
import DailySummaryCard from './daily/DailySummaryCard'

/* ── Types ────────────────────────────────────────────── */
export interface ModuleHealth {
  name: string
  score: number
  source: string
  desc: string
  insight: string | null
  locked: boolean
}

interface GscData {
  connected: boolean
  error?: boolean
  clicks7d: number | null
  impressions7d: number | null
  avgCtr7d: number | null
  avgPosition7d: number | null
  topQueries: { query: string; clicks: number; impressions: number; position: number }[]
  topPages: { page: string; clicks: number; impressions: number }[]
  clickTrend: { date: string; clicks: number }[]
}

interface Ga4Data {
  connected: boolean
  error?: boolean
  sessions7d: number | null
  activeUsers7d: number | null
  newUsers7d: number | null
  pageviews7d: number | null
  engagementRate7d: number | null
  trafficSources: { channel: string; sessions: number }[]
  topPages: { page: string; sessions: number; newUsers: number; engagementRate: number }[]
  dailyTrend: { date: string; newUsers: number; sessions: number }[]
}

interface WebAnalytics {
  visitors: { current: number; prior: number }
  pageviews: { current: number; prior: number }
  sessions:  { current: number; prior: number }
  avgDurationSecs: number | null; avgDurationSecsPrior: number | null
  bounceRate: number | null; bounceRatePrior: number | null
  visitorsChart: { date: string; visitors: number }[]
  topPaths:  { path: string; visitors: number; views: number }[]
  channels:  { channel: string; visitors: number; views: number }[]
  devices:   { device: string; visitors: number; views: number }[]
  countries: { country: string; visitors: number }[]
  activeHours: { dow: number; hour: number; users: number }[]
}

interface DashboardData {
  posthogConnected: boolean
  signups24h: number
  signins24h: number
  dau: number
  mau: number
  deletedAccounts24h: number
  retention: { day: string; rate: number }[] | null
  funnel: { stage: string; value: number }[] | null
  webAnalytics: WebAnalytics | null
  gsc: GscData
  ga4: Ga4Data
}

interface TrafficStats { activeUsers: number; newUsers: number; returningUsers: number }
interface TrafficData {
  connected: boolean
  stats: TrafficStats
  trend: { date: string; activeUsers: number; newUsers: number }[]
  newVsRet: { type: string; activeUsers: number }[]
  channels: { channel: string; sourceMedium: string; sessions: number; pct: number }[]
  landingPages: { page: string; sessions: number; pct: number }[]
  devices: { device: string; sessions: number; pct: number }[]
  countries: { country: string; sessions: number; pct: number }[]
  browsers: { browser: string; sessions: number; pct: number }[]
}

const RANGE_TO_PERIOD: Record<string, string> = { '24h': '1d', '7d': '7d', '30d': '30d' }
const PERIOD_DESC: Record<string, string> = { '24h': 'today', '7d': 'last 7 days', '30d': 'last 30 days' }
const CHANNEL_COLORS_MAP: Record<string, string> = {
  'Organic Search': '#4ade80', 'Direct': '#60a5fa', 'Referral': '#a78bfa',
  'Organic Social': '#f472b6', 'Paid Search': '#fb923c', 'Email': '#e7c873',
  'Organic Video': '#34d399', 'Unassigned': '#6b7280',
}
function chColor(ch: string) { return CHANNEL_COLORS_MAP[ch] ?? '#8aa897' }

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
  if (tone === 'green')  return '#4ade80'  // --green-bright
  if (tone === 'amber')  return '#e7c873'  // --gold
  if (tone === 'red')    return '#f87171'
  return '#8d9690'                         // --text-dim
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

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return null
  return Math.round(((current - prior) / prior) * 100)
}

/* ── Sub-components ───────────────────────────────────── */
const SOURCE_LOGOS: Record<string, string> = {
  'PostHog': 'https://www.google.com/s2/favicons?domain=posthog.com&sz=32',
  'Stripe':  'https://www.google.com/s2/favicons?domain=stripe.com&sz=32',
}

function SourcePill({ children }: { children: React.ReactNode }) {
  const label = String(children)
  const logo = SOURCE_LOGOS[label]
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.07em',
      textTransform: 'uppercase', padding: '3px 9px', borderRadius: 99,
      border: '1px solid var(--line)', color: 'var(--text-faint)',
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      {logo && <img src={logo} width={12} height={12} style={{ borderRadius: 2, display: 'block' }} alt="" />}
      {children}
    </span>
  )
}

function Delta({ value, invertGood = false }: { value: number; invertGood?: boolean }) {
  // if (value === 0) return <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>— flat vs yesterday</span>
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
  const iconColor = toneColor(iconTone)
  const textColor = comingSoon ? '#555f5a' : iconColor
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--line)',
      borderRadius: 16, padding: '20px 22px',
      display: 'flex', flexDirection: 'column', gap: 16,
      opacity: comingSoon ? 0.65 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${iconColor}1f`, color: iconColor,
        }}>
          <Icon size={17} />
        </div>
        {comingSoon ? <ComingSoonBadge /> : <SourcePill>{source}</SourcePill>}
      </div>
      <div>
        <div style={{
          fontSize: 40, fontWeight: 700, lineHeight: 1, letterSpacing: '-1px',
          color: comingSoon || loading ? '#555f5a' : 'var(--text)',
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
                  background: 'var(--green)', color: '#ffffff', border: 'none', cursor: 'pointer',
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

/* ── Summary renderer ─────────────────────────────────── */
// Parses **bold** and {{chip:Name}} from Claude output into React nodes
function renderSummary(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\{\{chip:[^}]+\}\})/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ color: 'var(--text)', fontWeight: 700 }}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('{{chip:') && part.endsWith('}}')) {
      const label = part.slice(7, -2)
      return (
        <span key={i} style={{
          display: 'inline-flex', alignItems: 'center',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
          padding: '2px 8px', borderRadius: 99,
          background: '#f8717120', color: '#f87171', border: '1px solid #f8717140',
          margin: '0 2px', verticalAlign: 'middle',
        }}>{label}</span>
      )
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}

/* ── Main component ───────────────────────────────────── */
interface Props {
  brand: { id: string; name: string }
  modules: ModuleHealth[]
  dailyEmailEnabled: boolean
}

export default function AnalyticsDashboard({ brand, modules, dailyEmailEnabled: initialDailyEmail }: Props) {
  const router = useRouter()
  const [view, setView] = useState<'users' | 'website'>('users')
  const [range, setRange] = useState('7d')
  const [expandedModule, setExpandedModule] = useState<string | null>(null)
  const [redirectTarget, setRedirectTarget] = useState<string | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [phLoading, setPhLoading] = useState(true)
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [trafficData, setTrafficData] = useState<TrafficData | null>(null)
  const [trafficLoading, setTrafficLoading] = useState(true)
  const [dailyEmail, setDailyEmail] = useState(initialDailyEmail)
  const [emailToggling, setEmailToggling] = useState(false)

  async function toggleDailyEmail() {
    setEmailToggling(true)
    try {
      const res = await fetch('/api/analytics/daily-email-pref', { method: 'POST' })
      if (res.ok) {
        const { dailyEmailEnabled } = await res.json() as { dailyEmailEnabled: boolean }
        setDailyEmail(dailyEmailEnabled)
      }
    } finally {
      setEmailToggling(false)
    }
  }

  // Fetch analytics data
  useEffect(() => {
    setPhLoading(true)
    fetch(`/api/analytics/auth-dashboard?brandId=${brand.id}`)
      .then(r => r.json())
      .then((d: DashboardData) => setData(d))
      .catch(() => setData(null))
      .finally(() => setPhLoading(false))
  }, [brand.id])

  // Fetch traffic data — refetches on every range change
  useEffect(() => {
    const period = RANGE_TO_PERIOD[range] ?? '7d'
    setTrafficLoading(true)
    fetch(`/api/analytics/ga4-traffic?brandId=${brand.id}&period=${period}`)
      .then(r => r.json())
      .then((d: TrafficData) => setTrafficData(d))
      .catch(() => setTrafficData(null))
      .finally(() => setTrafficLoading(false))
  }, [brand.id, range])

  // Generate summary once analytics fetch is done (success or failure)
  // phLoading going false is our signal that data is settled
  useEffect(() => {
    if (phLoading) return  // wait for analytics to settle first
    const activeModules = modules.filter(m => !m.locked)
    if (activeModules.length === 0) return
    setSummaryLoading(true)
    fetch('/api/analytics/overview-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandName: brand.name,
        modules,
        posthog: data,
        gsc: data?.gsc ?? null,
        ga4: data?.ga4 ?? null,
      }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((s: { summary?: string | null }) => setSummary(s.summary ?? null))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.id, phLoading])

  const retentionData = data?.retention ?? FALLBACK_RETENTION
  const funnelData    = data?.funnel    ?? FALLBACK_FUNNEL
  const gsc = data?.gsc
  const ga4 = data?.ga4

  // Build activity tiles — real PostHog data + Stripe (coming soon)
  const activityTiles: {
    key: string; label: string; value: string | number; delta: number
    source: string; icon: React.ElementType; tone: string
    loading?: boolean; comingSoon?: boolean; invertGood?: boolean
  }[] = [
    { key: 'signups',  label: 'New signups',         value: data?.signups24h         ?? 0, delta: 0, source: 'PostHog',  icon: UserPlus,      tone: 'green',   loading: phLoading },
    { key: 'signins',  label: 'Sign-ins',             value: data?.signins24h         ?? 0, delta: 0, source: 'PostHog',  icon: LogIn,         tone: 'green',   loading: phLoading },
    { key: 'dau',      label: 'Daily active users',   value: data?.dau                ?? 0, delta: 0, source: 'PostHog',  icon: Crown,         tone: 'amber',   loading: phLoading },
    { key: 'mau',      label: 'Monthly active users', value: data?.mau                ?? 0, delta: 0, source: 'PostHog',  icon: Crown,         tone: 'green',   loading: phLoading },
    { key: 'deleted',  label: 'Deleted account',      value: data?.deletedAccounts24h ?? 0, delta: 0, source: 'PostHog',  icon: Trash2,        tone: 'red',     loading: phLoading, invertGood: true },
    { key: 'pro',      label: 'Became PRO',           value: 0,                             delta: 0, source: 'Stripe',   icon: Crown,         tone: 'amber',   comingSoon: true },
    { key: 'unsub',    label: 'Unsubscribed',         value: 0,                             delta: 0, source: 'Stripe',   icon: UserMinus,     tone: 'red',     comingSoon: true, invertGood: true },
    { key: 'contact',  label: 'Contacted support',    value: 0,                             delta: 0, source: 'Internal', icon: MessageSquare, tone: 'neutral', comingSoon: true },
    { key: 'reviews',  label: 'Reviews left',         value: 0,                             delta: 0, source: 'Internal', icon: Star,          tone: 'amber',   comingSoon: true },
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
                {brand.name} · {[data?.posthogConnected && 'PostHog', gsc?.connected && 'GSC', ga4?.connected && 'GA4'].filter(Boolean).join(' · ') || 'No integrations connected'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* View toggle */}
            <div style={{ display: 'flex', padding: '3px', border: '1px solid var(--line)', borderRadius: 99, background: 'var(--bg-soft)' }}>
              {(['users', 'website'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{
                  fontSize: 12, fontWeight: 600, padding: '5px 16px', borderRadius: 99,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: view === v ? 'var(--text)' : 'transparent',
                  color: view === v ? 'var(--bg)' : 'var(--text-dim)',
                  textTransform: 'capitalize',
                }}>
                  {v === 'users' ? 'Users' : 'Website'}
                </button>
              ))}
            </div>
            {/* Range picker — only relevant for Website view */}
            {view === 'website' && (
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
            )}
            <button
              onClick={() => { setPhLoading(true); fetch(`/api/analytics/auth-dashboard?brandId=${brand.id}`).then(r => r.json()).then((d: DashboardData) => setData(d)).finally(() => setPhLoading(false)) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                padding: '7px 14px', borderRadius: 99, border: '1px solid var(--line)',
                background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer',
              }}
            >
              <RefreshCw size={12} style={{ animation: phLoading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
            </button>
            {/* Daily email toggle */}
            <button
              onClick={toggleDailyEmail}
              disabled={emailToggling}
              title={dailyEmail ? 'Daily email is on — click to turn off' : 'Turn on daily email digest'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                padding: '7px 14px', borderRadius: 99, border: '1px solid var(--line)',
                background: dailyEmail ? 'var(--green)' : 'transparent',
                color: dailyEmail ? '#06140c' : 'var(--text-dim)',
                cursor: emailToggling ? 'default' : 'pointer',
                opacity: emailToggling ? 0.6 : 1,
                transition: 'all 0.15s',
              }}
            >
              <Zap size={12} />
              {dailyEmail ? 'Daily email on' : 'Daily email'}
            </button>
          </div>
        </div>

        {/* Summary + Todo — hidden for now */}

        {/* ── Users view ── */}
        {view === 'users' && (<>

        {/* Daily Summary */}
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 14 }}>
            Yesterday
          </h2>
          <DailySummaryCard />
        </section>

        {/* Last 24 hours */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 14 }}>
            Last 24 hours
          </h2>
          {/* Group 1: activity events */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            {activityTiles.filter(t => !['dau', 'mau'].includes(t.key)).map((item) => (
              <StatCard
                key={item.key}
                icon={item.icon} iconTone={item.tone}
                label={item.label} value={item.value}
                source={item.source} deltaValue={item.delta}
                invertGood={item.invertGood}
                loading={item.loading}
                comingSoon={item.comingSoon}
              />
            ))}
          </div>
          {/* Group 2: active users */}
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 10 }}>
            Active users
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {activityTiles.filter(t => ['dau', 'mau'].includes(t.key)).map((item) => (
              <StatCard
                key={item.key}
                icon={item.icon} iconTone={item.tone}
                label={item.label} value={item.value}
                source={item.source} deltaValue={item.delta}
                invertGood={item.invertGood}
                loading={item.loading}
                comingSoon={item.comingSoon}
              />
            ))}
          </div>
        </section>

        {/* Growth & retention KPIs */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 14 }}>
            Growth &amp; retention
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
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

        {/* ── PostHog Web Analytics ── */}
        {data?.webAnalytics && (() => {
          const wa = data.webAnalytics!
          const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
          const maxHeatmap = Math.max(...wa.activeHours.map(h => h.users), 1)
          const heatmapGrid: Record<string, number> = {}
          wa.activeHours.forEach(h => { heatmapGrid[`${h.dow}_${h.hour}`] = h.users })

          const webKpis = [
            { label: 'Visitors',     value: fmt(wa.visitors.current),  prior: wa.visitors.prior,  current: wa.visitors.current,  suffix: '' },
            { label: 'Avg duration', value: wa.avgDurationSecs != null ? fmtDuration(wa.avgDurationSecs) : '—', prior: wa.avgDurationSecsPrior ?? 0, current: wa.avgDurationSecs ?? 0, suffix: '' },
            { label: 'Bounce rate',  value: wa.bounceRate != null ? `${wa.bounceRate}%` : '—', prior: wa.bounceRatePrior ?? 0, current: wa.bounceRate ?? 0, suffix: '%', invertGood: true },
          ]

          return (
            <section style={{ marginBottom: 36 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <img src="https://www.google.com/s2/favicons?domain=posthog.com&sz=32" width={13} height={13} style={{ borderRadius: 2 }} alt="" />
                  <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', margin: 0 }}>
                    App Analytics · last 28 days
                  </h2>
                </div>
              </div>

              {/* KPI row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
                {webKpis.map(k => {
                  const chg = pctChange(k.current, k.prior)
                  const good = k.invertGood ? (chg ?? 0) < 0 : (chg ?? 0) > 0
                  return (
                    <div key={k.label} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 16px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>{k.label}</div>
                      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text)', lineHeight: 1 }}>{k.value}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {chg != null ? (
                          <span style={{ color: good ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                            {chg > 0 ? '+' : ''}{chg}%
                          </span>
                        ) : null}
                        <span>vs prior 28d</span>
                      </div>
                    </div>
                  )
                })}
              </div>


              {/* Devices */}
              {wa.devices.length > 0 && (
                <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px', marginBottom: 14 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 14 }}>Devices</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {wa.devices.map((d, i) => {
                      const maxV = wa.devices[0]?.visitors ?? 1
                      return (
                        <div key={i}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{d.device}</span>
                            <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{fmt(d.visitors)}</span>
                          </div>
                          <div style={{ height: 4, borderRadius: 99, background: 'var(--line)' }}>
                            <div style={{ height: 4, borderRadius: 99, width: `${Math.round((d.visitors / maxV) * 100)}%`, background: '#e7c873' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Countries */}
              {wa.countries.length > 0 && (
                <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px', marginBottom: 14 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 14 }}>Top countries</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 24px' }}>
                    {wa.countries.slice(0, 10).map((c, i) => {
                      const maxV = wa.countries[0]?.visitors ?? 1
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.country}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flexShrink: 0 }}>{fmt(c.visitors)}</span>
                          <div style={{ width: 60, height: 4, borderRadius: 99, background: 'var(--line)', flexShrink: 0 }}>
                            <div style={{ height: 4, borderRadius: 99, width: `${Math.round((c.visitors / maxV) * 100)}%`, background: '#5eead4' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Active hours heatmap */}
              {wa.activeHours.length > 0 && (
                <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px', overflowX: 'auto' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Active hours</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>Unique users by day and hour (UTC), last 28 days</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, 1fr)', gap: 2, minWidth: 600 }}>
                    {/* Hour labels */}
                    <div />
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} style={{ fontSize: 9, color: 'var(--text-faint)', textAlign: 'center', paddingBottom: 4 }}>
                        {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                      </div>
                    ))}
                    {/* Rows */}
                    {DOW.map((day, dowIdx) => (
                      <React.Fragment key={day}>
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', paddingRight: 6 }}>{day}</div>
                        {Array.from({ length: 24 }, (_, h) => {
                          const val = heatmapGrid[`${dowIdx + 1}_${h}`] ?? 0
                          const intensity = val / maxHeatmap
                          return (
                            <div
                              key={h}
                              title={`${day} ${h}:00 — ${val} users`}
                              style={{
                                height: 18, borderRadius: 3,
                                background: intensity > 0
                                  ? `rgba(47, 191, 113, ${0.12 + intensity * 0.88})`
                                  : 'var(--line)',
                              }}
                            />
                          )
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )
        })()}

        </>)}

        {/* ── Website view ── */}
        {view === 'website' && (<>

        {/* ── GSC Section ── */}
        <section style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Search size={13} style={{ color: 'var(--text-faint)' }} />
              <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', margin: 0 }}>
                Search Console
              </h2>
            </div>
            {!gsc?.connected && <ComingSoonBadge />}
          </div>
          <div style={{ position: 'relative', opacity: gsc?.connected && !gsc?.error ? 1 : 0.55 }}>
            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
              {[
                { label: 'Organic clicks', value: gsc?.clicks7d,      suffix: '',  sub: '7 days' },
                { label: 'Impressions',    value: gsc?.impressions7d,  suffix: '',  sub: '7 days' },
                { label: 'Avg CTR',        value: gsc?.avgCtr7d,       suffix: '%', sub: '7 days' },
                { label: 'Avg position',   value: gsc?.avgPosition7d,  suffix: '',  sub: '7 days' },
              ].map(k => (
                <div key={k.label} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>{k.label}</div>
                  <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text)', lineHeight: 1, filter: !gsc?.connected ? 'blur(5px)' : 'none' }}>
                    {k.value != null ? `${fmt(k.value)}${k.suffix}` : '—'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>{k.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {/* Click trend chart */}
              <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Click trend</h3>
                <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>Organic clicks — last 30 days</p>
                <div style={{ height: 160, filter: !gsc?.connected ? 'blur(4px)' : 'none' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={gsc?.connected && gsc.clickTrend.length ? gsc.clickTrend : Array.from({ length: 10 }, (_, i) => ({ date: `d${i}`, clicks: Math.round(Math.random() * 80 + 20) }))} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gscFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="var(--green)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="var(--green)" stopOpacity={0}    />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                      <Tooltip contentStyle={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }} itemStyle={{ color: 'var(--green)' }} />
                      <Area type="monotone" dataKey="clicks" stroke="var(--green)" strokeWidth={2} fill="url(#gscFill)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Top queries */}
              <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Top queries</h3>
                <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>Driving the most organic clicks</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, filter: !gsc?.connected ? 'blur(4px)' : 'none' }}>
                  {(gsc?.connected && gsc.topQueries.length ? gsc.topQueries : [
                    { query: 'example query one', clicks: 120, impressions: 1400, position: 3.2 },
                    { query: 'example query two', clicks: 84, impressions: 920, position: 5.1 },
                    { query: 'example query three', clicks: 61, impressions: 740, position: 7.8 },
                  ]).map((q, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 12 }}>{q.query}</span>
                      <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmt(q.clicks)} clicks</span>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)', minWidth: 30, textAlign: 'right' }}>#{q.position}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Not connected / error overlay */}
            {(!gsc?.connected || gsc?.error) && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 14 }}>
                <div style={{ textAlign: 'center', padding: '20px 28px', background: 'var(--card)', border: `1px solid ${gsc?.error ? '#f8717140' : 'var(--line)'}`, borderRadius: 14 }}>
                  <Search size={22} style={{ color: gsc?.error ? '#f87171' : 'var(--text-faint)', marginBottom: 10 }} />
                  {gsc?.error ? (
                    <>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#f87171', marginBottom: 4 }}>GSC auth failed</p>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Check your service account key in Settings → Integrations</p>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Connect Search Console</p>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Go to Settings → Integrations → GSC API</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── GA4 Section ── */}
        <section style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart2 size={13} style={{ color: 'var(--text-faint)' }} />
              <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', margin: 0 }}>
                Google Analytics 4
              </h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!ga4?.connected && <ComingSoonBadge />}
              {ga4?.connected && (
                <button
                  onClick={() => router.push('/analytics/traffic')}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid var(--line)', color: 'var(--text-dim)', borderRadius: 8, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer' }}
                >
                  <ArrowRight size={11} />
                  View traffic details
                </button>
              )}
            </div>
          </div>
          {trafficData?.connected ? (
            <div style={{ opacity: trafficLoading ? 0.55 : 1, transition: 'opacity 0.2s' }}>
              {/* ── 3 stat cards ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
                {[
                  { label: 'Active users',    value: trafficData.stats?.activeUsers    ?? 0, color: 'var(--text)' },
                  { label: 'New users',       value: trafficData.stats?.newUsers       ?? 0, color: '#4ade80' },
                  { label: 'Returning users', value: trafficData.stats?.returningUsers ?? 0, color: 'var(--gold)' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>{s.label}</div>
                    <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.8px', color: s.color, lineHeight: 1 }}>{fmt(s.value)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>{PERIOD_DESC[range]}</div>
                  </div>
                ))}
              </div>

              {/* ── New vs returning bar ── */}
              {(() => {
                const newRow = trafficData.newVsRet?.find(r => r.type === 'new')
                const retRow = trafficData.newVsRet?.find(r => r.type === 'returning')
                const total  = (newRow?.activeUsers ?? 0) + (retRow?.activeUsers ?? 0) || 1
                const newPct = Math.round(((newRow?.activeUsers ?? 0) / total) * 100)
                return (
                  <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>New vs returning · {PERIOD_DESC[range]}</h3>
                      <div style={{ display: 'flex', gap: 16 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} /> New {newPct}%
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block' }} /> Returning {100 - newPct}%
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 6, borderRadius: 99, background: 'var(--line)', overflow: 'hidden', display: 'flex', marginBottom: 14 }}>
                      <div style={{ width: `${newPct}%`, height: '100%', background: '#4ade80', transition: 'width .4s ease' }} />
                      <div style={{ flex: 1, height: '100%', background: 'var(--gold)' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 32 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 3 }}>New users</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{fmt(newRow?.activeUsers ?? 0)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 3 }}>Returning users</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{fmt(retRow?.activeUsers ?? 0)}</div>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* ── Trend + Channels side by side ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                {/* Trend chart */}
                {trafficData.trend?.length > 1 ? (
                  <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Daily users</h3>
                    <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>{PERIOD_DESC[range]}</p>
                    <div style={{ height: 150 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trafficData.trend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="an-trf-au" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--green)" stopOpacity={0.25} />
                              <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="an-trf-nu" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.25} />
                              <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" tickFormatter={(v: string) => v.slice(5)} />
                          <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                          <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }} />
                          <Area type="monotone" dataKey="activeUsers" name="Active" stroke="var(--green)" strokeWidth={2} fill="url(#an-trf-au)" dot={false} />
                          <Area type="monotone" dataKey="newUsers" name="New" stroke="var(--gold)" strokeWidth={2} fill="url(#an-trf-nu)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ) : (
                  <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Trend chart needs multiple days of data</span>
                  </div>
                )}

                {/* Traffic channels */}
                <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>How they found you</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>{PERIOD_DESC[range]}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {(trafficData.channels ?? []).slice(0, 6).map((c, i) => (
                      <div key={i}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: chColor(c.channel), flexShrink: 0, display: 'inline-block' }} />
                            {c.channel}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: chColor(c.channel) }}>{c.pct}%</span>
                        </div>
                        <div style={{ height: 4, borderRadius: 99, background: 'var(--line)' }}>
                          <div style={{ height: 4, borderRadius: 99, width: `${c.pct}%`, background: chColor(c.channel), transition: 'width .4s ease' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Entry pages ── */}
              {(trafficData.landingPages ?? []).length > 0 && (
                <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px', marginBottom: 14 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Entry pages</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>Pages that bring visitors in · {PERIOD_DESC[range]}</p>
                  {trafficData.landingPages.slice(0, 8).map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < Math.min(trafficData.landingPages.length, 8) - 1 ? '1px solid var(--line)' : 'none' }}>
                      <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 16, fontFamily: 'monospace' }}>{p.page || '/'}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                        <div style={{ width: 60, height: 4, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
                          <div style={{ width: `${p.pct}%`, height: '100%', background: 'var(--green)', transition: 'width .4s ease' }} />
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)', minWidth: 60, textAlign: 'right' }}>{fmt(p.sessions)} sessions</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', minWidth: 30, textAlign: 'right' }}>{p.pct}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Devices / Countries / Browsers ── */}
              {((trafficData.devices ?? []).length > 0 || (trafficData.countries ?? []).length > 0 || (trafficData.browsers ?? []).length > 0) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>

                  {/* Devices */}
                  {(trafficData.devices ?? []).length > 0 && (
                    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Devices</h3>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>{PERIOD_DESC[range]}</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {trafficData.devices.map((d, i) => (
                          <div key={i}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                              <span style={{ fontSize: 13, color: 'var(--text)', textTransform: 'capitalize' }}>{d.device}</span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)' }}>{d.pct}%</span>
                            </div>
                            <div style={{ height: 5, borderRadius: 99, background: 'var(--line)' }}>
                              <div style={{ height: 5, borderRadius: 99, width: `${d.pct}%`, background: i === 0 ? '#4ade80' : i === 1 ? '#e7c873' : '#a78bfa', transition: 'width .4s ease' }} />
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>{fmt(d.sessions)} sessions</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Countries */}
                  {(trafficData.countries ?? []).length > 0 && (
                    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Top countries</h3>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>{PERIOD_DESC[range]}</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                        {trafficData.countries.slice(0, 8).map((c, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.country}</span>
                            <div style={{ width: 56, height: 4, borderRadius: 99, background: 'var(--line)', flexShrink: 0, overflow: 'hidden' }}>
                              <div style={{ height: 4, borderRadius: 99, width: `${c.pct}%`, background: '#5eead4', transition: 'width .4s ease' }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>{c.pct}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Browsers */}
                  {(trafficData.browsers ?? []).length > 0 && (
                    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Browsers</h3>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>{PERIOD_DESC[range]}</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                        {trafficData.browsers.map((b, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.browser}</span>
                            <div style={{ width: 56, height: 4, borderRadius: 99, background: 'var(--line)', flexShrink: 0, overflow: 'hidden' }}>
                              <div style={{ height: 4, borderRadius: 99, width: `${b.pct}%`, background: '#fb923c', transition: 'width .4s ease' }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>{b.pct}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          ) : (
            <div style={{ background: 'var(--card)', border: `1px solid ${ga4?.error ? '#f8717140' : 'var(--line)'}`, borderRadius: 14, padding: '28px 24px', textAlign: 'center' }}>
              <BarChart2 size={22} style={{ color: ga4?.error ? '#f87171' : 'var(--text-faint)', marginBottom: 10 }} />
              {ga4?.error ? (
                <>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#f87171', marginBottom: 4 }}>GA4 auth failed</p>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Check your service account key in Settings → Integrations</p>
                </>
              ) : trafficLoading ? (
                <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>Loading…</p>
              ) : (
                <>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Connect Google Analytics 4</p>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Go to Settings → Integrations → GA4 API</p>
                </>
              )}
            </div>
          )}
        </section>

        </>)}

        {/* Module health — hidden for now */}

      </div>
    </div>
  )
}
