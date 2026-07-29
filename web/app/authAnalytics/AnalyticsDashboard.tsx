'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts'
import {
  ArrowLeft, RefreshCw, UserPlus, LogIn, Crown, UserMinus,
  Trash2, MessageSquare, Star, TrendingDown, TrendingUp,
  Zap, ChevronDown, ArrowRight, Lock, Search, BarChart2, CheckCircle2, Circle, Copy,
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
  signups24h: number; signups7d: number; signups30d: number
  signupsPrev24h: number; signupsPrev7d: number; signupsPrev30d: number
  signins24h: number; signins7d: number; signins30d: number
  signinsPrev24h: number; signinsPrev7d: number; signinsPrev30d: number
  dau: number; activeUsers7d: number; mau: number
  dauPrev: number; activeUsersPrev7d: number; mauPrev: number
  deletedAccounts24h: number; deleted7d: number; deleted30d: number
  deletedPrev24h: number; deletedPrev7d: number; deletedPrev30d: number
  retention: { day: string; rate: number }[] | null
  funnel: { stage: string; value: number }[] | null
  activationFunnel: { stage: string; value: number }[] | null
  wau: { week: string; users: number }[] | null
  pmf: { event: string; label: string; retainedAvg: number; churnedAvg: number }[] | null
  webAnalytics: WebAnalytics | null
  gsc: GscData
  ga4: Ga4Data
  snapshotAt?: string | null
}

interface UserRow {
  name: string | null
  email: string
  userId: string
  timestamp: string
  source: string | null
  location: string | null
  plan: string | null
  sessions?: number
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
function formatTimeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/* ── Reference-mockup palette (Overview page only) ── */
const MOCK = {
  bg: '#FAF8F3', card: '#FFFFFF', border: '#E7E3D7',
  text: '#1E231F', muted: '#7A8078', muted2: '#9AA098',
  green: '#3E7B58', greenSoft: '#E7F2EA',
  amberBg: '#FBF1D8', amberText: '#96742A',
  red: '#C1503D', redSoft: '#FBEAE7',
  badgeDark: '#1E231F',
  shadow: '0 1px 2px rgba(30,35,31,0.04)',
}

function toneColor(tone: string): string {
  if (tone === 'green')  return MOCK.green
  if (tone === 'amber')  return MOCK.amberText
  if (tone === 'red')    return MOCK.red
  return MOCK.muted
}

function toneBg(tone: string): string {
  if (tone === 'green')  return MOCK.greenSoft
  if (tone === 'amber')  return MOCK.amberBg
  if (tone === 'red')    return MOCK.redSoft
  return '#F0EEE6'
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

function Delta({ value, invertGood = false, period = 'yesterday' }: { value: number; invertGood?: boolean; period?: string }) {
  const good = invertGood ? value < 0 : value > 0
  const Icon = value > 0 ? TrendingUp : TrendingDown
  return (
    <span style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, color: good ? MOCK.green : MOCK.red }}>
      <Icon size={13} />
      {value > 0 ? '+' : ''}{value} vs {period}
    </span>
  )
}

function ComingSoonBadge() {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase',
      padding: '5px 10px', borderRadius: 99, whiteSpace: 'nowrap', flexShrink: 0,
      color: MOCK.amberText, background: MOCK.amberBg,
    }}>
      Coming soon
    </span>
  )
}

function StatCard({
  icon: Icon, iconTone, label, value, source, deltaValue, invertGood, loading, comingSoon, period, onViewDetails, isMobile,
}: {
  icon: React.ElementType; iconTone: string; label: string; value: string | number
  source: string; deltaValue: number; invertGood?: boolean; loading?: boolean; comingSoon?: boolean; period?: string
  onViewDetails?: () => void; isMobile?: boolean
}) {
  const iconColor = toneColor(iconTone)
  const iconBg = toneBg(iconTone)
  return (
    <div style={{
      background: MOCK.card,
      border: `1px solid ${MOCK.border}`,
      boxShadow: MOCK.shadow,
      borderRadius: 14, padding: isMobile ? '16px 14px' : '22px 22px 18px',
      display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 6px' }}>
        <div style={{
          width: isMobile ? 30 : 38, height: isMobile ? 30 : 38, borderRadius: isMobile ? 8 : 10, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: iconBg, color: iconColor,
        }}>
          <Icon size={isMobile ? 15 : 19} />
        </div>
        {comingSoon ? <ComingSoonBadge /> : <SourcePill>{source}</SourcePill>}
      </div>
      <div>
        {loading && !comingSoon ? (
          <div className="an-skeleton" style={{ width: 56, height: 32, borderRadius: 8 }} />
        ) : (
          <div style={{
            fontSize: 'clamp(24px, 5vw, 38px)', fontWeight: 800, lineHeight: 1, letterSpacing: '-1px',
            color: comingSoon ? MOCK.green : MOCK.text,
            filter: comingSoon ? 'blur(6px)' : 'none',
            opacity: comingSoon ? 0.6 : 1,
            userSelect: comingSoon ? 'none' : 'auto',
          }}>
            {comingSoon ? '—' : typeof value === 'number' ? fmt(value) : value}
          </div>
        )}
        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4, color: MOCK.text }}>{label}</div>
      </div>
      {comingSoon
        ? <span style={{ fontSize: 12.5, color: MOCK.muted }}>Connect Stripe to unlock</span>
        : loading
          ? <div className="an-skeleton" style={{ width: 90, height: 13, borderRadius: 4 }} />
          : <Delta value={deltaValue} invertGood={invertGood} period={period} />
      }
      {!comingSoon && !loading && onViewDetails && (
        <button
          onClick={onViewDetails}
          style={{
            alignSelf: 'flex-start', fontSize: 12.5, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 4,
            color: MOCK.green, background: 'none', border: 'none',
            cursor: 'pointer', padding: 0, marginTop: -4,
          }}
        >
          View details <ArrowRight size={11} />
        </button>
      )}
    </div>
  )
}

