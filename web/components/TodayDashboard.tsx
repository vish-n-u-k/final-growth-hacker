'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { ActionCard } from '@/lib/daily/signals'

interface TrafficData {
  visits: number
  visitsPrior: number
  channels: { name: string; sessions: number }[]
}

interface Props {
  initialData: {
    cards: ActionCard[]
    streak: number
    allGood: boolean
    cachedAt: string
  }
}

// ── Accent colors per type ────────────────────────────────────────────────────

const TYPE_ACCENT: Record<string, { bg: string; border: string; label: string; dot: string }> = {
  outreach:      { bg: 'var(--td-amber-bg)',  border: 'var(--td-amber-line)',  label: 'Traffic signal',  dot: '#d97706' },
  social:        { bg: 'var(--td-violet-bg)', border: 'var(--td-violet-line)', label: 'Social signal',   dot: '#7c3aed' },
  seo:           { bg: 'var(--td-green-bg)',  border: 'var(--td-green-line)',  label: 'SEO signal',      dot: 'var(--green)' },
  content:       { bg: 'var(--td-blue-bg)',   border: 'var(--td-blue-line)',   label: 'Content signal',  dot: '#0284c7' },
  'module-item': { bg: 'var(--td-red-bg)',    border: 'var(--td-red-line)',    label: 'Open item',       dot: '#dc2626' },
  'all-good':    { bg: 'var(--td-green-bg)',  border: 'var(--td-green-line)',  label: 'All clear',       dot: 'var(--green)' },
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

function IconMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
    </svg>
  )
}
function IconSocial() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM7 9a3 3 0 1 1 0 6A3 3 0 0 1 7 9Zm10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/>
      <path d="m14 10.7-5 2.6M14 13.3 9 10.7"/>
    </svg>
  )
}
function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
    </svg>
  )
}
function IconDoc() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )
}
function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}
function IconStar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  )
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  outreach:      <IconMail />,
  social:        <IconSocial />,
  seo:           <IconSearch />,
  content:       <IconDoc />,
  'module-item': <IconCheck />,
  'all-good':    <IconStar />,
}

// ── Analytics bar (top strip) ─────────────────────────────────────────────────

function AnalyticsBar() {
  const [data, setData] = useState<{ traffic: TrafficData | null } | null>(null)

  useEffect(() => {
    fetch('/api/analytics/daily-summary')
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {})
  }, [])

  if (!data?.traffic) return null

  const { visits, visitsPrior, channels } = data.traffic
  const delta = visitsPrior > 0 ? Math.round(((visits - visitsPrior) / visitsPrior) * 100) : null
  const top = channels[0]?.name

  return (
    <div className="td-analytics-bar">
      <span className="td-analytics-label">Yesterday</span>
      <span className="td-analytics-num">{visits.toLocaleString()} visits</span>
      {delta !== null && (
        <span className={`td-analytics-delta ${delta >= 0 ? 'td-analytics-delta--up' : 'td-analytics-delta--dn'}`}>
          {delta >= 0 ? '+' : ''}{delta}%
        </span>
      )}
      {top && <span className="td-analytics-channel">via {top}</span>}
    </div>
  )
}

// ── Primary (first) action — large format ─────────────────────────────────────

