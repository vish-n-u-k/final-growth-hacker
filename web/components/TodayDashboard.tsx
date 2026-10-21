'use client'

import RoadToFiveHundred from '@/components/RoadToFiveHundred'
import RecentlyDone from '@/components/RecentlyDone'
import { useClaudeHandoff, repoLine, type HandoffArgs } from '@/components/useClaudeHandoff'
import SocialIcon, { socialBrand } from '@/components/SocialIcon'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import GmailOutreachProspects from '@/components/GmailOutreachProspects'
import TodaySocialPost, { type PostIdea } from '@/components/TodaySocialPost'
import TodayActivity from '@/components/TodayActivity'
import ElementEvidence from '@/components/ElementEvidence'
import PagePreview from '@/components/PagePreview'
import type { ActionCard, ImpactCard } from '@/lib/daily/signals'
import type { PlatformStats } from '@/app/api/social/analytics/route'
import type { DBItemFull } from '@/lib/modules/types'
import { connectUrl } from '@/lib/integrations/connect-url'
import { Spinner } from '@/components/ui/spinner'
import Link from 'next/link'
import DailyEmailToggle from '@/components/DailyEmailToggle'
import { BarChart3 } from 'lucide-react'

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

interface BlogEntry {
  id: string
  mdUrl?: string
  title: string
  slug: string
  status: string
  verificationStatus?: string | null
  verifiedLiveAt?: Date | string | null
  liveUrl?: string | null
  createdAt: Date | string | null
}

interface BlogData {
  blogs: BlogEntry[]
  limit: number
  activeCount: number
  weeklyDue: boolean
  lastBlogAt: string | null
}

interface TodayFocus {
  stage: string
  summary: string
}

type TaskStatus = 'done' | 'dismissed'

interface Props {
  initialData: {
    cards: ActionCard[]
    impacts: ImpactCard[]
    focus?: TodayFocus | null
    streak: number
    allGood: boolean
    cachedAt: string
  }
  brandName: string
  websiteUrl?: string | null
  mcpLastUsedAt?: string | null
  githubRepo?: string | null
  gmailConnected: boolean
  gmailAddress: string | null
  prospectItems: DBItemFull[]
  gmailModuleId: string | null
  frektoConnected: boolean
  frektoDefaultPlatform: string | null
  frektoTimezone?: string | null
  postIdeas: PostIdea[]
  posthogConnected: boolean
  blogData: BlogData
  dailyEmailEnabled?: boolean
  dailyEmailTo?: string | null
  earlyAccess?: boolean // lib/early-access.ts: coming-soon tools are live
}

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; dot: string; border: string }> = {
  outreach:      { label: 'Traffic signal',  dot: '#d97706', border: '#d97706' },
  social:        { label: 'Social signal',   dot: '#7c3aed', border: '#7c3aed' },
  seo:           { label: 'SEO signal',      dot: '#179a50', border: '#179a50' },
  content:       { label: 'Content signal',  dot: '#0284c7', border: '#0284c7' },
  'module-item': { label: 'Quick win',       dot: '#dc2626', border: '#dc2626' },
  alert:         { label: 'Alert',           dot: '#dc2626', border: '#dc2626' },
  play:          { label: 'Growth focus',    dot: '#179a50', border: '#179a50' },
  blog:          { label: 'Blog signal',     dot: '#0891b2', border: '#0891b2' },
  reminder:      { label: 'Reminder',        dot: '#f59e0b', border: '#f59e0b' },
}

const TYPE_WHY: Record<string, string> = {
  outreach:      'Visitors who leave without converting need a nudge. A well-timed email puts you back in front of people who already showed interest.',
  social:        'Gaps longer than 5 days cause the algorithm to deprioritise your account. Consistency beats perfection.',
  seo:           'Keyword positions drop fast when competitors update their pages. Catching this early is much cheaper than recovering lost rankings.',
  content:       'Stale or thin pages drag down your whole domain authority. Refreshing them signals freshness to Google.',
  'module-item': '',
  alert:         '',
  play:          '',
  blog:          'Publishing one SEO-optimised blog post per week compounds your organic traffic over time. Sites that publish consistently rank for 3-5x more keywords.',
  reminder:      '',
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
function IconPen() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
}
function IconBell() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  outreach:      <IconMail />,
  social:        <IconSocial />,
  seo:           <IconSearch />,
  content:       <IconDoc />,
  'module-item': <IconCheck />,
  blog:          <IconPen />,
  reminder:      <IconBell />,
  alert:         <IconBell />,
  play:          <IconSearch />,
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
    <Link href="/analytics" className="td-analytics-bar" title="Open analytics">
      <span className="td-analytics-label">Yesterday</span>
      <span className="td-analytics-num">{visits.toLocaleString()} visits</span>
      {delta !== null && (
        <span className={`td-analytics-delta ${delta >= 0 ? 'td-analytics-delta--up' : 'td-analytics-delta--dn'}`}>
          {delta >= 0 ? '+' : ''}{delta}%
        </span>
      )}
      {top && <span className="td-analytics-channel">via {top}</span>}
    </Link>
  )
}

// ── "Do it with Claude" prompts ─────────────────────────────────────────────────
// Each website task gets two prompts: one that uses the GrowJin MCP (Claude reads the task, does it
// and marks it done here) and a plain one for Claude Code without the MCP.

interface SiteCtx { brandName: string; websiteUrl: string | null; githubRepo: string | null }
const where = (c: SiteCtx) => `${c.websiteUrl ? ` (${c.websiteUrl})` : ''}`
const codebase = (c: SiteCtx) => `my website codebase${c.githubRepo ? ` (${c.githubRepo})` : ''}`

