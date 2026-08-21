'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import GmailOutreachProspects from '@/components/GmailOutreachProspects'
import FrektoPostingSection from '@/components/FrektoPostingSection'
import type { ActionCard, ImpactCard } from '@/lib/daily/signals'
import type { PlatformStats } from '@/app/api/social/analytics/route'
import type { DBItemFull } from '@/lib/modules/types'

interface TrafficData {
  visits: number
  visitsPrior: number
  channels: { name: string; sessions: number }[]
}

interface RecentPost {
  platform: string
  topic: string
  status: string
  scheduledAt: string
}

interface Props {
  initialData: {
    cards: ActionCard[]
    impacts: ImpactCard[]
    streak: number
    allGood: boolean
    cachedAt: string
  }
  brandName: string
  gmailConnected: boolean
  gmailAddress: string | null
  prospectItems: DBItemFull[]
  gmailModuleId: string | null
  socialModuleId: string | null
  frektoConnected: boolean
}

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; dot: string; border: string }> = {
  outreach:      { label: 'Traffic signal',  dot: '#d97706', border: '#d97706' },
  social:        { label: 'Social signal',   dot: '#7c3aed', border: '#7c3aed' },
  seo:           { label: 'SEO signal',      dot: '#179a50', border: '#179a50' },
  content:       { label: 'Content signal',  dot: '#0284c7', border: '#0284c7' },
  'module-item': { label: 'Open item',       dot: '#dc2626', border: '#dc2626' },
}

const TYPE_WHY: Record<string, string> = {
  outreach:      'Visitors who leave without converting need a nudge. A well-timed email puts you back in front of people who already showed interest.',
  social:        'Gaps longer than 5 days cause the algorithm to deprioritise your account. Consistency beats perfection.',
  seo:           'Keyword positions drop fast when competitors update their pages. Catching this early is much cheaper than recovering lost rankings.',
  content:       'Stale or thin pages drag down your whole domain authority. Refreshing them signals freshness to Google.',
  'module-item': 'High-weight items have the biggest impact on your growth score. Completing them unlocks the next module.',
}

const IMPACT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  'keyword-gain':   { label: 'SEO',     color: '#179a50', bg: 'rgba(23,154,80,.1)' },
  'traffic-growth': { label: 'Traffic', color: '#0284c7', bg: 'rgba(2,132,199,.1)' },
  'social-traffic': { label: 'Social',  color: '#7c3aed', bg: 'rgba(124,58,237,.1)' },
}

const IMPACT_WHY: Record<string, string> = {
  'keyword-gain':   'Your recent SEO changes are paying off. Keep optimising to hold this momentum before competitors catch up.',
  'traffic-growth': 'More visitors means more chances to convert. Check which channel drove the spike and double down on it.',
  'social-traffic': 'Your post drove measurable traffic. Post consistently to repeat this effect.',
}

const PLATFORM_COLOR: Record<string, string> = {
  instagram: '#e1306c',
  facebook:  '#1877f2',
  linkedin:  '#0a66c2',
  twitter:   '#1da1f2',
  tiktok:    '#010101',
  youtube:   '#ff0000',
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

function IconMail() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
}
function IconSocial() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM7 9a3 3 0 1 1 0 6A3 3 0 0 1 7 9Zm10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/><path d="m14 10.7-5 2.6M14 13.3 9 10.7"/></svg>
}
function IconSearch() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
}
function IconDoc() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
}
function IconCheck() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  outreach:      <IconMail />,
  social:        <IconSocial />,
  seo:           <IconSearch />,
  content:       <IconDoc />,
  'module-item': <IconCheck />,
}

// ── Analytics bar ─────────────────────────────────────────────────────────────

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

// which card types expand inline vs navigate away
const INLINE_TYPES: Set<string> = new Set(['outreach', 'social'])

// ── Action card ───────────────────────────────────────────────────────────────

