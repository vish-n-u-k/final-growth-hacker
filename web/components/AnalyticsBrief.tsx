'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { AnalyticsSummaryResponse } from '@/app/api/analytics/summary/route'

interface Props {
  brand: { id: string; name: string; websiteUrl: string }
  connectedProviders: string[]
}

const PROVIDER_LABELS: Record<string, string> = {
  posthog: 'PostHog',
  gsc_api: 'Search Console API',
  google_psi: 'PageSpeed Insights',
  google_analytics: 'Google Analytics',
}

function getScoreCls(score: number | null): string {
  if (score == null) return 'an-score-none'
  return score >= 90 ? 'an-score-great' : score >= 50 ? 'an-score-mid' : 'an-score-low'
}

function getScoreColor(score: number | null): string {
  if (score == null) return 'var(--text-faint)'
  return score >= 90 ? 'var(--green-bright)' : score >= 50 ? '#e7c873' : '#e05252'
}

function fmt(n: number | null | undefined, fallback = '—'): string {
  if (n == null) return fallback
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
}

function ConnectPrompt({ providers }: { providers: string[] }) {
  const router = useRouter()
  return (
    <div className="an-connect-prompt">
      <span className="an-connect-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="7" y="11" width="10" height="11" rx="2"/>
          <path d="M5 11V7a7 7 0 0 1 14 0v4"/>
        </svg>
      </span>
      <span>Connect {providers.map(p => PROVIDER_LABELS[p] ?? p).join(' or ')} to unlock</span>
      <button className="an-connect-btn" onClick={() => router.push('/settings')}>
        Connect →
      </button>
    </div>
  )
}

function MetricRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="an-metric-row">
      <span className="an-metric-label">{label}</span>
      <span className="an-metric-value">
        {value}
        {sub && <span className="an-metric-sub">{sub}</span>}
      </span>
    </div>
  )
}

