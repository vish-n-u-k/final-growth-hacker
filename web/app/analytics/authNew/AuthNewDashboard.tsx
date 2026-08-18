'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw, Globe, ChevronDown, ChevronUp, TrendingUp, Users, MousePointerClick, Search, BarChart2, Zap } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface Funnel {
  impressions: number | null
  clicks: number | null
  sessions: number | null
  signups: number | null
  activeUsers: number | null
  clickThroughRate: number | null
  sessionToSignupRate: number | null
  signupToActiveRate: number | null
}

interface ChannelRow {
  channel: string
  ga4Sessions: number
  phSignups: number
  phActiveUsers: number
  gscClicks: number
  retentionPct: number | null
}

interface LandingPage {
  path: string
  gscClicks: number
  ga4Sessions: number
  phSignups: number
}

interface GscQuery {
  query: string
  clicks: number
  impressions: number
  position: number
}

interface SignupSource {
  source: string
  signups: number
  activeUsers: number
}

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
  totalSessionTimeSecs: number
  sessionCount: number
  avgSessionTimeSecs: number
}

interface ApiResponse {
  funnel: Funnel
  channelMatrix: ChannelRow[]
  enrichedLandingPages: LandingPage[]
  gsc: {
    connected: boolean
    topQueries: GscQuery[]
    topPages: { page: string; clicks: number; impressions: number }[]
    impressions30d: number | null
    clicks30d: number | null
    avgCtr30d: number | null
    avgPosition30d: number | null
  }
  ga4: { connected: boolean }
  posthog: {
    connected: boolean
    signupsBySource: SignupSource[]
    signupsByDevice: { device: string; signups: number }[]
    signupsByCountry: { country: string; signups: number }[]
    users: JourneyUser[]
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

function fmtDuration(secs: number): string {
  if (!secs || secs <= 0) return '—'
  if (secs < 60)  return `${secs}s`
  const m = Math.floor(secs / 60)
  if (m < 60)     return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function pct(a: number | null, b: number | null): string {
  if (!a || !b) return ''
  return `${Math.round((a / b) * 100)}%`
}

const SOURCE_COLORS: Record<string, string> = {
  'Facebook':  '#6495ed',
  'Instagram': '#e1306c',
  'Google':    '#4ade80',
  'LinkedIn':  '#60a5fa',
  'Twitter/X': '#94a3b8',
  'YouTube':   '#f87171',
  'TikTok':    '#5eead4',
  'Direct':    '#8aa897',
}
function sourceColor(source: string) { return SOURCE_COLORS[source] ?? '#a78bfa' }

const STATUS_STYLE = {
  active:  { color: '#4ade80', label: 'Active'   },
  dormant: { color: '#e7c873', label: 'Dormant'  },
  churned: { color: '#f87171', label: 'Churned'  },
  new:     { color: '#a78bfa', label: 'New'      },
}

// ── Shared UI atoms ──────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '22px 24px', ...style }}>
      {children}
    </div>
  )
}

function SectionTitle({ icon, title, sub }: { icon?: React.ReactNode; title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span style={{ color: 'var(--green)', display: 'flex' }}>{icon}</span>}
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{title}</h2>
      </div>
      {sub && <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function NotConnectedNote({ source }: { source: string }) {
  return (
    <div style={{ padding: '16px', background: 'var(--bg)', borderRadius: 10, border: '1px dashed var(--line)' }}>
      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>
        {source} is not connected yet. Connect it in Settings → Integrations to see this data.
      </p>
    </div>
  )
}

// ── 1. Story summary ─────────────────────────────────────────────────────────

function StorySummary({ funnel, gscConnected, ga4Connected, phConnected }: {
  funnel: Funnel; gscConnected: boolean; ga4Connected: boolean; phConnected: boolean
}) {
  const parts: string[] = []

  if (gscConnected && funnel.impressions) {
    parts.push(`Your site appeared in Google search **${fmt(funnel.impressions)} times** this month.`)
    if (funnel.clicks) parts.push(`**${fmt(funnel.clicks)} people** clicked through${funnel.clickThroughRate ? ` (${funnel.clickThroughRate}% click rate)` : ''}.`)
  }
  if (ga4Connected && funnel.sessions) {
    parts.push(`Those visitors had **${fmt(funnel.sessions)} sessions** on your site.`)
  }
  if (phConnected && funnel.signups) {
    parts.push(`**${fmt(funnel.signups)} people signed up** in the last 30 days.`)
    if (funnel.activeUsers) {
      parts.push(`Of those, **${fmt(funnel.activeUsers)} are still active** this week${funnel.signupToActiveRate ? ` — a ${funnel.signupToActiveRate}% activation rate` : ''}.`)
    }
  }

  if (!parts.length) {
    return (
      <Card>
        <p style={{ fontSize: 14, color: 'var(--text-faint)', margin: 0 }}>
          Connect at least one integration (Google Search Console, GA4, or PostHog) to see your acquisition summary.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--green)', marginBottom: 14, marginTop: 0 }}>
        This month in a nutshell
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {parts.map((part, i) => (
          <p key={i} style={{ fontSize: 15, color: 'var(--text)', margin: 0, lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: part.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--green-bright)">$1</strong>') }} />
        ))}
      </div>
    </Card>
  )
}

// ── Funnel detail panels ──────────────────────────────────────────────────────

function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.max(4, Math.round((value / Math.max(max, 1)) * 100))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 130, fontSize: 12, color: 'var(--text)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ flex: 1, height: 7, background: 'var(--line)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.4s' }} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color, minWidth: 36, textAlign: 'right' }}>{fmt(value)}</div>
    </div>
  )
}

function DetailPanel({ tabs, children }: { tabs: { key: string; label: string }[]; children: (active: string) => React.ReactNode }) {
  const [active, setActive] = useState(tabs[0]?.key ?? '')
  return (
    <div style={{ marginTop: 14, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActive(t.key)} style={{
            flex: 1, padding: '9px 0', fontSize: 12, fontWeight: 600,
            border: 'none', cursor: 'pointer', background: 'transparent',
            color: active === t.key ? 'var(--text)' : 'var(--text-faint)',
            borderBottom: active === t.key ? '2px solid var(--green)' : '2px solid transparent',
            transition: 'all 0.15s',
          }}>{t.label}</button>
        ))}
      </div>
      <div style={{ padding: '14px 16px' }}>{children(active)}</div>
    </div>
  )
}