function taskHandoff(card: ActionCard, c: SiteCtx): HandoffArgs {
  const d = card.data ?? {}
  const kind = String(d.taskKind ?? 'item')
  const id = String(d.taskId ?? '')
  const action = typeof d.action === 'string' ? d.action : ''
  const finding = typeof d.finding === 'string' ? d.finding : card.reason
  const done = kind === 'item'
    ? `call toggle_item with item_id "${id}" and checked true, passing link (the pull request, changed page or published post) and note (one sentence on what you changed) so I can see the result in GrowJin`
    : `call resolve_signal with signal_id "${id}" and status "done", passing link (the pull request, changed page or published post) and note (one sentence on what you changed) so I can see the result in GrowJin`
  const mcp = [
    `Use the GrowJin connector to do one of today's growth tasks for ${c.brandName}${where(c)}.`,
    repoLine(c.githubRepo),
    '',
    `1. Call get_today_tasks and find the task "${card.headline}" (id ${id}).`,
    `2. Do it in ${codebase(c)}.${action ? ` Suggested fix: ${action}` : ''} If it needs real data from me (stats, quotes, prices), ask instead of inventing it.`,
    '3. Ship it the way this repo usually ships changes (open a pull request if that is the norm) and tell me exactly what changed.',
    `4. When it's done, ${done} so GrowJin marks it complete.`,
  ].join('\n')
  const plain = [
    `Please make this change on my website${where(c)}, in ${codebase(c)}.`,
    repoLine(c.githubRepo),
    '',
    `Task: ${card.headline}`,
    finding ? `Why: ${finding}` : '',
    action ? `What to do: ${action}` : '',
    '',
    'If it needs real data from me (stats, quotes, prices), ask instead of inventing it. Make the change, then tell me exactly what you changed.',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n')
  return { key: `task:${card.id}`, label: card.headline, plain, mcp }
}

function blogHandoff(blog: { id: string; title: string; mdUrl?: string }, c: SiteCtx): HandoffArgs {
  const steps = [
    `2. Add it to ${codebase(c)} the way the site already publishes posts (same folder, format and layout). If there is no blog yet, add a simple /blog section with an index page that lists posts.`,
    '3. Use the slug for the URL, set the page title and meta description, add the post to the sitemap and link it from the blog index.',
    '4. Ship it the way this repo usually ships changes (open a pull request if that is the norm) and tell me the URL it will be live at.',
  ]
  const mcp = [
    `Use the GrowJin connector to publish a blog post on my website${where(c)}.`,
    repoLine(c.githubRepo),
    '',
    `1. Call get_blog_post with blog_id "${blog.id}" to get the article (markdown) with its slug, meta title and meta description.`,
    ...steps,
    `5. Once it's live, call mark_blog_published with blog_id "${blog.id}" and the live_url.`,
  ].join('\n')
  const plain = [
    `Please publish this blog post on my website${where(c)}: "${blog.title}".`,
    repoLine(c.githubRepo),
    '',
    `1. Download the post (markdown with front matter: title, slug, meta title, meta description) from ${blog.mdUrl ?? 'GrowJin (Today › Weekly blog › Copy markdown)'}`,
    ...steps,
    '5. Tell me the live URL so I can mark it published in GrowJin.',
  ].join('\n')
  return { key: `blog:${blog.id}`, label: blog.title, plain, mcp, title: 'Add this post to your website' }
}

// "**bold**" from the AI's wording, shown as bold instead of literal asterisks
const withBold = (text: string) => text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))

// which card types expand inline vs navigate away
const INLINE_TYPES: Set<string> = new Set(['outreach', 'social', 'blog'])

// ── Action card ───────────────────────────────────────────────────────────────

