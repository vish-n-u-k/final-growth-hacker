'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { ArrowLeft, RefreshCw, Info } from 'lucide-react'

type Period = '7d' | '30d' | '90d'
const PERIODS: { key: Period; label: string; desc: string }[] = [
  { key: '7d',  label: '7 Days',  desc: 'last 7 days' },
  { key: '30d', label: '30 Days', desc: 'last 30 days' },
  { key: '90d', label: '90 Days', desc: 'last 90 days' },
]

interface OverviewMetrics {
  sessions: number
  activeUsers: number
  newUsers: number
  engagedSessions: number
  avgEngagementTime: number
  pageviews: number
  conversions: number
}

interface InsightsData {
  connected: boolean
  error?: string
  period: string
  propertyId: string
  overview: { current: OverviewMetrics; prior: OverviewMetrics }
  trend: { date: string; activeUsers: number; newUsers: number; sessions: number }[]
  newVsReturning: { type: string; users: number; engagedSessions: number }[]
  channels: { channel: string; sessions: number; users: number; engagedSessions: number; conversions: number; pct: number }[]
  referrals: { source: string; sessions: number; users: number; engagedSessions: number; conversions: number }[]
  landingPages: { page: string; sessions: number; newUsers: number; avgEngagementTime: number; conversions: number; pct: number }[]
  pagePerformance: { page: string; views: number; users: number; avgEngagementTime: number; conversions: number }[]
  geography: { country: string; users: number; sessions: number; engagedSessions: number; conversions: number }[]
  devices: { device: string; users: number; sessions: number; engagedSessions: number; conversions: number }[]
  events: { name: string; count: number }[]
  timeAnalysis: { dow: number; hour: number; users: number }[]
}

interface AiInsights {
  headline: string
  insights: { text: string; impact: 'high' | 'medium' | 'low' }[]
  actions: { text: string; impact: 'high' | 'medium' | 'low' }[]
}

const CHANNEL_COLORS: Record<string, string> = {
  'Organic Search': '#4ade80',
  'Direct': '#60a5fa',
  'Referral': '#a78bfa',
  'Organic Social': '#f472b6',
  'Paid Search': '#fb923c',
  'Email': '#e7c873',
  'Organic Video': '#34d399',
  'Unassigned': '#6b7280',
}
function channelColor(ch: string) {
  return CHANNEL_COLORS[ch] ?? '#8aa897'
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtTime(secs: number) {
  if (!secs) return '0s'
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function pctChange(curr: number, prior: number): number | null {
  if (!prior) return null
  return Math.round(((curr - prior) / prior) * 100)
}

const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 22px' }
const ttStyle = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }

// GA4 dayOfWeek: 0=Sunday, remap to Mon=0…Sun=6 for display
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// GA4 0=Sun,1=Mon…6=Sat → we want Mon=0…Sun=6
function remapDow(ga4Dow: number): number {
  // ga4: 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
  // display: Mon=0,Tue=1,...,Sat=5,Sun=6
  return ga4Dow === 0 ? 6 : ga4Dow - 1
}

function impactColor(impact: string) {
  if (impact === 'high') return '#4ade80'
  if (impact === 'medium') return '#e7c873'
  return '#8aa897'
}

function DeltaPill({ curr, prior }: { curr: number; prior: number }) {
  const chg = pctChange(curr, prior)
  if (chg === null) return <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>—</span>
  const positive = chg >= 0
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
      background: positive ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
      color: positive ? '#4ade80' : '#f87171',
    }}>
      {positive ? '+' : ''}{chg}%
    </span>
  )
}

function SkeletonBlock({ h }: { h: number }) {
  return <div style={{ height: h, borderRadius: 14, background: 'var(--line)', animation: 'an-skeleton-pulse 1.4s ease-in-out infinite' }} />
}

function InfoTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        style={{ display: 'inline-flex', alignItems: 'center', cursor: 'default', color: 'var(--text-faint)', opacity: 0.7 }}
      >
        <Info size={11} />
      </span>
      {visible && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: '#ffffff', border: '1px solid #e2e8e4', borderRadius: 8,
          padding: '8px 11px', fontSize: 11.5, lineHeight: 1.6, color: '#374151',
          whiteSpace: 'pre-line', width: 215, zIndex: 100, pointerEvents: 'none',
          boxShadow: '0 4px 20px rgba(0,0,0,0.13)',
          textTransform: 'none', letterSpacing: 'normal', fontWeight: 400,
        }}>
          {text}
        </span>
      )}
    </span>
  )
}

export default function TrafficDashboard({ brandId, brandName }: { brandId: string; brandName: string }) {
  const router = useRouter()
  const [period, setPeriod] = useState<Period>('30d')
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [aiInsights, setAiInsights] = useState<AiInsights | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [sortPageBy, setSortPageBy] = useState<'views' | 'users' | 'time'>('views')

  const fetchAi = useCallback(async (d: InsightsData) => {
    setAiLoading(true)
    setAiInsights(null)
    try {
      const topChannels = d.channels.slice(0, 3).map(c => ({ channel: c.channel, sessions: c.sessions, pct: c.pct, conversions: c.conversions }))
      const newRow = d.newVsReturning.find(r => r.type === 'new')
      const retRow = d.newVsReturning.find(r => r.type === 'returning')
      const totalUsers = (newRow?.users ?? 0) + (retRow?.users ?? 0) || 1
      const summary = {
        period,
        activeUsers: { current: d.overview.current.activeUsers, prior: d.overview.prior.activeUsers },
        sessions: { current: d.overview.current.sessions, prior: d.overview.prior.sessions },
        engagedSessions: { current: d.overview.current.engagedSessions, prior: d.overview.prior.engagedSessions },
        newUserPct: Math.round(((newRow?.users ?? 0) / totalUsers) * 100),
        topChannels,
        topLandingPages: d.landingPages.slice(0, 3).map(p => ({ page: p.page, sessions: p.sessions, conversions: p.conversions })),
        topCountries: d.geography.slice(0, 3).map(g => ({ country: g.country, users: g.users })),
        devices: d.devices.map(dv => ({ device: dv.device, users: dv.users })),
        totalConversions: d.overview.current.conversions,
      }
      const res = await fetch('/api/analytics/ga4-insights-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, period, summary }),
      })
      if (res.ok) setAiInsights(await res.json() as AiInsights)
    } catch { /* AI is non-blocking */ } finally {
      setAiLoading(false)
    }
  }, [brandId, period])

  const load = useCallback(async (soft = false) => {
    soft ? setBusy(true) : setLoading(true)
    setErr(null)
    setAiInsights(null)
    try {
      const res = await fetch(`/api/analytics/ga4-insights?brandId=${brandId}&period=${period}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json() as InsightsData
      setData(d)
      if (d.connected && !d.error) fetchAi(d)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }, [brandId, period, fetchAi])

  useEffect(() => { load() }, [load])

  const Header = ({ right }: { right?: React.ReactNode }) => (
    <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '13px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.back()} style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}>
            <ArrowLeft size={14} />
          </button>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)' }}>Traffic & Visitors</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{brandName}{data?.propertyId ? ` · GA4 ${data.propertyId}` : ''}</div>
          </div>
        </div>
        {right}
      </div>
    </div>
  )

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>
      <Header />
      <div style={{ maxWidth: 960, margin: '40px auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[60, 120, 220, 160, 180].map((h, i) => <SkeletonBlock key={i} h={h} />)}
      </div>
    </div>
  )

  if (err || !data?.connected) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>
      <Header />
      <div style={{ maxWidth: 960, margin: '32px auto', padding: '0 24px' }}>
        <div style={{ background: '#2a1515', border: '1px solid #6b2626', borderRadius: 12, padding: '16px 20px', color: '#f08080', fontSize: 13 }}>
          {err ?? 'Google Analytics not connected. Go to Settings → Integrations → GA4 API.'}
        </div>
      </div>
    </div>
  )

  const { overview, trend, newVsReturning, channels, referrals, landingPages, pagePerformance, geography, devices, events, timeAnalysis } = data

  const periodDesc = PERIODS.find(p => p.key === period)?.desc ?? 'last 30 days'
  const newRow = newVsReturning.find(r => r.type === 'new')
  const retRow = newVsReturning.find(r => r.type === 'returning')
  const totalNvR = (newRow?.users ?? 0) + (retRow?.users ?? 0) || 1
  const newPct = Math.round(((newRow?.users ?? 0) / totalNvR) * 100)

  const sortedPages = [...pagePerformance].sort((a, b) =>
    sortPageBy === 'views' ? b.views - a.views :
    sortPageBy === 'users' ? b.users - a.users :
    b.avgEngagementTime - a.avgEngagementTime
  )

  const totalDeviceUsers = devices.reduce((s, d) => s + d.users, 0) || 1

  // Build heatmap grid
  const heatmapGrid: Record<string, number> = {}
  timeAnalysis.forEach(h => {
    const displayDow = remapDow(h.dow)
    heatmapGrid[`${displayDow}_${h.hour}`] = (heatmapGrid[`${displayDow}_${h.hour}`] ?? 0) + h.users
  })
  const maxHeatmap = Math.max(...Object.values(heatmapGrid), 1)

  const overviewCards = [
    { label: 'Total Visitors',   curr: overview.current.activeUsers,    prior: overview.prior.activeUsers,    color: 'var(--text)',  tooltip: 'Active Users\n\nUnique people who visited at least one page in the selected period.\n\nSource: GA4 activeUsers metric.' },
    { label: 'New Visitors',     curr: overview.current.newUsers,        prior: overview.prior.newUsers,        color: '#4ade80',      tooltip: 'New Users\n\nVisitors whose first session ever on your site occurred within this period.\n\nSource: GA4 newUsers metric.' },
    { label: 'Returning',        curr: Math.max(0, overview.current.activeUsers - overview.current.newUsers), prior: Math.max(0, overview.prior.activeUsers - overview.prior.newUsers), color: 'var(--gold)', tooltip: 'Returning Users\n\nVisitors who had at least one prior session before this period.\n\nCalculated as: Active Users − New Users.' },
    { label: 'Engaged Sessions', curr: overview.current.engagedSessions, prior: overview.prior.engagedSessions, color: '#60a5fa',      tooltip: 'Engaged Sessions\n\nSessions that lasted longer than 10 seconds, had a conversion event, or had 2+ page views.\n\nSource: GA4 engagedSessions metric.' },
    { label: 'Avg Engagement',   curr: overview.current.avgEngagementTime, prior: overview.prior.avgEngagementTime, color: '#a78bfa', isTime: true, tooltip: 'Average Session Duration\n\nMean time users actively had your site in the foreground, per session.\n\nSource: GA4 averageSessionDuration (seconds).' },
    { label: 'Page Views',       curr: overview.current.pageviews,       prior: overview.prior.pageviews,       color: '#34d399',      tooltip: 'Screen / Page Views\n\nTotal number of pages viewed, including repeated views of the same page.\n\nSource: GA4 screenPageViews metric.' },
    { label: 'Conversions',      curr: overview.current.conversions,     prior: overview.prior.conversions,     color: '#fb923c',      tooltip: 'Conversions\n\nTotal count of conversion events fired (e.g. form submits, purchases).\n\nRequires conversion events configured in GA4. Shows — if none set up.' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>
      <Header right={
        <button onClick={() => load(true)} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, padding: '6px 14px', borderRadius: 99, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={11} style={{ animation: busy ? 'an-spin 0.8s linear infinite' : 'none' }} />
          Refresh
        </button>
      } />

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 24px 80px', opacity: busy ? 0.65 : 1, transition: 'opacity 0.2s' }}>

        {/* ── Period tabs ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => { if (p.key !== period) setPeriod(p.key) }} style={{
              padding: '7px 18px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              border: p.key === period ? '1px solid var(--green)' : '1px solid var(--line)',
              background: p.key === period ? 'color-mix(in srgb, var(--green) 12%, var(--card))' : 'transparent',
              color: p.key === period ? 'var(--green)' : 'var(--text-dim)',
              transition: 'all 0.15s ease',
            }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* ── 1. AI Insights block ── */}
        <div style={{ ...card, marginBottom: 24, borderLeft: '3px solid var(--green)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--green)', background: 'color-mix(in srgb, var(--green) 12%, transparent)', padding: '3px 8px', borderRadius: 99 }}>AI Growth Advisor</span>
          </div>
          {aiLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[24, 14, 14, 14].map((h, i) => (
                <div key={i} style={{ height: h, borderRadius: 6, background: 'var(--line)', animation: 'an-skeleton-pulse 1.4s ease-in-out infinite', width: i === 0 ? '70%' : `${55 + i * 10}%` }} />
              ))}
            </div>
          )}
          {!aiLoading && !aiInsights && (
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>Generating insights...</div>
          )}
          {aiInsights && (
            <>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text)', marginBottom: 16, lineHeight: 1.5 }}>{aiInsights.headline}</div>
              {aiInsights.insights.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: 8 }}>Key Observations</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {aiInsights.insights.map((ins, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: impactColor(ins.impact), flexShrink: 0, marginTop: 5 }} />
                        <span style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>{ins.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {aiInsights.actions.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: 8 }}>Recommended Actions</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {aiInsights.actions.map((act, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: impactColor(act.impact), flexShrink: 0, marginTop: 1, background: `color-mix(in srgb, ${impactColor(act.impact)} 15%, transparent)`, padding: '1px 6px', borderRadius: 4 }}>{act.impact.toUpperCase()}</span>
                        <span style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55 }}>{act.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── 2. Overview Cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
          {overviewCards.map(s => (
            <div key={s.label} style={card}>
              <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                {s.label}
                <InfoTooltip text={s.tooltip} />
              </div>
              <div style={{ fontSize: 30, fontWeight: 700, color: s.color, letterSpacing: '-0.8px', lineHeight: 1 }}>
                {s.isTime ? fmtTime(s.curr) : s.curr > 0 ? fmt(s.curr) : (s.label === 'Conversions' ? '—' : '0')}
              </div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <DeltaPill curr={s.curr} prior={s.prior} />
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>vs prior</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Trend chart ── */}
        {trend.length > 1 && (
          <div style={{ ...card, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Daily visitors · {periodDesc}</span>
              <InfoTooltip text={'Daily Visitors Trend\n\nShows active users, new users, and sessions for each day in the selected period.\n\nUseful for spotting traffic spikes, drops, or seasonal patterns.'} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16, display: 'flex', gap: 16 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 2, background: 'var(--green)', display: 'inline-block' }} />Active users</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 2, background: 'var(--gold)', display: 'inline-block' }} />New users</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 2, background: '#60a5fa', display: 'inline-block' }} />Sessions</span>
            </div>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ins-au" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--green)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ins-nu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ins-ss" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" tickFormatter={v => v.slice(5)} />
                  <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={ttStyle} />
                  <Area type="monotone" dataKey="sessions"    name="Sessions"     stroke="#60a5fa" strokeWidth={1.5} fill="url(#ins-ss)" dot={false} />
                  <Area type="monotone" dataKey="activeUsers" name="Active users" stroke="var(--green)" strokeWidth={2} fill="url(#ins-au)" dot={false} />
                  <Area type="monotone" dataKey="newUsers"    name="New users"    stroke="var(--gold)"  strokeWidth={2} fill="url(#ins-nu)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── 3. Traffic Sources ── */}
        {channels.length > 0 && (
          <div style={{ ...card, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Traffic Sources · {periodDesc}</span>
              <InfoTooltip text={'Traffic Sources\n\nBreaks down where your visitors came from — Organic Search, Direct, Referral, Social, Email, etc.\n\nEng. Rate = engaged sessions ÷ total sessions. Conv. = conversion events fired from that channel.'} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {channels.map((c, i) => {
                const engRate = c.sessions > 0 ? Math.round((c.engagedSessions / c.sessions) * 100) : 0
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: channelColor(c.channel), flexShrink: 0, display: 'inline-block' }} />
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{c.channel}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{engRate}% engaged</span>
                        {c.conversions > 0 && <span style={{ fontSize: 11, color: '#fb923c' }}>{c.conversions} conv.</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{fmt(c.sessions)} sessions</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: channelColor(c.channel), minWidth: 34, textAlign: 'right' }}>{c.pct}%</span>
                      </div>
                    </div>
                    <div style={{ height: 4, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
                      <div style={{ width: `${c.pct}%`, height: '100%', background: channelColor(c.channel), transition: 'width .4s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── New vs returning ── */}
        <div style={{ ...card, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>New vs Returning</span>
              <InfoTooltip text={'New vs Returning Users\n\nNew: first visit ever on your site in this period.\nReturning: had at least one prior session before this period.\n\nA high returning % signals strong retention. A high new % means good acquisition but check if they come back.'} />
            </div>
            <div style={{ display: 'flex', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                New {newPct}%
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block' }} />
                Returning {100 - newPct}%
              </div>
            </div>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: 'var(--line)', overflow: 'hidden', display: 'flex', marginBottom: 16 }}>
            <div style={{ width: `${newPct}%`, height: '100%', background: 'var(--green)', transition: 'width .4s ease' }} />
            <div style={{ flex: 1, height: '100%', background: 'var(--gold)' }} />
          </div>
          <div style={{ display: 'flex', gap: 40 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>New users</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{fmt(newRow?.users ?? 0)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>Returning users</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{fmt(retRow?.users ?? 0)}</div>
            </div>
            {newRow && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>New engaged</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{fmt(newRow.engagedSessions)}</div>
              </div>
            )}
          </div>
        </div>

        {/* ── 4. Referral Websites ── */}
        <div style={{ ...card, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Referral Websites</span>
            <InfoTooltip text={'Referral Websites\n\nSites that linked to yours and sent visitors (sessionMedium = referral).\n\n% Share = that source\'s sessions ÷ total referral sessions.\nNew Users = first-time visitors sent by this source.\nConv. = conversion events from referred visitors.'} />
          </div>
          {referrals.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', padding: '12px 0' }}>No referral traffic in this period.</div>
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 70px 70px 80px 60px', gap: 8, padding: '0 0 8px', borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
                {['Source', '% Share', 'Sessions', 'New Users', 'Eng. Rate', 'Conv.'].map(h => (
                  <div key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>{h}</div>
                ))}
              </div>
              {(() => {
                const totalRefSessions = referrals.reduce((s, r) => s + r.sessions, 0) || 1
                return referrals.map((r, i) => {
                  const engRate = r.sessions > 0 ? Math.round((r.engagedSessions / r.sessions) * 100) : 0
                  const pct = Math.round((r.sessions / totalRefSessions) * 100)
                  return (
                    <div key={i} style={{ padding: '9px 0', borderBottom: i < referrals.length - 1 ? '1px solid var(--line)' : 'none' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 70px 70px 80px 60px', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ fontSize: 12.5, color: 'var(--text)', fontFamily: 'var(--font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.source}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)' }}>{pct}%</div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{fmt(r.sessions)}</div>
                        <div style={{ fontSize: 12, color: '#4ade80' }}>{fmt(r.users)}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: engRate >= 50 ? '#4ade80' : 'var(--text-dim)' }}>{engRate}%</div>
                        <div style={{ fontSize: 12, color: r.conversions > 0 ? '#fb923c' : 'var(--text-faint)' }}>{r.conversions > 0 ? r.conversions : '—'}</div>
                      </div>
                      <div style={{ height: 3, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: '#a78bfa', transition: 'width .4s ease' }} />
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          )}
        </div>

        {/* ── 5. Landing Pages ── */}
        {landingPages.length > 0 && (
          <div style={{ ...card, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Landing Pages</span>
              <InfoTooltip text={'Landing Pages\n\nThe first page a visitor hit when starting their session.\n\nAvg Time = average session duration for sessions that started on this page.\n"Top converting" badge = page with the most conversion events as entry point.'} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {landingPages.map((p, i) => {
                const isBest = p.conversions > 0 && p.conversions === Math.max(...landingPages.map(x => x.conversions))
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: i < landingPages.length - 1 ? '1px solid var(--line)' : 'none', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.page || '/'}</span>
                        {isBest && <span style={{ fontSize: 10, fontWeight: 700, color: '#4ade80', background: 'rgba(74,222,128,0.12)', padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>Top converting</span>}
                      </div>
                      <div style={{ marginTop: 5, height: 3, borderRadius: 99, background: 'var(--line)', overflow: 'hidden', width: '100%' }}>
                        <div style={{ width: `${p.pct}%`, height: '100%', background: 'var(--green)', transition: 'width .4s ease' }} />
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-dim)', textAlign: 'right' }}>
                      <div><div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Sessions</div><div style={{ fontWeight: 600, color: 'var(--text)' }}>{fmt(p.sessions)}</div></div>
                      <div><div style={{ fontSize: 10, color: 'var(--text-faint)' }}>New</div><div style={{ fontWeight: 600, color: 'var(--text)' }}>{fmt(p.newUsers)}</div></div>
                      <div><div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Avg time</div><div style={{ fontWeight: 600, color: 'var(--text)' }}>{fmtTime(p.avgEngagementTime)}</div></div>
                      <div><div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Conv.</div><div style={{ fontWeight: 600, color: p.conversions > 0 ? '#fb923c' : 'var(--text-faint)' }}>{p.conversions > 0 ? p.conversions : '—'}</div></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── 6. Page Performance ── */}
        {pagePerformance.length > 0 && (
          <div style={{ ...card, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Page Performance</span>
                <InfoTooltip text={'Page Performance\n\nAll pages visited (not just entry points), ranked by the selected sort.\n\nViews = total page loads including repeat visits.\nAvg Time = mean session duration for sessions that included this page.\nSort by Views, Users, or Avg Time using the buttons.'} />
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['views', 'users', 'time'] as const).map(s => (
                  <button key={s} onClick={() => setSortPageBy(s)} style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99, cursor: 'pointer',
                    border: sortPageBy === s ? '1px solid var(--green)' : '1px solid var(--line)',
                    background: sortPageBy === s ? 'color-mix(in srgb, var(--green) 12%, var(--card))' : 'transparent',
                    color: sortPageBy === s ? 'var(--green)' : 'var(--text-faint)',
                  }}>
                    {s === 'views' ? 'Views' : s === 'users' ? 'Users' : 'Time'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px 80px 60px', gap: 8, padding: '0 0 8px', borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
                {['Page', 'Views', 'Users', 'Avg Time', 'Conv.'].map(h => (
                  <div key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>{h}</div>
                ))}
              </div>
              {sortedPages.slice(0, 15).map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px 80px 60px', gap: 8, padding: '8px 0', borderBottom: i < Math.min(sortedPages.length, 15) - 1 ? '1px solid var(--line)' : 'none' }}>
                  <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.page}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: sortPageBy === 'views' ? 600 : 400 }}>{fmt(p.views)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: sortPageBy === 'users' ? 600 : 400 }}>{fmt(p.users)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: sortPageBy === 'time' ? 600 : 400 }}>{fmtTime(p.avgEngagementTime)}</div>
                  <div style={{ fontSize: 12, color: p.conversions > 0 ? '#fb923c' : 'var(--text-faint)' }}>{p.conversions > 0 ? p.conversions : '—'}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 7. Geography ── */}
        {geography.length > 0 && (
          <div style={{ ...card, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Top Countries</span>
              <InfoTooltip text={'Top Countries\n\nWhere your visitors are located, based on their IP address at session start.\n\nBar length = relative share vs the top country.\nEng. Rate = engaged sessions ÷ total sessions for that country.'} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {geography.map((g, i) => {
                const maxUsers = geography[0]?.users ?? 1
                const pct = Math.round((g.users / maxUsers) * 100)
                const engRate = g.sessions > 0 ? Math.round((g.engagedSessions / g.sessions) * 100) : 0
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500 }}>{g.country || 'Unknown'}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{engRate}% engaged</span>
                        {g.conversions > 0 && <span style={{ fontSize: 11, color: '#fb923c' }}>{g.conversions} conv.</span>}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{fmt(g.users)}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: '#5eead4', transition: 'width .4s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── 8. Devices ── */}
        {devices.length > 0 && (
          <div style={{ ...card, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Devices</span>
              <InfoTooltip text={'Devices\n\nBreaks down visitors by device type: Desktop, Mobile, Tablet.\n\n% = that device\'s share of total active users.\nEng. Rate = engaged sessions ÷ total sessions for that device type.\nLow mobile engagement may signal a poor mobile experience.'} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(devices.length, 3)}, 1fr)`, gap: 12 }}>
              {devices.map((d, i) => {
                const pct = Math.round((d.users / totalDeviceUsers) * 100)
                const engRate = d.sessions > 0 ? Math.round((d.engagedSessions / d.sessions) * 100) : 0
                const deviceColors = ['#4ade80', '#60a5fa', '#e7c873']
                return (
                  <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'capitalize', color: 'var(--text-faint)', marginBottom: 8 }}>{d.device}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: deviceColors[i] ?? 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1, marginBottom: 4 }}>{pct}%</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>{fmt(d.users)} users</div>
                    <div style={{ height: 3, borderRadius: 99, background: 'var(--line)', overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: deviceColors[i] ?? 'var(--green)' }} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Eng. rate: <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{engRate}%</span></div>
                    {d.conversions > 0 && <div style={{ fontSize: 11, color: '#fb923c', marginTop: 2 }}>{d.conversions} conversions</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── 9. Time Analysis heatmap ── */}
        {timeAnalysis.length > 0 && (
          <div style={{ ...card, marginBottom: 24, overflowX: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Active Hours</span>
              <InfoTooltip text={'Active Hours Heatmap\n\nShows when your users are most active, by day of week and hour (UTC).\n\nDarker green = more users at that time.\nUse this to time content publishing, email sends, or ad scheduling for peak engagement.'} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>Users by day and hour (UTC), {periodDesc}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, 1fr)', gap: 2, minWidth: 600 }}>
              {/* Hour labels */}
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} style={{ fontSize: 9, color: 'var(--text-faint)', textAlign: 'center', paddingBottom: 4 }}>
                  {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                </div>
              ))}
              {/* Rows */}
              {DOW_LABELS.map((day, dowIdx) => (
                <React.Fragment key={day}>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', paddingRight: 6 }}>{day}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const val = heatmapGrid[`${dowIdx}_${h}`] ?? 0
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

        {/* ── 10. Top Events ── */}
        {events.length > 0 && (
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Top Events</span>
              <InfoTooltip text={'Top Events\n\nGA4 events fired by visitors, sorted by total count.\n\nIncludes automatic events (page_view, session_start, scroll) and any custom events you\'ve set up.\nBar length = relative count vs the most fired event.'} />
            </div>
            <div>
              {events.map((e, i) => {
                const maxCount = events[0]?.count ?? 1
                const pct = Math.round((e.count / maxCount) * 100)
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < events.length - 1 ? '1px solid var(--line)' : 'none' }}>
                    <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono, monospace)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                    <div style={{ width: 100, height: 4, borderRadius: 99, background: 'var(--line)', flexShrink: 0 }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: 'var(--green)' }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', minWidth: 50, textAlign: 'right' }}>{fmt(e.count)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