// Mini user list (shared by signups + active panels)
function MiniUserList({ users, emptyMsg }: { users: JourneyUser[]; emptyMsg: string }) {
  if (!users.length) return <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>{emptyMsg}</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto', scrollbarWidth: 'none' }}>
      {users.map(u => {
        const color = sourceColor(u.source)
        const st    = STATUS_STYLE[u.status]
        return (
          <div key={u.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--line)' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: '#2fbf7118', border: '1px solid #2fbf7135', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#2fbf71' }}>
              {(u.name || u.email || '?').slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.name || u.email || `User ${u.userId.slice(0, 8)}`}
              </div>
              {u.email && u.name && (
                <div style={{ fontSize: 10, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
              )}
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: `${color}15`, color, border: `1px solid ${color}25`, flexShrink: 0, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {u.source}
            </span>
            {u.country && u.country !== 'null' && (
              <span style={{ fontSize: 10, color: 'var(--text-faint)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
                <Globe size={10} />{u.country}
              </span>
            )}
            <span style={{ fontSize: 10, fontWeight: 700, color: st.color, flexShrink: 0 }}>{st.label}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', flexShrink: 0 }}>{u.signedUpRel}</span>
          </div>
        )
      })}
    </div>
  )
}

// Step 0 — Impressions panel
function ImpressionsPanel({ topQueries }: { topQueries: GscQuery[] }) {
  const sorted = [...topQueries].sort((a, b) => b.impressions - a.impressions)
  const max = Math.max(...sorted.map(q => q.impressions), 1)
  return (
    <DetailPanel tabs={[{ key: 'queries', label: 'Top queries by impressions' }]}>
      {() => sorted.length === 0
        ? <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>No query data yet.</p>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sorted.map(q => <MiniBar key={q.query} label={q.query} value={q.impressions} max={max} color="#60a5fa" />)}
          </div>}
    </DetailPanel>
  )
}

// Step 1 — Clicks panel
function ClicksPanel({ topQueries, topPages }: { topQueries: GscQuery[]; topPages: { page: string; clicks: number; impressions: number }[] }) {
  const maxQ = Math.max(...topQueries.map(q => q.clicks), 1)
  const maxP = Math.max(...topPages.map(p => p.clicks), 1)
  return (
    <DetailPanel tabs={[{ key: 'queries', label: 'Top queries' }, { key: 'pages', label: 'Top pages' }]}>
      {active => active === 'queries'
        ? topQueries.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>No query data.</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topQueries.map(q => (
                <div key={q.query}>
                  <MiniBar label={q.query} value={q.clicks} max={maxQ} color="#818cf8" />
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 140, marginTop: 2 }}>
                    {fmt(q.impressions)} impressions · position #{q.position}
                  </div>
                </div>
              ))}
            </div>
        : topPages.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>No page data.</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topPages.map(p => <MiniBar key={p.page} label={p.page} value={p.clicks} max={maxP} color="#818cf8" />)}
            </div>
      }
    </DetailPanel>
  )
}