function PrimaryAction({ card, onCta }: { card: ActionCard; onCta: () => void }) {
  const accent = TYPE_ACCENT[card.type] ?? TYPE_ACCENT.outreach
  const icon = TYPE_ICON[card.type]
  const platform = card.data?.platform as string | undefined

  return (
    <div className="td-primary" style={{ '--td-accent-bg': accent.bg, '--td-accent-line': accent.border } as React.CSSProperties}>
      <div className="td-primary-inner">
        <div className="td-primary-meta">
          <span className="td-primary-dot" style={{ background: accent.dot }} />
          <span className="td-primary-label">{accent.label}</span>
          <span className="td-primary-rank">Priority 1</span>
        </div>

        <div className="td-primary-icon-wrap">
          <div className="td-primary-icon" style={{ color: accent.dot }}>
            {icon}
          </div>
        </div>

        <h2 className="td-primary-headline">{card.headline}</h2>
        <p className="td-primary-reason">{card.reason}</p>

        <div className="td-primary-actions">
          <a href={card.ctaUrl} className="td-cta-btn" onClick={onCta}>
            {card.cta}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }}>
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
          {card.type === 'social' && platform && (
            <a href="/engagement-hub" className="td-ghost-btn">
              Open Engagement Hub
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Secondary action — compact card ──────────────────────────────────────────

function SecondaryAction({ card, rank, onCta }: { card: ActionCard; rank: number; onCta: () => void }) {
  const accent = TYPE_ACCENT[card.type] ?? TYPE_ACCENT.outreach
  const icon = TYPE_ICON[card.type]

  return (
    <div className="td-secondary">
      <div className="td-secondary-rank">{rank}</div>
      <div className="td-secondary-content">
        <div className="td-secondary-top">
          <span className="td-secondary-icon" style={{ color: accent.dot }}>{icon}</span>
          <div>
            <div className="td-secondary-headline">{card.headline}</div>
            <div className="td-secondary-reason">{card.reason}</div>
          </div>
        </div>
        <a href={card.ctaUrl} className="td-secondary-cta" onClick={onCta}>
          {card.cta} &rarr;
        </a>
      </div>
    </div>
  )
}

// ── All-good state ─────────────────────────────────────────────────────────────

function AllGoodState({ cachedAt, onRefresh, refreshing }: { cachedAt: string; onRefresh: () => void; refreshing: boolean }) {
  const time = cachedAt ? new Date(cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <div className="td-allgood">
      <div className="td-allgood-ring">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <p className="td-allgood-headline">All signals clear</p>
      <p className="td-allgood-sub">No action needed today.{time ? ` Checked at ${time}.` : ''}</p>
      <button className="td-ghost-btn" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? 'Checking...' : 'Refresh'}
      </button>
    </div>
  )
}

// ── Loading state ─────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="td-loading-state">
      <div className="td-loading-dots">
        <span /><span /><span />
      </div>
      <p>Reading your signals...</p>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TodayDashboard({ initialData }: Props) {
  const router = useRouter()
  const [cards, setCards] = useState<ActionCard[]>(initialData.cards)
  const [streak, setStreak] = useState(initialData.streak)
  const [allGood, setAllGood] = useState(initialData.allGood)
  const [cachedAt, setCachedAt] = useState(initialData.cachedAt)
  const [refreshing, setRefreshing] = useState(false)
  const [ready, setReady] = useState(initialData.cards.length > 0 || initialData.allGood)

  // Auto-fetch if cache stale
  useEffect(() => {
    const age = cachedAt ? Date.now() - new Date(cachedAt).getTime() : Infinity
    if (age >= 4 * 60 * 60 * 1000) fetchSignals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchSignals = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/today/signals')
      if (res.ok) {
        const d = await res.json()
        setCards(d.cards ?? [])
        setStreak(d.streak ?? 0)
        setAllGood(d.allGood ?? false)
        setCachedAt(d.cachedAt ?? '')
        setReady(true)
      }
    } catch { /* silent */ }
    setRefreshing(false)
  }, [])

  const markAction = useCallback(async () => {
    try {
      const res = await fetch('/api/today/mark-action', { method: 'POST' })
      if (res.ok) setStreak((await res.json()).streak ?? streak)
    } catch { /* silent */ }
  }, [streak])

  // Date string
  const now = new Date()
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dayLabel = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`

  const [primary, ...secondary] = cards

  return (
    <div className="td-root">
      {/* ── Nav ── */}
      <nav className="td-nav">
        <button className="td-nav-logo" onClick={() => router.push('/dashboard')}>
          <img src="/growjinlogo.svg" alt="" width={18} height={18} />
          <span>GrowJin</span>
        </button>
        <div className="td-nav-links">
          <a href="/dashboard" className="td-nav-link">Modules</a>
          <a href="/today" className="td-nav-link td-nav-link--on">Today</a>
          <a href="/settings" className="td-nav-icon" title="Settings">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
            </svg>
          </a>
        </div>
      </nav>

      {/* ── Hero strip ── */}
      <div className="td-hero">
        <div className="td-hero-left">
          <div className="td-hero-day">{dayLabel}</div>
          <div className="td-hero-tag">
            {ready && !allGood && cards.length > 0
              ? `${cards.length} thing${cards.length === 1 ? '' : 's'} need your attention`
              : ready && allGood
              ? 'You\'re all caught up'
              : 'Checking your signals...'}
          </div>
        </div>
        <div className="td-hero-right">
          <AnalyticsBar />
          {streak > 0 && (
            <div className="td-streak-pill">
              <span className="td-streak-num">{streak}</span>
              <span className="td-streak-txt">day streak</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="td-body">
        {!ready || (refreshing && cards.length === 0) ? (
          <LoadingState />
        ) : allGood && cards.length === 0 ? (
          <AllGoodState cachedAt={cachedAt} onRefresh={fetchSignals} refreshing={refreshing} />
        ) : (
          <>
            {/* Primary action — full width, large */}
            {primary && <PrimaryAction card={primary} onCta={markAction} />}

            {/* Secondary actions — side by side */}
            {secondary.length > 0 && (
              <div className="td-secondary-section">
                <div className="td-secondary-heading">Also today</div>
                <div className="td-secondary-grid">
                  {secondary.map((card, i) => (
                    <SecondaryAction key={card.id} card={card} rank={i + 2} onCta={markAction} />
                  ))}
                </div>
              </div>
            )}

            {/* Refresh link */}
            <button className="td-recheck" onClick={fetchSignals} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : `Last updated ${cachedAt ? new Date(cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'recently'} · Refresh`}
            </button>
          </>
        )}
      </div>

      <style>{`
        /* ── Color tokens ── */
        :root {
          --td-amber-bg:  rgba(217,119,6,.07);
          --td-amber-line: rgba(217,119,6,.2);
          --td-violet-bg:  rgba(124,58,237,.07);
          --td-violet-line: rgba(124,58,237,.2);
          --td-green-bg:  rgba(23,154,80,.07);
          --td-green-line: rgba(23,154,80,.2);
          --td-blue-bg:   rgba(2,132,199,.07);
          --td-blue-line: rgba(2,132,199,.2);
          --td-red-bg:    rgba(220,38,38,.07);
          --td-red-line:  rgba(220,38,38,.2);
        }

        /* ── Page shell ── */
        .td-root {
          min-height: 100vh;
          background: var(--bg);
          display: flex;
          flex-direction: column;
        }

        /* ── Nav ── */
        .td-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 32px;
          height: 54px;
          border-bottom: 1px solid var(--line);
          background: var(--card);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .td-nav-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 700;
          font-size: 15px;
          color: var(--text);
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          letter-spacing: -0.2px;
        }
        .td-nav-links {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .td-nav-link {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-dim);
          text-decoration: none;
          padding: 5px 12px;
          border-radius: 7px;
          transition: background 0.12s, color 0.12s;
        }
        .td-nav-link:hover { background: var(--bg-soft); color: var(--text); }
        .td-nav-link--on {
          background: var(--accent);
          color: var(--green);
          font-weight: 600;
        }
        .td-nav-icon {
          display: grid;
          place-items: center;
          width: 30px; height: 30px;
          color: var(--text-dim);
          border-radius: 7px;
          transition: background 0.12s, color 0.12s;
        }
        .td-nav-icon:hover { background: var(--bg-soft); color: var(--text); }

        /* ── Hero strip ── */
        .td-hero {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          padding: 36px 40px 0;
          max-width: 1000px;
          width: 100%;
          margin: 0 auto;
          box-sizing: border-box;
        }
        .td-hero-left {}
        .td-hero-day {
          font-family: var(--font-display, serif);
          font-size: 32px;
          font-weight: 700;
          color: var(--text);
          letter-spacing: -0.8px;
          line-height: 1;
        }
        .td-hero-tag {
          font-size: 14px;
          color: var(--text-dim);
          margin-top: 6px;
        }
        .td-hero-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
          padding-top: 4px;
        }

        /* ── Analytics bar (inline in hero) ── */
        .td-analytics-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-soft);
          border: 1px solid var(--line);
          border-radius: 99px;
          padding: 6px 14px;
          font-size: 13px;
          color: var(--text-dim);
        }
        .td-analytics-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-faint);
        }
        .td-analytics-num {
          font-weight: 700;
          color: var(--text);
        }
        .td-analytics-delta {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 99px;
        }
        .td-analytics-delta--up  { background: rgba(23,154,80,.12); color: var(--green); }
        .td-analytics-delta--dn  { background: rgba(220,38,38,.1);  color: #dc2626; }
        .td-analytics-channel { color: var(--text-faint); font-size: 12px; }

        /* ── Streak pill ── */
        .td-streak-pill {
          display: flex;
          align-items: center;
          gap: 5px;
          background: var(--bg-soft);
          border: 1px solid var(--line);
          border-radius: 99px;
          padding: 6px 14px;
        }
        .td-streak-num {
          font-size: 15px;
          font-weight: 700;
          color: var(--green);
        }
        .td-streak-txt {
          font-size: 12px;
          color: var(--text-dim);
        }

        /* ── Body ── */
        .td-body {
          max-width: 1000px;
          width: 100%;
          margin: 0 auto;
          padding: 28px 40px 80px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* ── Primary action ── */
        .td-primary {
          background: var(--td-accent-bg, var(--td-amber-bg));
          border: 1px solid var(--td-accent-line, var(--td-amber-line));
          border-radius: 20px;
          overflow: hidden;
        }
        .td-primary-inner {
          padding: 36px 40px;
        }
        .td-primary-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 20px;
        }
        .td-primary-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .td-primary-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--text-dim);
        }
        .td-primary-rank {
          margin-left: auto;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-faint);
          text-transform: uppercase;
          letter-spacing: 0.07em;
        }
        .td-primary-icon-wrap {
          margin-bottom: 14px;
        }
        .td-primary-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px; height: 44px;
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 12px;
        }
        .td-primary-headline {
          font-family: var(--font-display, serif);
          font-size: 26px;
          font-weight: 700;
          color: var(--text);
          letter-spacing: -0.5px;
          margin: 0 0 10px;
          line-height: 1.15;
        }
        .td-primary-reason {
          font-size: 14px;
          color: var(--text-dim);
          line-height: 1.6;
          max-width: 520px;
          margin: 0 0 28px;
        }
        .td-primary-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        /* ── CTA button ── */
        .td-cta-btn {
          display: inline-flex;
          align-items: center;
          font-size: 14px;
          font-weight: 600;
          padding: 11px 22px;
          border-radius: 10px;
          background: var(--green);
          color: #fff;
          border: none;
          text-decoration: none;
          cursor: pointer;
          transition: opacity 0.15s;
          letter-spacing: -0.1px;
        }
        .td-cta-btn:hover { opacity: 0.88; }

        /* ── Ghost button ── */
        .td-ghost-btn {
          display: inline-flex;
          align-items: center;
          font-size: 13px;
          font-weight: 500;
          padding: 10px 18px;
          border-radius: 10px;
          background: var(--card);
          color: var(--text-dim);
          border: 1px solid var(--line);
          text-decoration: none;
          cursor: pointer;
          transition: background 0.12s, border-color 0.12s, color 0.12s;
        }
        .td-ghost-btn:hover {
          background: var(--bg-soft);
          border-color: var(--green);
          color: var(--text);
        }
        .td-ghost-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Secondary section ── */
        .td-secondary-section {}
        .td-secondary-heading {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--text-faint);
          margin-bottom: 12px;
        }
        .td-secondary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 14px;
        }
        .td-secondary {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 22px 24px;
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }
        .td-secondary-rank {
          width: 26px; height: 26px;
          border-radius: 7px;
          background: var(--bg-soft);
          border: 1px solid var(--line);
          display: grid;
          place-items: center;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-faint);
          flex-shrink: 0;
          margin-top: 1px;
        }
        .td-secondary-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .td-secondary-top {
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .td-secondary-icon {
          flex-shrink: 0;
          margin-top: 1px;
          display: flex;
        }
        .td-secondary-headline {
          font-size: 14px;
          font-weight: 600;
          color: var(--text);
          margin-bottom: 3px;
          line-height: 1.3;
        }
        .td-secondary-reason {
          font-size: 12px;
          color: var(--text-dim);
          line-height: 1.5;
        }
        .td-secondary-cta {
          font-size: 12px;
          font-weight: 600;
          color: var(--green);
          text-decoration: none;
          padding: 6px 12px;
          border: 1px solid var(--line);
          border-radius: 7px;
          background: var(--bg-soft);
          display: inline-flex;
          align-items: center;
          width: fit-content;
          transition: background 0.12s, border-color 0.12s;
        }
        .td-secondary-cta:hover {
          background: var(--accent);
          border-color: var(--green);
        }

        /* ── All good state ── */
        .td-allgood {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 80px 40px;
          gap: 14px;
        }
        .td-allgood-ring {
          width: 60px; height: 60px;
          border-radius: 50%;
          border: 2px solid var(--green);
          display: grid;
          place-items: center;
          color: var(--green);
          margin-bottom: 6px;
        }
        .td-allgood-headline {
          font-family: var(--font-display, serif);
          font-size: 22px;
          font-weight: 700;
          color: var(--text);
          letter-spacing: -0.3px;
          margin: 0;
        }
        .td-allgood-sub {
          font-size: 14px;
          color: var(--text-dim);
          margin: 0;
        }

        /* ── Loading ── */
        .td-loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          padding: 80px 40px;
          color: var(--text-dim);
          font-size: 14px;
        }
        .td-loading-dots {
          display: flex;
          gap: 6px;
        }
        .td-loading-dots span {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--text-faint);
          animation: td-pulse 1.2s ease-in-out infinite;
        }
        .td-loading-dots span:nth-child(2) { animation-delay: 0.2s; }
        .td-loading-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes td-pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40%            { opacity: 1;   transform: scale(1); }
        }

        /* ── Recheck link ── */
        .td-recheck {
          font-size: 12px;
          color: var(--text-faint);
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          text-align: left;
        }
        .td-recheck:hover { color: var(--text-dim); }
        .td-recheck:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Light mode overrides ── */
        html.light .td-nav-link--on { background: #d0eadb; color: #179a50; }
        html.light .td-analytics-delta--up { background: #d0eadb; color: #179a50; }
        html.light .td-cta-btn { background: #179a50; }
        html.light .td-streak-num { color: #179a50; }
        html.light .td-secondary-cta { color: #179a50; }
        html.light .td-allgood-ring { border-color: #179a50; color: #179a50; }

        /* ── Responsive ── */
        @media (max-width: 680px) {
          .td-hero { flex-direction: column; gap: 16px; padding: 24px 20px 0; }
          .td-hero-day { font-size: 24px; }
          .td-body { padding: 20px 20px 60px; }
          .td-primary-inner { padding: 24px 22px; }
          .td-primary-headline { font-size: 20px; }
          .td-secondary-grid { grid-template-columns: 1fr; }
          .td-nav { padding: 0 16px; }
          .td-hero-right { flex-wrap: wrap; }
        }
      `}</style>
    </div>
  )
}
