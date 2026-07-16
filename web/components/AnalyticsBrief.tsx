'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { OverviewResponse, StatusBoardItem } from '@/app/api/analytics/summary/route'

interface Props {
  brand: { id: string; name: string; websiteUrl: string }
  connectedProviders: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, fallback = '—'): string {
  if (n == null) return fallback
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function fmtShortDate(isoDate: string): string {
  // isoDate is YYYY-MM-DD — parse as UTC to avoid timezone shifts
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function scoreColor(score: number): string {
  return score >= 90 ? 'var(--green-bright)' : score >= 60 ? 'var(--gold)' : '#e05252'
}

// Renders **bold** and {{chip:X}} tokens
function BriefText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\{\{chip:[^}]+\}\})/g)
  return (
    <p className="ov-brief-text">
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i} className="ov-brief-bold">{part.slice(2, -2)}</strong>
        const chipMatch = part.match(/^\{\{chip:(.+)\}\}$/)
        if (chipMatch)
          return <span key={i} className="ov-chip">{chipMatch[1]}</span>
        return part
      })}
    </p>
  )
}

// Ring SVG for growth audit avg
function Ring({ pct }: { pct: number }) {
  const r = 22
  const circ = 2 * Math.PI * r
  const offset = circ - (circ * pct) / 100
  return (
    <svg width="54" height="54" viewBox="0 0 54 54">
      <circle cx="27" cy="27" r={r} fill="none" stroke="var(--bg-soft)" strokeWidth="6.5" />
      <circle cx="27" cy="27" r={r} fill="none" stroke="var(--green-bright)" strokeWidth="6.5"
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
        transform="rotate(-90 27 27)" style={{ transition: 'stroke-dashoffset .6s ease' }} />
    </svg>
  )
}

// Status board row
function StatusRow({ item }: { item: StatusBoardItem }) {
  const dotCls = item.value === '🔒' ? 'ov-dot-locked' : item.value === '—' ? 'ov-dot-pending' : parseInt(item.value) >= 100 ? 'ov-dot-done' : 'ov-dot-progress'
  return (
    <div className="ov-list-row">
      <span className={`ov-status-dot ${dotCls}`} />
      <span className={`ov-domain-chip ov-domain-${item.domain}`}>{item.domain}</span>
      <div className="ov-list-name">
        {item.name}
        <span className="ov-list-desc">{item.description}</span>
      </div>
      <span className="ov-list-val">{item.value}</span>
    </div>
  )
}

// Locked card body
function LockedCard({ title, sub }: { title: string; sub: string }) {
  const router = useRouter()
  return (
    <div className="ov-locked-body">
      <div className="ov-locked-text">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ov-lock-icon">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <div>
          <div className="ov-locked-title">{title}</div>
          <div className="ov-locked-sub">{sub}</div>
        </div>
      </div>
      <button className="ov-connect-btn" onClick={() => router.push('/settings')}>Connect →</button>
    </div>
  )
}