// Step 2 — Sessions panel
function SessionsPanel({ channelMatrix, landingPages }: { channelMatrix: ChannelRow[]; landingPages: LandingPage[] }) {
  const maxC = Math.max(...channelMatrix.map(c => c.ga4Sessions), 1)
  const maxP = Math.max(...landingPages.map(p => p.ga4Sessions), 1)
  return (
    <DetailPanel tabs={[{ key: 'channels', label: 'By channel' }, { key: 'pages', label: 'Top pages' }]}>
      {active => active === 'channels'
        ? channelMatrix.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>No channel data.</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {channelMatrix.filter(c => c.ga4Sessions > 0).map((c, i) => (
                <div key={c.channel}>
                  <MiniBar label={c.channel} value={c.ga4Sessions} max={maxC} color={['#a78bfa','#60a5fa','#4ade80','#e7c873','#f87171','#5eead4'][i % 6]} />
                  {c.phSignups > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 140, marginTop: 2 }}>
                      {c.phSignups} signed up from this channel
                    </div>
                  )}
                </div>
              ))}
            </div>
        : landingPages.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>No page data.</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {landingPages.filter(p => p.ga4Sessions > 0).map(p => <MiniBar key={p.path} label={p.path} value={p.ga4Sessions} max={maxP} color="#a78bfa" />)}
            </div>
      }
    </DetailPanel>
  )
}