export default function AnalyticsBrief({ brand, connectedProviders }: Props) {
  const router = useRouter()
  const [data, setData] = useState<AnalyticsSummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const connected = new Set(connectedProviders)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analytics/summary')
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json() as AnalyticsSummaryResponse
      setData(json)
    } catch {
      setError('Could not load analytics. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const posthogMissing = !connected.has('posthog')
  const gscApiMissing = !connected.has('gsc_api')
  const gscVerificationOnly = !connected.has('gsc_api') && connected.has('google_search_console')
  const psiMissing = !connected.has('google_psi')

  return (
    <div className="an-root">
      {/* Header */}
      <div className="an-header">
        <div className="an-header-inner">
          <div className="an-header-left">
            <button className="an-back-btn" onClick={() => router.push('/dashboard')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
            </button>
            <div>
              <h1 className="an-title">Today's Brief</h1>
              {data && <p className="an-date">{fmtDate(data.date)}</p>}
            </div>
          </div>
          <div className="an-header-right">
            <span className="an-brand-chip">{brand.name}</span>
            <button
              className="an-refresh-btn"
              onClick={load}
              disabled={loading}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                style={{ animation: loading ? 'an-spin 1s linear infinite' : 'none' }}
              >
                <path d="M23 4v6h-6"/>
                <path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="an-body">
        {error && (
          <div className="an-error">{error}</div>
        )}

        {/* Claude action — top priority */}
        {(data || loading) && (
          <div className="an-action-card">
            <div className="an-action-label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              One thing to do today
            </div>
            {loading ? (
              <div className="an-skeleton an-skeleton-action" />
            ) : (
              <>
                <p className="an-action-text">{data?.action}</p>
                {data?.actionContext && (
                  <p className="an-action-context">{data.actionContext}</p>
                )}
              </>
            )}
          </div>
        )}

        {/* Brief summary */}
        {(data || loading) && (
          <div className="an-brief-card">
            <span className="an-brief-label">Summary</span>
            {loading ? (
              <>
                <div className="an-skeleton an-skeleton-line" />
                <div className="an-skeleton an-skeleton-line an-skeleton-short" />
              </>
            ) : (
              <p className="an-brief-text">{data?.brief}</p>
            )}
          </div>
        )}

        {/* Metrics grid */}
        <div className="an-grid">

          {/* PostHog */}
          <div className="an-card">
            <div className="an-card-hd">
              <span className="an-card-title">User Activity</span>
              <span className="an-card-source">PostHog</span>
            </div>
            {posthogMissing ? (
              <ConnectPrompt providers={['posthog']} />
            ) : loading ? (
              <div className="an-metrics-loading">
                {[1,2,3,4].map(i => <div key={i} className="an-skeleton an-skeleton-metric" />)}
              </div>
            ) : (
              <div className="an-metrics">
                <MetricRow label="Daily active users" value={fmt(data?.posthog.dau)} sub="today" />
                <MetricRow label="Monthly active users" value={fmt(data?.posthog.mau)} sub="30 days" />
                <MetricRow label="New signups" value={fmt(data?.posthog.newUsers7d)} sub="7 days" />
                <MetricRow label="Sessions" value={fmt(data?.posthog.sessions7d)} sub="7 days" />
              </div>
            )}
          </div>

          {/* GSC */}
          <div className="an-card">
            <div className="an-card-hd">
              <span className="an-card-title">Search Performance</span>
              <span className="an-card-source">GSC API</span>
            </div>
            {gscVerificationOnly ? (
              <div className="an-gsc-partial">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>Verification only — no live data.</span>
                <p className="an-gsc-partial-note">You connected Search Console for site verification. To pull clicks and impressions, also connect the <strong>Google Search Console API</strong> (service account) in Settings.</p>
                <button className="an-connect-btn" onClick={() => router.push('/settings')}>Connect API →</button>
              </div>
            ) : gscApiMissing ? (
              <ConnectPrompt providers={['gsc_api']} />
            ) : loading ? (
              <div className="an-metrics-loading">
                {[1,2,3,4].map(i => <div key={i} className="an-skeleton an-skeleton-metric" />)}
              </div>
            ) : (
              <>
                <div className="an-metrics">
                  <MetricRow label="Clicks" value={fmt(data?.gsc.clicks7d)} sub="7 days" />
                  <MetricRow label="Impressions" value={fmt(data?.gsc.impressions7d)} sub="7 days" />
                  <MetricRow label="Avg CTR" value={data?.gsc.avgCtr7d != null ? `${data.gsc.avgCtr7d}%` : '—'} />
                  <MetricRow label="Avg position" value={data?.gsc.avgPosition7d != null ? String(data.gsc.avgPosition7d) : '—'} />
                </div>
                {data?.gsc.topQueries && data.gsc.topQueries.length > 0 && (
                  <div className="an-queries">
                    <span className="an-queries-label">Top queries</span>
                    {data.gsc.topQueries.map((q) => (
                      <div key={q.query} className="an-query-row">
                        <span className="an-query-text">{q.query}</span>
                        <span className="an-query-clicks">{q.clicks} clk</span>
                        <span className="an-query-pos">#{q.position}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Module health */}
          <div className="an-card">
            <div className="an-card-hd">
              <span className="an-card-title">Module Health</span>
              <span className="an-card-source">Internal</span>
            </div>
            {loading ? (
              <div className="an-metrics-loading">
                {[1,2,3].map(i => <div key={i} className="an-skeleton an-skeleton-metric" />)}
              </div>
            ) : (
              <>
                <div className="an-metrics">
                  <MetricRow
                    label="Analysed"
                    value={`${data?.moduleHealth.analyzedModules ?? 0} / ${data?.moduleHealth.totalModules ?? 0}`}
                    sub="modules"
                  />
                  <MetricRow
                    label="Avg score"
                    value={`${data?.moduleHealth.avgScore ?? 0}%`}
                  />
                  {data?.moduleHealth.lowest && (
                    <MetricRow
                      label="Needs work"
                      value={`${data.moduleHealth.lowest.score}%`}
                      sub={data.moduleHealth.lowest.name}
                    />
                  )}
                </div>
                <div className="an-module-bar-wrap">
                  <div
                    className="an-module-bar"
                    style={{ width: `${data?.moduleHealth.avgScore ?? 0}%` }}
                  />
                </div>
                <button
                  className="an-goto-modules"
                  onClick={() => router.push('/dashboard')}
                >
                  View modules →
                </button>
              </>
            )}
          </div>

          {/* PageSpeed Insights */}
          <div className="an-card">
            <div className="an-card-hd">
              <span className="an-card-title">Page Speed</span>
              <span className="an-card-source">PSI</span>
            </div>
            {psiMissing ? (
              <ConnectPrompt providers={['google_psi']} />
            ) : loading ? (
              <div className="an-metrics-loading">
                {[1,2].map(i => <div key={i} className="an-skeleton an-skeleton-metric" />)}
              </div>
            ) : (
              <div className="an-psi-scores">
                <div className="an-psi-item">
                  <span className={`an-score-badge ${getScoreCls(data?.psi.mobileScore ?? null)}`}>{data?.psi.mobileScore ?? '—'}</span>
                  <span className="an-psi-label">Mobile</span>
                  <div className="an-psi-bar-wrap">
                    <div className="an-psi-bar" style={{ width: `${data?.psi.mobileScore ?? 0}%`, background: getScoreColor(data?.psi.mobileScore ?? null) }} />
                  </div>
                </div>
                <div className="an-psi-item">
                  <span className={`an-score-badge ${getScoreCls(data?.psi.desktopScore ?? null)}`}>{data?.psi.desktopScore ?? '—'}</span>
                  <span className="an-psi-label">Desktop</span>
                  <div className="an-psi-bar-wrap">
                    <div className="an-psi-bar" style={{ width: `${data?.psi.desktopScore ?? 0}%`, background: getScoreColor(data?.psi.desktopScore ?? null) }} />
                  </div>
                </div>
                <p className="an-psi-note">Live Lighthouse test — runs fresh on each refresh.</p>
              </div>
            )}
          </div>

          {/* GA4 */}
          <div className="an-card">
            <div className="an-card-hd">
              <span className="an-card-title">Google Analytics</span>
              <span className="an-card-source">GA4</span>
            </div>
            {!data?.ga4.connected && !loading ? (
              <ConnectPrompt providers={['ga4_api']} />
            ) : loading ? (
              <div className="an-metrics-loading">
                {[1,2,3,4].map(i => <div key={i} className="an-skeleton an-skeleton-metric" />)}
              </div>
            ) : (
              <div className="an-metrics">
                <MetricRow label="Sessions" value={fmt(data?.ga4.sessions7d)} sub="7 days" />
                <MetricRow label="Active users" value={fmt(data?.ga4.activeUsers7d)} sub="7 days" />
                <MetricRow label="New users" value={fmt(data?.ga4.newUsers7d)} sub="7 days" />
                <MetricRow label="Pageviews" value={fmt(data?.ga4.pageviews7d)} sub="7 days" />
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