function ActionCardItem({ card, rank, onCta, expanded, onToggleExpand }: {
  card: ActionCard
  rank: number
  onCta: () => void
  expanded: boolean
  onToggleExpand: () => void
}) {
  const cfg = TYPE_CONFIG[card.type] ?? TYPE_CONFIG.outreach
  const icon = TYPE_ICON[card.type]
  const isInline = INLINE_TYPES.has(card.type)

  return (
    <div className="td-card" style={{ '--td-card-border': cfg.border } as React.CSSProperties}>
      <div className="td-card-header">
        <div className="td-card-label">
          <span className="td-card-icon" style={{ color: cfg.dot }}>{icon}</span>
          <span className="td-card-type">{cfg.label}</span>
        </div>
        <span className="td-card-rank">#{rank}</span>
      </div>

      <h3 className="td-card-headline">{card.headline}</h3>
      <p className="td-card-reason">{card.reason}</p>

      {TYPE_WHY[card.type] && (
        <div className="td-card-why">
          <span className="td-why-label">Why this matters</span>
          {TYPE_WHY[card.type]}
        </div>
      )}

      {isInline ? (
        <button className="td-cta-btn" onClick={() => { onCta(); onToggleExpand() }}>
          {expanded ? 'Close' : card.type === 'outreach' ? 'Write outreach emails' : 'Create a post'}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 5, transform: expanded ? 'rotate(180deg)' : 'none' }}>
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      ) : (
        <a href={card.ctaUrl} className="td-cta-btn" onClick={onCta}>
          {card.cta}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 5 }}>
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </a>
      )}
    </div>
  )
}

// ── Impact card ───────────────────────────────────────────────────────────────