// Step 3 — Signups panel
function SignupsPanel({ users, signupsBySource, signupsByDevice, signupsByCountry }: {
  users: JourneyUser[]
  signupsBySource: SignupSource[]
  signupsByDevice: { device: string; signups: number }[]
  signupsByCountry: { country: string; signups: number }[]
}) {
  const recentSignups = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000
    return users.filter(u => new Date(u.signedUpAt).getTime() >= cutoff).slice(0, 50)
  }, [users])

  const maxSource  = Math.max(...signupsBySource.map(s => s.signups), 1)
  const maxDevice  = Math.max(...signupsByDevice.map(d => d.signups), 1)
  const maxCountry = Math.max(...signupsByCountry.map(c => c.signups), 1)
  const DEVICE_COLORS: Record<string, string> = { Mobile: '#a78bfa', Desktop: '#4ade80', Tablet: '#e7c873', Unknown: 'var(--text-faint)' }
  const COUNTRY_COLORS = ['#4ade80','#60a5fa','#a78bfa','#e7c873','#f87171','#5eead4','#fb923c','#e1306c','#94a3b8','#6495ed']

  return (
    <DetailPanel tabs={[{ key: 'who', label: 'Who' }, { key: 'source', label: 'Source' }, { key: 'device', label: 'Device' }, { key: 'country', label: 'Country' }]}>
      {active => {
        if (active === 'who') return <MiniUserList users={recentSignups} emptyMsg="No signups in the last 30 days." />
        if (active === 'source') return signupsBySource.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>No source data.</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {signupsBySource.slice(0, 8).map(s => <MiniBar key={s.source} label={s.source} value={s.signups} max={maxSource} color={sourceColor(s.source)} />)}
            </div>
        if (active === 'device') return signupsByDevice.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>No device data.</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {signupsByDevice.map(d => <MiniBar key={d.device} label={d.device} value={d.signups} max={maxDevice} color={DEVICE_COLORS[d.device] ?? '#a78bfa'} />)}
            </div>
        // country
        return signupsByCountry.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>No country data.</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {signupsByCountry.map((c, i) => <MiniBar key={c.country} label={c.country} value={c.signups} max={maxCountry} color={COUNTRY_COLORS[i % 10]} />)}
            </div>
      }}
    </DetailPanel>
  )
}

// Step 4 — Active users panel
function ActivePanel({ users }: { users: JourneyUser[] }) {
  const activeUsers = useMemo(() => users.filter(u => u.status === 'active'), [users])
  return (
    <DetailPanel tabs={[{ key: 'list', label: 'Active users this week' }]}>
      {() => <MiniUserList users={activeUsers} emptyMsg="No active users found in the last 7 days." />}
    </DetailPanel>
  )
}

// ── 2. Funnel steps ───────────────────────────────────────────────────────────