function KpiCard({ label, value, sub, source, delta, bad, loading, comingSoon, isMobile }: {
  label: string; value: string; sub: string; source: string
  delta: number; bad?: boolean; loading?: boolean; comingSoon?: boolean; isMobile?: boolean
}) {
  return (
    <div style={{
      background: MOCK.card, border: `1px solid ${MOCK.border}`,
      boxShadow: MOCK.shadow,
      borderRadius: 14,
      padding: isMobile ? '16px 14px' : '22px 22px 18px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: MOCK.green }}>
          {label}
        </span>
        {comingSoon ? <ComingSoonBadge /> : <SourcePill>{source}</SourcePill>}
      </div>
      {loading && !comingSoon ? (
        <div className="an-skeleton" style={{ width: 64, height: 30, borderRadius: 8 }} />
      ) : (
        <div style={{
          fontSize: 'clamp(22px, 5vw, 30px)', fontWeight: 800, letterSpacing: '-1px', lineHeight: 1,
          color: comingSoon ? MOCK.green : MOCK.text,
          filter: comingSoon ? 'blur(6px)' : 'none',
          opacity: comingSoon ? 0.6 : 1,
          userSelect: comingSoon ? 'none' : 'auto',
        }}>
          {value}
        </div>
      )}
      <div style={{ fontSize: 13.5, fontWeight: 500, color: MOCK.muted }}>{sub}</div>
      {comingSoon
        ? <span style={{ fontSize: 12.5, color: MOCK.muted }}>Connect Stripe to unlock</span>
        : loading
          ? <div className="an-skeleton" style={{ width: 90, height: 13, borderRadius: 4 }} />
          : <Delta value={delta} invertGood={bad} />
      }
    </div>
  )
}

function RetentionCurve({ data, loading, onViewDetails }: { data: { day: string; rate: number }[]; loading: boolean; onViewDetails?: () => void }) {
  return (
    <div style={{ background: MOCK.card, border: `1px solid ${MOCK.border}`, boxShadow: MOCK.shadow, borderRadius: 14, padding: '26px 26px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <h3 style={{ fontSize: 19, fontWeight: 700, color: MOCK.text, fontFamily: 'var(--font-display, Fraunces, serif)' }}>
            Retention curve
          </h3>
          <p style={{ fontSize: 13.5, color: MOCK.muted, marginTop: 3 }}>
            Share of signed-up users still active N days after signup.
            {loading && <span style={{ color: MOCK.muted2, marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!loading && onViewDetails && (
            <button onClick={onViewDetails} style={{ fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, color: MOCK.green, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              View details <ArrowRight size={11} />
            </button>
          )}
          <SourcePill>PostHog</SourcePill>
        </div>
      </div>
      <div style={{ width: '100%', height: 200, marginTop: 24 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="retFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#3EBFA6" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#3EBFA6" stopOpacity={0}    />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tick={{ fill: MOCK.muted2, fontSize: 11 }} axisLine={{ stroke: MOCK.border }} tickLine={false} />
            <YAxis tick={{ fill: MOCK.muted2, fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              contentStyle={{ background: MOCK.card, border: `1px solid ${MOCK.border}`, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: MOCK.muted }}
              itemStyle={{ color: '#3EBFA6' }}
              formatter={(v) => [`${v}%`, 'Retained']}
            />
            <Area type="monotone" dataKey="rate" stroke="#3EBFA6" strokeWidth={2.5} fill="url(#retFill)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function FunnelCard({ data, loading, onViewDetails }: { data: { stage: string; value: number }[]; loading: boolean; onViewDetails?: () => void }) {
  const max = data[0]?.value ?? 1
  return (
    <div style={{ background: MOCK.card, border: `1px solid ${MOCK.border}`, boxShadow: MOCK.shadow, borderRadius: 14, padding: '26px 26px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <h3 style={{ fontSize: 19, fontWeight: 700, color: MOCK.text, fontFamily: 'var(--font-display, Fraunces, serif)' }}>
            Conversion funnel
          </h3>
          <p style={{ fontSize: 13.5, color: MOCK.muted, marginTop: 3 }}>
            Where users fall off between arriving and paying.
            {loading && <span style={{ color: MOCK.muted2, marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!loading && onViewDetails && (
            <button onClick={onViewDetails} style={{ fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, color: MOCK.green, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              View details <ArrowRight size={11} />
            </button>
          )}
          <SourcePill>PostHog</SourcePill>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 24 }}>
        {data.map((f, i) => {
          const pct = Math.round((f.value / max) * 100)
          const prev = i > 0 ? data[i - 1].value : null
          const stepPct = prev ? Math.round((f.value / prev) * 100) : 100
          return (
            <div key={f.stage}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, color: MOCK.muted }}>{f.stage}</span>
                <span style={{ fontSize: 14, color: MOCK.text, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {f.value.toLocaleString()}
                  {prev && (
                    <span style={{ fontWeight: 500, fontSize: 13, color: stepPct < 30 ? MOCK.red : MOCK.muted }}>
                      {stepPct}% of prev
                    </span>
                  )}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: MOCK.greenSoft }}>
                <div style={{
                  height: 8, borderRadius: 99, width: `${pct}%`,
                  background: MOCK.green,
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ActivationFunnelCard({ data, loading, onViewDetails }: { data: { stage: string; value: number }[] | null; loading: boolean; onViewDetails?: () => void }) {
  const displayData = data ?? []
  const max = displayData[0]?.value ?? 1
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)' }}>
            Activation funnel
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 3 }}>
            Signup → brand setup → first post → social → publish · last 90 days
            {loading && <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!loading && onViewDetails && (
            <button onClick={onViewDetails} style={{ fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--green-bright)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              View details <ArrowRight size={11} />
            </button>
          )}
          <SourcePill>PostHog</SourcePill>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 24 }}>
        {loading
          ? [1, 2, 3, 4, 5].map(i => (
              <div key={i}>
                <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--line)', marginBottom: 8 }} />
                <div style={{ height: 8, borderRadius: 99, background: 'var(--line)' }} />
              </div>
            ))
          : displayData.length === 0
            ? <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>No funnel data — ensure onboarding_started, post_generated, social_account_connected and post_shared events are firing in PostHog</div>
          : displayData.map((f, i) => {
              const pct = Math.round((f.value / max) * 100)
              const prev = i > 0 ? displayData[i - 1].value : null
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
                    <div style={{ height: 8, borderRadius: 99, width: `${pct}%`, background: 'linear-gradient(90deg, var(--green), var(--green-bright))' }} />
                  </div>
                </div>
              )
            })
        }
      </div>
    </div>
  )
}

function WauChart({ data, loading, onViewDetails }: { data: { week: string; users: number }[] | null; loading: boolean; onViewDetails?: () => void }) {
  const chartData = data ?? []
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)' }}>
            Daily active users
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 3 }}>
            Unique identified users per day — last 30 days
            {loading && <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!loading && onViewDetails && (
            <button onClick={onViewDetails} style={{ fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--green-bright)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              View details <ArrowRight size={11} />
            </button>
          )}
          <SourcePill>PostHog</SourcePill>
        </div>
      </div>
      {!loading && chartData.length === 0 ? (
        <div style={{ marginTop: 24, padding: '28px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          No event data in PostHog for the last 30 days
        </div>
      ) : (
      <div style={{ width: '100%', height: 200, marginTop: 24 }}>
        <ResponsiveContainer>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="wauFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="var(--lime)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--lime)" stopOpacity={0}    />
              </linearGradient>
            </defs>
            <XAxis dataKey="week" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--text-dim)' }}
              itemStyle={{ color: 'var(--lime)' }}
              formatter={(v) => [v, 'Active users']}
            />
            <Area type="monotone" dataKey="users" stroke="var(--lime)" strokeWidth={2.5} fill="url(#wauFill)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      )}
    </div>
  )
}

function PmfCard({ data, loading, onViewDetails }: { data: { event: string; label: string; retainedAvg: number; churnedAvg: number }[] | null; loading: boolean; onViewDetails?: () => void }) {
  const displayData = data ?? []
  const maxVal = Math.max(...displayData.flatMap(d => [d.retainedAvg, d.churnedAvg]), 1)
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)' }}>
            Product-market fit signals
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 3 }}>
            Avg events per user — retained vs churned · last 90 days
            {loading && <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!loading && onViewDetails && (
            <button onClick={onViewDetails} style={{ fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--green-bright)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              View details <ArrowRight size={11} />
            </button>
          )}
          <SourcePill>PostHog</SourcePill>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 20, fontSize: 11, color: 'var(--text-dim)', marginTop: 20, marginBottom: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--green-bright)', display: 'inline-block' }} />
          Retained
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#f87171', display: 'inline-block' }} />
          Churned
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 16 }}>
        {loading
          ? [1, 2, 3, 4].map(i => (
              <div key={i}>
                <div style={{ height: 12, width: '50%', borderRadius: 4, background: 'var(--line)', marginBottom: 8 }} />
                <div style={{ height: 6, borderRadius: 99, background: 'var(--line)', marginBottom: 4 }} />
                <div style={{ height: 6, borderRadius: 99, background: 'var(--line)' }} />
              </div>
            ))
          : displayData.length === 0
            ? <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>No feature event data — ensure feed_viewed, post_generated, post_shared etc. are firing in PostHog</div>
          : displayData.map(d => (
              <div key={d.event}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{d.label}</span>
                  <span style={{ fontSize: 12, display: 'flex', gap: 14, flexShrink: 0 }}>
                    <span style={{ color: 'var(--green-bright)', fontWeight: 600 }}>{d.retainedAvg}×</span>
                    <span style={{ color: '#f87171', fontWeight: 600 }}>{d.churnedAvg}×</span>
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ height: 6, borderRadius: 99, background: 'var(--line)' }}>
                    <div style={{ height: 6, borderRadius: 99, width: `${Math.round((d.retainedAvg / maxVal) * 100)}%`, background: 'var(--green-bright)' }} />
                  </div>
                  <div style={{ height: 6, borderRadius: 99, background: 'var(--line)' }}>
                    <div style={{ height: 6, borderRadius: 99, width: `${Math.round((d.churnedAvg / maxVal) * 100)}%`, background: '#f87171' }} />
                  </div>
                </div>
              </div>
            ))
        }
      </div>
    </div>
  )
}

function DetailMobileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0' }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', flexShrink: 0 }}>{label}</span>
      {value}
    </div>
  )
}

function DetailView({
  type, users, loading, onBack, snapshotData, isMobile, onCopy,
}: {
  type: 'signups' | 'signins' | 'dau' | 'deleted' | 'retention' | 'funnel' | 'activation-funnel' | 'wau' | 'pmf'
  users: UserRow[]
  loading: boolean
  onBack: () => void
  snapshotData: DashboardData | null
  isMobile: boolean
  onCopy: (text: string, msg: string) => void
}) {
  const TITLE: Record<string, string> = {
    signups: 'New signups', signins: 'Sign-ins',
    dau: 'Active users', deleted: 'Deleted accounts', retention: 'Retention cohorts',
    funnel: 'Conversion funnel', 'activation-funnel': 'Activation funnel',
    wau: 'Daily active users', pmf: 'PMF signals',
  }

  function fmtTs(ts: string): string {
    try {
      const d = new Date(ts)
      if (isNaN(d.getTime())) return ts
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    } catch { return ts }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: isMobile ? '20px 16px' : '32px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <button
          onClick={onBack}
          style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}
        >
          <ArrowLeft size={15} />
        </button>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)', margin: 0 }}>
            {TITLE[type]}
          </h1>
          {(type === 'signups' || type === 'signins' || type === 'dau' || type === 'deleted') && (
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
              {loading ? 'Loading...' : `${users.length} result${users.length === 1 ? '' : 's'}`}
            </p>
          )}
        </div>
      </div>

      {type !== 'signups' && type !== 'signins' && type !== 'dau' && type !== 'deleted' ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '22px 24px' }}>
          <div style={{ overflowX: 'auto' }}>
            {type === 'retention' && (() => {
              const rows = snapshotData?.retention ?? FALLBACK_RETENTION
              return (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 300 }}>
                  <thead><tr>
                    <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', padding: '0 32px 12px 0', borderBottom: '1px solid var(--line)' }}>Day</th>
                    <th style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', padding: '0 0 12px', borderBottom: '1px solid var(--line)' }}>Retention rate</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.day}>
                        <td style={{ padding: '10px 32px 10px 0', fontSize: 14, color: 'var(--text-dim)', borderBottom: '1px solid var(--line)' }}>{r.day}</td>
                        <td style={{ padding: '10px 0', fontSize: 14, fontWeight: 600, textAlign: 'right', borderBottom: '1px solid var(--line)', color: r.rate >= 50 ? 'var(--green-bright)' : r.rate >= 20 ? 'var(--gold)' : '#f87171' }}>{r.rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })()}
            {(type === 'funnel' || type === 'activation-funnel') && (() => {
              const rows = type === 'funnel' ? (snapshotData?.funnel ?? FALLBACK_FUNNEL) : (snapshotData?.activationFunnel ?? [])
              const max = rows[0]?.value ?? 1
              return rows.length === 0 ? (
                <div style={{ padding: '20px 0', color: 'var(--text-faint)', fontSize: 13 }}>No funnel data in snapshot</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 400 }}>
                  <thead><tr>
                    <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', padding: '0 0 12px', borderBottom: '1px solid var(--line)' }}>Stage</th>
                    <th style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', padding: '0 0 12px 32px', borderBottom: '1px solid var(--line)' }}>Users</th>
                    <th style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', padding: '0 0 12px 32px', borderBottom: '1px solid var(--line)' }}>Step rate</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((f, i) => {
                      const prev = i > 0 ? rows[i - 1].value : null
                      const stepPct = prev ? Math.round((f.value / prev) * 100) : Math.round((f.value / max) * 100)
                      return (
                        <tr key={f.stage}>
                          <td style={{ padding: '10px 0', fontSize: 14, color: 'var(--text-dim)', borderBottom: '1px solid var(--line)' }}>{f.stage}</td>
                          <td style={{ padding: '10px 0 10px 32px', fontSize: 14, fontWeight: 600, textAlign: 'right', borderBottom: '1px solid var(--line)', color: 'var(--text)' }}>{f.value.toLocaleString()}</td>
                          <td style={{ padding: '10px 0 10px 32px', fontSize: 14, fontWeight: 600, textAlign: 'right', borderBottom: '1px solid var(--line)', color: i === 0 ? 'var(--text-faint)' : stepPct < 30 ? '#f87171' : 'var(--green-bright)' }}>
                            {i === 0 ? '100%' : `${stepPct}%`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )
            })()}
            {type === 'wau' && (() => {
              const rows = snapshotData?.wau ?? []
              return rows.length === 0 ? (
                <div style={{ padding: '20px 0', color: 'var(--text-faint)', fontSize: 13 }}>No daily active user data in snapshot</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 300 }}>
                  <thead><tr>
                    <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', padding: '0 32px 12px 0', borderBottom: '1px solid var(--line)' }}>Date</th>
                    <th style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', padding: '0 0 12px', borderBottom: '1px solid var(--line)' }}>Active users</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ padding: '10px 32px 10px 0', fontSize: 14, color: 'var(--text-dim)', borderBottom: '1px solid var(--line)' }}>{r.week}</td>
                        <td style={{ padding: '10px 0', fontSize: 14, fontWeight: 600, textAlign: 'right', borderBottom: '1px solid var(--line)', color: 'var(--text)' }}>{r.users}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })()}
            {type === 'pmf' && (() => {
              const rows = snapshotData?.pmf ?? []
              return rows.length === 0 ? (
                <div style={{ padding: '20px 0', color: 'var(--text-faint)', fontSize: 13 }}>No PMF signal data in snapshot</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 400 }}>
                  <thead><tr>
                    <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', padding: '0 0 12px', borderBottom: '1px solid var(--line)' }}>Feature</th>
                    <th style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', padding: '0 0 12px 32px', borderBottom: '1px solid var(--line)' }}>Retained avg</th>
                    <th style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', padding: '0 0 12px 32px', borderBottom: '1px solid var(--line)' }}>Churned avg</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(d => (
                      <tr key={d.event}>
                        <td style={{ padding: '10px 0', fontSize: 14, color: 'var(--text-dim)', borderBottom: '1px solid var(--line)' }}>{d.label}</td>
                        <td style={{ padding: '10px 0 10px 32px', fontSize: 14, fontWeight: 600, textAlign: 'right', borderBottom: '1px solid var(--line)', color: 'var(--green-bright)' }}>{d.retainedAvg}×</td>
                        <td style={{ padding: '10px 0 10px 32px', fontSize: 14, fontWeight: 600, textAlign: 'right', borderBottom: '1px solid var(--line)', color: '#f87171' }}>{d.churnedAvg}×</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })()}
          </div>
        </div>
      ) : (
        <>
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column-reverse' : 'row',
            alignItems: isMobile ? 'stretch' : 'center',
            justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10,
          }}>
            <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>Click the copy icon next to any email to copy individually</span>
            <button
              onClick={() => {
                const emails = users.map(u => u.email).filter(Boolean).join(', ')
                if (emails) onCopy(emails, `Copied ${users.length} email${users.length === 1 ? '' : 's'}`)
              }}
              disabled={users.length === 0 || loading}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 600,
                padding: '9px 16px', borderRadius: 99, border: '1px solid var(--line)',
                background: 'transparent', color: 'var(--text-dim)', cursor: users.length === 0 || loading ? 'not-allowed' : 'pointer',
                opacity: users.length === 0 || loading ? 0.5 : 1,
              }}
            >
              <Copy size={13} /> Copy all emails
            </button>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 14 }}>Loading users…</div>
            ) : users.length === 0 ? (
              <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 14 }}>No users found for this time range</div>
            ) : isMobile ? (
              users.map((u, i) => (
                <div key={i} style={{ padding: '18px 16px', borderBottom: i < users.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <div style={{ textAlign: 'center', marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>User</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{u.name ?? '—'}</div>
                  </div>
                  <DetailMobileRow label="User ID" value={<span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-faint)' }}>{u.userId}</span>} />
                  <DetailMobileRow label="Email" value={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>{u.email || '—'}</span>
                      {u.email && (
                        <button
                          onClick={() => onCopy(u.email, `Copied ${u.email}`)}
                          style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-faint)', padding: 4, display: 'flex', alignItems: 'center' }}
                          title="Copy email"
                        >
                          <Copy size={12} />
                        </button>
                      )}
                    </span>
                  } />
                  <DetailMobileRow label="Signed up" value={<span style={{ fontSize: 13, color: 'var(--text)' }}>{fmtTs(u.timestamp)}</span>} />
                  <DetailMobileRow label="Source" value={
                    u.source
                      ? <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: 'rgba(74,222,128,0.12)', color: 'var(--green-bright)' }}>{u.source}</span>
                      : <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>—</span>
                  } />
                  <DetailMobileRow label="Location" value={<span style={{ fontSize: 13, color: 'var(--text)' }}>{u.location ?? '—'}</span>} />
                  <DetailMobileRow label="Plan" value={
                    u.plan
                      ? <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: 'var(--bg-soft)', color: 'var(--text-dim)' }}>{u.plan}</span>
                      : <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>—</span>
                  } />
                </div>
              ))
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      {['User', 'User ID', 'Email', 'Timestamp', 'Source', 'Location', 'Plan'].map(h => (
                        <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', padding: '12px 16px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap' }}>{u.name ?? '—'}</td>
                        <td style={{ padding: '12px 16px', fontSize: 11, color: 'var(--text-faint)', fontFamily: 'monospace', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.userId}</td>
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 13, color: 'var(--text)' }}>{u.email || '—'}</span>
                            {u.email && (
                              <button
                                onClick={() => onCopy(u.email, `Copied ${u.email}`)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 2, display: 'flex', alignItems: 'center' }}
                                title="Copy email"
                              >
                                <Copy size={12} />
                              </button>
                            )}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{fmtTs(u.timestamp)}</td>
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          {u.source
                            ? <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: 'rgba(74,222,128,0.12)', color: 'var(--green-bright)' }}>{u.source}</span>
                            : <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>—</span>}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{u.location ?? '—'}</td>
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          {u.plan
                            ? <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: 'var(--bg-soft)', color: 'var(--text-dim)' }}>{u.plan}</span>
                            : <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
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
}