function ImpactCardItem({ card }: { card: ImpactCard }) {
  const cfg = IMPACT_CONFIG[card.type] ?? IMPACT_CONFIG['traffic-growth']

  return (
    <div className="td-impact-card">
      <div className="td-impact-badge" style={{ background: cfg.bg, color: cfg.color }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7"/>
        </svg>
        {cfg.label}
      </div>
      <div className="td-impact-headline">{card.headline}</div>
      <div className="td-impact-detail" style={{ color: cfg.color }}>{card.detail}</div>
      {IMPACT_WHY[card.type] && (
        <div className="td-impact-why">{IMPACT_WHY[card.type]}</div>
      )}
    </div>
  )
}

// ── Social feed ───────────────────────────────────────────────────────────────

function SocialFeed({ posts }: { posts: RecentPost[] }) {
  if (posts.length === 0) return null
  return (
    <div className="td-social-feed">
      <div className="td-section-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM7 9a3 3 0 1 1 0 6A3 3 0 0 1 7 9Zm10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/>
          <path d="m14 10.7-5 2.6M14 13.3 9 10.7"/>
        </svg>
        Recent Posts
      </div>
      <div className="td-feed-list">
        {posts.map((post, i) => {
          const color = PLATFORM_COLOR[post.platform] ?? '#888'
          const date = new Date(post.scheduledAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
          const label = post.platform.charAt(0).toUpperCase() + post.platform.slice(1)
          return (
            <div key={i} className="td-feed-row">
              <span className="td-feed-platform" style={{ background: color + '18', color }}>
                {label}
              </span>
              <span className="td-feed-topic">{post.topic}</span>
              <span className="td-feed-date">{date}</span>
              <span className={`td-feed-status td-feed-status--${post.status}`}>
                {post.status === 'done' ? 'Published' : post.status === 'failed' ? 'Failed' : 'Scheduled'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Social analytics ──────────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, { bg: string; color: string }> = {
  instagram: { bg: '#e1306c18', color: '#e1306c' },
  facebook:  { bg: '#1877f218', color: '#1877f2' },
  linkedin:  { bg: '#0a66c218', color: '#0a66c2' },
  pinterest: { bg: '#e6000018', color: '#e60023' },
}

// which OAuth provider to connect for each platform
const PLATFORM_CONNECT: Record<string, string> = {
  instagram: 'instagram_oauth',
  facebook:  'meta_oauth',
  linkedin:  'linkedin_oauth',
  pinterest: 'pinterest_oauth',
}

function fmt(n?: number) {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

function StatPill({ label, value }: { label: string; value?: number }) {
  return (
    <div className="td-stat-pill">
      <span className="td-stat-val">{fmt(value)}</span>
      <span className="td-stat-label">{label}</span>
    </div>
  )
}

function PlatformCard({ p }: { p: PlatformStats }) {
  const c = PLATFORM_COLORS[p.provider] ?? { bg: '#88888818', color: '#888' }
  const connectProvider = PLATFORM_CONNECT[p.provider]

  if (!p.connected) {
    return (
      <div className="td-platform-card td-platform-card--dim">
        <div className="td-platform-header">
          <div className="td-platform-name-wrap">
            <span className="td-platform-dot" style={{ background: c.color, opacity: 0.4 }} />
            <span className="td-platform-name" style={{ opacity: 0.5 }}>{p.name}</span>
          </div>
          {connectProvider && (
            <a href={`/api/connect/${connectProvider}?return_to=/today`} className="td-connect-btn" style={{ borderColor: c.color, color: c.color }}>
              Connect
            </a>
          )}
        </div>
        <p className="td-platform-not-connected">Not connected — connect to see analytics here.</p>
      </div>
    )
  }

  return (
    <div className="td-platform-card">
      <div className="td-platform-header">
        <div className="td-platform-name-wrap">
          <span className="td-platform-dot" style={{ background: c.color }} />
          <span className="td-platform-name">{p.name}</span>
          {p.handle && <span className="td-platform-handle">{p.handle}</span>}
        </div>
        {p.followers != null && (
          <div className="td-platform-followers" style={{ color: c.color, background: c.bg }}>
            {fmt(p.followers)} followers
          </div>
        )}
      </div>

      {p.error && !p.impressions7d && !p.reach7d && !p.engagements7d ? (
        <p className="td-platform-error">{p.error}</p>
      ) : (
        <>
          <div className="td-platform-stats">
            {p.impressions7d != null && <StatPill label="Impressions (7d)" value={p.impressions7d} />}
            {p.reach7d       != null && <StatPill label="Reach (7d)"       value={p.reach7d} />}
            {p.engagements7d != null && <StatPill label="Engagements (7d)" value={p.engagements7d} />}
            {p.saves7d       != null && <StatPill label="Saves (7d)"       value={p.saves7d} />}
            {p.clicks7d      != null && <StatPill label="Pin Clicks (7d)"  value={p.clicks7d} />}
          </div>

          {p.recentPosts && p.recentPosts.length > 0 && (
            <div className="td-platform-posts">
              <div className="td-platform-posts-label">Recent posts</div>
              {p.recentPosts.map((post, i) => (
                <div key={i} className="td-platform-post-row">
                  <span className="td-post-caption">{post.caption || '(no caption)'}</span>
                  <span className="td-post-meta">{post.likes} likes · {post.comments} comments · {post.date}</span>
                </div>
              ))}
            </div>
          )}

          {p.error && (
            <p className="td-platform-error td-platform-error--soft">{p.error}</p>
          )}
        </>
      )}
    </div>
  )
}

function SocialAnalytics() {
  const [platforms, setPlatforms] = useState<PlatformStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/social/analytics')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.platforms) setPlatforms(d.platforms) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (!loading && platforms.length === 0) return null

  return (
    <div className="td-social-analytics">
      <div className="td-section-label td-section-label--gap">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 11v6M12 8v9M17 14v3"/>
        </svg>
        Social Analytics
      </div>

      {loading ? (
        <div className="td-social-loading">
          <div className="td-loading-dots"><span /><span /><span /></div>
        </div>
      ) : (
        <div className="td-platform-list">
          {platforms.map(p => <PlatformCard key={p.provider} p={p} />)}
        </div>
      )}
    </div>
  )
}

// ── States ────────────────────────────────────────────────────────────────────

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

function LoadingState() {
  return (
    <div className="td-loading-state">
      <div className="td-loading-dots"><span /><span /><span /></div>
      <p>Reading your signals...</p>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TodayDashboard({ initialData, brandName, gmailConnected, gmailAddress, prospectItems, gmailModuleId, socialModuleId, frektoConnected }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  const runOutreachAnalysis = useCallback(async () => {
    if (!gmailModuleId || analyzing) return
    setAnalyzing(true)
    try {
      await fetch('/api/modules/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId: gmailModuleId }),
      })
      router.refresh()
    } catch { /* silent */ }
    setAnalyzing(false)
  }, [gmailModuleId, analyzing, router])
  const [cards, setCards] = useState<ActionCard[]>(initialData.cards)
  const [impacts, setImpacts] = useState<ImpactCard[]>(initialData.impacts ?? [])
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([])
  const [streak, setStreak] = useState(initialData.streak)
  const [allGood, setAllGood] = useState(initialData.allGood)
  const [cachedAt, setCachedAt] = useState(initialData.cachedAt)
  const [refreshing, setRefreshing] = useState(false)
  const [ready, setReady] = useState(initialData.cards.length > 0 || initialData.allGood)
  const [oauthBanner, setOauthBanner] = useState<string | null>(null)

  useEffect(() => {
    const connected = searchParams.get('oauth_connected')
    const label = searchParams.get('label')
    const error = searchParams.get('oauth_error')
    if (connected) {
      setOauthBanner(label ? `${label} connected successfully.` : 'Account connected.')
      // strip params from URL without reload
      const url = new URL(window.location.href)
      url.searchParams.delete('oauth_connected')
      url.searchParams.delete('label')
      window.history.replaceState({}, '', url.toString())
      // refresh signals to pick up new platform data
      setTimeout(() => fetchSignals(), 500)
    } else if (error) {
      setOauthBanner(`Connection failed: ${error}`)
      const url = new URL(window.location.href)
      url.searchParams.delete('oauth_error')
      window.history.replaceState({}, '', url.toString())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        setImpacts(d.impacts ?? [])
        setRecentPosts(d.recentPosts ?? [])
        setStreak(d.streak ?? 0)
        setAllGood(d.allGood ?? false)
        setCachedAt(d.cachedAt ?? '')
      }
    } catch { /* silent */ }
    setReady(true)
    setRefreshing(false)
  }, [])

  const markAction = useCallback(async () => {
    try {
      const res = await fetch('/api/today/mark-action', { method: 'POST' })
      if (res.ok) setStreak((await res.json()).streak ?? streak)
    } catch { /* silent */ }
  }, [streak])

  const now = new Date()
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dayLabel = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`

  return (
    <div className="td-root">
      {/* OAuth result banner */}
      {oauthBanner && (
        <div className={`td-oauth-banner ${oauthBanner.startsWith('Connection failed') ? 'td-oauth-banner--error' : 'td-oauth-banner--ok'}`}>
          <span>{oauthBanner}</span>
          <button className="td-oauth-banner-close" onClick={() => setOauthBanner(null)}>✕</button>
        </div>
      )}

      {/* Nav */}
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

      {/* Hero */}
      <div className="td-hero">
        <div className="td-hero-left">
          <div className="td-hero-day">{dayLabel}</div>
          <div className="td-hero-tag">
            {ready && !allGood && cards.length > 0
              ? `${cards.length} thing${cards.length === 1 ? '' : 's'} need your attention`
              : ready && allGood ? 'You\'re all caught up'
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

      {/* Body */}
      <div className="td-body">
        {!ready || (refreshing && cards.length === 0) ? (
          <LoadingState />
        ) : allGood && cards.length === 0 ? (
          <>
            <AllGoodState cachedAt={cachedAt} onRefresh={fetchSignals} refreshing={refreshing} />
            {impacts.length > 0 && (
              <>
                <div className="td-section-label">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
                  </svg>
                  What&apos;s working
                </div>
                {impacts.map(c => <ImpactCardItem key={c.id} card={c} />)}
              </>
            )}
            <SocialAnalytics />
            <SocialFeed posts={recentPosts} />
          </>
        ) : (
          <>
            {/* Action cards */}
            <div className="td-section-label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Actions for today
            </div>
            {cards.map((card, i) => (
              <div key={card.id}>
                <ActionCardItem
                  card={card}
                  rank={i + 1}
                  onCta={markAction}
                  expanded={expandedCard === card.id}
                  onToggleExpand={() => setExpandedCard(expandedCard === card.id ? null : card.id)}
                />
                {/* Inline outreach panel */}
                {card.type === 'outreach' && expandedCard === card.id && (
                  <div className="td-inline-panel">
                    <div className="td-inline-panel-header">
                      <span className="td-inline-panel-title">
                        {prospectItems.length > 0
                          ? `Email Outreach — ${prospectItems.length} prospect${prospectItems.length !== 1 ? 's' : ''}`
                          : 'Email Outreach'}
                      </span>
                      <button className="td-inline-panel-close" onClick={() => setExpandedCard(null)}>×</button>
                    </div>
                    {prospectItems.length === 0 ? (
                      <div className="td-inline-analyze">
                        <p className="td-inline-analyze-msg">No prospects identified yet.</p>
                        <button
                          className="td-inline-analyze-btn"
                          onClick={runOutreachAnalysis}
                          disabled={analyzing}
                        >
                          {analyzing ? 'Finding prospects…' : 'Find prospects now'}
                        </button>
                      </div>
                    ) : (
                      <GmailOutreachProspects items={prospectItems} gmailConnected={gmailConnected} />
                    )}
                  </div>
                )}

                {/* Inline social post panel */}
                {card.type === 'social' && expandedCard === card.id && (
                  <div className="td-inline-panel">
                    <div className="td-inline-panel-header">
                      <span className="td-inline-panel-title">Generate Social Post</span>
                      <button className="td-inline-panel-close" onClick={() => setExpandedCard(null)}>×</button>
                    </div>
                    {socialModuleId ? (
                      <FrektoPostingSection
                        moduleId={socialModuleId}
                        brandName={brandName}
                        connected={frektoConnected}
                      />
                    ) : (
                      <div className="td-inline-analyze">
                        <p className="td-inline-analyze-msg">Complete the Social Media module first to unlock post generation.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Impact cards */}
            {impacts.length > 0 && (
              <>
                <div className="td-section-label td-section-label--gap">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
                  </svg>
                  What&apos;s working
                </div>
                {impacts.map(c => <ImpactCardItem key={c.id} card={c} />)}
              </>
            )}

            {/* Social analytics + post feed */}
            <SocialAnalytics />
            <SocialFeed posts={recentPosts} />

            <button className="td-recheck" onClick={fetchSignals} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : `Last updated ${cachedAt ? new Date(cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'recently'} · Refresh`}
            </button>
          </>
        )}
      </div>

      <style>{`
        /* tokens */
        :root {
          --td-amber-bg:   rgba(217,119,6,.07);
          --td-amber-line: rgba(217,119,6,.25);
          --td-violet-bg:  rgba(124,58,237,.07);
          --td-violet-line:rgba(124,58,237,.25);
          --td-green-bg:   rgba(23,154,80,.07);
          --td-green-line: rgba(23,154,80,.25);
          --td-blue-bg:    rgba(2,132,199,.07);
          --td-blue-line:  rgba(2,132,199,.25);
          --td-red-bg:     rgba(220,38,38,.07);
          --td-red-line:   rgba(220,38,38,.25);
        }

        /* shell */
        .td-root { min-height: 100vh; background: var(--bg); display: flex; flex-direction: column; }

        /* inline panel */
        .td-inline-panel {
          border: 1px solid var(--line); border-radius: 14px;
          background: var(--card); overflow: hidden;
          margin-bottom: 12px;
        }
        .td-inline-panel-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 20px; border-bottom: 1px solid var(--line);
          background: var(--bg-soft);
        }
        .td-inline-panel-title {
          font-size: 13px; font-weight: 600; color: var(--text);
        }
        .td-inline-panel-close {
          background: none; border: none; cursor: pointer;
          color: var(--text-faint); font-size: 18px; line-height: 1;
          padding: 0 2px;
        }
        .td-inline-panel-close:hover { color: var(--text); }
        .td-inline-analyze {
          padding: 32px 24px; display: flex; flex-direction: column; align-items: center; gap: 14px;
        }
        .td-inline-analyze-msg { font-size: 14px; color: var(--text-dim); margin: 0; }
        .td-inline-analyze-btn {
          background: var(--green); color: #fff; border: none; cursor: pointer;
          padding: 9px 20px; border-radius: 9px; font-size: 13px; font-weight: 600;
          font-family: var(--font-body);
        }
        .td-inline-analyze-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        /* oauth banner */
        .td-oauth-banner {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 24px; font-size: 13px; font-weight: 500;
          border-bottom: 1px solid var(--line);
        }
        .td-oauth-banner--ok { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
        .td-oauth-banner--error { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
        .td-oauth-banner-close {
          background: none; border: none; cursor: pointer; font-size: 14px;
          color: inherit; opacity: 0.6; padding: 0 4px;
        }
        .td-oauth-banner-close:hover { opacity: 1; }

        /* nav */
        .td-nav {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 32px; height: 54px;
          border-bottom: 1px solid var(--line); background: var(--card);
          position: sticky; top: 0; z-index: 10;
        }
        .td-nav-logo {
          display: flex; align-items: center; gap: 8px;
          font-weight: 700; font-size: 15px; color: var(--text);
          background: none; border: none; cursor: pointer; padding: 0;
        }
        .td-nav-links { display: flex; align-items: center; gap: 4px; }
        .td-nav-link {
          font-size: 13px; font-weight: 500; color: var(--text-dim);
          text-decoration: none; padding: 5px 12px; border-radius: 7px;
          transition: background .12s, color .12s;
        }
        .td-nav-link:hover { background: var(--bg-soft); color: var(--text); }
        .td-nav-link--on { background: var(--accent); color: var(--green); font-weight: 600; }
        .td-nav-icon {
          display: grid; place-items: center; width: 30px; height: 30px;
          color: var(--text-dim); border-radius: 7px; transition: background .12s, color .12s;
        }
        .td-nav-icon:hover { background: var(--bg-soft); color: var(--text); }

        /* hero */
        .td-hero {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
          padding: 36px 40px 0; max-width: 780px; width: 100%; margin: 0 auto; box-sizing: border-box;
        }
        .td-hero-day {
          font-family: var(--font-display, serif); font-size: 30px; font-weight: 700;
          color: var(--text); letter-spacing: -0.6px; line-height: 1;
        }
        .td-hero-tag { font-size: 14px; color: var(--text-dim); margin-top: 6px; }
        .td-hero-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; padding-top: 4px; }

        /* analytics bar */
        .td-analytics-bar {
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-soft); border: 1px solid var(--line);
          border-radius: 99px; padding: 6px 14px; font-size: 13px; color: var(--text-dim);
        }
        .td-analytics-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-faint); }
        .td-analytics-num { font-weight: 700; color: var(--text); }
        .td-analytics-delta { font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 99px; }
        .td-analytics-delta--up { background: rgba(23,154,80,.12); color: var(--green); }
        .td-analytics-delta--dn { background: rgba(220,38,38,.1); color: #dc2626; }
        .td-analytics-channel { color: var(--text-faint); font-size: 12px; }

        /* streak */
        .td-streak-pill {
          display: flex; align-items: center; gap: 5px;
          background: var(--bg-soft); border: 1px solid var(--line);
          border-radius: 99px; padding: 6px 14px;
        }
        .td-streak-num { font-size: 15px; font-weight: 700; color: var(--green); }
        .td-streak-txt { font-size: 12px; color: var(--text-dim); }

        /* body */
        .td-body {
          max-width: 780px; width: 100%; margin: 0 auto;
          padding: 24px 40px 80px; box-sizing: border-box;
          display: flex; flex-direction: column; gap: 14px;
        }

        /* section label */
        .td-section-label {
          display: flex; align-items: center; gap: 7px;
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .1em; color: var(--text-faint);
          margin-bottom: 2px;
        }
        .td-section-label--gap { margin-top: 12px; }

        /* action card */
        .td-card {
          background: var(--card);
          border: 1px solid var(--line);
          border-left: 3px solid var(--td-card-border, var(--line));
          border-radius: 14px;
          padding: 22px 24px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .td-card-header {
          display: flex; align-items: center; justify-content: space-between;
        }
        .td-card-label { display: flex; align-items: center; gap: 8px; }
        .td-card-icon { display: flex; flex-shrink: 0; }
        .td-card-type {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .08em; color: var(--text-dim);
        }
        .td-card-rank {
          font-size: 11px; font-weight: 600; color: var(--text-faint);
          letter-spacing: .05em;
        }
        .td-card-headline {
          font-family: var(--font-display, serif);
          font-size: 20px; font-weight: 700; color: var(--text);
          letter-spacing: -0.3px; margin: 0; line-height: 1.2;
        }
        .td-card-reason {
          font-size: 13px; color: var(--text-dim); line-height: 1.6; margin: 0;
        }
        .td-card-why {
          font-size: 12px; color: var(--text-dim); line-height: 1.65;
          padding: 10px 14px; background: var(--bg-soft);
          border-radius: 8px; border-left: 2px solid var(--line);
        }
        .td-why-label {
          display: block; font-size: 10px; font-weight: 700;
          text-transform: uppercase; letter-spacing: .1em;
          color: var(--text-faint); margin-bottom: 3px;
        }

        /* CTA button */
        .td-cta-btn {
          display: inline-flex; align-items: center; align-self: flex-start;
          font-size: 13px; font-weight: 600; padding: 9px 18px;
          border-radius: 9px; background: var(--green); color: #fff;
          border: none; text-decoration: none; cursor: pointer;
          transition: opacity .15s; margin-top: 4px;
        }
        .td-cta-btn:hover { opacity: .88; }

        /* ghost button */
        .td-ghost-btn {
          display: inline-flex; align-items: center;
          font-size: 13px; font-weight: 500; padding: 9px 18px;
          border-radius: 9px; background: var(--card); color: var(--text-dim);
          border: 1px solid var(--line); text-decoration: none; cursor: pointer;
          transition: background .12s, border-color .12s, color .12s;
        }
        .td-ghost-btn:hover { background: var(--bg-soft); border-color: var(--green); color: var(--text); }
        .td-ghost-btn:disabled { opacity: .5; cursor: not-allowed; }

        /* impact card */
        .td-impact-card {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 14px; padding: 20px 24px;
          display: flex; flex-direction: column; gap: 6px;
        }
        .td-impact-badge {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .07em; padding: 3px 10px 3px 8px; border-radius: 99px;
          align-self: flex-start;
        }
        .td-impact-headline {
          font-family: var(--font-display, serif);
          font-size: 18px; font-weight: 700; color: var(--text);
          letter-spacing: -0.3px; line-height: 1.2;
        }
        .td-impact-detail { font-size: 14px; font-weight: 600; line-height: 1.4; }
        .td-impact-why {
          font-size: 12px; color: var(--text-faint); line-height: 1.6;
          margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--line);
        }

        /* social feed */
        .td-social-feed {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 14px; padding: 20px 24px;
          display: flex; flex-direction: column; gap: 14px;
          margin-top: 6px;
        }
        .td-feed-list { display: flex; flex-direction: column; gap: 10px; }
        .td-feed-row {
          display: flex; align-items: center; gap: 12px;
          font-size: 13px;
        }
        .td-feed-platform {
          font-size: 11px; font-weight: 700; padding: 3px 9px;
          border-radius: 99px; flex-shrink: 0; text-transform: capitalize;
        }
        .td-feed-topic {
          flex: 1; color: var(--text); overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .td-feed-date { color: var(--text-faint); font-size: 12px; flex-shrink: 0; }
        .td-feed-status {
          font-size: 11px; font-weight: 600; flex-shrink: 0;
          padding: 2px 8px; border-radius: 99px;
        }
        .td-feed-status--done      { background: rgba(23,154,80,.1);  color: #179a50; }
        .td-feed-status--scheduled { background: rgba(2,132,199,.1);  color: #0284c7; }
        .td-feed-status--failed    { background: rgba(220,38,38,.1);  color: #dc2626; }

        /* all good */
        .td-allgood {
          display: flex; flex-direction: column; align-items: center;
          text-align: center; padding: 60px 40px; gap: 12px;
        }
        .td-allgood-ring {
          width: 56px; height: 56px; border-radius: 50%;
          border: 2px solid var(--green); display: grid; place-items: center;
          color: var(--green); margin-bottom: 4px;
        }
        .td-allgood-headline {
          font-family: var(--font-display, serif); font-size: 20px; font-weight: 700;
          color: var(--text); letter-spacing: -0.3px; margin: 0;
        }
        .td-allgood-sub { font-size: 13px; color: var(--text-dim); margin: 0; }

        /* loading */
        .td-loading-state {
          display: flex; flex-direction: column; align-items: center;
          gap: 14px; padding: 80px 40px; color: var(--text-dim); font-size: 14px;
        }
        .td-loading-dots { display: flex; gap: 6px; }
        .td-loading-dots span {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--text-faint); animation: td-pulse 1.2s ease-in-out infinite;
        }
        .td-loading-dots span:nth-child(2) { animation-delay: .2s; }
        .td-loading-dots span:nth-child(3) { animation-delay: .4s; }
        @keyframes td-pulse {
          0%, 80%, 100% { opacity: .3; transform: scale(.8); }
          40%            { opacity: 1;  transform: scale(1); }
        }

        /* recheck */
        .td-recheck {
          font-size: 12px; color: var(--text-faint);
          background: none; border: none; cursor: pointer; padding: 0; text-align: left;
        }
        .td-recheck:hover { color: var(--text-dim); }
        .td-recheck:disabled { opacity: .5; cursor: not-allowed; }

        /* social analytics */
        .td-social-analytics { display: flex; flex-direction: column; gap: 12px; }
        .td-social-loading {
          display: flex; justify-content: center; padding: 24px;
        }
        .td-platform-list { display: flex; flex-direction: column; gap: 12px; }
        .td-platform-card {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 14px; padding: 20px 24px;
          display: flex; flex-direction: column; gap: 14px;
        }
        .td-platform-header {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
        }
        .td-platform-name-wrap { display: flex; align-items: center; gap: 8px; }
        .td-platform-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
        .td-platform-name { font-size: 14px; font-weight: 700; color: var(--text); }
        .td-platform-handle { font-size: 12px; color: var(--text-faint); }
        .td-platform-followers {
          font-size: 12px; font-weight: 600; padding: 4px 10px;
          border-radius: 99px; flex-shrink: 0;
        }
        .td-platform-stats {
          display: flex; flex-wrap: wrap; gap: 10px;
        }
        .td-stat-pill {
          background: var(--bg-soft); border: 1px solid var(--line);
          border-radius: 10px; padding: 10px 14px;
          display: flex; flex-direction: column; gap: 2px;
          min-width: 110px;
        }
        .td-stat-val { font-size: 18px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
        .td-stat-label { font-size: 11px; color: var(--text-faint); }
        .td-platform-posts { display: flex; flex-direction: column; gap: 8px; }
        .td-platform-posts-label {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: .08em; color: var(--text-faint);
        }
        .td-platform-post-row {
          display: flex; flex-direction: column; gap: 2px;
          padding: 10px 12px; background: var(--bg-soft);
          border-radius: 9px; border: 1px solid var(--line);
        }
        .td-post-caption {
          font-size: 13px; color: var(--text);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .td-post-meta { font-size: 11px; color: var(--text-faint); }
        .td-platform-error {
          font-size: 12px; color: var(--text-faint); margin: 0;
        }
        .td-platform-error--soft { margin-top: -4px; }
        .td-platform-card--dim { opacity: 0.75; }
        .td-platform-not-connected {
          font-size: 12px; color: var(--text-faint); margin: 0;
        }
        .td-connect-btn {
          font-size: 12px; font-weight: 600;
          padding: 4px 12px; border-radius: 7px;
          border: 1px solid; background: transparent;
          text-decoration: none; cursor: pointer;
          transition: opacity .15s;
          flex-shrink: 0;
        }
        .td-connect-btn:hover { opacity: .75; }

        /* light overrides */
        html.light .td-nav-link--on { background: #d0eadb; color: #179a50; }
        html.light .td-analytics-delta--up { background: #d0eadb; color: #179a50; }
        html.light .td-cta-btn { background: #179a50; }
        html.light .td-streak-num { color: #179a50; }
        html.light .td-allgood-ring { border-color: #179a50; color: #179a50; }
        html.light .td-section-label { color: #7aaa8a; }
        html.light .td-feed-status--done { background: #d0eadb; color: #179a50; }

        /* responsive */
        @media (max-width: 640px) {
          .td-hero { flex-direction: column; gap: 14px; padding: 24px 20px 0; }
          .td-hero-day { font-size: 24px; }
          .td-body { padding: 18px 20px 60px; }
          .td-nav { padding: 0 16px; }
          .td-hero-right { flex-wrap: wrap; }
          .td-feed-row { flex-wrap: wrap; gap: 6px; }
        }
      `}</style>
    </div>
  )
}