function FunnelSteps({ funnel, gscConnected, ga4Connected, phConnected, data }: {
  funnel: Funnel; gscConnected: boolean; ga4Connected: boolean; phConnected: boolean
  data: ApiResponse
}) {
  const [openStep, setOpenStep] = useState<number | null>(null)

  const toggle = (i: number, ok: boolean) => { if (ok) setOpenStep(s => s === i ? null : i) }

  const steps = [
    { label: 'People who saw you on Google',    value: funnel.impressions, sub: 'Google Search impressions (last 30 days)',                                                                            color: '#60a5fa', icon: <Search size={16} />,           ok: gscConnected },
    { label: 'People who clicked to your site', value: funnel.clicks,      sub: funnel.clickThroughRate ? `${funnel.clickThroughRate}% of people who saw you actually clicked` : 'Google Search clicks', color: '#818cf8', icon: <MousePointerClick size={16} />, ok: gscConnected },
    { label: 'Website sessions',                value: funnel.sessions,    sub: 'Total visits on your site in the last 30 days',                                                                      color: '#a78bfa', icon: <BarChart2 size={16} />,         ok: ga4Connected },
    { label: 'New signups',                     value: funnel.signups,     sub: funnel.sessionToSignupRate ? `${funnel.sessionToSignupRate}% of visits turned into signups` : 'People who created an account (last 30 days)', color: '#4ade80', icon: <Users size={16} />, ok: phConnected },
    { label: 'Still active this week',          value: funnel.activeUsers, sub: funnel.signupToActiveRate ? `${funnel.signupToActiveRate}% of signups came back within 7 days` : 'Signed-up users seen in the last 7 days',   color: '#e7c873', icon: <TrendingUp size={16} />, ok: phConnected },
  ]

  const maxVal = Math.max(...steps.map(s => s.value ?? 0), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {steps.map((step, i) => {
        const barWidth = step.value != null && step.ok ? Math.max(4, Math.round((step.value / maxVal) * 100)) : 0
        const isOpen   = openStep === i

        return (
          <div key={i}>
            <div
              onClick={() => toggle(i, step.ok)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                cursor: step.ok ? 'pointer' : 'default',
                padding: '6px 10px', borderRadius: 10,
                background: isOpen ? `${step.color}08` : 'transparent',
                border: step.ok ? `1px solid ${isOpen ? step.color + '40' : 'transparent'}` : '1px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 260 }}>
                <span style={{ color: step.ok ? step.color : 'var(--text-faint)', display: 'flex', flexShrink: 0 }}>{step.icon}</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: step.ok ? 'var(--text)' : 'var(--text-faint)' }}>{step.label}</span>
                    {step.ok && (isOpen
                      ? <ChevronUp size={13} style={{ color: step.color }} />
                      : <ChevronDown size={13} style={{ color: step.color }} />)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>{step.ok ? step.sub : 'Not connected'}</div>
                </div>
              </div>
              <div style={{ flex: 1, height: 8, background: 'var(--bg)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${barWidth}%`, height: '100%', background: step.color, borderRadius: 99, transition: 'width 0.5s ease', opacity: step.ok ? 1 : 0.2 }} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: step.ok ? step.color : 'var(--text-faint)', minWidth: 52, textAlign: 'right' }}>
                {step.ok ? fmt(step.value) : '—'}
              </div>
            </div>

            {isOpen && step.ok && (
              i === 0 ? <ImpressionsPanel topQueries={data.gsc.topQueries} /> :
              i === 1 ? <ClicksPanel topQueries={data.gsc.topQueries} topPages={data.gsc.topPages ?? []} /> :
              i === 2 ? <SessionsPanel channelMatrix={data.channelMatrix} landingPages={data.enrichedLandingPages} /> :
              i === 3 ? <SignupsPanel users={data.posthog.users} signupsBySource={data.posthog.signupsBySource} signupsByDevice={data.posthog.signupsByDevice} signupsByCountry={data.posthog.signupsByCountry} /> :
                        <ActivePanel users={data.posthog.users} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 3. Where do users come from ───────────────────────────────────────────────

function WhereFromSection({ sources }: { sources: SignupSource[] }) {
  if (!sources.length) return <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>No signup source data yet.</p>

  const maxSignups = Math.max(...sources.map(s => s.signups), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sources.slice(0, 8).map(s => {
        const color = sourceColor(s.source)
        const barPct = Math.max(3, Math.round((s.signups / maxSignups) * 100))
        return (
          <div key={s.source}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.source}</span>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>
                  {s.signups} signed up
                </span>
                {s.activeUsers > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    {s.activeUsers} still active
                  </span>
                )}
              </div>
            </div>
            <div style={{ height: 8, background: 'var(--bg)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${barPct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.5s' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 4. Best performing pages ──────────────────────────────────────────────────

function TopPagesSection({ pages, gscConnected, ga4Connected, phConnected }: {
  pages: LandingPage[]; gscConnected: boolean; ga4Connected: boolean; phConnected: boolean
}) {
  if (!pages.length) return <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>No page data available.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {pages.slice(0, 10).map((p, i) => {
        const total = p.gscClicks + p.ga4Sessions + p.phSignups
        return (
          <div key={i} style={{ padding: '14px 16px', background: 'var(--bg)', borderRadius: 12, border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace', marginBottom: 10, wordBreak: 'break-all' }}>
              {p.path}
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {gscConnected && (
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#60a5fa' }}>{fmt(p.gscClicks) || '0'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Google clicks</div>
                </div>
              )}
              {ga4Connected && (
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>{fmt(p.ga4Sessions) || '0'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Visits</div>
                </div>
              )}
              {phConnected && (
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#4ade80' }}>{p.phSignups || '0'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Signups from this page</div>
                </div>
              )}
              {total === 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>No data for this page yet</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 5. What people search to find you ────────────────────────────────────────

function TopQueriesSection({ queries }: { queries: GscQuery[] }) {
  if (!queries.length) return <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>No search query data yet.</p>

  const maxClicks = Math.max(...queries.map(q => q.clicks), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {queries.map((q, i) => {
        const barPct = Math.max(3, Math.round((q.clicks / maxClicks) * 100))
        const posColor = q.position <= 3 ? '#4ade80' : q.position <= 10 ? '#e7c873' : '#f87171'
        const posLabel = q.position <= 3 ? 'Top 3' : q.position <= 10 ? 'Page 1' : `Position ${q.position}`
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{q.query}</span>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0, marginLeft: 10 }}>
                  <span style={{ fontSize: 11, color: '#60a5fa', fontWeight: 600 }}>{q.clicks} clicks</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: posColor, background: `${posColor}15`, padding: '2px 8px', borderRadius: 99, border: `1px solid ${posColor}30` }}>
                    {posLabel}
                  </span>
                </div>
              </div>
              <div style={{ height: 5, background: 'var(--bg)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${barPct}%`, height: '100%', background: '#60a5fa60', borderRadius: 99 }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 6. User list ──────────────────────────────────────────────────────────────

function Avatar({ name, email }: { name: string; email: string }) {
  const src = name || email || '?'
  const initials = src === '?'
    ? '?'
    : src.includes('@')
      ? src.slice(0, 2).toUpperCase()
      : src.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: '#2fbf7120', border: '1px solid #2fbf7140', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#2fbf71' }}>
      {initials}
    </div>
  )
}

function UserRow({ user }: { user: JourneyUser }) {
  const [expanded, setExpanded] = useState(false)
  const color = sourceColor(user.source)
  const st    = STATUS_STYLE[user.status]

  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <Avatar name={user.name} email={user.email} />

        {/* Identity */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Primary: name if available, else email, else short user ID */}
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.name || user.email || `User ${user.userId.slice(0, 8)}`}
          </div>
          {/* Second line: always show email if we have it, plus source/country/time */}
          <div style={{ fontSize: 11, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.email && (
              <span style={{ color: 'var(--text-dim)', marginRight: 8 }}>{user.email}</span>
            )}
            came from <strong style={{ color }}>{user.source}</strong>
            {user.country && user.country !== 'null' ? ` · ${user.country}` : ''}
            {' · '}{user.signedUpRel}
          </div>
        </div>

        {/* Status */}
        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: `${st.color}15`, color: st.color, border: `1px solid ${st.color}30`, flexShrink: 0 }}>
          {st.label}
        </span>

        {/* Session time */}
        {user.avgSessionTimeSecs > 0 && (
          <span style={{ fontSize: 11, color: '#a78bfa', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {fmtDuration(user.avgSessionTimeSecs)} avg/session
          </span>
        )}

        {expanded
          ? <ChevronUp size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          : <ChevronDown size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />}
      </button>

      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--line)' }}>
          {/* Journey narrative */}
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--card)', borderRadius: 10, fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>
            {user.name || (user.email ? user.email.split('@')[0] : `User ${user.userId.slice(0, 8)}`)} found you via <strong style={{ color }}>{user.source}</strong>
            {user.initialUrl && user.initialUrl !== 'null' && (() => {
              let path = user.initialUrl
              try { path = new URL(user.initialUrl).pathname } catch { /* ok */ }
              return <>, landed on <code style={{ fontSize: 11, background: 'var(--bg)', padding: '1px 6px', borderRadius: 4 }}>{path}</code></>
            })()}
            {', signed up '}<strong>{user.signedUpRel}</strong>
            {user.totalEvents > 0 ? `, and has triggered ${user.totalEvents.toLocaleString()} events` : ''}
            {user.sessionCount > 0 ? ` across ${user.sessionCount} sessions (avg ${fmtDuration(user.avgSessionTimeSecs)} each)` : ''}
            {user.lastSeenRel ? `. Last seen ${user.lastSeenRel}.` : '.'}
          </div>

          {/* Stat grid */}
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'Status',       value: st.label,                             color: st.color      },
              { label: 'Events',       value: user.totalEvents.toLocaleString(),    color: 'var(--text)' },
              { label: 'Page views',   value: user.pageviews.toLocaleString(),      color: 'var(--text)' },
              ...(user.sessionCount > 0 ? [
                { label: 'Sessions',   value: String(user.sessionCount),             color: '#a78bfa'     },
                { label: 'Time in app',value: fmtDuration(user.totalSessionTimeSecs),color: '#a78bfa'    },
              ] : []),
              ...(user.country && user.country !== 'null' ? [
                { label: 'Country',    value: user.country,                          color: 'var(--text)' },
              ] : []),
            ].map(stat => (
              <div key={stat.label} style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', minWidth: 80 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function AuthNewDashboard({ brand }: { brand: { id: string; name: string } }) {
  const router = useRouter()
  const [data, setData]       = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [statusFilter, setStatusFilter] = useState('All')

  const load = () => {
    setLoading(true)
    fetch(`/api/analytics/authNew?brandId=${brand.id}`)
      .then(r => r.json())
      .then((d: ApiResponse) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [brand.id])

  const users = data?.posthog.users ?? []

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      if (statusFilter !== 'All' && u.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!u.email.toLowerCase().includes(q) && !u.name.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [users, statusFilter, search])

  const gscOk = !!data?.gsc.connected
  const ga4Ok = !!data?.ga4.connected
  const phOk  = !!data?.posthog.connected

  const activeCount  = users.filter(u => u.status === 'active').length
  const dormantCount = users.filter(u => u.status === 'dormant').length
  const churnedCount = users.filter(u => u.status === 'churned').length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body, Outfit, sans-serif)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              onClick={() => router.push('/analytics')}
              style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}
            >
              <ArrowLeft size={15} />
            </button>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)', fontFamily: 'var(--font-display, Fraunces, serif)', margin: 0 }}>
                Who are your users and where do they come from?
              </h1>
              <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 3 }}>
                {brand.name} · last 30 days
                {[gscOk && 'Google Search', ga4Ok && 'Website Analytics', phOk && 'User Tracking'].filter(Boolean).length > 0 &&
                  ` · ${[gscOk && 'Google Search', ga4Ok && 'Website Analytics', phOk && 'User Tracking'].filter(Boolean).join(', ')}`}
              </p>
            </div>
          </div>
          <button
            onClick={load}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 99, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}
          >
            <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, height: 140, opacity: 0.4 + i * 0.1 }} />
            ))}
          </div>
        ) : !data ? (
          <Card>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: 0 }}>Could not load data. Try refreshing.</p>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* 1 — Story summary */}
            <StorySummary funnel={data.funnel} gscConnected={gscOk} ga4Connected={ga4Ok} phConnected={phOk} />

            {/* 2 — Funnel pipeline */}
            <Card>
              <SectionTitle icon={<TrendingUp size={16} />} title="Your acquisition funnel" sub="How people discover you, visit your site, and sign up — step by step" />
              <FunnelSteps
                funnel={data.funnel}
                gscConnected={gscOk}
                ga4Connected={ga4Ok}
                phConnected={phOk}
                data={data}
              />
            </Card>

            {/* 3 — Where users come from */}
            <Card>
              <SectionTitle icon={<Users size={16} />} title="Where do your signups come from?" sub="Which channels are actually converting visitors into users (last 30 days)" />
              {!phOk
                ? <NotConnectedNote source="PostHog (user tracking)" />
                : <WhereFromSection sources={data.posthog.signupsBySource} />}
            </Card>

            {/* 4 — Best pages */}
            <Card>
              <SectionTitle icon={<MousePointerClick size={16} />} title="Your best performing pages" sub="Which pages get the most visitors, clicks from Google, and signups" />
              {!gscOk && !ga4Ok && !phOk
                ? <NotConnectedNote source="At least one integration" />
                : <TopPagesSection pages={data.enrichedLandingPages} gscConnected={gscOk} ga4Connected={ga4Ok} phConnected={phOk} />}
            </Card>

            {/* 5 — What people search */}
            {gscOk && (
              <Card>
                <SectionTitle icon={<Search size={16} />} title="What are people searching to find you?" sub="Real search queries that brought visitors to your site from Google (last 30 days)" />
                {!data.gsc.topQueries.length
                  ? <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>No search query data yet — this populates once Google has indexed your site.</p>
                  : (
                    <>
                      {/* Quick stats */}
                      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
                        {[
                          { label: 'Shown in search', value: fmt(data.gsc.impressions30d), color: '#60a5fa' },
                          { label: 'Clicks received',  value: fmt(data.gsc.clicks30d),     color: '#818cf8' },
                          { label: 'Click rate',       value: data.gsc.avgCtr30d != null ? `${data.gsc.avgCtr30d}%` : '—', color: '#a78bfa' },
                          { label: 'Average position', value: data.gsc.avgPosition30d != null ? `#${data.gsc.avgPosition30d}` : '—', color: '#e7c873' },
                        ].map(chip => (
                          <div key={chip.label} style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: chip.color, lineHeight: 1 }}>{chip.value}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 3 }}>{chip.label}</div>
                          </div>
                        ))}
                      </div>
                      <TopQueriesSection queries={data.gsc.topQueries} />
                    </>
                  )}
              </Card>
            )}

            {/* 6 — User list */}
            <Card>
              <SectionTitle icon={<Zap size={16} />} title="Your users" sub="Everyone who has signed up — click any row to see their full journey" />
              {!phOk ? (
                <NotConnectedNote source="PostHog (user tracking)" />
              ) : (
                <>
                  {/* Stats row */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Total',   value: users.length,   color: 'var(--text)' },
                      { label: 'Active this week', value: activeCount,  color: '#4ade80' },
                      { label: 'Gone quiet', value: dormantCount, color: '#e7c873' },
                      { label: 'Churned',  value: churnedCount, color: '#f87171' },
                    ].map(s => (
                      <div key={s.label} style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 3 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Filters */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      placeholder="Search by name or email..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      style={{ flex: 1, minWidth: 180, maxWidth: 260, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 99, padding: '7px 14px', fontSize: 12, color: 'var(--text)', outline: 'none' }}
                    />
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['All', 'active', 'dormant', 'churned', 'new'] as const).map(s => {
                        const st = s === 'All' ? null : STATUS_STYLE[s]
                        return (
                          <button key={s} onClick={() => setStatusFilter(s)} style={{
                            fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 99,
                            border: `1px solid ${statusFilter === s && st ? st.color + '60' : 'var(--line)'}`,
                            cursor: 'pointer',
                            background: statusFilter === s ? (st ? `${st.color}20` : 'var(--text)') : 'transparent',
                            color: statusFilter === s ? (st ? st.color : 'var(--bg)') : 'var(--text-dim)',
                            textTransform: 'capitalize',
                          }}>
                            {s === 'dormant' ? 'Gone quiet' : s === 'All' ? 'Everyone' : s.charAt(0).toUpperCase() + s.slice(1)}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {filteredUsers.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-faint)', fontSize: 13 }}>
                      No users match your filters.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {filteredUsers.map(u => <UserRow key={u.userId} user={u} />)}
                    </div>
                  )}
                </>
              )}
            </Card>

          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        [style*="scrollbarWidth"]::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  )
}