export default function AnalyticsDashboard({ brand, modules }: Props) {
  const router = useRouter()
  const [backLoading, setBackLoading] = useState(false)
  const [range, setRange] = useState('24h')
  const [expandedModule, setExpandedModule] = useState<string | null>(null)
  const [redirectTarget, setRedirectTarget] = useState<string | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [phLoading, setPhLoading] = useState(true)
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [detailView, setDetailView] = useState<'signups'|'signins'|'dau'|'deleted'|'retention'|'funnel'|'activation-funnel'|'wau'|'pmf'|null>(null)
  const [detailUsers, setDetailUsers] = useState<UserRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [toastMsg, setToastMsg] = useState<string|null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const openDetail = (type: 'signups'|'signins'|'dau'|'deleted'|'retention'|'funnel'|'activation-funnel'|'wau'|'pmf') => {
    setDetailView(type)
    if (type !== 'signups' && type !== 'signins' && type !== 'dau' && type !== 'deleted') return
    setDetailLoading(true)
    setDetailUsers([])
    fetch(`/api/analytics/users?brandId=${brand.id}&type=${type}&range=${range}`)
      .then(r => r.json())
      .then((d: { users: UserRow[] }) => setDetailUsers(d.users ?? []))
      .catch(() => setDetailUsers([]))
      .finally(() => setDetailLoading(false))
  }

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 1600)
  }

  // Fetch analytics data (returns cached snapshot unless force=true)
  useEffect(() => {
    setPhLoading(true)
    fetch(`/api/analytics/auth-dashboard?brandId=${brand.id}`)
      .then(r => r.json())
      .then((d: DashboardData) => { setData(d); setSnapshotAt(d.snapshotAt ?? null) })
      .catch(() => setData(null))
      .finally(() => setPhLoading(false))
  }, [brand.id])

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

  // Range-derived values
  const rangeLabel      = range === '7d' ? 'Last 7 days' : range === '30d' ? 'Last 30 days' : 'Last 24 hours'
  const rangePeriod     = range === '7d' ? 'prev 7d'     : range === '30d' ? 'prev 30d'     : 'yesterday'
  const signupsVal      = range === '7d' ? (data?.signups7d ?? 0)          : range === '30d' ? (data?.signups30d ?? 0)          : (data?.signups24h ?? 0)
  const signinsVal      = range === '7d' ? (data?.signins7d ?? 0)          : range === '30d' ? (data?.signins30d ?? 0)          : (data?.signins24h ?? 0)
  const deletedVal      = range === '7d' ? (data?.deleted7d ?? 0)          : range === '30d' ? (data?.deleted30d ?? 0)          : (data?.deletedAccounts24h ?? 0)
  const activeUsersVal  = range === '7d' ? (data?.activeUsers7d ?? 0)      : range === '30d' ? (data?.mau ?? 0)                 : (data?.dau ?? 0)
  const activeUsersLabel = range === '7d' ? '7-day active users'           : range === '30d' ? 'Monthly active users'           : 'Daily active users'

  // Prior period values for delta calculation
  const signupsPrior     = range === '7d' ? (data?.signupsPrev7d ?? 0)      : range === '30d' ? (data?.signupsPrev30d ?? 0)      : (data?.signupsPrev24h ?? 0)
  const signinsPrior     = range === '7d' ? (data?.signinsPrev7d ?? 0)      : range === '30d' ? (data?.signinsPrev30d ?? 0)      : (data?.signinsPrev24h ?? 0)
  const activeUsersPrior = range === '7d' ? (data?.activeUsersPrev7d ?? 0)  : range === '30d' ? (data?.mauPrev ?? 0)             : (data?.dauPrev ?? 0)
  const deletedPrior     = range === '7d' ? (data?.deletedPrev7d ?? 0)      : range === '30d' ? (data?.deletedPrev30d ?? 0)      : (data?.deletedPrev24h ?? 0)

  // Build activity tiles — real PostHog data + Stripe (coming soon)
  const activityTiles: {
    key: string; label: string; value: string | number; delta: number
    source: string; icon: React.ElementType; tone: string
    loading?: boolean; comingSoon?: boolean; invertGood?: boolean; period?: string
    onViewDetails?: () => void
  }[] = [
    { key: 'signups',  label: 'New signups',      value: signupsVal,      delta: signupsVal - signupsPrior,         source: 'PostHog',  icon: UserPlus,      tone: 'green',   loading: phLoading, period: rangePeriod, onViewDetails: data?.posthogConnected ? () => openDetail('signups') : undefined },
    { key: 'signins',  label: 'Sign-ins',          value: signinsVal,      delta: signinsVal - signinsPrior,         source: 'PostHog',  icon: LogIn,         tone: 'green',   loading: phLoading, period: rangePeriod, onViewDetails: data?.posthogConnected ? () => openDetail('signins') : undefined },
    { key: 'au',       label: activeUsersLabel,    value: activeUsersVal,  delta: activeUsersVal - activeUsersPrior, source: 'PostHog',  icon: Crown,         tone: 'amber',   loading: phLoading, period: rangePeriod, onViewDetails: data?.posthogConnected ? () => openDetail('dau') : undefined },
    { key: 'deleted',  label: 'Deleted account',   value: deletedVal,      delta: deletedVal - deletedPrior,         source: 'PostHog',  icon: Trash2,        tone: 'red',     loading: phLoading, period: rangePeriod, invertGood: true, onViewDetails: data?.posthogConnected ? () => openDetail('deleted') : undefined },
    { key: 'pro',      label: 'Became PRO',        value: 0, delta: 0, source: 'Stripe',   icon: Crown,         tone: 'amber',   comingSoon: true },
    { key: 'unsub',    label: 'Unsubscribed',      value: 0, delta: 0, source: 'Stripe',   icon: UserMinus,     tone: 'red',     comingSoon: true, invertGood: true },
    { key: 'contact',  label: 'Support contacted', value: 0, delta: 0, source: 'Internal', icon: MessageSquare, tone: 'amber', comingSoon: true },
    { key: 'reviews',  label: 'Reviews left',      value: 0, delta: 0, source: 'Internal', icon: Star,          tone: 'amber',   comingSoon: true },
  ]

  const avgScore = modules.filter(m => !m.locked).length > 0
    ? Math.round(modules.filter(m => !m.locked).reduce((s, m) => s + m.score, 0) / modules.filter(m => !m.locked).length)
    : 0

  if (detailView !== null) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>
        {toastMsg && (
          <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', fontSize: 13, fontWeight: 600, padding: '10px 20px', borderRadius: 99, zIndex: 100, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
            <CheckCircle2 size={14} /> {toastMsg}
          </div>
        )}
        <DetailView
          type={detailView}
          users={detailUsers}
          loading={detailLoading}
          onBack={() => setDetailView(null)}
          snapshotData={data}
          isMobile={isMobile}
          onCopy={(text, msg) => { void navigator.clipboard.writeText(text); showToast(msg) }}
        />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: MOCK.bg, fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>

      {redirectTarget && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px',
          borderRadius: 12, fontSize: 13, background: 'var(--green)', color: '#06140c',
        }}>
          Opening <strong style={{ marginLeft: 2 }}>{redirectTarget}</strong> →
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: isMobile ? '20px 16px' : '32px 28px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              onClick={() => { setBackLoading(true); router.push('/dashboard') }}
              style={{
                width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${MOCK.border}`, background: MOCK.card, color: MOCK.text, cursor: 'pointer',
              }}
            >
              {backLoading
                ? <RefreshCw size={14} style={{ animation: 'spin 0.7s linear infinite' }} />
                : <ArrowLeft size={15} />
              }
            </button>
            <div>
              <h1 style={{
                fontSize: 30, fontWeight: 700, letterSpacing: '-0.4px', color: MOCK.text,
                fontFamily: 'var(--font-display, Fraunces, serif)', margin: 0,
              }}>
                User Analytics
              </h1>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: MOCK.green, marginTop: 4 }}>
                {brand.name} · {[data?.posthogConnected && 'PostHog', gsc?.connected && 'GSC', ga4?.connected && 'GA4'].filter(Boolean).join(' · ') || 'No integrations connected'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'flex-start' : 'flex-end', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', padding: '3px', border: `1px solid ${MOCK.border}`, borderRadius: 99, background: MOCK.card }}>
                {['24h', '7d', '30d'].map((r) => (
                  <button key={r} onClick={() => setRange(r)} style={{
                    fontSize: 13.5, fontWeight: 600, padding: '5px 14px', borderRadius: 99,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: range === r ? MOCK.badgeDark : 'transparent',
                    color: range === r ? '#ffffff' : MOCK.muted,
                  }}>
                    {r}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setPhLoading(true)
                  fetch(`/api/analytics/auth-dashboard?brandId=${brand.id}&force=true`)
                    .then(r => r.json())
                    .then((d: DashboardData) => { setData(d); setSnapshotAt(d.snapshotAt ?? null) })
                    .finally(() => setPhLoading(false))
                }}
                title="Refresh"
                style={{
                  width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${MOCK.border}`, background: MOCK.card, color: MOCK.text, cursor: 'pointer',
                }}
              >
                <RefreshCw size={14} style={{ animation: phLoading ? 'spin 1s linear infinite' : 'none' }} />
              </button>
            </div>
            {snapshotAt && !phLoading && (
              <span style={{ fontSize: 11.5, color: MOCK.muted2 }}>
                fetched {formatTimeAgo(snapshotAt)}
              </span>
            )}
          </div>
        </div>

        {/* Summary + Todo — hidden for now */}

        {/* Activity section — range-driven */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: MOCK.green, marginBottom: 14 }}>
            {rangeLabel}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12 }}>
            {activityTiles.map((item) => (
              <StatCard
                key={item.key}
                icon={item.icon} iconTone={item.tone}
                label={item.label} value={item.value}
                source={item.source} deltaValue={item.delta}
                invertGood={item.invertGood}
                loading={item.loading}
                comingSoon={item.comingSoon}
                period={item.period}
                onViewDetails={item.onViewDetails}
                isMobile={isMobile}
              />
            ))}
          </div>
        </section>

        {/* Growth & retention KPIs */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: MOCK.green, marginBottom: 14 }}>
            Growth &amp; retention
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
            <KpiCard label="MRR" value="$0" sub="Monthly recurring revenue" source="Stripe" delta={0} comingSoon isMobile={isMobile} />
            <KpiCard label="ARR" value="$0" sub="Annualised run rate" source="Stripe" delta={0} comingSoon isMobile={isMobile} />
            <KpiCard label="Churn rate" value="0%" sub="Paid cancellations, 30d" source="Stripe" delta={0} bad comingSoon isMobile={isMobile} />
            <KpiCard label="Onboarding drop-off" value="0%" sub="Users who don't return after signup" source="Stripe" delta={0} bad comingSoon isMobile={isMobile} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <RetentionCurve data={retentionData} loading={phLoading} onViewDetails={data?.posthogConnected ? () => openDetail('retention') : undefined} />
            <FunnelCard data={funnelData} loading={phLoading} onViewDetails={data?.posthogConnected ? () => openDetail('funnel') : undefined} />
          </div>
        </section>

        {/* ── Product signals ── */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: MOCK.green, marginBottom: 14 }}>
            Product signals
          </h2>
          {!data?.posthogConnected && !phLoading ? (
            <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '28px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>PostHog not connected</p>
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Go to Settings → Integrations → PostHog to connect</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <WauChart data={data?.wau ?? null} loading={phLoading} onViewDetails={data?.posthogConnected ? () => openDetail('wau') : undefined} />
              <ActivationFunnelCard data={data?.activationFunnel ?? null} loading={phLoading} onViewDetails={data?.posthogConnected ? () => openDetail('activation-funnel') : undefined} />
              <PmfCard data={data?.pmf ?? null} loading={phLoading} onViewDetails={data?.posthogConnected ? () => openDetail('pmf') : undefined} />
            </div>
          )}
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
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
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
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: '8px 24px' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
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
            {!ga4?.connected && <ComingSoonBadge />}
          </div>
          <div style={{ position: 'relative', opacity: ga4?.connected && !ga4?.error ? 1 : 0.55 }}>
            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
              {[
                { label: 'Sessions',        value: ga4?.sessions7d,       suffix: '' },
                { label: 'Active users',    value: ga4?.activeUsers7d,    suffix: '' },
                { label: 'New users',       value: ga4?.newUsers7d,       suffix: '' },
                { label: 'Pageviews',       value: ga4?.pageviews7d,      suffix: '' },
                { label: 'Engagement rate', value: ga4?.engagementRate7d, suffix: '%' },
              ].map(k => (
                <div key={k.label} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 16px' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>{k.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text)', lineHeight: 1, filter: !ga4?.connected ? 'blur(5px)' : 'none' }}>
                    {k.value != null ? `${fmt(k.value)}${k.suffix}` : '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>7 days</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14, marginBottom: 14 }}>
              {/* Daily trend chart */}
              <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>New users</h3>
                <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>Daily new users — last 30 days</p>
                <div style={{ height: 160, filter: !ga4?.connected ? 'blur(4px)' : 'none' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={ga4?.connected && ga4.dailyTrend.length ? ga4.dailyTrend : Array.from({ length: 10 }, (_, i) => ({ date: `d${i}`, newUsers: Math.round(Math.random() * 30 + 5) }))} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="ga4Fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="var(--gold)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="var(--gold)" stopOpacity={0}    />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                      <Tooltip contentStyle={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }} itemStyle={{ color: 'var(--gold)' }} />
                      <Area type="monotone" dataKey="newUsers" stroke="var(--gold)" strokeWidth={2} fill="url(#ga4Fill)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Traffic sources */}
              <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Traffic sources</h3>
                <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>Sessions by channel — 7 days</p>
                {(() => {
                  const sources = ga4?.connected && ga4.trafficSources.length ? ga4.trafficSources : [
                    { channel: 'Organic Search', sessions: 420 },
                    { channel: 'Direct', sessions: 280 },
                    { channel: 'Referral', sessions: 140 },
                    { channel: 'Social', sessions: 90 },
                  ]
                  const maxSessions = Math.max(...sources.map(s => s.sessions), 1)
                  const CHANNEL_COLORS: Record<string, string> = { 'Organic Search': 'var(--green)', 'Direct': 'var(--green-bright)', 'Referral': 'var(--gold)', 'Social': '#5eead4', 'Email': '#a78bfa', 'Paid Search': '#f87171' }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, filter: !ga4?.connected ? 'blur(4px)' : 'none' }}>
                      {sources.map(s => (
                        <div key={s.channel}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{s.channel}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{fmt(s.sessions)}</span>
                          </div>
                          <div style={{ height: 5, borderRadius: 99, background: 'var(--line)' }}>
                            <div style={{ height: 5, borderRadius: 99, width: `${Math.round(s.sessions / maxSessions * 100)}%`, background: CHANNEL_COLORS[s.channel] ?? 'var(--text-dim)' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Top landing pages */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Top landing pages</h3>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>Entry pages by sessions — 7 days</p>
              <div style={{ filter: !ga4?.connected ? 'blur(4px)' : 'none', overflowX: 'auto' }}>
                <div style={{ minWidth: isMobile ? 380 : 'unset' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '6px 20px', fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                  <span>Page</span><span>Sessions</span><span>New users</span><span>Engagement</span>
                </div>
                {(ga4?.connected && ga4.topPages.length ? ga4.topPages : [
                  { page: '/home', sessions: 340, newUsers: 180, engagementRate: 72 },
                  { page: '/pricing', sessions: 210, newUsers: 95, engagementRate: 68 },
                  { page: '/blog/example-post', sessions: 130, newUsers: 110, engagementRate: 81 },
                ]).map((p, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '6px 20px', padding: '7px 0', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.page}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'right' }}>{fmt(p.sessions)}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'right' }}>{fmt(p.newUsers)}</span>
                    <span style={{ fontSize: 12, textAlign: 'right', color: p.engagementRate >= 60 ? 'var(--green-bright)' : p.engagementRate >= 40 ? 'var(--gold)' : '#f87171' }}>{p.engagementRate}%</span>
                  </div>
                ))}
                </div>
              </div>
            </div>

            {/* Not connected / error overlay */}
            {(!ga4?.connected || ga4?.error) && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 14 }}>
                <div style={{ textAlign: 'center', padding: '20px 28px', background: 'var(--card)', border: `1px solid ${ga4?.error ? '#f8717140' : 'var(--line)'}`, borderRadius: 14 }}>
                  <BarChart2 size={22} style={{ color: ga4?.error ? '#f87171' : 'var(--text-faint)', marginBottom: 10 }} />
                  {ga4?.error ? (
                    <>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#f87171', marginBottom: 4 }}>GA4 auth failed</p>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Check your service account key in Settings → Integrations</p>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Connect Google Analytics 4</p>
                      <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Go to Settings → Integrations → GA4 API</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Module health — hidden for now */}

      </div>
    </div>
  )
}