function ActionCardItem({ card, rank, onCta, expanded, onToggleExpand, onDone, onComplete, onClaude, claudeHint, composer }: {
  card: ActionCard
  onClaude?: () => void
  claudeHint?: React.ReactNode
  rank: number
  onCta: () => void
  expanded: boolean
  onToggleExpand: () => void
  onDone?: () => void
  onComplete?: (status: TaskStatus) => Promise<void>
  // Shown inside the card in place of its text and buttons while expanded (e.g. "Create a post")
  composer?: React.ReactNode
}) {
  const [marking, setMarking] = useState(false)
  const [completing, setCompleting] = useState<TaskStatus | null>(null)
  const action = typeof card.data?.action === 'string' ? card.data.action : null
  const helps = typeof card.data?.helps === 'string' && card.data.helps.trim() ? card.data.helps : null
  const taskKind = card.data?.taskKind as string | undefined

  async function handleComplete(status: TaskStatus) {
    if (!onComplete) return
    setCompleting(status)
    try { await onComplete(status) } catch { setCompleting(null) }
  }
  const cfg = TYPE_CONFIG[card.type] ?? TYPE_CONFIG.outreach
  const icon = TYPE_ICON[card.type]
  const isInline = INLINE_TYPES.has(card.type)

  async function handleMarkDone() {
    const reminderId = card.data?.reminderId as string | undefined
    if (!reminderId) return
    setMarking(true)
    try {
      // Only drop the card once it's really marked done, or it comes back on the next load
      const res = await fetch(`/api/reminders/${reminderId}/done`, { method: 'POST' })
      if (!res.ok) throw new Error('mark done failed')
      onDone?.()
    } catch {
      setMarking(false)
    }
  }

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
      <p className="td-card-reason">{helps && card.reason ? <strong>Why: </strong> : null}{withBold(card.reason)}</p>

      {/* The module check's picture: the failing elements on the page, or the Google / share preview */}
      {card.data?.visual != null && (
        <div className="td-card-visual">
          <ElementEvidence data={card.data.visual} shown={1} />
          <PagePreview data={card.data.visual} options={card.data.choiceOptions as string[] | null} slug={String(card.data.slug ?? '')} />
        </div>
      )}

      {expanded && composer ? composer : <>
      {action && (
        <div className="td-card-why">
          <span className="td-why-label">What to do</span>
          {withBold(action)}
        </div>
      )}
      {helps ? (
        <div className="td-card-why">
          <span className="td-why-label">How it helps</span>
          {withBold(helps)}
        </div>
      ) : !action && TYPE_WHY[card.type] && (
        <div className="td-card-why">
          <span className="td-why-label">Why this matters</span>
          {TYPE_WHY[card.type]}
        </div>
      )}

      {card.type === 'reminder' ? (
        <div className="td-card-actions">
          <button
            className="td-cta-btn"
            onClick={handleMarkDone}
            disabled={marking}
            style={{ opacity: marking ? 0.6 : 1 }}
          >
            {marking ? <><Spinner />Marking…</> : 'Mark done'}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 5 }}>
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>
          <a href="/reminders" className="td-ghost-btn">
            View all
          </a>
        </div>
      ) : (
        <div className="td-card-actions">
          {isInline ? (
            <button className="td-cta-btn" onClick={() => { if (card.type !== 'social') onCta(); onToggleExpand() }}>
              {expanded ? 'Close' : card.type === 'outreach' ? 'Write outreach emails' : card.type === 'blog' ? 'Write the blog post' : 'Create a post'}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 5, transform: expanded ? 'rotate(180deg)' : 'none' }}>
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
          ) : onClaude ? (
            <>
              <button className="td-cta-btn" onClick={() => { onCta(); onClaude() }}>Fix with Claude</button>
              <a href={card.ctaUrl} className="td-ghost-btn" onClick={onCta}>{card.cta}</a>
            </>
          ) : (
            <a href={card.ctaUrl} className="td-cta-btn" onClick={onCta}>
              {card.cta}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 5 }}>
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </a>
          )}
          {onComplete && (
            <button className="td-ghost-btn" onClick={() => handleComplete('done')} disabled={completing !== null}>
              {completing === 'done' ? <><Spinner />Marking…</> : 'Mark done'}
            </button>
          )}
          {onComplete && taskKind !== 'item' && (
            <button className="td-ghost-btn" onClick={() => handleComplete('dismissed')} disabled={completing !== null}>
              {completing === 'dismissed' ? <><Spinner />Hiding…</> : 'Not relevant'}
            </button>
          )}
        </div>
      )}
      </>}
      {claudeHint}
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
                <SocialIcon platform={post.platform} size={13} />
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
            {socialBrand(p.provider) ? <span style={{ opacity: 0.5 }}><SocialIcon platform={p.provider} size={16} /></span> : <span className="td-platform-dot" style={{ background: c.color, opacity: 0.4 }} />}
            <span className="td-platform-name" style={{ opacity: 0.5 }}>{p.name}</span>
          </div>
          {connectProvider && (
            <a href={`/api/connect/${connectProvider}?return_to=/today`} className="td-connect-btn">
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
          {socialBrand(p.provider) ? <SocialIcon platform={p.provider} size={16} /> : <span className="td-platform-dot" style={{ background: c.color }} />}
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
        <>
          {platforms.some(p => p.connected) && (
            <div className="td-platform-list">
              {platforms.filter(p => p.connected).map(p => <PlatformCard key={p.provider} p={p} />)}
            </div>
          )}
          {/* Not-connected platforms: one row of connect buttons, not a card each. */}
          {platforms.some(p => !p.connected && PLATFORM_CONNECT[p.provider]) && (
            <div className="td-connect-row">
              <span className="td-connect-row-text">{platforms.some(p => p.connected) ? 'Add more:' : 'Connect to see your social stats:'}</span>
              {platforms.filter(p => !p.connected && PLATFORM_CONNECT[p.provider]).map(p => {
                const c = PLATFORM_COLORS[p.provider] ?? { bg: '#88888818', color: '#888' }
                return (
                  <a key={p.provider} href={`/api/connect/${PLATFORM_CONNECT[p.provider]}?return_to=/today`} className="td-connect-btn">
                    {socialBrand(p.provider) ? <SocialIcon platform={p.provider} size={16} /> : <span className="td-connect-dot" style={{ background: c.color }} aria-hidden="true" />}
                    {p.name}
                  </a>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Weekly Blog Section ───────────────────────────────────────────────────────

interface GeneratedBlog {
  id: string
  title: string
  slug: string
  metaTitle?: string | null
  metaDescription?: string | null
  targetKeyword?: string | null
  content: string
  status: string
  verificationStatus?: string | null
  liveUrl?: string | null
  createdAt: string | null
  via?: 'frekto'
  destination?: 'linkedin' | 'blog_mcp' | null
  mdUrl?: string
}

type BlogMode = 'draft' | 'linkedin' | 'blog'
const BLOG_MODES: { key: BlogMode; label: string; hint: string }[] = [
  { key: 'draft', label: 'Just write it', hint: 'Nothing is posted. Review and copy it here.' },
  { key: 'linkedin', label: 'Post on LinkedIn', hint: 'Frekto schedules it on LinkedIn for tomorrow.' },
  { key: 'blog', label: 'Publish on my blog', hint: 'Frekto publishes it tomorrow to the blog you connected in Frekto (Settings → Integrations).' },
]

// Topic box, ideas from Search Console / brand keywords, and (with Frekto) where the article goes.
function BlogComposer({ frektoConnected, generating, topic, setTopic, mode, setMode, onWrite }: {
  frektoConnected: boolean
  generating: false | 'frekto' | 'growjin'
  topic: string
  setTopic: (t: string) => void
  mode: BlogMode
  setMode: (m: BlogMode) => void
  onWrite: (via: 'frekto' | 'growjin') => void
}) {
  const [ideas, setIdeas] = useState<{ topic: string; why: string; helps?: string }[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/blogs/topics').then(r => r.ok ? r.json() : null).then(d => { if (alive) setIdeas(d?.ideas ?? []) }).catch(() => { if (alive) setIdeas([]) })
    return () => { alive = false }
  }, [])
  const busy = generating !== false

  return (
    <div className="td-blog-compose">
      <label className="td-blog-compose-label" htmlFor="td-blog-topic">What should it be about?</label>
      <input
        id="td-blog-topic"
        className="td-blog-topic"
        value={topic}
        maxLength={300}
        onChange={e => setTopic(e.target.value)}
        placeholder="Leave empty and we'll pick a topic for you"
      />
      {ideas === null ? (
        <p className="td-blog-ideas-note"><Spinner size={11} />Finding topic ideas…</p>
      ) : ideas.length > 0 && (
        <div className="td-blog-ideas">
          {ideas.map(i => (
            <button key={i.topic} type="button" className={`td-blog-idea${topic === i.topic ? ' is-on' : ''}`} onClick={() => setTopic(i.topic)} title={i.helps ? `${i.why}. ${i.helps}` : i.why}>
              <span>{i.topic}</span>
              <small>Why: {i.why}</small>
              {i.helps && <small>How it helps: {i.helps}</small>}
            </button>
          ))}
        </div>
      )}

      {frektoConnected ? (
        <>
          <div className="td-blog-modes" role="radiogroup" aria-label="What to do with it">
            {BLOG_MODES.map(m => (
              <label key={m.key} className={`td-blog-mode${mode === m.key ? ' is-on' : ''}`}>
                <input type="radio" name="td-blog-mode" checked={mode === m.key} onChange={() => setMode(m.key)} />
                <span><b style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{m.key === 'linkedin' && <SocialIcon platform="linkedin" size={14} />}{m.label}</b><small>{m.hint}</small></span>
              </label>
            ))}
          </div>
          <div className="td-blog-compose-actions">
            <button className="td-cta-btn" onClick={() => onWrite('frekto')} disabled={busy}>
              {generating === 'frekto' ? <><span className="td-btn-spinner" />Frekto is writing… (up to a minute)</> : mode === 'draft' ? 'Write with Frekto' : mode === 'linkedin' ? 'Write and schedule on LinkedIn' : 'Write and publish on my blog'}
            </button>
            <button className="td-ghost-btn" onClick={() => onWrite('growjin')} disabled={busy}>
              {generating === 'growjin' ? <><span className="td-btn-spinner td-btn-spinner--dark" />Writing…</> : 'Longer SEO post instead'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="td-blog-compose-actions">
            <button className="td-cta-btn" onClick={() => onWrite('growjin')} disabled={busy}>
              {generating ? <><span className="td-btn-spinner" />Writing…</> : 'Write the blog post'}
            </button>
          </div>
          <p className="td-blog-ideas-note">Connect Frekto in <a href={connectUrl('frekto')}>Settings → Integrations</a> to post articles to LinkedIn or your blog automatically.</p>
        </>
      )}
    </div>
  )
}

function WeeklyBlogSection({ initialData, frektoConnected = false, onAddToSite, addHint }: {
  initialData: BlogData
  frektoConnected?: boolean
  onAddToSite?: (blog: { id: string; title: string; mdUrl?: string }) => void
  addHint?: (blogId: string) => React.ReactNode
}) {
  const [data, setData] = useState<BlogData>(initialData)
  const [generating, setGenerating] = useState<false | 'frekto' | 'growjin'>(false)
  const [generatedBlog, setGeneratedBlog] = useState<GeneratedBlog | null>(null)
  const [topic, setTopic] = useState('')
  const [mode, setMode] = useState<BlogMode>('draft')
  const [via, setVia] = useState<'frekto' | 'growjin'>(frektoConnected ? 'frekto' : 'growjin')
  const [composeOpen, setComposeOpen] = useState(false)
  const [replaceId, setReplaceId] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showContent, setShowContent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async (rid?: string, writer: 'frekto' | 'growjin' = via) => {
    setVia(writer)
    setGenerating(writer)
    setError(null)
    try {
      const res = await fetch('/api/blogs/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replaceId: rid ?? replaceId ?? undefined, topic: topic || undefined, via: writer, frektoMode: mode }),
      })
      // A crashed or timed-out request returns an error page, not JSON: say that instead of a generic failure
      const json = await res.json().catch(() => ({ error: res.status === 504 ? 'Writing the article took too long and was stopped. Try again.' : `Something went wrong on GrowJin's side (error ${res.status}). Try again in a minute.` }))
      if (json.atLimit) {
        setData(prev => ({ ...prev, activeCount: prev.limit, blogs: json.blogs }))
        return
      }
      if (json.error) { setError(json.error); return }
      setGeneratedBlog(json.blog)
      // refresh list
      const listRes = await fetch('/api/blogs')
      if (listRes.ok) setData(await listRes.json())
      setReplaceId(null)
    } catch {
      setError('Generation failed. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const verify = async (id: string) => {
    setVerifyingId(id)
    try {
      const res = await fetch(`/api/blogs/${id}/verify`, { method: 'POST' })
      if (res.ok) {
        const v = await res.json()
        if (generatedBlog?.id === id) {
          setGeneratedBlog(prev => prev ? {
            ...prev,
            verificationStatus: v.status,
            liveUrl: v.liveUrl ?? null,
          } : null)
        }
        // refresh list to get updated verification status
        const listRes = await fetch('/api/blogs')
        if (listRes.ok) setData(await listRes.json())
      }
    } finally {
      setVerifyingId(null)
    }
  }

  const markPublished = async (id: string) => {
    setMarkingId(id)
    try {
      const res = await fetch(`/api/blogs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published' }),
      })
      if (res.ok) {
        if (generatedBlog?.id === id) {
          setGeneratedBlog(prev => prev ? { ...prev, status: 'published', verificationStatus: 'pending' } : null)
        }
        const listRes = await fetch('/api/blogs')
        if (listRes.ok) setData(await listRes.json())
      }
    } finally {
      setMarkingId(null)
    }
    // Auto-trigger verification after publish
    verify(id)
  }

  const copyContent = () => {
    if (!generatedBlog?.content) return
    navigator.clipboard.writeText(generatedBlog.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const atLimit = data.activeCount >= data.limit
  const latestBlog = data.blogs[0] ?? null
  const lastBlogDate = latestBlog?.createdAt ? new Date(latestBlog.createdAt) : null
  const daysSince = lastBlogDate
    ? Math.floor((Date.now() - lastBlogDate.getTime()) / 864e5)
    : null

  // Next due: 7 days after last blog
  const nextDueLabel = (() => {
    if (!lastBlogDate) return null
    const next = new Date(lastBlogDate.getTime() + 7 * 864e5)
    const daysUntil = Math.ceil((next.getTime() - Date.now()) / 864e5)
    if (daysUntil <= 0) return 'due now'
    const day = next.toLocaleDateString([], { weekday: 'long' })
    return `${day} (${daysUntil} day${daysUntil === 1 ? '' : 's'})`
  })()

  return (
    <div className="td-blog-section" id="blog">
      <div className="td-section-label td-section-label--gap">
        <IconPen />
        Weekly Blog
        {atLimit && !replaceId && !generatedBlog && (
          <span className="td-blog-limit-badge">Limit {data.activeCount}/{data.limit}</span>
        )}
      </div>

      {/* Generated blog result */}
      {generatedBlog && (
        <div className="td-blog-result">
          <div className="td-blog-result-header">
            <div>
              <div className="td-blog-result-title">{generatedBlog.title}</div>
              {generatedBlog.targetKeyword && (
                <div className="td-blog-result-kw">Keyword: {generatedBlog.targetKeyword}</div>
              )}
            </div>
            <span className={`td-blog-status td-blog-status--${generatedBlog.status}`}>
              {generatedBlog.status}
            </span>
          </div>
          {generatedBlog.status === 'scheduled' && (
            <div className="td-blog-scheduled-note">
              Frekto will {generatedBlog.destination === 'blog_mcp' ? 'publish this on your blog' : 'post this on LinkedIn'} tomorrow. You can change or cancel it in Frekto.
            </div>
          )}
          {generatedBlog.metaDescription && (
            <div className="td-blog-meta-desc">{generatedBlog.metaDescription}</div>
          )}
          <div className="td-blog-result-actions">
            <button className="td-ghost-btn" onClick={copyContent}>
              {copied ? 'Copied!' : 'Copy markdown'}
            </button>
            <button className="td-ghost-btn" onClick={() => setShowContent(s => !s)}>
              {showContent ? 'Hide content' : 'Preview content'}
            </button>
            {generatedBlog.status === 'draft' && onAddToSite && (
              <button className="td-cta-btn" onClick={() => onAddToSite(generatedBlog)}>Add to my website with Claude</button>
            )}
            {generatedBlog.status === 'draft' && (
              <button
                className={onAddToSite ? 'td-ghost-btn' : 'td-cta-btn'}
                onClick={() => markPublished(generatedBlog.id)}
                disabled={markingId === generatedBlog.id}
              >
                {markingId === generatedBlog.id ? <><Spinner />Saving...</> : 'Mark as published'}
              </button>
            )}
          </div>
          {addHint?.(generatedBlog.id)}

          {/* Verification status */}
          {generatedBlog.status === 'published' && (
            <div className="td-blog-verify-row">
              {verifyingId === generatedBlog.id || generatedBlog.verificationStatus === 'pending' ? (
                <span className="td-blog-verify-checking">
                  <span className="td-btn-spinner td-btn-spinner--dark" />
                  Checking if live...
                </span>
              ) : generatedBlog.verificationStatus === 'live' ? (
                <>
                  <span className="td-blog-verify-live">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Live
                  </span>
                  {generatedBlog.liveUrl && (
                    <a href={generatedBlog.liveUrl} target="_blank" rel="noopener noreferrer" className="td-blog-live-link">
                      {generatedBlog.liveUrl}
                    </a>
                  )}
                </>
              ) : generatedBlog.verificationStatus === 'not_found' ? (
                <>
                  <span className="td-blog-verify-notfound">Not found yet</span>
                  <button className="td-ghost-btn td-ghost-btn--sm" onClick={() => verify(generatedBlog.id)} disabled={verifyingId === generatedBlog.id}>
                    Check again
                  </button>
                </>
              ) : (
                <button className="td-ghost-btn td-ghost-btn--sm" onClick={() => verify(generatedBlog.id)} disabled={verifyingId === generatedBlog.id}>
                  Check if live
                </button>
              )}
            </div>
          )}
          {showContent && (
            <pre className="td-blog-preview">{generatedBlog.content}</pre>
          )}
        </div>
      )}

      {/* At limit — replace mode */}
      {atLimit && !generatedBlog && (
        <div className="td-blog-card">
          <p className="td-blog-at-limit-msg">
            You&apos;ve reached your blog limit ({data.limit} posts). Select one to replace:
          </p>
          <div className="td-blog-replace-list">
            {data.blogs.map(b => {
              const date = b.createdAt ? new Date(b.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''
              return (
                <label key={b.id} className={`td-blog-replace-row ${replaceId === b.id ? 'td-blog-replace-row--selected' : ''}`}>
                  <input type="radio" name="replace" value={b.id} checked={replaceId === b.id} onChange={() => setReplaceId(b.id)} />
                  <span className="td-blog-replace-title">{b.title}</span>
                  <span className="td-blog-replace-meta">{date} · {b.status}</span>
                </label>
              )
            })}
          </div>
          <button
            className="td-cta-btn"
            onClick={() => replaceId && generate(replaceId)}
            disabled={!replaceId || generating !== false}
            style={{ marginTop: 12 }}
          >
            {generating ? (
              <><span className="td-btn-spinner" />Generating...</>
            ) : (
              'Generate replacing selected'
            )}
          </button>
          {error && <p className="td-blog-error">{error}</p>}
        </div>
      )}

      {/* Normal states — not at limit */}
      {!atLimit && !generatedBlog && (
        <div className="td-blog-card">
          {data.weeklyDue ? (
            <>
              <p className="td-blog-no-blog">
                {latestBlog
                  ? `No blog this week — last post was ${daysSince} day${daysSince === 1 ? '' : 's'} ago.`
                  : 'No blogs generated yet.'}
              </p>
              <BlogComposer frektoConnected={frektoConnected} generating={generating} topic={topic} setTopic={setTopic} mode={mode} setMode={setMode} onWrite={w => generate(undefined, w)} />
              {error && <p className="td-blog-error">{error}</p>}
            </>
          ) : (
            <>
              {nextDueLabel && (
                <p className="td-blog-next-due">Next blog due: {nextDueLabel}</p>
              )}
              {latestBlog && (
                <div className="td-blog-latest">
                  <span className="td-blog-latest-label">Latest:</span>
                  <span className="td-blog-latest-title">&ldquo;{latestBlog.title}&rdquo;</span>
                  <span className={`td-blog-status td-blog-status--${latestBlog.status}`}>{latestBlog.status}</span>
                  {latestBlog.status === 'draft' && onAddToSite && (
                    <button className="td-ghost-btn td-ghost-btn--sm td-blog-add-btn" onClick={() => onAddToSite(latestBlog)}>Add to my website with Claude</button>
                  )}
                  {latestBlog.status === 'draft' && (
                    <button
                      className="td-ghost-btn td-ghost-btn--sm"
                      onClick={() => markPublished(latestBlog.id)}
                      disabled={markingId === latestBlog.id}
                    >
                      {markingId === latestBlog.id ? <><Spinner />Saving...</> : 'Mark as published'}
                    </button>
                  )}
                  {latestBlog.status === 'published' && (
                    verifyingId === latestBlog.id || latestBlog.verificationStatus === 'pending' ? (
                      <span className="td-blog-verify-checking">
                        <span className="td-btn-spinner td-btn-spinner--dark" />Checking...
                      </span>
                    ) : latestBlog.verificationStatus === 'live' ? (
                      <span className="td-blog-verify-live">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Live
                      </span>
                    ) : (
                      <button className="td-ghost-btn td-ghost-btn--sm" onClick={() => verify(latestBlog.id)} disabled={verifyingId === latestBlog.id}>
                        {latestBlog.verificationStatus === 'not_found' ? 'Check again' : 'Check if live'}
                      </button>
                    )
                  )}
                </div>
              )}
              {latestBlog && addHint?.(latestBlog.id)}
              {composeOpen ? (
                <>
                  <BlogComposer frektoConnected={frektoConnected} generating={generating} topic={topic} setTopic={setTopic} mode={mode} setMode={setMode} onWrite={w => generate(undefined, w)} />
                  {error && <p className="td-blog-error">{error}</p>}
                </>
              ) : (
                <button className="td-ghost-btn td-ghost-btn--sm td-blog-write-now" onClick={() => setComposeOpen(true)}>Write one now</button>
              )}
            </>
          )}
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
        {refreshing ? <><Spinner />Checking...</> : 'Refresh'}
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

export default function TodayDashboard({ initialData, brandName, websiteUrl = null, mcpLastUsedAt = null, githubRepo = null, gmailConnected, gmailAddress, prospectItems, gmailModuleId, frektoConnected, frektoDefaultPlatform, frektoTimezone = null, postIdeas, posthogConnected, blogData, dailyEmailEnabled = false, dailyEmailTo = null, earlyAccess = false }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const handoff = useClaudeHandoff({ mcpLastUsedAt, githubRepo })
  const site: SiteCtx = { brandName, websiteUrl, githubRepo }
  const addBlogToSite = (b: { id: string; title: string; mdUrl?: string }) => handoff.start(blogHandoff(b, site))
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
  const [focus, setFocus] = useState<TodayFocus | null>(initialData.focus ?? null)
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
      setTimeout(() => fetchSignals(true), 500)
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
    // Same limits as /api/today/signals: 4h, or 30 min when the focus had no traffic data
    if (age >= (focus?.stage === 'unknown' ? 30 * 60 * 1000 : 4 * 60 * 60 * 1000)) fetchSignals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // fresh: the Refresh button / a new connection — recompute instead of reusing the 4h cache
  const fetchSignals = useCallback(async (fresh = false) => {
    setRefreshing(true)
    try {
      const res = await fetch(fresh ? '/api/today/signals?refresh=1' : '/api/today/signals')
      if (res.ok) {
        const d = await res.json()
        setCards(d.cards ?? [])
        setImpacts(d.impacts ?? [])
        setFocus(d.focus ?? null)
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

  // Same effect as Claude's toggle_item / resolve_signal: the task leaves the list everywhere
  const completeTask = useCallback(async (card: ActionCard, status: TaskStatus) => {
    const res = await fetch('/api/today/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: card.data?.taskKind, id: card.data?.taskId, status }),
    })
    if (!res.ok) throw new Error('complete failed')
    setCards(prev => prev.filter(c => c.id !== card.id))
    if (status === 'done') markAction()
  }, [markAction])

  // A post went out from the "Create a post" panel: mark the task done and count today's action,
  // but keep the card (with its success message) until the panel is closed.
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set())
  const publishedSocial = useCallback((card: ActionCard) => {
    setPublishedIds(prev => new Set(prev).add(card.id))
    markAction()
    if (card.data?.taskKind) {
      fetch('/api/today/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: card.data.taskKind, id: card.data.taskId, status: 'done' }),
      }).catch(() => {})
    }
  }, [markAction])
  const closeSocialPanel = useCallback((card: ActionCard) => {
    setExpandedCard(null)
    if (publishedIds.has(card.id)) setCards(prev => prev.filter(c => c.id !== card.id))
  }, [publishedIds])

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

      {/* Hero */}
      <div className="td-hero">
        <div className="td-hero-left">
          <div className="td-hero-day">{dayLabel}</div>
          <div className="td-hero-tag">
            {ready && cards.length > 0
              ? `${cards.length} thing${cards.length === 1 ? ' needs' : 's need'} your attention`
              : ready && !refreshing ? 'You\'re all caught up'
              : <><Spinner size={12} />Checking your signals…</>}
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
          <DailyEmailToggle initialEnabled={dailyEmailEnabled} email={dailyEmailTo} />
          <Link href="/analytics" className="td-analytics-link">
            <BarChart3 size={15} aria-hidden="true" />
            Analytics
          </Link>
        </div>
      </div>

      {/* Body */}
      <div className="td-body">
        {/* Road to 500 users timeline (needs PostHog) */}
        {posthogConnected && <div className="td-journey"><RoadToFiveHundred posthogConnected /></div>}

        {/* What happened since yesterday (visitors, signups, sources) before what to do */}
        <TodayActivity />

        {!ready || (refreshing && cards.length === 0) ? (
          <LoadingState />
        ) : cards.length === 0 ? (
          <>
            <AllGoodState cachedAt={cachedAt} onRefresh={() => fetchSignals(true)} refreshing={refreshing} />
            {impacts.length > 0 && (
              <>
                <div className="td-section-label">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
                  </svg>
                  What&apos;s working
                </div>
                <div className="td-cards">{impacts.map(c => <ImpactCardItem key={c.id} card={c} />)}</div>
              </>
            )}
            <RecentlyDone />
            <WeeklyBlogSection initialData={blogData} frektoConnected={frektoConnected} onAddToSite={addBlogToSite} addHint={id => handoff.hint(`blog:${id}`)} />
            <SocialAnalytics />
            <SocialFeed posts={recentPosts} />
          </>
        ) : (
          <>
            {/* Today's focus (current growth bottleneck) */}
            {/* Card #1 is usually this same growth focus; only show the box when it adds something. */}
            {focus && cards[0]?.type !== 'play' && (
              <div className="td-card-why" style={{ marginBottom: 12 }}>
                <span className="td-why-label">Today&apos;s focus</span>
                {focus.summary}
              </div>
            )}

            {/* Action cards */}
            <div className="td-section-label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Actions for today
            </div>
            <div className="td-cards">
            {cards.map((card, i) => (
              <div key={card.id} className={`td-cell${expandedCard === card.id ? ' td-cell--wide' : ''}`}>
                <ActionCardItem
                  card={card}
                  rank={i + 1}
                  onCta={markAction}
                  expanded={expandedCard === card.id}
                  onToggleExpand={() => expandedCard === card.id && card.type === 'social' ? closeSocialPanel(card) : setExpandedCard(expandedCard === card.id ? null : card.id)}
                  onDone={card.type === 'reminder' ? () => setCards(prev => prev.filter(c => c.id !== card.id)) : undefined}
                  onComplete={card.data?.taskKind ? (status) => completeTask(card, status) : undefined}
                  onClaude={card.data?.route === 'code' && !INLINE_TYPES.has(card.type) ? () => handoff.start(taskHandoff(card, site)) : undefined}
                  claudeHint={handoff.hint(`task:${card.id}`)}
                  composer={card.type === 'social' ? (
                    <TodaySocialPost
                      connected={frektoConnected}
                      ideas={postIdeas}
                      defaultPlatform={frektoDefaultPlatform}
                      timezone={frektoTimezone}
                      onPublished={() => publishedSocial(card)}
                      onCancel={() => closeSocialPanel(card)}
                    />
                  ) : undefined}
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
                          {analyzing ? <><Spinner />Finding prospects…</> : 'Find prospects now'}
                        </button>
                      </div>
                    ) : (
                      <GmailOutreachProspects items={prospectItems} gmailConnected={gmailConnected} earlyAccess={earlyAccess} />
                    )}
                  </div>
                )}

                {/* Inline blog generation panel */}
                {card.type === 'blog' && expandedCard === card.id && (
                  <div className="td-inline-panel">
                    <div className="td-inline-panel-header">
                      <span className="td-inline-panel-title">Generate Weekly Blog</span>
                      <button className="td-inline-panel-close" onClick={() => setExpandedCard(null)}>×</button>
                    </div>
                    <div style={{ padding: '8px 0' }}>
                      <WeeklyBlogSection initialData={blogData} frektoConnected={frektoConnected} onAddToSite={addBlogToSite} addHint={id => handoff.hint(`blog:${id}`)} />
                    </div>
                  </div>
                )}
              </div>
            ))}
            </div>

            {/* Impact cards */}
            {impacts.length > 0 && (
              <>
                <div className="td-section-label td-section-label--gap">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
                  </svg>
                  What&apos;s working
                </div>
                <div className="td-cards">{impacts.map(c => <ImpactCardItem key={c.id} card={c} />)}</div>
              </>
            )}

            <RecentlyDone />

            {/* Weekly blog */}
            <WeeklyBlogSection initialData={blogData} frektoConnected={frektoConnected} onAddToSite={addBlogToSite} addHint={id => handoff.hint(`blog:${id}`)} />

            {/* Social analytics + post feed */}
            <SocialAnalytics />
            <SocialFeed posts={recentPosts} />

            <button className="td-recheck" onClick={() => fetchSignals(true)} disabled={refreshing}>
              {refreshing ? <><Spinner />Refreshing...</> : `Last updated ${cachedAt ? new Date(cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'recently'} · Refresh`}
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

        /* "Create a post" steps inside the social card (TodaySocialPost) */
        .tsp { display: flex; flex-direction: column; gap: 18px; margin-top: 4px; }
        .tsp-steps { list-style: none; margin: 0; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; counter-reset: tsp; }
        .tsp-steps li {
          counter-increment: tsp; display: inline-flex; align-items: center; gap: 7px;
          font-size: 12.5px; color: var(--text-faint); padding: 4px 10px 4px 4px; border-radius: 999px; background: var(--bg-soft);
        }
        .tsp-steps li::before {
          content: counter(tsp); width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
          font-size: 11px; font-weight: 700; background: var(--line); color: var(--text-dim);
        }
        .tsp-steps li.is-on { color: var(--text); font-weight: 600; }
        .tsp-steps li.is-on::before { background: var(--green); color: #fff; }
        .tsp-steps li.is-done::before { content: '✓'; background: rgba(23,154,80,.15); color: var(--green); }
        .tsp-q { border: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
        .tsp-q legend { font-size: 14.5px; font-weight: 700; color: var(--text); margin-bottom: 8px; padding: 0; }
        .tsp-q:disabled { opacity: .6; }
        .tsp-opt {
          display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-radius: 10px;
          border: 1px solid var(--line); background: var(--card); cursor: pointer; font-size: 14px; color: var(--text);
        }
        .tsp-opt:hover { border-color: rgba(23,154,80,.5); }
        .tsp-opt.is-on { border-color: var(--green); background: rgba(23,154,80,.06); }
        .tsp-opt input { accent-color: var(--green); margin: 0; flex: none; }
        .tsp-opt span { flex: 1; min-width: 0; line-height: 1.4; }
        .tsp-opt em { font-style: normal; display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-faint); flex: none; }
        .tsp-skel { display: flex; flex-direction: column; gap: 8px; }
        .tsp-skel i { height: 44px; border-radius: 10px; background: var(--bg-soft); animation: tsp-pulse 1.2s ease-in-out infinite; }
        @keyframes tsp-pulse { 50% { opacity: .5; } }
        .tsp-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .tsp-chips--small .tsp-chip { padding: 5px 11px; font-size: 12.5px; }
        .tsp-chip {
          display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px; border-radius: 999px;
          border: 1px solid var(--line); background: var(--card); color: var(--text-dim); font-size: 13px; cursor: pointer;
        }
        .tsp-chip:hover { border-color: var(--green); color: var(--text); }
        .tsp-chip.is-on { border-color: var(--green); background: rgba(23,154,80,.1); color: var(--green); font-weight: 600; }
        .tsp-input {
          width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px;
          border: 1px solid var(--line); background: var(--card); color: var(--text);
          font: inherit; font-size: 14px; line-height: 1.5; resize: vertical; outline: none;
        }
        .tsp-input:focus { border-color: var(--green); }
        .tsp-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
        .tsp-btn {
          display: inline-flex; align-items: center; gap: 8px; padding: 11px 22px; border-radius: 10px; border: none;
          background: var(--green); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none;
        }
        .tsp-btn:disabled { opacity: .6; cursor: default; }
        .tsp-ghost { padding: 10px 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--text-dim); font-size: 13.5px; cursor: pointer; }
        .tsp-link { background: none; border: none; padding: 6px 2px; color: var(--text-dim); font-size: 13.5px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
        .tsp-link:hover { color: var(--text); }
        .tsp-hint { font-size: 12.5px; color: var(--text-faint); margin: 0; }
        .tsp-error { margin: 0; font-size: 13.5px; color: #dc2626; }
        .tsp-progress { display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-radius: 10px; background: var(--bg-soft); }
        .tsp-progress b { font-size: 14px; color: var(--text); }
        .tsp-progress p { margin: 2px 0 0; font-size: 12.5px; color: var(--text-faint); }
        .tsp-progress .tsp-spin { border-color: var(--line); border-top-color: var(--green); }
        .tsp-spin { width: 16px; height: 16px; flex: none; border-radius: 50%; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; animation: tsp-spin .8s linear infinite; }
        @keyframes tsp-spin { to { transform: rotate(360deg); } }
        .tsp-review { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
        @media (max-width: 760px) { .tsp-review { grid-template-columns: 1fr; } }
        .tsp-review-side { display: flex; flex-direction: column; gap: 14px; }
        .tsp-meta { display: inline-flex; align-items: center; gap: 7px; margin: 0; font-size: 13px; font-weight: 600; color: var(--text-dim); }
        .tsp-topic { margin: 0; font-size: 15px; color: var(--text); line-height: 1.45; }
        .tsp-when { display: flex; flex-wrap: wrap; gap: 8px; }
        .tsp-when .tsp-input { width: auto; }
        .tsp-when > .pk-wrap:last-of-type { flex: 1 1 100%; }
        .tsp-when .tsp-tz { width: 100%; max-width: 340px; }
        .tsp-tz-note { margin: 2px 0 0; font-size: 12px; color: var(--text-faint); }
        .tsp-preview { border: 1px solid var(--line); border-radius: 12px; background: var(--bg-soft); padding: 12px; display: flex; justify-content: center; }
        .tsp-preview img, .tsp-preview video { max-width: 100%; max-height: 460px; border-radius: 8px; display: block; }
        .tsp-slides { display: flex; gap: 8px; overflow-x: auto; }
        .tsp-slides img { height: 320px; width: auto; flex: none; }
        .tsp-note { padding: 14px 16px; border-radius: 10px; background: var(--bg-soft); }
        .tsp-note b { font-size: 14.5px; color: var(--text); }
        .tsp-note p { margin: 4px 0 0; font-size: 13.5px; color: var(--text-dim); line-height: 1.5; }
        .tsp-done { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; border-radius: 10px; background: rgba(23,154,80,.07); }
        .tsp-done > span { width: 28px; height: 28px; flex: none; border-radius: 50%; background: var(--green); color: #fff; display: grid; place-items: center; font-weight: 700; }
        .tsp-done b { font-size: 14.5px; color: var(--text); }
        .tsp-done p { margin: 3px 0 0; font-size: 13px; color: var(--text-dim); }
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

        /* hero */
        .td-hero {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
          padding: 36px clamp(20px, 3.2vw, 48px) 0; max-width: 1680px; width: 100%; margin: 0 auto; box-sizing: border-box;
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
        a.td-analytics-bar { text-decoration: none; transition: border-color .15s; }
        a.td-analytics-bar:hover { border-color: var(--green); }
        .td-analytics-link {
          display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 99px;
          border: 1px solid var(--line); background: var(--card, var(--bg-soft)); color: var(--text);
          font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap;
          transition: border-color .15s, color .15s;
        }
        .td-analytics-link:hover { border-color: var(--green); color: var(--green); }
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
          max-width: 1680px; width: 100%; margin: 0 auto;
          padding: 24px clamp(20px, 3.2vw, 48px) 80px; box-sizing: border-box;
          display: flex; flex-direction: column; gap: 14px;
        }

        .td-journey .gp-journey { margin-bottom: 0; }

        /* action and impact cards: one column on phones, more as the screen widens */
        .td-cards {
          display: grid; gap: 16px; align-items: start;
          grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr));
        }
        .td-cell { min-width: 0; }
        .td-cell--wide { grid-column: 1 / -1; }

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
        .td-card-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
        .td-card-actions .td-cta-btn { margin-top: 0; }

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
          display: inline-flex; align-items: center; gap: 7px;
          font-size: 13px; font-weight: 600; padding: 6px 12px;
          border-radius: 8px; border: 1px solid var(--line); background: var(--card);
          color: var(--text); text-decoration: none; white-space: nowrap;
          transition: border-color .12s, background .12s;
        }
        .td-connect-btn:hover { border-color: var(--green); background: var(--bg-soft); }
        .td-connect-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

        /* light overrides */
        html.light .td-analytics-delta--up { background: #d0eadb; color: #179a50; }
        html.light .td-cta-btn { background: #179a50; }
        html.light .td-streak-num { color: #179a50; }
        html.light .td-allgood-ring { border-color: #179a50; color: #179a50; }
        html.light .td-feed-status--done { background: #d0eadb; color: #179a50; }

        /* weekly blog */
        .td-blog-section { display: flex; flex-direction: column; gap: 10px; }
        .td-blog-limit-badge {
          font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 99px;
          background: rgba(220,38,38,.1); color: #dc2626; text-transform: none;
          letter-spacing: 0; margin-left: 4px;
        }
        .td-blog-card {
          background: var(--card); border: 1px solid var(--line);
          border-radius: 14px; padding: 20px 24px;
          display: flex; flex-direction: column; gap: 12px;
        }
        .td-blog-no-blog { font-size: 13px; color: var(--text-dim); margin: 0; }
        .td-blog-next-due { font-size: 13px; color: var(--text-dim); margin: 0; }
        .td-blog-at-limit-msg { font-size: 13px; color: var(--text-dim); margin: 0; }
        .td-blog-error { font-size: 12px; color: #dc2626; margin: 0; }

        .td-blog-replace-list { display: flex; flex-direction: column; gap: 8px; }
        .td-blog-replace-row {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; border-radius: 9px;
          border: 1px solid var(--line); cursor: pointer;
          font-size: 13px; color: var(--text); background: var(--bg-soft);
          transition: border-color .12s;
        }
        .td-blog-replace-row--selected { border-color: var(--green); background: var(--card); }
        .td-blog-replace-row input[type=radio] { flex-shrink: 0; accent-color: var(--green); }
        .td-blog-replace-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .td-blog-replace-meta { font-size: 11px; color: var(--text-faint); flex-shrink: 0; }

        .td-blog-latest {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          font-size: 13px; color: var(--text-dim);
        }
        .td-blog-latest-label { font-weight: 600; flex-shrink: 0; }
        .td-blog-latest-title { flex: 1; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .td-ghost-btn--sm { padding: 5px 12px; font-size: 12px; }

        .td-blog-status {
          font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 99px; flex-shrink: 0;
        }
        .td-blog-status--draft     { background: rgba(2,132,199,.1);  color: #0284c7; }
        .td-blog-status--published { background: rgba(23,154,80,.1);  color: #179a50; }
        .td-blog-status--replaced  { background: rgba(107,114,128,.1); color: #6b7280; }

        .td-blog-result {
          background: var(--card); border: 1px solid var(--line); border-left: 3px solid #0891b2;
          border-radius: 14px; padding: 20px 24px;
          display: flex; flex-direction: column; gap: 12px;
        }
        .td-blog-result-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .td-blog-result-title {
          font-family: var(--font-display, serif); font-size: 18px; font-weight: 700;
          color: var(--text); letter-spacing: -0.3px; line-height: 1.2;
        }
        .td-blog-result-kw { font-size: 12px; color: var(--text-faint); margin-top: 4px; }
        .td-blog-meta-desc { font-size: 13px; color: var(--text-dim); line-height: 1.6; }
        .td-blog-result-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .td-blog-preview {
          font-size: 12px; line-height: 1.7; color: var(--text-dim);
          background: var(--bg-soft); border: 1px solid var(--line);
          border-radius: 8px; padding: 16px; white-space: pre-wrap;
          word-break: break-word; max-height: 400px; overflow-y: auto;
          font-family: var(--font-body, sans-serif);
        }

        .td-btn-spinner {
          display: inline-block; width: 12px; height: 12px; border-radius: 50%;
          border: 2px solid rgba(255,255,255,.4); border-top-color: #fff;
          animation: td-spin .7s linear infinite; margin-right: 7px; flex-shrink: 0;
        }
        .td-btn-spinner--dark {
          border-color: rgba(0,0,0,.15); border-top-color: var(--text-dim);
        }
        @keyframes td-spin { to { transform: rotate(360deg); } }

        /* verification */
        .td-blog-verify-row {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          padding-top: 10px; border-top: 1px solid var(--line);
        }
        .td-blog-verify-checking {
          display: inline-flex; align-items: center;
          font-size: 12px; color: var(--text-faint);
        }
        .td-blog-verify-live {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 12px; font-weight: 600; color: #179a50;
          background: rgba(23,154,80,.1); padding: 3px 10px; border-radius: 99px;
        }
        .td-blog-verify-notfound {
          font-size: 12px; color: var(--text-faint);
        }
        .td-blog-live-link {
          font-size: 12px; color: #0891b2; text-decoration: none;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px;
        }
        .td-blog-live-link:hover { text-decoration: underline; }

        /* responsive */
        @media (max-width: 640px) {
          .td-hero { flex-direction: column; gap: 14px; padding: 24px 16px 0; }
          .td-hero-day { font-size: 24px; }
          .td-body { padding: 18px 16px 60px; }
          .td-hero-right { flex-wrap: wrap; }
          .td-feed-row { flex-wrap: wrap; gap: 6px; }
          .td-card, .td-blog-card, .td-impact-card { padding: 18px 16px; }
          .td-connect-row { padding: 12px 14px; }
          .td-card-actions .td-cta-btn { flex: 1 1 100%; justify-content: center; }
          /* two per row; a third takes the full row instead of squeezing all three */
          .td-card-actions .td-ghost-btn { flex: 1 1 calc(50% - 4px); justify-content: center; padding: 9px 10px; white-space: nowrap; }
          .td-analytics-bar { flex-wrap: wrap; row-gap: 2px; border-radius: 14px; }
          .td-analytics-bar > * { white-space: nowrap; }
        }
      `}</style>
      {handoff.modal}
    </div>
  )
}
