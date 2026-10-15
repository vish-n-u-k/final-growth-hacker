'use client'

import { useEffect, useMemo, useState } from 'react'
import ArrowIcon from '@/components/ArrowIcon'
import Link from 'next/link'
import PersonPanel, { ago } from '@/components/PersonPanel'
import { connectUrl } from '@/lib/integrations/connect-url'

// Acquisition & Journeys: how people find you, which channels and pages turn visitors into
// signups, and every signed-up person with their full journey one tap away.
// Data: /api/analytics/authNew (Search Console + GA4 + PostHog, last 30 days).

interface Funnel {
  impressions: number | null
  clicks: number | null
  sessions: number | null
  signups: number | null
  activeUsers: number | null
}

interface LandingPage { path: string; gscClicks: number; ga4Sessions: number; phSignups: number }
interface SignupSource { source: string; signups: number; activeUsers: number }
type Status = 'active' | 'dormant' | 'churned' | 'new'

interface JourneyUser {
  userId: string
  email: string
  name: string
  signedUpAt: string
  source: string
  country: string
  initialUrl: string
  lastSeen: string | null
  status: Status
}

interface ApiResponse {
  funnel: Funnel
  enrichedLandingPages: LandingPage[]
  gsc: { connected: boolean }
  ga4: { connected: boolean }
  posthog: { connected: boolean; signupsBySource: SignupSource[]; users: JourneyUser[] }
}

const STATUS_LABEL: Record<Status, string> = { active: 'Active', new: 'New', dormant: 'Quiet', churned: 'Gone' }
const FILTERS: { key: 'all' | Status; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'active', label: 'Active' },
  { key: 'new', label: 'New' },
  { key: 'dormant', label: 'Quiet' },
  { key: 'churned', label: 'Gone' },
]

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString()

function pathOf(url: string): string {
  try { return new URL(url).pathname } catch { return '' }
}

function Funnel({ data }: { data: ApiResponse }) {
  const f = data.funnel
  const steps = [
    { label: 'Saw you on Google', value: f.impressions, on: data.gsc.connected },
    { label: 'Clicked through from Google', value: f.clicks, on: data.gsc.connected },
    { label: 'Visited your site', value: f.sessions, on: data.ga4.connected },
    { label: 'Signed up', value: f.signups, on: data.posthog.connected },
    { label: 'Still active this week', value: f.activeUsers, on: data.posthog.connected },
  ].filter(s => s.on && s.value != null) as { label: string; value: number }[]
  const max = Math.max(1, ...steps.map(s => s.value))
  const missing = [
    !data.gsc.connected && { label: 'Search Console', what: 'Google searches and clicks', provider: 'gsc_api' },
    !data.ga4.connected && { label: 'Google Analytics', what: 'site visits', provider: 'ga4_api' },
    !data.posthog.connected && { label: 'PostHog', what: 'signups and activity', provider: 'posthog' },
  ].filter((m): m is { label: string; what: string; provider: string } => !!m)

  return (
    <section className="aj-card">
      <h2 className="aj-h2">How people find you</h2>
      {steps.length === 0 ? (
        <p className="aj-muted">No data for the last 30 days yet.</p>
      ) : (
        <ol className="aj-funnel">
          {steps.map((s, i) => {
            const prev = steps[i - 1]
            const rate = prev && prev.value > 0 ? Math.round((s.value / prev.value) * 1000) / 10 : null
            return (
              <li key={s.label}>
                <div className="aj-funnel-row">
                  <span className="aj-funnel-label">{s.label}</span>
                  <span className="aj-funnel-num">{n(s.value)}</span>
                </div>
                <span className="aj-bar"><i style={{ width: `${Math.max(2, (s.value / max) * 100)}%` }} /></span>
                {rate != null && <span className="aj-funnel-rate">{rate}% of the step before</span>}
              </li>
            )
          })}
        </ol>
      )}
      {missing.length > 0 && (
        <p className="aj-muted aj-missing">
          Connect {missing.map((m, i) => (
            <span key={m.provider}>{i > 0 ? (i === missing.length - 1 ? ' and ' : ', ') : ''}<Link href={connectUrl(m.provider)}>{m.label}</Link> ({m.what})</span>
          ))} to see the full path.
        </p>
      )}
    </section>
  )
}

