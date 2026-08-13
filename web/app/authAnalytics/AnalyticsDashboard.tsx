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
  Plus, X as XIcon, Pencil,
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
  totalUsers: number
  proUsers: number
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
  cardOverrides?: Record<string, { label?: string; events?: string[] }>
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

interface CustomMetricData {
  id: string
  eventName: string
  label: string
  tone: string
  metricType: string
  count24h: number; count7d: number; count30d: number
  uniqueUsers24h: number; uniqueUsers7d: number; uniqueUsers30d: number
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

function InfoTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onClick={(e) => { e.stopPropagation(); setVisible(v => !v) }}
        style={{
          width: 16, height: 16, borderRadius: '50%',
          background: 'transparent', border: `1px solid ${MOCK.border}`,
          color: MOCK.muted2, fontSize: 10, fontWeight: 700,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, lineHeight: 1,
        }}
      >
        i
      </button>
      {visible && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%',
          transform: 'translateX(-50%)',
          background: '#ffffff', border: '1px solid #d1d5db',
          borderRadius: 10, padding: '10px 14px',
          fontSize: 12.5, color: '#111827', lineHeight: 1.6,
          width: 230, zIndex: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          pointerEvents: 'none',
          whiteSpace: 'normal', textAlign: 'left',
        }}>
          {text}
        </div>
      )}
    </span>
  )
}

function StatCard({
  icon: Icon, iconTone, label, value, source, deltaValue, invertGood, loading, comingSoon, period, onViewDetails, isMobile, info,
}: {
  icon: React.ElementType; iconTone: string; label: string; value: string | number
  source: string; deltaValue: number; invertGood?: boolean; loading?: boolean; comingSoon?: boolean; period?: string
  onViewDetails?: () => void; isMobile?: boolean; info?: string
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: MOCK.text }}>{label}</span>
          {info && <InfoTooltip text={info} />}
        </div>
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
            cursor: 'pointer', padding: 0, marginTop: -4, textDecoration: 'underline',
          }}
        >
          View details <ArrowRight size={11} />
        </button>
      )}
    </div>
  )
}