const TAB_LABELS = ['done', 'ongoing', 'pending', 'locked'] as const
type Tab = typeof TAB_LABELS[number]

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsBrief({ brand, connectedProviders: _ }: Props) {
  const router = useRouter()
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('done')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analytics/summary')
      if (!res.ok) throw new Error('Failed')
      setData(await res.json() as OverviewResponse)
    } catch {
      setError('Could not load overview. Try refreshing.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const tabCounts = {
    done: data?.statusBoard.done.length ?? 0,
    ongoing: data?.statusBoard.ongoing.length ?? 0,
    pending: data?.statusBoard.pending.length ?? 0,
    locked: data?.statusBoard.locked.length ?? 0,
  }

  return (
    <div className="ov-root">

      {/* ── Header ── */}
      <div className="ov-header">
        <div className="ov-header-inner">
          <div className="ov-header-left">
            <button className="ov-back-btn" onClick={() => router.push('/dashboard')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
            </button>
            <div>
              <h1 className="ov-title">Overview</h1>
              {data && <p className="ov-subtitle">{fmtDate(data.date)} · everything happening across {brand.name}, in one page</p>}
            </div>
          </div>
          <div className="ov-header-right">
            <span className="ov-brand-chip">{brand.name}</span>
            <button className="ov-refresh-btn" onClick={load} disabled={loading}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ animation: loading ? 'ov-spin 1s linear infinite' : 'none' }}>
                <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="ov-body">
        {error && <div className="ov-error">{error}</div>}

        {/* ── Top Priority ── */}
        <div className="ov-priority-card">
          <div className="ov-eyebrow ov-eyebrow-green">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
            Top priority today
          </div>
          {loading ? (
            <div className="ov-skel ov-skel-h2" />
          ) : (
            <>
              <h2 className="ov-priority-title">{data?.topPriority?.title ?? 'Run your first module analysis'}</h2>
              <p className="ov-priority-desc">{data?.topPriority?.description ?? 'Analyse a module to see your top priority.'}</p>
            </>
          )}
        </div>

        {/* ── Summary ── */}
        <div className="ov-summary-card">
          <div className="ov-eyebrow ov-eyebrow-faint">Summary — in plain terms</div>
          {loading ? (
            <><div className="ov-skel ov-skel-line" /><div className="ov-skel ov-skel-line ov-skel-short" /></>
          ) : data?.brief ? (
            <BriefText text={data.brief} />
          ) : null}
        </div>

        {/* ── Stat strip ── */}
        <div className="ov-stats">
          {/* Growth audit avg */}
          <div className="ov-stat ov-stat-ring">
            {loading ? <div className="ov-skel ov-skel-ring" /> : <Ring pct={data?.stats.growthAuditAvg ?? 0} />}
            <div>
              <div className="ov-stat-label">Module avg</div>
              <div className="ov-stat-big">{loading ? '—' : data?.stats.growthAuditAvg ?? 0}<small>%</small></div>
              <div className="ov-stat-sub">avg across {data?.stats.moduleAnalysed ?? 0} modules</div>
            </div>
          </div>

          {/* Road to 500 */}
          <div className="ov-stat">
            <div className="ov-stat-label">Road to 500</div>
            {!loading && !data?.posthog.connected ? (
              <div className="ov-stat-connect-nudge">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.5 }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Connect PostHog to track users toward 500</span>
              </div>
            ) : (
              <>
                <div className="ov-stat-big">{loading ? '—' : fmt(data?.goal.current)}<small>/500</small></div>
                <div className="ov-track">
                  <i style={{ width: `${data?.goal.pct ?? 0}%`, background: 'linear-gradient(90deg, var(--green), var(--green-bright))' }} />
                </div>
                {data?.posthog.dataStartDate && (
                  <div className="ov-stat-sub">since {fmtShortDate(data.posthog.dataStartDate)}</div>
                )}
              </>
            )}
          </div>

          {/* Stickiness */}
          <div className="ov-stat">
            <div className="ov-stat-label">DAU / MAU</div>
            {loading ? <div className="ov-skel ov-skel-num" /> : (
              <>
                <div className="ov-stat-big" style={{ color: data?.stats.stickiness != null && data.stats.stickiness < 10 ? 'var(--gold)' : 'var(--text)' }}>
                  {data?.stats.stickiness != null ? `${data.stats.stickiness}` : '—'}<small>%</small>
                </div>
                {data?.posthog.dau != null && data?.posthog.mau != null && (
                  <div className="ov-stat-sub">{data.posthog.dau} daily / {data.posthog.mau} monthly{data.stats.stickiness != null && data.stats.stickiness < 10 ? ' — on the low side' : ''}</div>
                )}
              </>
            )}
          </div>

          {/* Module coverage */}
          <div className="ov-stat">
            <div className="ov-stat-label">Module coverage</div>
            <div className="ov-stat-big">{loading ? '—' : data?.stats.moduleAnalysed ?? 0}<small>/{data?.stats.moduleTotal ?? '—'}</small></div>
            <div className="ov-track">
              <i style={{ width: `${data && data.stats.moduleTotal > 0 ? Math.round((data.stats.moduleAnalysed / data.stats.moduleTotal) * 100) : 0}%`, background: 'linear-gradient(90deg, var(--green), var(--green-bright))' }} />
            </div>
          </div>
        </div>

        {/* ── Status board ── */}
        <div className="ov-section-head">
          <h3>Status board</h3>
          <span>growth, product & integrations combined</span>
        </div>

        <div className="ov-tabs">
          {TAB_LABELS.map(t => (
            <button key={t} className={`ov-tab ${tab === t ? 'ov-tab-active' : ''}`} onClick={() => setTab(t)}>
              <span className={`ov-tab-dot ov-tab-dot-${t}`} />
              {t.charAt(0).toUpperCase() + t.slice(1)}
              <span className="ov-tab-count">{tabCounts[t]}</span>
            </button>
          ))}
        </div>

        <div className="ov-list-card">
          {loading ? (
            [1,2,3].map(i => <div key={i} className="ov-list-row"><div className="ov-skel ov-skel-row" /></div>)
          ) : (
            (data?.statusBoard[tab] ?? []).length > 0
              ? (data?.statusBoard[tab] ?? []).map((item, i) => <StatusRow key={i} item={item} />)
              : <div className="ov-list-empty">Nothing here yet.</div>
          )}
        </div>

        {/* ── Metrics grid ── */}
        <div className="ov-section-head">
          <h3>Metrics, with context</h3>
          <span>numbers plus what they mean</span>
        </div>

        <div className="ov-grid2">

          {/* PostHog */}
          <div className="ov-card">
            <div className="ov-card-head"><h4>User Activity</h4><span className="ov-badge">PostHog</span></div>
            {!data?.posthog.connected && !loading ? (
              <LockedCard title="Connect PostHog to unlock user activity" sub="DAU, MAU, new signups, and session data" />
            ) : (
              <>
                <div className="ov-row"><span className="ov-rlabel">Daily active users</span><span className="ov-rval">{fmt(data?.posthog.dau)}<span className="ov-rperiod">today</span></span></div>
                <div className="ov-row"><span className="ov-rlabel">Monthly active users</span><span className="ov-rval">{fmt(data?.posthog.mau)}<span className="ov-rperiod">30 days</span></span></div>
                <div className="ov-row"><span className="ov-rlabel">New signups</span><span className="ov-rval">{fmt(data?.posthog.newUsers7d)}<span className="ov-rperiod">7 days</span></span></div>
                <div className="ov-row"><span className="ov-rlabel">Sessions</span><span className="ov-rval">{fmt(data?.posthog.sessions7d)}<span className="ov-rperiod">7 days</span></span></div>
                {data?.stats.stickiness != null && data.stats.stickiness < 10 && (
                  <div className="ov-insight ov-insight-amber">Stickiness (DAU/MAU) is {data.stats.stickiness}% — healthy SaaS apps typically sit closer to 15–20%. Worth watching as you grow past 500 users.</div>
                )}
                {data?.stats.stickiness != null && data.stats.stickiness >= 10 && (
                  <div className="ov-insight">Stickiness is {data.stats.stickiness}% — on track. Keep monitoring as your user base grows.</div>
                )}
              </>
            )}
          </div>

          {/* Module Health */}
          <div className="ov-card">
            <div className="ov-card-head"><h4>Module Health</h4><span className="ov-badge">Internal</span></div>
            <div className="ov-row"><span className="ov-rlabel">Analysed</span><span className="ov-rval">{data?.stats.moduleAnalysed ?? '—'}<span className="ov-rperiod">/ {data?.stats.moduleTotal ?? '—'} modules</span></span></div>
            <div className="ov-row"><span className="ov-rlabel">Avg score</span><span className="ov-rval">{data?.stats.avgScore ?? '—'}%</span></div>
            {data?.lowestModule && (
              <div className="ov-row"><span className="ov-rlabel">Needs work</span><span className="ov-rval ov-rval-red">{data.lowestModule.score}%<span className="ov-rperiod">{data.lowestModule.name}</span></span></div>
            )}
            <div className="ov-track ov-track-mt"><i style={{ width: `${data?.stats.avgScore ?? 0}%`, background: 'linear-gradient(90deg, var(--green), var(--green-bright))' }} /></div>
            {data && data.stats.moduleAnalysed < data.stats.moduleTotal * 0.6 && (
              <div className="ov-insight">{data.stats.moduleTotal - data.stats.moduleAnalysed} modules still unanalysed. Coverage matters as much as score — the average will move a lot once the rest are scanned.</div>
            )}
            <button className="ov-goto-btn" onClick={() => router.push('/dashboard')}>View modules →</button>
          </div>

          {/* Search Performance */}
          <div className="ov-card">
            <div className="ov-card-head"><h4>Search Performance</h4><span className="ov-badge">GSC API</span></div>
            {data?.gsc.connectionStatus === 'locked' ? (
              <LockedCard title="Connect Google Search Console API" sub="Clicks, impressions, CTR, and keyword positions" />
            ) : (
              <>
                <div className="ov-row"><span className="ov-rlabel">Clicks</span><span className="ov-rval" style={data?.gsc.clicks7d == null ? { color: 'var(--text-faint)' } : {}}>{fmt(data?.gsc.clicks7d)}<span className="ov-rperiod">7 days</span></span></div>
                <div className="ov-row"><span className="ov-rlabel">Impressions</span><span className="ov-rval" style={data?.gsc.impressions7d == null ? { color: 'var(--text-faint)' } : {}}>{fmt(data?.gsc.impressions7d)}<span className="ov-rperiod">7 days</span></span></div>
                <div className="ov-row"><span className="ov-rlabel">Avg CTR</span><span className="ov-rval" style={data?.gsc.avgCtr7d == null ? { color: 'var(--text-faint)' } : {}}>{data?.gsc.avgCtr7d != null ? `${data.gsc.avgCtr7d}%` : '—'}</span></div>
                <div className="ov-row"><span className="ov-rlabel">Avg position</span><span className="ov-rval" style={data?.gsc.avgPosition7d == null ? { color: 'var(--text-faint)' } : {}}>{data?.gsc.avgPosition7d ?? '—'}</span></div>
                {data?.gsc.connectionStatus === 'connected_pending_data' && (
                  <div className="ov-insight ov-insight-amber">Connected, but no data has come through yet — Search Console usually takes 24–48h after connecting to populate. Check back tomorrow.</div>
                )}
                {data?.gsc.topQueries && data.gsc.topQueries.length > 0 && (
                  <div className="ov-queries">
                    <span className="ov-queries-label">Top queries</span>
                    {data.gsc.topQueries.map(q => (
                      <div key={q.query} className="ov-query-row">
                        <span className="ov-query-text">{q.query}</span>
                        <span className="ov-query-clicks">{q.clicks} clk</span>
                        <span className="ov-query-pos">#{q.position}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* GA4 */}
          <div className="ov-card">
            <div className="ov-card-head"><h4>Google Analytics</h4><span className="ov-badge">GA4</span></div>
            {!data?.ga4.connected && !loading ? (
              <LockedCard title="Connect ga4_api to unlock" sub="Traffic sources, conversion paths, retention cohorts" />
            ) : (
              <div className="ov-metrics">
                <div className="ov-row"><span className="ov-rlabel">Sessions</span><span className="ov-rval">{fmt(data?.ga4.sessions7d)}<span className="ov-rperiod">7 days</span></span></div>
                <div className="ov-row"><span className="ov-rlabel">Active users</span><span className="ov-rval">{fmt(data?.ga4.activeUsers7d)}<span className="ov-rperiod">7 days</span></span></div>
                <div className="ov-row"><span className="ov-rlabel">New users</span><span className="ov-rval">{fmt(data?.ga4.newUsers7d)}<span className="ov-rperiod">7 days</span></span></div>
                <div className="ov-row"><span className="ov-rlabel">Pageviews</span><span className="ov-rval">{fmt(data?.ga4.pageviews7d)}<span className="ov-rperiod">7 days</span></span></div>
              </div>
            )}
          </div>

          {/* PSI */}
          <div className="ov-card">
            <div className="ov-card-head"><h4>Page Speed</h4><span className="ov-badge">PSI</span></div>
            {!data?.psi.connected && !loading ? (
              <LockedCard title="Connect PageSpeed Insights to unlock" sub="Core Web Vitals, load time, mobile score" />
            ) : (
              <div className="ov-psi-scores">
                {(['mobile', 'desktop'] as const).map(type => {
                  const score = type === 'mobile' ? data?.psi.mobileScore : data?.psi.desktopScore
                  return (
                    <div key={type} className="ov-psi-item">
                      <span className="ov-psi-score" style={{ color: score != null ? scoreColor(score) : 'var(--text-faint)' }}>{score ?? '—'}</span>
                      <span className="ov-psi-label">{type.charAt(0).toUpperCase() + type.slice(1)}</span>
                      <div className="ov-track ov-track-flex">
                        <i style={{ width: `${score ?? 0}%`, background: score != null ? scoreColor(score) : 'var(--text-faint)' }} />
                      </div>
                    </div>
                  )
                })}
                <p className="ov-psi-note">Live Lighthouse test — runs fresh on each refresh.</p>
              </div>
            )}
          </div>

          {/* Revenue — always locked */}
          <div className="ov-card">
            <div className="ov-card-head"><h4>Customer Economics</h4><span className="ov-badge">Billing</span></div>
            <LockedCard title="Connect billing to unlock CAC, churn & ARPU" sub="Calculated automatically from spend + signups + revenue events" />
          </div>

        </div>

        {/* ── Growth progress ── */}
        {!loading && data && data.growthProgress.length > 0 && (
          <>
            <div className="ov-section-head">
              <h3>Growth module progress</h3>
              <span>road to Level 1</span>
            </div>
            <div className="ov-prog-list">
              {data.growthProgress.map(m => (
                <div key={m.name} className="ov-prog-item">
                  <div className="ov-prog-name">{m.name}</div>
                  <div className="ov-track ov-track-flex">
                    <i style={{ width: `${m.score}%`, background: m.score >= 100 ? 'var(--green-bright)' : m.score >= 75 ? 'var(--gold)' : '#e05252' }} />
                  </div>
                  <div className="ov-prog-pct" style={{ color: m.score >= 100 ? 'var(--green-bright)' : m.score >= 75 ? 'var(--gold)' : '#e05252' }}>{m.score}%</div>
                  <div className="ov-prog-note">{m.note}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── What's next ── */}
        {!loading && data && data.whatNext.length > 0 && (
          <>
            <div className="ov-section-head">
              <h3>What's next</h3>
              <span>ordered by impact</span>
            </div>
            <div className="ov-next-list">
              {data.whatNext.map((item, i) => (
                <div key={i} className="ov-next-item">
                  <div className="ov-next-num">{i + 1}</div>
                  <div>
                    <h5 className="ov-next-title">
                      {item.title}
                      <span className={`ov-next-tag ov-next-tag-${item.severity}`}>{item.severity}</span>
                    </h5>
                    <p className="ov-next-desc">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  )
}