function Sources({ sources }: { sources: SignupSource[] }) {
  const list = sources.filter(s => s.signups > 0).slice(0, 8)
  if (list.length === 0) return null
  const max = Math.max(...list.map(s => s.signups))
  return (
    <section className="aj-card">
      <h2 className="aj-h2">Where your signups come from</h2>
      <ul className="aj-sources">
        {list.map(s => (
          <li key={s.source}>
            <span className="aj-src-name">{s.source || 'Unknown'}</span>
            <span className="aj-bar"><i style={{ width: `${Math.max(3, (s.signups / max) * 100)}%` }} /></span>
            <span className="aj-src-num">{s.signups}<small>{s.activeUsers > 0 ? ` · ${s.activeUsers} active` : ''}</small></span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Pages({ pages, data }: { pages: LandingPage[]; data: ApiResponse }) {
  const rows = pages.filter(p => p.ga4Sessions || p.gscClicks || p.phSignups).slice(0, 8)
  if (rows.length === 0) return null
  const cols = [
    data.ga4.connected && { key: 'ga4Sessions' as const, label: 'Visits' },
    data.gsc.connected && { key: 'gscClicks' as const, label: 'Google clicks' },
    data.posthog.connected && { key: 'phSignups' as const, label: 'Signups' },
  ].filter(Boolean) as { key: 'ga4Sessions' | 'gscClicks' | 'phSignups'; label: string }[]
  return (
    <section className="aj-card">
      <h2 className="aj-h2">Pages that bring people in</h2>
      <div className="aj-table" role="table">
        <div className="aj-tr aj-th" role="row" style={{ gridTemplateColumns: `1fr repeat(${cols.length}, 78px)` }}>
          <span role="columnheader">Page</span>
          {cols.map(c => <span key={c.key} role="columnheader">{c.label}</span>)}
        </div>
        {rows.map(p => (
          <div key={p.path} className="aj-tr" role="row" style={{ gridTemplateColumns: `1fr repeat(${cols.length}, 78px)` }}>
            <span className="aj-path" title={p.path}>{p.path}</span>
            {cols.map(c => <span key={c.key}>{n(p[c.key])}</span>)}
          </div>
        ))}
      </div>
    </section>
  )
}

function People({ users }: { users: JourneyUser[] }) {
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [limit, setLimit] = useState(30)

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: users.length }
    for (const u of users) c[u.status] = (c[u.status] ?? 0) + 1
    return c
  }, [users])

  const shown = users.filter(u =>
    (filter === 'all' || u.status === filter) &&
    (!q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())),
  )

  return (
    <section className="aj-card">
      <h2 className="aj-h2">Your users <span className="aj-count">{users.length}</span></h2>
      <div className="aj-controls">
        <input className="aj-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or email" aria-label="Search users" />
        <div className="aj-filters" role="tablist" aria-label="Filter by status">
          {FILTERS.filter(f => f.key === 'all' || counts[f.key]).map(f => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'is-on' : ''} onClick={() => setFilter(f.key)}>
              {f.label} <span>{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="aj-muted">No users match.</p>
      ) : (
        <ul className="aj-people">
          {shown.slice(0, limit).map(u => {
            const open = openId === u.userId
            const display = u.name || u.email || 'Someone'
            const landing = pathOf(u.initialUrl)
            return (
              <li key={u.userId} className={`ta-person-wrap${open ? ' is-open' : ''}`}>
                <button type="button" className="ta-person" onClick={() => setOpenId(open ? null : u.userId)} aria-expanded={open}>
                  <span className="ta-avatar" aria-hidden="true">{display.slice(0, 1).toUpperCase()}</span>
                  <span className="ta-person-main">
                    <b>{display}</b>
                    <span className="ta-muted">
                      from {u.source || 'Unknown'}{u.country ? ` · ${u.country}` : ''}{landing && landing !== '/' ? ` · landed on ${landing}` : ''}
                    </span>
                  </span>
                  <span className="aj-status" data-status={u.status}>{STATUS_LABEL[u.status]}</span>
                  <span className="ta-time aj-hide-sm">{u.signedUpAt ? `joined ${ago(u.signedUpAt)}` : ''}</span>
                  <svg className="ta-chev" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
                </button>
                {open && <PersonPanel id={u.userId} />}
              </li>
            )
          })}
        </ul>
      )}
      {shown.length > limit && (
        <button type="button" className="aj-more" onClick={() => setLimit(l => l + 30)}>Show more ({shown.length - limit} left)</button>
      )}
    </section>
  )
}

export default function AuthNewDashboard({ brand }: { brand: { id: string; name: string } }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = () => {
    setLoading(true)
    setFailed(false)
    fetch(`/api/analytics/authNew?brandId=${brand.id}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [brand.id])

  const nothingConnected = data && !data.gsc.connected && !data.ga4.connected && !data.posthog.connected

  return (
    <div className="aj-page">
      <div className="aj-head">
        <Link href="/analytics" className="aj-back">← Analytics</Link>
        <div className="aj-titlerow">
          <div>
            <h1 className="aj-title">Acquisition &amp; Journeys</h1>
            <p className="aj-muted">{brand.name} · last 30 days</p>
          </div>
          <button type="button" className="aj-refresh" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      {loading && !data ? (
        <div className="aj-stack">{[0, 1, 2].map(i => <div key={i} className="aj-card aj-skel" />)}</div>
      ) : failed && !data ? (
        <section className="aj-card"><p className="aj-muted">Couldn&apos;t load this right now. <button type="button" className="aj-link" onClick={load}>Try again</button></p></section>
      ) : nothingConnected ? (
        <section className="aj-card">
          <h2 className="aj-h2">Connect your analytics</h2>
          <p className="aj-muted">Connect PostHog, Google Analytics or Search Console to see how people find you and who signs up.</p>
          <Link href="/settings?tab=integrations&group=analytics" className="aj-cta">Go to Integrations <ArrowIcon /></Link>
        </section>
      ) : data && (
        <div className={`aj-stack${loading ? ' ta-dim' : ''}`}>
          <Funnel data={data} />
          <Sources sources={data.posthog.signupsBySource ?? []} />
          <Pages pages={data.enrichedLandingPages ?? []} data={data} />
          {data.posthog.connected && <People users={data.posthog.users ?? []} />}
        </div>
      )}
    </div>
  )
}