function KpiCard({ label, value, sub, source, delta, bad, loading, comingSoon, isMobile, info }: {
  label: string; value: string; sub: string; source: string
  delta: number; bad?: boolean; loading?: boolean; comingSoon?: boolean; isMobile?: boolean; info?: string
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {comingSoon ? <ComingSoonBadge /> : <SourcePill>{source}</SourcePill>}
          {info && <InfoTooltip text={info} />}
        </div>
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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', marginBottom: 4 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ fontSize: 19, fontWeight: 700, color: MOCK.text, fontFamily: 'var(--font-display, Fraunces, serif)', margin: 0 }}>
              Retention curve
            </h3>
            <InfoTooltip text="Shows what % of users who signed up are still active after day 1, day 7, day 14, etc. A healthy product keeps this curve as high and flat as possible." />
          </div>
          <p style={{ fontSize: 13.5, color: MOCK.muted, marginTop: 3 }}>
            Share of signed-up users still active N days after signup.
            {loading && <span style={{ color: MOCK.muted2, marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <SourcePill>PostHog</SourcePill>
          {!loading && onViewDetails && (
            <button onClick={onViewDetails} style={{ fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', color: MOCK.green, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
              View details <ArrowRight size={11} />
            </button>
          )}
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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', marginBottom: 4 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ fontSize: 19, fontWeight: 700, color: MOCK.text, fontFamily: 'var(--font-display, Fraunces, serif)', margin: 0 }}>
              Conversion funnel
            </h3>
            <InfoTooltip text="Tracks how many users complete each step from first visit to paying customer. The drop between each step shows where you're losing people." />
          </div>
          <p style={{ fontSize: 13.5, color: MOCK.muted, marginTop: 3 }}>
            Where users fall off between arriving and paying.
            {loading && <span style={{ color: MOCK.muted2, marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <SourcePill>PostHog</SourcePill>
          {!loading && onViewDetails && (
            <button onClick={onViewDetails} style={{ fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', color: MOCK.green, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
              View details <ArrowRight size={11} />
            </button>
          )}
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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', marginBottom: 4 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)', margin: 0 }}>
              Activation funnel
            </h3>
            <InfoTooltip text="Tracks new users through your onboarding steps. A big drop at any stage means that step is too confusing or asks too much — fix that step first." />
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 3 }}>
            Signup → brand setup → first post → social → publish · last 90 days
            {loading && <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <SourcePill>PostHog</SourcePill>
          {!loading && onViewDetails && (
            <button onClick={onViewDetails} style={{ fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', color: 'var(--green-bright)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
              View details <ArrowRight size={11} />
            </button>
          )}
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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', marginBottom: 4 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)' }}>
            Daily active users
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 3 }}>
            Unique identified users per day — last 30 days
            {loading && <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, flexShrink: 0 }}>
          <SourcePill>PostHog</SourcePill>
          {!loading && onViewDetails && (
            <button onClick={onViewDetails} style={{ fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', color: 'var(--green-bright)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
              View details <ArrowRight size={11} />
            </button>
          )}
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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', marginBottom: 4 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)' }}>
            Product-market fit signals
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 3 }}>
            Avg events per user — retained vs churned · last 90 days
            {loading && <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>Loading…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, flexShrink: 0 }}>
          <SourcePill>PostHog</SourcePill>
          {!loading && onViewDetails && (
            <button onClick={onViewDetails} style={{ fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', color: 'var(--green-bright)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
              View details <ArrowRight size={11} />
            </button>
          )}
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
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: MOCK.muted2, flexShrink: 0 }}>{label}</span>
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
          style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${MOCK.border}`, background: MOCK.card, color: MOCK.text, cursor: 'pointer' }}
        >
          <ArrowLeft size={15} />
        </button>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.4px', color: MOCK.text, fontFamily: 'var(--font-display, Fraunces, serif)', margin: 0 }}>
            {TITLE[type]}
          </h1>
          {(type === 'signups' || type === 'signins' || type === 'dau' || type === 'deleted') && (
            <p style={{ fontSize: 13.5, fontWeight: 600, color: MOCK.green, marginTop: 4 }}>
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
            <span style={{ fontSize: 13, color: MOCK.muted2 }}>Click the copy icon next to any email to copy individually</span>
            <button
              onClick={() => {
                const emails = users.map(u => u.email).filter(Boolean).join(', ')
                if (emails) onCopy(emails, `Copied ${users.length} email${users.length === 1 ? '' : 's'}`)
              }}
              disabled={users.length === 0 || loading}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 600,
                padding: '9px 16px', borderRadius: 99, border: `1px solid ${MOCK.border}`,
                background: MOCK.card, color: MOCK.text, cursor: users.length === 0 || loading ? 'not-allowed' : 'pointer',
                opacity: users.length === 0 || loading ? 0.5 : 1,
              }}
            >
              <Copy size={13} /> Copy all emails
            </button>
          </div>

          <div style={{ background: MOCK.card, border: `1px solid ${MOCK.border}`, boxShadow: MOCK.shadow, borderRadius: 14, overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: '40px 24px', textAlign: 'center', color: MOCK.muted2, fontSize: 14 }}>Loading users…</div>
            ) : users.length === 0 ? (
              <div style={{ padding: '40px 24px', textAlign: 'center', color: MOCK.muted2, fontSize: 14 }}>No users found for this time range</div>
            ) : isMobile ? (
              users.map((u, i) => (
                <div key={i} style={{ padding: '18px 16px', borderBottom: i < users.length - 1 ? `1px solid ${MOCK.border}` : 'none' }}>
                  <div style={{ textAlign: 'center', marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: MOCK.muted2 }}>User</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: MOCK.text, marginTop: 2 }}>{u.name ?? '—'}</div>
                  </div>
                  <DetailMobileRow label="User ID" value={<span style={{ fontFamily: 'monospace', fontSize: 12, color: MOCK.muted2 }}>{u.userId}</span>} />
                  <DetailMobileRow label="Email" value={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, color: MOCK.text }}>{u.email || '—'}</span>
                      {u.email && (
                        <button
                          onClick={() => onCopy(u.email, `Copied ${u.email}`)}
                          style={{ background: 'none', border: `1px solid ${MOCK.border}`, borderRadius: 6, cursor: 'pointer', color: MOCK.muted2, padding: 4, display: 'flex', alignItems: 'center' }}
                          title="Copy email"
                        >
                          <Copy size={12} />
                        </button>
                      )}
                    </span>
                  } />
                  <DetailMobileRow label="Signed up" value={<span style={{ fontSize: 13, color: MOCK.text }}>{fmtTs(u.timestamp)}</span>} />
                  <DetailMobileRow label="Source" value={
                    u.source
                      ? <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: MOCK.greenSoft, color: MOCK.green }}>{u.source}</span>
                      : <span style={{ fontSize: 12, color: MOCK.muted2 }}>—</span>
                  } />
                  <DetailMobileRow label="Location" value={<span style={{ fontSize: 13, color: MOCK.text }}>{u.location ?? '—'}</span>} />
                  <DetailMobileRow label="Plan" value={
                    u.plan
                      ? <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: '#F0EEE6', color: MOCK.muted }}>{u.plan}</span>
                      : <span style={{ fontSize: 12, color: MOCK.muted2 }}>—</span>
                  } />
                </div>
              ))
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${MOCK.border}` }}>
                      {['User', 'User ID', 'Email', 'Timestamp', 'Source', 'Location', 'Plan'].map(h => (
                        <th key={h} style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: MOCK.muted, background: '#FBF9F4', padding: '12px 16px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${MOCK.border}` }}>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: MOCK.text, whiteSpace: 'nowrap' }}>{u.name ?? '—'}</td>
                        <td style={{ padding: '12px 16px', fontSize: 11, color: MOCK.muted2, fontFamily: 'monospace', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.userId}</td>
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 13, color: MOCK.text }}>{u.email || '—'}</span>
                            {u.email && (
                              <button
                                onClick={() => onCopy(u.email, `Copied ${u.email}`)}
                                style={{ background: 'none', border: `1px solid ${MOCK.border}`, borderRadius: 7, cursor: 'pointer', color: MOCK.muted, padding: 4, display: 'flex', alignItems: 'center' }}
                                title="Copy email"
                              >
                                <Copy size={12} />
                              </button>
                            )}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 12, color: MOCK.text, whiteSpace: 'nowrap' }}>{fmtTs(u.timestamp)}</td>
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          {u.source
                            ? <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: MOCK.greenSoft, color: MOCK.green }}>{u.source}</span>
                            : <span style={{ fontSize: 12, color: MOCK.muted2 }}>—</span>}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 12, color: MOCK.text, whiteSpace: 'nowrap' }}>{u.location ?? '—'}</td>
                        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          {u.plan
                            ? <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: '#F0EEE6', color: MOCK.muted }}>{u.plan}</span>
                            : <span style={{ fontSize: 12, color: MOCK.muted2 }}>—</span>}
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

/* ── Road to 500 progress track ───────────────────────── */
function RoadToGoalTrack({ current, milestones }: { current: number; milestones: number[] }) {
  const goal = milestones[milestones.length - 1]
  const n = milestones.length - 1

  let pct = 0
  if (current >= goal) {
    pct = 100
  } else {
    for (let i = 0; i < n; i++) {
      if (current <= milestones[i + 1]) {
        const segStart = (i / n) * 100
        const segEnd = ((i + 1) / n) * 100
        const t = (current - milestones[i]) / (milestones[i + 1] - milestones[i])
        pct = segStart + t * (segEnd - segStart)
        break
      }
    }
  }

  return (
    <div style={{ position: 'relative', paddingBottom: 36 }}>
      {/* Track */}
      <div style={{ position: 'relative', height: 5, background: '#E7E3D7', borderRadius: 99 }}>
        {/* Fill */}
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: MOCK.green, borderRadius: 99 }} />

        {/* Milestone dots */}
        {milestones.map((ms, i) => {
          const msPct = (i / n) * 100
          const passed = ms <= current
          return (
            <div key={ms} style={{ position: 'absolute', top: '50%', left: `${msPct}%`, transform: 'translate(-50%, -50%)', zIndex: 1 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: passed ? MOCK.green : MOCK.card,
                border: `2px solid ${passed ? MOCK.green : '#C8C4B8'}`,
              }} />
            </div>
          )
        })}

        {/* Current position dot */}
        <div style={{ position: 'absolute', top: '50%', left: `${pct}%`, transform: 'translate(-50%, -50%)', zIndex: 4 }}>
          <div style={{
            width: 18, height: 18, borderRadius: '50%',
            background: MOCK.green,
            border: `3px solid ${MOCK.card}`,
            boxShadow: `0 0 0 2px ${MOCK.green}`,
          }} />
        </div>
      </div>

      {/* Milestone labels */}
      {milestones.map((ms, i) => {
        const msPct = (i / n) * 100
        return (
          <div key={ms} style={{
            position: 'absolute',
            left: `${msPct}%`,
            top: 14,
            transform: i === 0 ? 'none' : i === n ? 'translateX(-100%)' : 'translateX(-50%)',
            fontSize: 11,
            color: MOCK.muted2,
            fontWeight: 500,
            userSelect: 'none',
          }}>
            {ms}
          </div>
        )
      })}

      {/* You're here label */}
      <div style={{
        position: 'absolute',
        left: `${pct}%`,
        top: 28,
        transform: pct < 5 ? 'translateX(0)' : pct > 95 ? 'translateX(-100%)' : 'translateX(-50%)',
        fontSize: 11.5,
        fontWeight: 700,
        color: MOCK.green,
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}>
        {current} · you're here
      </div>
    </div>
  )
}

/* ── Main component ───────────────────────────────────── */
interface Props {
  brand: { id: string; name: string; websiteUrl: string; createdAt: string | null }
  modules: ModuleHealth[]
  dailyEmailEnabled: boolean
}

export default function AnalyticsDashboard({ brand, modules, dailyEmailEnabled: initialDailyEmail }: Props) {
  const router = useRouter()
  const [backLoading, setBackLoading] = useState(false)
  const [view, setView] = useState<'users' | 'website'>('users')
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
  const [customMetrics, setCustomMetrics] = useState<CustomMetricData[]>([])
  const [showAddMetric, setShowAddMetric] = useState(false)
  const [phEvents, setPhEvents] = useState<{ event: string; cnt: number }[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventSearch, setEventSearch] = useState('')
  const [newMetricEvent, setNewMetricEvent] = useState('')
  const [newMetricLabel, setNewMetricLabel] = useState('')
  const [newMetricTone, setNewMetricTone] = useState('green')
  const [newMetricType, setNewMetricType] = useState('count')
  const [savingMetric, setSavingMetric] = useState(false)
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
  const [editBuiltinCard, setEditBuiltinCard] = useState<{ key: string; label: string; events: string } | null>(null)
  const [savingBuiltinEdit, setSavingBuiltinEdit] = useState(false)
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null)
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

  const loadCustomMetrics = () => {
    fetch(`/api/analytics/custom-metrics?brandId=${brand.id}`)
      .then(r => r.json())
      .then((d: { metrics: CustomMetricData[] }) => setCustomMetrics(d.metrics ?? []))
      .catch(() => {})
  }

  const openEditBuiltin = (key: string, defaultLabel: string) => {
    const ov = data?.cardOverrides?.[key]
    setEditBuiltinCard({
      key,
      label: ov?.label ?? defaultLabel,
      events: (ov?.events ?? []).join(', '),
    })
  }

  const saveBuiltinEdit = async () => {
    if (!editBuiltinCard || savingBuiltinEdit) return
    setSavingBuiltinEdit(true)
    const events = editBuiltinCard.events.split(',').map(e => e.trim()).filter(Boolean)
    try {
      const res = await fetch('/api/analytics/built-in-metrics', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: brand.id, key: editBuiltinCard.key, label: editBuiltinCard.label, events }),
      })
      if (res.ok) {
        setData(prev => prev ? {
          ...prev,
          cardOverrides: { ...prev.cardOverrides, [editBuiltinCard.key]: { label: editBuiltinCard.label, events } },
        } : prev)
        setEditBuiltinCard(null)
        showToast('Saved — refresh analytics to apply new events')
      }
    } finally {
      setSavingBuiltinEdit(false)
    }
  }

  const openEditCustom = (m: CustomMetricData) => {
    setEditingCustomId(m.id)
    setNewMetricEvent(m.eventName)
    setNewMetricLabel(m.label)
    setNewMetricTone(m.tone)
    setNewMetricType(m.metricType)
    setEventSearch(m.eventName)
    setShowAddMetric(true)
    if (phEvents.length === 0) {
      setEventsLoading(true)
      fetch(`/api/analytics/posthog-events?brandId=${brand.id}`)
        .then(r => r.json())
        .then((d: { events: { event: string; cnt: number }[] }) => setPhEvents(d.events ?? []))
        .catch(() => {})
        .finally(() => setEventsLoading(false))
    }
  }

  const openAddMetric = () => {
    setEditingCustomId(null)
    setShowAddMetric(true)
    setNewMetricEvent('')
    setNewMetricLabel('')
    setNewMetricTone('green')
    setNewMetricType('count')
    setEventSearch('')
    if (phEvents.length === 0) {
      setEventsLoading(true)
      fetch(`/api/analytics/posthog-events?brandId=${brand.id}`)
        .then(r => r.json())
        .then((d: { events: { event: string; cnt: number }[] }) => setPhEvents(d.events ?? []))
        .catch(() => {})
        .finally(() => setEventsLoading(false))
    }
  }

  const saveMetric = async () => {
    if (!newMetricEvent || !newMetricLabel || savingMetric) return
    setSavingMetric(true)
    try {
      const url    = editingCustomId ? `/api/analytics/custom-metrics/${editingCustomId}` : '/api/analytics/custom-metrics'
      const method = editingCustomId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: brand.id, eventName: newMetricEvent, label: newMetricLabel, tone: newMetricTone, metricType: newMetricType }),
      })
      if (res.ok) {
        setShowAddMetric(false)
        setEditingCustomId(null)
        loadCustomMetrics()
        showToast(editingCustomId ? 'Metric updated' : 'Metric added')
      }
    } finally {
      setSavingMetric(false)
    }
  }

  const deleteMetric = async (id: string) => {
    setCustomMetrics(prev => prev.filter(m => m.id !== id))
    await fetch(`/api/analytics/custom-metrics/${id}?brandId=${brand.id}`, { method: 'DELETE' })
    showToast('Metric removed')
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

  // Load custom metric cards (always fresh — not cached in snapshot)
  useEffect(() => { loadCustomMetrics() }, [brand.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const cardOv = data?.cardOverrides ?? {}
  const CARD_INFO: Record<string, string> = {
    signups:  'People who created a new account in this period. A rising number means your marketing or word-of-mouth is working.',
    signins:  'Existing users who logged back in. Shows how many people are actively returning to your product.',
    au:       'Unique users who did anything in your app during this period. Think of it as the heartbeat of your product.',
    deleted:  'Users who deleted their account. Even 1 is worth investigating — look for patterns in timing or user type.',
    pro:      'Users who upgraded to a paid plan. This is your core revenue signal — track it closely every day.',
    unsub:    'Paid users who cancelled their subscription. A spike here usually means something went wrong with the product or onboarding.',
    contact:  'Users who reached out for help. High numbers can signal confusing UX or a missing feature.',
    reviews:  'Users who left a review on app stores or review sites. Reviews drive trust and help new users decide to sign up.',
  }

  const activityTiles: {
    key: string; label: string; value: string | number; delta: number
    source: string; icon: React.ElementType; tone: string
    loading?: boolean; comingSoon?: boolean; invertGood?: boolean; period?: string
    onViewDetails?: () => void; onEdit?: () => void; info?: string
  }[] = [
    { key: 'signups',  label: 'New signups',      value: signupsVal,      delta: signupsVal - signupsPrior,         source: 'PostHog',  icon: UserPlus,      tone: 'green',   loading: phLoading, period: rangePeriod, onViewDetails: data?.posthogConnected ? () => openDetail('signups') : undefined },
    { key: 'signins',  label: 'Sign-ins',          value: signinsVal,      delta: signinsVal - signinsPrior,         source: 'PostHog',  icon: LogIn,         tone: 'green',   loading: phLoading, period: rangePeriod, onViewDetails: data?.posthogConnected ? () => openDetail('signins') : undefined },
    { key: 'au',       label: activeUsersLabel,    value: activeUsersVal,  delta: activeUsersVal - activeUsersPrior, source: 'PostHog',  icon: Crown,         tone: 'amber',   loading: phLoading, period: rangePeriod, onViewDetails: data?.posthogConnected ? () => openDetail('dau') : undefined },
    { key: 'deleted',  label: cardOv['deleted']?.label ?? 'Deleted account', value: deletedVal, delta: deletedVal - deletedPrior, source: 'PostHog', icon: Trash2, tone: 'red', loading: phLoading, period: rangePeriod, invertGood: true, onViewDetails: data?.posthogConnected ? () => openDetail('deleted') : undefined, onEdit: data?.posthogConnected ? () => openEditBuiltin('deleted', 'Deleted account') : undefined },
    { key: 'pro',      label: cardOv['pro']?.label ?? 'Became PRO',        value: data?.proUsers ?? 0, delta: 0, source: 'PostHog', icon: Crown, tone: 'amber', loading: phLoading, onEdit: data?.posthogConnected ? () => openEditBuiltin('pro', 'Became PRO') : undefined },
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
          <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: MOCK.badgeDark, color: '#ffffff', fontSize: 13, fontWeight: 600, padding: '10px 20px', borderRadius: 99, zIndex: 100, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
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

  // ── Computed value for a custom metric given the current range ───────────────
  const customMetricValue = (m: CustomMetricData) => {
    if (m.metricType === 'unique_users') {
      return range === '7d' ? m.uniqueUsers7d : range === '30d' ? m.uniqueUsers30d : m.uniqueUsers24h
    }
    return range === '7d' ? m.count7d : range === '30d' ? m.count30d : m.count24h
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>

      {/* ── Add Metric Modal ──────────────────────────────────────── */}
      {showAddMetric && (
        <div
          onClick={e => { if (e.target === e.currentTarget) { setShowAddMetric(false); setEditingCustomId(null) } }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(30,35,31,0.55)',
            zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div style={{ background: MOCK.card, borderRadius: 18, width: '100%', maxWidth: 500, padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,0.22)', maxHeight: '90vh', overflowY: 'auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: MOCK.text, margin: 0 }}>{editingCustomId ? 'Edit metric' : 'Add custom metric'}</h3>
                <p style={{ fontSize: 13, color: MOCK.muted, margin: '4px 0 0' }}>Pick any PostHog event and give it a name</p>
              </div>
              <button onClick={() => { setShowAddMetric(false); setEditingCustomId(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MOCK.muted, padding: 4, display: 'flex' }}>
                <XIcon size={18} />
              </button>
            </div>

            {/* Event picker */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: MOCK.muted, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 8 }}>
                PostHog event
              </label>
              <input
                value={eventSearch}
                onChange={e => { setEventSearch(e.target.value); if (newMetricEvent && !e.target.value.toLowerCase().includes(newMetricEvent.toLowerCase())) setNewMetricEvent('') }}
                placeholder="Search events..."
                autoFocus
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${MOCK.border}`, fontSize: 14, color: MOCK.text, background: MOCK.bg, outline: 'none', boxSizing: 'border-box' }}
              />
              <div style={{ maxHeight: 200, overflowY: 'auto', border: `1px solid ${MOCK.border}`, borderTop: 'none', borderRadius: '0 0 10px 10px' }}>
                {eventsLoading ? (
                  <div style={{ padding: '14px 16px', color: MOCK.muted, fontSize: 13 }}>Loading events from PostHog...</div>
                ) : phEvents.filter(e => !eventSearch || e.event.toLowerCase().includes(eventSearch.toLowerCase())).length === 0 ? (
                  <div style={{ padding: '14px 16px', color: MOCK.muted, fontSize: 13 }}>No events found</div>
                ) : (
                  phEvents
                    .filter(e => !eventSearch || e.event.toLowerCase().includes(eventSearch.toLowerCase()))
                    .slice(0, 40)
                    .map(e => (
                      <button
                        key={e.event}
                        onClick={() => {
                          setNewMetricEvent(e.event)
                          setEventSearch(e.event)
                          if (!newMetricLabel) setNewMetricLabel(e.event)
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          width: '100%', padding: '9px 14px', background: newMetricEvent === e.event ? MOCK.greenSoft : 'transparent',
                          border: 'none', borderBottom: `1px solid ${MOCK.border}`,
                          cursor: 'pointer', textAlign: 'left', color: MOCK.text, fontSize: 13,
                        }}
                      >
                        <span style={{ fontFamily: 'monospace', fontWeight: newMetricEvent === e.event ? 700 : 400 }}>{e.event}</span>
                        <span style={{ color: MOCK.muted, fontSize: 11.5, flexShrink: 0, marginLeft: 8 }}>{e.cnt.toLocaleString()}</span>
                      </button>
                    ))
                )}
              </div>
            </div>

            {/* Display name */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: MOCK.muted, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 8 }}>
                Display name
              </label>
              <input
                value={newMetricLabel}
                onChange={e => setNewMetricLabel(e.target.value)}
                placeholder="e.g. Became PRO"
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${MOCK.border}`, fontSize: 14, color: MOCK.text, background: MOCK.bg, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Count type + Colour */}
            <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MOCK.muted, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 8 }}>Count type</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['count', 'unique_users'] as const).map(t => (
                    <button key={t} onClick={() => setNewMetricType(t)} style={{
                      flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1px solid ${newMetricType === t ? MOCK.green : MOCK.border}`,
                      background: newMetricType === t ? MOCK.greenSoft : 'transparent',
                      color: newMetricType === t ? MOCK.green : MOCK.muted,
                    }}>
                      {t === 'count' ? 'Total fires' : 'Unique users'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MOCK.muted, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 8 }}>Colour</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['green', 'amber', 'red'] as const).map(t => (
                    <button key={t} onClick={() => setNewMetricTone(t)} style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1px solid ${newMetricTone === t ? toneColor(t) : MOCK.border}`,
                      background: newMetricTone === t ? toneBg(t) : 'transparent',
                      color: newMetricTone === t ? toneColor(t) : MOCK.muted,
                    }}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Save */}
            <button
              onClick={() => void saveMetric()}
              disabled={!newMetricEvent || !newMetricLabel || savingMetric}
              style={{
                width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                cursor: !newMetricEvent || !newMetricLabel || savingMetric ? 'not-allowed' : 'pointer',
                background: !newMetricEvent || !newMetricLabel ? MOCK.border : MOCK.green,
                color: !newMetricEvent || !newMetricLabel ? MOCK.muted : '#fff',
                fontSize: 14, fontWeight: 700, opacity: savingMetric ? 0.7 : 1,
              }}
            >
              {savingMetric ? 'Saving...' : editingCustomId ? 'Save changes' : 'Add metric'}
            </button>
          </div>
        </div>
      )}

      {/* ── Edit Built-in Card Modal ─────────────────────────── */}
      {editBuiltinCard && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setEditBuiltinCard(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(30,35,31,0.55)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div style={{ background: MOCK.card, borderRadius: 18, width: '100%', maxWidth: 460, padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: MOCK.text, margin: 0 }}>Edit card</h3>
                <p style={{ fontSize: 13, color: MOCK.muted, margin: '4px 0 0' }}>
                  {editBuiltinCard.key === 'deleted' ? 'Deleted account' : 'Became PRO'} card
                </p>
              </div>
              <button onClick={() => setEditBuiltinCard(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MOCK.muted, padding: 4, display: 'flex' }}>
                <XIcon size={18} />
              </button>
            </div>

            {/* Label */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: MOCK.muted, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 8 }}>
                Display name
              </label>
              <input
                value={editBuiltinCard.label}
                onChange={e => setEditBuiltinCard(prev => prev ? { ...prev, label: e.target.value } : prev)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${MOCK.border}`, fontSize: 14, color: MOCK.text, background: MOCK.bg, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Events */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: MOCK.muted, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 8 }}>
                {editBuiltinCard.key === 'pro' ? 'Event name (optional)' : 'Event names (comma-separated)'}
              </label>
              <input
                value={editBuiltinCard.events}
                onChange={e => setEditBuiltinCard(prev => prev ? { ...prev, events: e.target.value } : prev)}
                placeholder={editBuiltinCard.key === 'deleted'
                  ? 'e.g. account_deleted, user_deleted'
                  : 'e.g. subscription_created'}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${MOCK.border}`, fontSize: 14, color: MOCK.text, background: MOCK.bg, outline: 'none', boxSizing: 'border-box' }}
              />
              <p style={{ fontSize: 12, color: MOCK.muted, marginTop: 6 }}>
                {editBuiltinCard.key === 'deleted'
                  ? 'Default: account_deleted, user_deleted, delete_account'
                  : 'Leave blank to count persons where plan = \'pro\'. Set an event to count upgrade event fires instead.'}
              </p>
            </div>

            <button
              onClick={() => void saveBuiltinEdit()}
              disabled={!editBuiltinCard.label || savingBuiltinEdit}
              style={{
                width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                cursor: !editBuiltinCard.label || savingBuiltinEdit ? 'not-allowed' : 'pointer',
                background: !editBuiltinCard.label ? MOCK.border : MOCK.green,
                color: !editBuiltinCard.label ? MOCK.muted : '#fff',
                fontSize: 14, fontWeight: 700, opacity: savingBuiltinEdit ? 0.7 : 1,
              }}
            >
              {savingBuiltinEdit ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

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
              {/* View toggle */}
              <div style={{ display: 'flex', padding: '3px', border: `1px solid ${MOCK.border}`, borderRadius: 99, background: MOCK.card }}>
                {(['users', 'website'] as const).map(v => (
                  <button key={v} onClick={() => setView(v)} style={{
                    fontSize: 13.5, fontWeight: 600, padding: '5px 16px', borderRadius: 99,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: view === v ? MOCK.badgeDark : 'transparent',
                    color: view === v ? '#ffffff' : MOCK.muted,
                    textTransform: 'capitalize',
                  }}>
                    {v === 'users' ? 'Users' : 'Website'}
                  </button>
                ))}
              </div>
              {/* Range picker — controls PostHog activity, only relevant on Users view */}
              {view === 'users' && (
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
              )}
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
              {/* Daily email toggle — only when both PostHog + GA4 connected */}
              {data?.posthogConnected && ga4?.connected && (
                <button
                  onClick={toggleDailyEmail}
                  disabled={emailToggling}
                  title={dailyEmail ? 'Daily email is on — click to turn off' : 'Get a daily summary email at 8am IST'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 13, fontWeight: 600,
                    padding: '7px 14px', borderRadius: 99,
                    border: `1px solid ${MOCK.border}`,
                    background: dailyEmail ? MOCK.green : MOCK.card,
                    color: dailyEmail ? '#ffffff' : MOCK.muted,
                    cursor: emailToggling ? 'default' : 'pointer',
                    opacity: emailToggling ? 0.6 : 1,
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Zap size={12} />
                  {dailyEmail ? 'Daily email on' : 'Daily email'}
                </button>
              )}
            </div>
            {snapshotAt && !phLoading && (
              <span style={{ fontSize: 11.5, color: MOCK.muted2 }}>
                fetched {formatTimeAgo(snapshotAt)}
              </span>
            )}
          </div>
        </div>

        {/* Summary + Todo — hidden for now */}

        {/* ── Users view ── */}
        {view === 'users' && (<>

        {/* Road to 500 banner */}
        <div style={{
          background: MOCK.card,
          border: `1px solid ${MOCK.border}`,
          borderRadius: 18,
          padding: isMobile ? '20px 16px' : '24px 28px',
          marginBottom: 28,
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '180px 1fr auto',
            gap: isMobile ? 20 : 32,
            alignItems: 'center',
          }}>
            {/* Users count */}
            <div>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: MOCK.green, marginBottom: 6,
              }}>
                Users on board
              </div>
              {phLoading ? (
                <div className="an-skeleton" style={{ width: 80, height: 52, borderRadius: 8 }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{
                    fontSize: 52, fontWeight: 800, letterSpacing: '-2px',
                    color: MOCK.text, lineHeight: 1,
                    fontFamily: 'var(--font-display, Fraunces, serif)',
                  }}>
                    {data?.totalUsers ?? 0}
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 600, color: MOCK.muted }}>/500</span>
                </div>
              )}
            </div>

            {/* Progress track */}
            {phLoading ? (
              <div style={{ position: 'relative', paddingBottom: 36 }}>
                <div className="an-skeleton" style={{ height: 5, borderRadius: 99 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
                  {[0, 1, 2, 3, 4].map(i => (
                    <div key={i} className="an-skeleton" style={{ width: 24, height: 11, borderRadius: 4 }} />
                  ))}
                </div>
              </div>
            ) : (
              <RoadToGoalTrack current={data?.totalUsers ?? 0} milestones={[0, 100, 200, 300, 400, 500]} />
            )}

            {/* MRR box */}
            <div style={{
              background: MOCK.amberBg, border: '1px solid #E8D5A0',
              borderRadius: 12, padding: '12px 16px', flexShrink: 0,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: MOCK.amberText, marginBottom: 6,
              }}>
                Projected MRR
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: MOCK.amberText, letterSpacing: '-0.5px' }}>
                  $9.5K
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: MOCK.amberText, opacity: 0.75 }}>
                  $19 × 500
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Activity section — range-driven */}
        <section style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: MOCK.green, margin: 0 }}>
              {rangeLabel}
            </h2>
            {data?.posthogConnected && (
              <button
                onClick={openAddMetric}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 99,
                  border: `1px solid ${MOCK.border}`, background: MOCK.card,
                  color: MOCK.green, cursor: 'pointer',
                }}
              >
                <Plus size={12} /> Add metric
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12 }}>
            {activityTiles.map((item) => (
              item.onEdit ? (
                <div key={item.key} style={{ position: 'relative' }}>
                  <StatCard
                    icon={item.icon} iconTone={item.tone}
                    label={item.label} value={item.value}
                    source={item.source} deltaValue={item.delta}
                    invertGood={item.invertGood}
                    loading={item.loading}
                    period={item.period}
                    onViewDetails={item.onViewDetails}
                    isMobile={isMobile}
                    info={item.info}
                  />
                  <button
                    onClick={item.onEdit}
                    title="Edit card"
                    style={{
                      position: 'absolute', top: 10, right: 10,
                      background: MOCK.card, border: `1px solid ${MOCK.border}`,
                      borderRadius: 6, padding: '3px', cursor: 'pointer',
                      color: MOCK.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                    }}
                  >
                    <Pencil size={11} />
                  </button>
                </div>
              ) : (
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
                  info={item.info}
                />
              )
            ))}
            {/* Custom metric cards */}
            {customMetrics.map(m => (
              <div key={m.id} style={{ position: 'relative' }}>
                <StatCard
                  icon={Zap}
                  iconTone={m.tone}
                  label={m.label}
                  value={customMetricValue(m)}
                  source="PostHog"
                  deltaValue={0}
                  period={rangePeriod}
                  isMobile={isMobile}
                />
                <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => openEditCustom(m)}
                    title="Edit metric"
                    style={{ background: MOCK.card, border: `1px solid ${MOCK.border}`, borderRadius: 6, padding: '3px', cursor: 'pointer', color: MOCK.muted, display: 'flex', alignItems: 'center', lineHeight: 1 }}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => void deleteMetric(m.id)}
                    title="Remove metric"
                    style={{ background: MOCK.card, border: `1px solid ${MOCK.border}`, borderRadius: 6, padding: '3px', cursor: 'pointer', color: MOCK.muted, display: 'flex', alignItems: 'center', lineHeight: 1 }}
                  >
                    <XIcon size={11} />
                  </button>
                </div>
              </div>
            ))}
            {/* Add metric placeholder card */}
            {data?.posthogConnected && (
              <button
                onClick={openAddMetric}
                style={{
                  background: 'transparent', border: `2px dashed ${MOCK.border}`,
                  borderRadius: 14, padding: '22px', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 8,
                  cursor: 'pointer', color: MOCK.muted, minHeight: 130,
                }}
              >
                <Plus size={18} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Add metric</span>
              </button>
            )}
          </div>
        </section>

        {/* Growth & retention KPIs */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: MOCK.green, marginBottom: 14 }}>
            Growth &amp; retention
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
            <KpiCard label="MRR" value="$0" sub="Monthly recurring revenue" source="Stripe" delta={0} comingSoon isMobile={isMobile} info="Monthly Recurring Revenue — the total you earn every month from paying subscribers. The north star metric for SaaS growth." />
            <KpiCard label="ARR" value="$0" sub="Annualised run rate" source="Stripe" delta={0} comingSoon isMobile={isMobile} info="Annual Recurring Revenue — your MRR multiplied by 12. Useful for investor conversations and year-ahead planning." />
            <KpiCard label="Churn rate" value="0%" sub="Paid cancellations, 30d" source="Stripe" delta={0} bad comingSoon isMobile={isMobile} info="The percentage of paying customers who cancelled this month. Below 2% is healthy for most SaaS products. Lower is better." />
            <KpiCard label="Onboarding drop-off" value="0%" sub="Users who don't return after signup" source="Stripe" delta={0} bad comingSoon isMobile={isMobile} info="Users who signed up but never came back after day 1. High drop-off usually means your first-run experience needs work." />
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
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
              {[
                { label: 'Organic clicks', value: gsc?.clicks7d,      suffix: '',  sub: '7 days', info: 'Visitors who found you on Google and actually clicked through to your site. More clicks = more free traffic from search.' },
                { label: 'Impressions',    value: gsc?.impressions7d,  suffix: '',  sub: '7 days', info: 'How many times your site appeared in Google search results. High impressions but low clicks means your title or description needs work.' },
                { label: 'Avg CTR',        value: gsc?.avgCtr7d,       suffix: '%', sub: '7 days', info: 'Click-through rate — what % of people who saw you in Google results actually clicked. Above 3% is good for most sites.' },
                { label: 'Avg position',   value: gsc?.avgPosition7d,  suffix: '',  sub: '7 days', info: 'Your average ranking in Google results. Position 1 is the top spot. Lower number = higher rank = more visibility.' },
              ].map(k => (
                <div key={k.label} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{k.label}</div>
                    <InfoTooltip text={k.info} />
                  </div>
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
                { label: 'Sessions',        value: ga4?.sessions7d,       suffix: '', info: 'A session is one visit to your site. One person can have multiple sessions in a day if they leave and come back.' },
                { label: 'Active users',    value: ga4?.activeUsers7d,    suffix: '', info: 'People who visited and did something meaningful — viewed a page, clicked a button — in the last 7 days.' },
                { label: 'New users',       value: ga4?.newUsers7d,       suffix: '', info: 'First-time visitors who have never been to your site before. Growing new users means your reach is expanding.' },
                { label: 'Pageviews',       value: ga4?.pageviews7d,      suffix: '', info: 'Total pages viewed across all visits. High pageviews relative to sessions means people are exploring multiple pages.' },
                { label: 'Engagement rate', value: ga4?.engagementRate7d, suffix: '%', info: 'Share of sessions where the visitor stayed 10+ seconds or interacted with the page. Above 60% is healthy.' },
              ].map(k => (
                <div key={k.label} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{k.label}</div>
                    <InfoTooltip text={k.info} />
                  </div>
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
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>New users</h3>
                  <InfoTooltip text="First-time visitors per day over the last 30 days. A rising trend means your reach is growing. Spikes often come from a viral post, launch, or ad campaign." />
                </div>
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
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Traffic sources</h3>
                  <InfoTooltip text="Where your visitors are coming from. Organic Search = Google. Direct = typed your URL or bookmarked. Referral = another site linked to you. Social = social media." />
                </div>
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
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Top landing pages</h3>
                <InfoTooltip text="The first page visitors land on when they arrive at your site. A strong landing page keeps people engaged; a weak one sends them away immediately." />
              </div>
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

        </>)}

        {/* Module health — hidden for now */}

      </div>
    </div>
  )
}
