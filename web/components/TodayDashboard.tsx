'use client'

import RoadToFiveHundred from '@/components/RoadToFiveHundred'
import RecentlyDone, { useRecentlyDone } from '@/components/RecentlyDone'
import { useClaudeHandoff, repoLine, type HandoffArgs } from '@/components/useClaudeHandoff'
import SocialIcon, { socialBrand } from '@/components/SocialIcon'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import GmailOutreachProspects from '@/components/GmailOutreachProspects'
import TodaySocialPost, { type PostIdea } from '@/components/TodaySocialPost'
import LastRefreshed from '@/components/LastRefreshed'
import TodayActivity from '@/components/TodayActivity'
import ElementEvidence from '@/components/ElementEvidence'
import PagePreview from '@/components/PagePreview'
import type { ActionCard, ImpactCard } from '@/lib/daily/signals'
import type { PlatformStats } from '@/app/api/social/analytics/route'
import type { DBItemFull } from '@/lib/modules/types'
import { connectUrl } from '@/lib/integrations/connect-url'
import { ListSkeleton, Spinner } from '@/components/ui/loading'
import Link from 'next/link'
import DailyEmailToggle from '@/components/DailyEmailToggle'
import ToolHeader from '@/components/ToolHeader'
import { TrendingUp, ListChecks, PenLine, Share2, CircleCheck, Mail, Search, FileText, Wrench, CircleAlert, Target, Bell, type LucideIcon } from 'lucide-react'

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

// ── SVG icons ─────────────────────────────────────────────────────────────────

function IconPen() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
}

// ── Yesterday's visits ────────────────────────────────────────────────────────

// One line for the closed "How it's going" section: "412 visits yesterday (+18%) · most from Google"
function useYesterday() {
  const [line, setLine] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/analytics/daily-summary')
      .then(r => r.ok ? r.json() : null)
      .then((d: { traffic: TrafficData | null } | null) => {
        if (!d?.traffic) return
        const { visits, visitsPrior, channels } = d.traffic
        const delta = visitsPrior > 0 ? Math.round(((visits - visitsPrior) / visitsPrior) * 100) : null
        const top = channels[0]?.name
        setLine(`${visits.toLocaleString()} visit${visits === 1 ? '' : 's'} yesterday${delta !== null && delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta}%)` : ''}${top ? ` · most from ${top}` : ''}`)
      })
      .catch(() => {})
  }, [])
  return line
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

// A grey icon per task type, so the list is easy to scan without colour
const TYPE_ICON: Record<string, LucideIcon> = {
  outreach: Mail, social: Share2, seo: Search, content: FileText, 'module-item': Wrench,
  alert: CircleAlert, play: Target, blog: PenLine, reminder: Bell,
}
function TaskIcon({ type, big }: { type: string; big?: boolean }) {
  const Icon = TYPE_ICON[type] ?? ListChecks
  return <span className={`td-ticon${big ? ' td-ticon--big' : ''}`} aria-hidden="true"><Icon size={big ? 20 : 16} strokeWidth={1.8} /></span>
}

// Tasks done today out of today's total, as a small ring
function DoneRing({ done, total }: { done: number; total: number }) {
  const r = 11, c = 2 * Math.PI * r, part = total ? done / total : 0
  return (
    <span className="td-ring" role="img" aria-label={`${done} of ${total} done today`}>
      <svg width="28" height="28" viewBox="0 0 28 28">
        <circle cx="14" cy="14" r={r} className="td-ring-bg" />
        <circle cx="14" cy="14" r={r} className="td-ring-fg" strokeDasharray={`${c * part} ${c}`} transform="rotate(-90 14 14)" />
      </svg>
      <span className="td-ring-t">{done}/{total}</span>
    </span>
  )
}

// which card types expand inline vs navigate away
const INLINE_TYPES: Set<string> = new Set(['outreach', 'social', 'blog'])

// ── Action card ───────────────────────────────────────────────────────────────

// One task, opened from the "To do today" list. No type label or colour: the name, why, and the steps.
function ActionCardItem({ card, onClose, onCta, expanded, onToggleExpand, onDone, onComplete, onClaude, claudeHint, composer }: {
  card: ActionCard
  onClaude?: () => void
  claudeHint?: React.ReactNode
  onClose: () => void
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
    <div className="td-card">
      <div className="td-card-header">
        <h3 className="td-card-headline">{card.headline}</h3>
        <button type="button" className="btn btn-link td-card-close" onClick={onClose}>Close</button>
      </div>
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

// ── What's working ────────────────────────────────────────────────────────────

function ImpactRow({ card }: { card: ImpactCard }) {
  return (
    <li className="td-impact-row">
      <b>{card.headline}</b>
      <span>{card.detail}</span>
    </li>
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
          const date = new Date(post.scheduledAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
          const label = post.platform.charAt(0).toUpperCase() + post.platform.slice(1)
          return (
            <div key={i} className="td-feed-row">
              <span className="td-feed-platform">
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
          <div className="td-platform-followers">
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
        <div className="td-social-loading"><ListSkeleton rows={2} start={false} /></div>
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
              {generating === 'frekto' ? <><Spinner />Frekto is writing… (up to a minute)</> : mode === 'draft' ? 'Write with Frekto' : mode === 'linkedin' ? 'Write and schedule on LinkedIn' : 'Write and publish on my blog'}
            </button>
            <button className="td-ghost-btn" onClick={() => onWrite('growjin')} disabled={busy}>
              {generating === 'growjin' ? <><Spinner />Writing…</> : 'Longer SEO post instead'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="td-blog-compose-actions">
            <button className="td-cta-btn" onClick={() => onWrite('growjin')} disabled={busy}>
              {generating ? <><Spinner />Writing…</> : 'Write the blog post'}
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
                  <Spinner />
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
              <><Spinner />Writing…</>
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
                        <Spinner />Checking…
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
  return (
    <div className="td-allgood">
      <p className="td-allgood-headline">All caught up</p>
      <p className="td-allgood-sub">New tasks appear after tomorrow morning&apos;s check. {cachedAt && <LastRefreshed at={cachedAt} prefix="Checked" staleAfterHours={4.5} />}</p>
      <button className="btn btn-primary" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? <><Spinner />Checking…</> : 'Check again now'}
      </button>
    </div>
  )
}

// ── Sections that open and close ───────────────────────────────────────────────

type FoldId = 'todo' | 'numbers' | 'content' | 'social' | 'done'
const FOLD_IDS: FoldId[] = ['numbers', 'todo', 'content', 'social', 'done']
// v2: "How it's going" moved to the top and starts open; older saved choices had it closed
const FOLDS_KEY = 'today-folds-v2'

// Which sections are open, kept in this browser. "How it's going" and "To do today" start open.
function useFolds() {
  const [open, setOpen] = useState<Record<FoldId, boolean>>({ numbers: true, todo: true, content: false, social: false, done: false })
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FOLDS_KEY) ?? 'null')
      if (saved && typeof saved === 'object') setOpen(o => ({ ...o, ...saved }))
    } catch { /* storage blocked: use the defaults */ }
  }, [])
  const save = (next: Record<FoldId, boolean>) => {
    setOpen(next)
    try { localStorage.setItem(FOLDS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }
  return {
    open,
    toggle: (id: FoldId) => save({ ...open, [id]: !open[id] }),
    show: (id: FoldId) => { if (!open[id]) save({ ...open, [id]: true }) },
    all: (on: boolean) => save(Object.fromEntries(FOLD_IDS.map(k => [k, on])) as Record<FoldId, boolean>),
  }
}

// A section's header shows a one-line summary, so the closed page still tells the day's story.
// The body only mounts when open, so closed sections don't fetch anything.
function Fold({ id, title, icon: Icon, summary, aside, open, onToggle, children }: {
  id: FoldId; title: string; icon: LucideIcon; summary: React.ReactNode; aside?: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <section className="td-fold">
      <button type="button" className="td-fold-h" aria-expanded={open} aria-controls={`td-fold-${id}`} onClick={onToggle}>
        <span className="td-fold-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
        <span className="td-fold-t">
          <b>{title}</b>
          <span className="td-fold-sum">{summary}</span>
        </span>
        {aside}
        <svg className="td-fold-chev" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
      </button>
      {open && <div className="td-fold-b" id={`td-fold-${id}`}>{children}</div>}
    </section>
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
  // The task opened from the list (null: the first one shows as "Start here")
  const [openId, setOpenId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const folds = useFolds()
  const yesterday = useYesterday()
  const done = useRecentlyDone()
  // Tasks finished on this page since it loaded, so the done ring moves without a reload
  const [doneHere, setDoneHere] = useState(0)

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

  // A task left the list: open the one after it, so the next step is always on screen
  const advance = useCallback((id: string) => {
    const i = cards.findIndex(c => c.id === id)
    const rest = cards.filter(c => c.id !== id)
    setCards(rest)
    setExpandedCard(null)
    setOpenId(i >= 0 ? rest[i]?.id ?? null : null)
  }, [cards])

  // Same effect as Claude's toggle_item / resolve_signal: the task leaves the list everywhere
  const completeTask = useCallback(async (card: ActionCard, status: TaskStatus) => {
    const res = await fetch('/api/today/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: card.data?.taskKind, id: card.data?.taskId, status }),
    })
    if (!res.ok) throw new Error('complete failed')
    advance(card.id)
    if (status === 'done') { markAction(); setDoneHere(n => n + 1) }
  }, [markAction, advance])

  // A post went out from the "Create a post" panel: mark the task done and count today's action,
  // but keep the card (with its success message) until the panel is closed.
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set())
  const publishedSocial = useCallback((card: ActionCard) => {
    setPublishedIds(prev => new Set(prev).add(card.id))
    markAction()
    setDoneHere(n => n + 1)
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
    if (publishedIds.has(card.id)) advance(card.id)
  }, [publishedIds, advance])

  const now = new Date()
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dayLabel = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`

  const loading = !ready || (refreshing && cards.length === 0)
  const closeTask = () => { setOpenId(null); setExpandedCard(null) }
  const openTask = (id: string) => { setOpenId(id); setExpandedCard(null) }

  // One-line summaries for the closed sections
  const today = new Date().toDateString()
  const doneToday = (done?.filter(t => new Date(t.at).toDateString() === today).length ?? 0) + doneHere
  const todayTotal = doneToday + cards.length
  const todoSum = loading ? 'Checking your tasks…'
    : cards.length === 0 ? 'All caught up'
    : `${cards.length} to do${doneToday ? ` · ${doneToday} done` : ''} · next: ${cards[0].headline}`
  const numbersSum = [yesterday, impacts[0]?.headline].filter(Boolean).join(' · ') || 'Visitors, sign-ups and what’s working'
  const latestBlog = blogData.blogs[0]
  const contentSum = [
    blogData.weeklyDue ? 'This week’s blog is due' : latestBlog ? `Latest blog: “${latestBlog.title}”` : 'No blog yet',
    recentPosts.length ? `${recentPosts.length} recent post${recentPosts.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')
  const doneSum = [
    done === null ? '' : done.length ? `${done.length} done lately` : 'Nothing yet',
    streak > 0 ? `${streak}-day streak` : '',
  ].filter(Boolean).join(' · ') || ' '

  function renderTask(card: ActionCard) {
    return (
      <div key={card.id} className="td-cell">
        <ActionCardItem
          card={card}
          onClose={closeTask}
          onCta={markAction}
          expanded={expandedCard === card.id}
          onToggleExpand={() => expandedCard === card.id && card.type === 'social' ? closeSocialPanel(card) : setExpandedCard(expandedCard === card.id ? null : card.id)}
          onDone={card.type === 'reminder' ? () => { advance(card.id); setDoneHere(n => n + 1) } : undefined}
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
                  ? `Email Outreach: ${prospectItems.length} prospect${prospectItems.length !== 1 ? 's' : ''}`
                  : 'Email Outreach'}
              </span>
              <button className="td-inline-panel-close" onClick={() => setExpandedCard(null)} aria-label="Close">×</button>
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
              <span className="td-inline-panel-title">Write this week&apos;s blog</span>
              <button className="td-inline-panel-close" onClick={() => setExpandedCard(null)} aria-label="Close">×</button>
            </div>
            <div style={{ padding: '8px 0' }}>
              <WeeklyBlogSection initialData={blogData} frektoConnected={frektoConnected} onAddToSite={addBlogToSite} addHint={id => handoff.hint(`blog:${id}`)} />
            </div>
          </div>
        )}
      </div>
    )
  }

  // "To do today": the first task as "Start here" (the page's one green button), the rest as quiet
  // rows. Opening a row shows its details in place; finishing it opens the next one.
  function renderTodo() {
    if (loading) return <ListSkeleton rows={4} />
    if (cards.length === 0) return <AllGoodState cachedAt={cachedAt} onRefresh={() => fetchSignals(true)} refreshing={refreshing} />
    return (
      <div className="td-todo">
        {cards.map((card, i) => {
          if (card.id === openId) return renderTask(card)
          if (i === 0 && !cards.some(c => c.id === openId)) {
            return (
              <div key={card.id} className="td-next">
                <TaskIcon type={card.type} big />
                <div className="td-next-text">
                  <span className="td-eyebrow">Start here</span>
                  <b>{card.headline}</b>
                  <span>{withBold(card.reason)}</span>
                </div>
                <button type="button" className="btn btn-primary td-next-go" onClick={() => openTask(card.id)}>Start</button>
              </div>
            )
          }
          return (
            <button key={card.id} type="button" className="td-row" onClick={() => openTask(card.id)}>
              <TaskIcon type={card.type} />
              <span className="td-row-main">
                <span className="td-row-name">{card.headline}</span>
                <span className="td-row-why">{card.reason.replace(/\*\*/g, '')}</span>
              </span>
              <span className="td-row-go" aria-hidden="true">Open ›</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="td-root">
      {/* OAuth result banner */}
      {oauthBanner && (
        <div className={`td-oauth-banner ${oauthBanner.startsWith('Connection failed') ? 'td-oauth-banner--error' : 'td-oauth-banner--ok'}`}>
          <span>{oauthBanner}</span>
          <button className="td-oauth-banner-close" onClick={() => setOauthBanner(null)} aria-label="Close">✕</button>
        </div>
      )}

      <div className="tool-page td-page">
      <ToolHeader
        icon="sun"
        title="Today"
        intro="today"
        meta={<>
          <span>{dayLabel}</span>
          {cachedAt && <><span aria-hidden="true">·</span><LastRefreshed at={cachedAt} prefix="Tasks updated" staleAfterHours={4.5} onRefresh={() => fetchSignals(true)} refreshing={refreshing} /></>}
          <span aria-hidden="true">·</span>
          <button type="button" className="btn btn-link td-settings-link" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(v => !v)}>Settings</button>
        </>}
      />

      {/* Settings: the daily email, checking again, and the full numbers. Off the page until asked for. */}
      {settingsOpen && (
        <div className="td-settings">
          <DailyEmailToggle initialEnabled={dailyEmailEnabled} email={dailyEmailTo} variant="full" />
          <div className="td-settings-foot">
            <button type="button" className="btn btn-link" onClick={() => fetchSignals(true)} disabled={refreshing}>
              {refreshing ? <><Spinner />Checking…</> : 'Check for new tasks now'}
            </button>
            <Link href="/analytics" className="btn btn-link">Open Analytics</Link>
          </div>
        </div>
      )}

      <div className="td-body">
        <div className="td-fold-tools">
          <button type="button" className="btn btn-link" onClick={() => folds.all(true)}>Open all</button>
          <button type="button" className="btn btn-link" onClick={() => folds.all(false)}>Close all</button>
        </div>

        <div className="td-folds">
          <Fold id="numbers" title="How it’s going" icon={TrendingUp} summary={numbersSum} open={folds.open.numbers} onToggle={() => folds.toggle('numbers')}>
            {/* Road to 500 users timeline (needs PostHog) */}
            {posthogConnected && <div className="td-journey"><RoadToFiveHundred posthogConnected /></div>}
            {/* What happened: visitors, signups and sources */}
            <TodayActivity />
            {impacts.length > 0 && (
              <div className="td-fold-part">
                <div className="td-eyebrow">What&apos;s working</div>
                <ul className="td-impacts">{impacts.map(c => <ImpactRow key={c.id} card={c} />)}</ul>
              </div>
            )}
          </Fold>

          <Fold id="todo" title="To do today" icon={ListChecks} summary={todoSum} aside={!loading && todayTotal > 0 ? <DoneRing done={doneToday} total={todayTotal} /> : undefined} open={folds.open.todo} onToggle={() => folds.toggle('todo')}>
            {renderTodo()}
          </Fold>

          <Fold id="content" title="Blog and posts" icon={PenLine} summary={contentSum} open={folds.open.content} onToggle={() => folds.toggle('content')}>
            <WeeklyBlogSection initialData={blogData} frektoConnected={frektoConnected} onAddToSite={addBlogToSite} addHint={id => handoff.hint(`blog:${id}`)} />
            <SocialFeed posts={recentPosts} />
          </Fold>

          <Fold id="social" title="Social accounts" icon={Share2} summary="Followers and recent posts on each account" open={folds.open.social} onToggle={() => folds.toggle('social')}>
            <SocialAnalytics />
          </Fold>

          <Fold id="done" title="Done" icon={CircleCheck} summary={doneSum} open={folds.open.done} onToggle={() => folds.toggle('done')}>
            {done === null ? <ListSkeleton rows={2} start={false} /> : <RecentlyDone done={done} />}
          </Fold>
        </div>
      </div>
      </div>

      <style>{`
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
        .tsp-error { margin: 0; font-size: 13.5px; color: var(--crit); }
        .tsp-progress { display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-radius: 10px; background: var(--bg-soft); }
        .tsp-progress b { font-size: 14px; color: var(--text); }
        .tsp-progress p { margin: 2px 0 0; font-size: 12.5px; color: var(--text-faint); }
        .tsp-progress .spinner { color: var(--green); opacity: 1; }
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
        .td-oauth-banner--ok { background: var(--accent); color: var(--accent-foreground); }
        .td-oauth-banner--error { background: var(--crit-soft); color: var(--crit); }
        .td-oauth-banner-close {
          background: none; border: none; cursor: pointer; font-size: 14px;
          color: inherit; opacity: 0.6; padding: 0 4px;
        }
        .td-oauth-banner-close:hover { opacity: 1; }

        /* body */
        .td-body { display: flex; flex-direction: column; }
        .td-page .th { margin-bottom: 0; }

        /* Settings: daily email, check again, Analytics */
        .td-settings-link { font-size: inherit; padding: 0; color: var(--text-dim); text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
        .td-settings { margin-top: 18px; padding: 18px 22px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); max-width: 640px; }
        .td-settings-foot { display: flex; flex-wrap: wrap; gap: 4px 20px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }

        /* Sections that open and close. A closed one still shows its one-line summary. */
        .td-fold-tools { display: flex; justify-content: flex-end; gap: 16px; margin-top: 14px; }
        .td-fold-tools .btn-link { font-size: 13px; }
        .td-folds { margin-top: 6px; border-top: 1px solid var(--line); }
        .td-fold { border-bottom: 1px solid var(--line); }
        .td-fold-h {
          display: flex; align-items: center; gap: 14px; width: 100%; padding: 18px 4px;
          border: 0; background: none; color: var(--text); text-align: left; cursor: pointer; font-family: var(--font-body);
        }
        .td-fold-h:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; border-radius: 8px; }
        .td-fold-icon {
          flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
          background: var(--bg-soft); border: 1px solid var(--line); color: var(--text-dim);
        }
        .td-fold-h[aria-expanded="true"] .td-fold-icon { color: var(--text); }
        .td-ticon {
          flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
          background: var(--bg-soft); color: var(--text-dim);
        }
        .td-ticon--big { width: 44px; height: 44px; background: var(--card); color: var(--green); }
        .td-ring { position: relative; flex: none; display: inline-flex; align-items: center; gap: 8px; }
        .td-ring svg { display: block; }
        .td-ring-bg { fill: none; stroke: var(--line); stroke-width: 3; }
        .td-ring-fg { fill: none; stroke: var(--green); stroke-width: 3; stroke-linecap: round; transition: stroke-dasharray .4s; }
        .td-ring-t { font-size: 13px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
        @media (prefers-reduced-motion: reduce) { .td-ring-fg { transition: none; } }
        .td-fold-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .td-fold-t b { font-size: 17px; font-weight: 500; }
        .td-fold-sum { font-size: 14px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .td-fold-h:hover .td-fold-t b { text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
        .td-fold-chev { flex: none; color: var(--text-faint); transition: transform .15s; }
        .td-fold-h[aria-expanded="true"] .td-fold-chev { transform: rotate(180deg); }
        .td-fold-h[aria-expanded="true"] .td-fold-sum { display: none; }
        .td-fold-b { padding: 0 4px 24px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        .td-fold-part { display: flex; flex-direction: column; gap: 8px; }
        .td-fold-empty { margin: 0; font-size: 14px; color: var(--text-faint); }
        /* The section's own title already names these; don't repeat it inside */
        .td-fold-b > .td-blog-section > .td-section-label:first-child,
        .td-fold-b > .td-social-analytics > .td-section-label:first-child,
        .td-fold-b > .td-social-feed > .td-section-label:first-child,
        .td-fold-b > .ta-wrap .ta-title { display: none; }
        .td-eyebrow { display: block; font-size: 12px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--text-faint); }
        @media (prefers-reduced-motion: reduce) { .td-fold-chev { transition: none; } }

        /* To do today: "Start here" (the one green button), then quiet rows */
        .td-todo { display: flex; flex-direction: column; }
        .td-next {
          display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
          padding: 20px 22px; border-radius: 14px; background: var(--accent); margin-bottom: 6px;
        }
        .td-next-text { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .td-next-text > b { font-size: 18px; font-weight: 500; color: var(--text); }
        .td-next-text > span:last-child { font-size: 15px; color: var(--text-dim); line-height: 1.5; }
        .td-next .td-eyebrow { color: var(--text-dim); margin-bottom: 2px; }
        .td-next-go { height: 42px; padding: 0 24px; font-size: 14px; }
        .td-row {
          display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 4px;
          border: 0; border-bottom: 1px solid var(--line); background: none; color: var(--text);
          text-align: left; cursor: pointer; font-family: var(--font-body);
        }
        .td-row:last-child { border-bottom: 0; }
        .td-row:hover .td-row-name { text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
        .td-row:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; border-radius: 8px; }
        .td-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .td-row-name { font-size: 15px; font-weight: 500; }
        .td-row-why { font-size: 14px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .td-row-go { font-size: 14px; color: var(--text-faint); white-space: nowrap; }
        .td-todo > .td-cell { margin: 6px 0; }

        /* What's working: plain lines */
        .td-impacts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
        .td-impact-row { display: flex; flex-direction: column; gap: 1px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 15px; }
        .td-impact-row b { font-weight: 500; }
        .td-impact-row span { font-size: 14px; }
        .td-impact-row:last-child { border-bottom: 0; }
        .td-impact-row span { color: var(--text-dim); }

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
          border-radius: 14px;
          padding: 22px 24px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .td-card-header {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
        }
        .td-card-close { flex: none; font-size: 13px; }
        .td-card-headline {
          font-family: var(--font-display, serif);
          font-size: 22px; font-weight: 500; color: var(--text);
          letter-spacing: -0.2px; margin: 0; line-height: 1.25;
        }
        .td-card-reason {
          font-size: 15px; color: var(--text-dim); line-height: 1.55; margin: 0;
        }
        .td-card-reason strong, .td-card-reason b { font-weight: 500; color: var(--text); }
        .td-card-why { font-size: 15px; color: var(--text); line-height: 1.6; }
        .td-card-why b { font-weight: 500; }
        .td-why-label {
          display: block; font-size: 12px; font-weight: 500;
          text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-faint); margin-bottom: 2px;
        }

        /* CTA button */
        .td-cta-btn {
          display: inline-flex; align-items: center; align-self: flex-start;
          font-size: 14px; font-weight: 600; height: 38px; padding: 0 16px; box-sizing: border-box;
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
          font-size: 14px; font-weight: 500; height: 38px; padding: 0 16px; box-sizing: border-box;
          border-radius: 9px; background: var(--card); color: var(--text-dim);
          border: 1px solid var(--line); text-decoration: none; cursor: pointer;
          transition: background .12s, border-color .12s, color .12s;
        }
        .td-ghost-btn:hover { background: var(--bg-soft); border-color: var(--green); color: var(--text); }
        .td-ghost-btn:disabled { opacity: .5; cursor: not-allowed; }

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
          display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
          font-size: 12px; font-weight: 600; color: var(--text-dim); text-transform: capitalize;
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
        .td-feed-status { color: var(--text-faint); }
        .td-feed-status--failed { color: var(--crit); }

        /* all good */
        .td-allgood {
          display: flex; flex-direction: column; align-items: center;
          text-align: center; padding: 36px 22px; gap: 10px; border-radius: 14px; background: var(--bg-soft);
        }
        .td-allgood-headline {
          font-family: var(--font-display, serif); font-size: 20px; font-weight: 700;
          color: var(--text); letter-spacing: -0.3px; margin: 0;
        }
        .td-allgood-sub { font-size: 13px; color: var(--text-dim); margin: 0; }


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
          font-size: 13px; color: var(--text-dim); flex-shrink: 0;
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


        /* weekly blog */
        .td-blog-section { display: flex; flex-direction: column; gap: 10px; }
        .td-blog-limit-badge {
          font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 99px;
          background: var(--crit-soft); color: var(--crit); text-transform: none;
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
        .td-blog-error { font-size: 13px; color: var(--crit); margin: 0; }

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
        .td-ghost-btn--sm { height: 32px; padding: 0 12px; font-size: 13px; border-radius: 8px; }
        .td-blog-write-now { align-self: flex-start; }

        .td-blog-status { font-size: 13px; color: var(--text-faint); flex-shrink: 0; text-transform: capitalize; }

        .td-blog-result {
          background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--info);
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
          font-size: 12px; font-weight: 600; color: var(--accent-foreground);
          background: var(--accent); padding: 3px 10px; border-radius: 99px;
        }
        .td-blog-verify-notfound {
          font-size: 12px; color: var(--text-faint);
        }
        .td-blog-live-link {
          font-size: 12px; color: var(--info); text-decoration: none;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px;
        }
        .td-blog-live-link:hover { text-decoration: underline; }

        /* Type on Today: 400 for reading, 500 for names, labels and numbers, 600 only for the page
           title and the one green button. Sizes: 13 meta, 14 secondary, 15 body and names,
           17 section names, 22 serif for an opened task, 32 the page title. */
        .td-root .th-meta, .td-root .th-meta span, .td-root .th-meta .last-refreshed-btn { font-size: 14px; }
        .td-root .td-connect-btn { font-weight: 500; }
        .td-root .last-refreshed-btn { font-weight: 500; }
        .td-root .ta-num { font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; }
        .td-root .ta-delta { font-size: 12px; font-weight: 500; }
        .td-root .ta-label { font-size: 13px; }
        .td-root .ta-sub { font-size: 13px; font-weight: 500; color: var(--text-dim); }
        .td-root .ta-person-main b { font-size: 15px; font-weight: 500; }
        .td-root .ta-muted { font-size: 13px; }
        .td-root .ta-avatar { font-weight: 500; }
        .td-root .ta-bar-name, .td-root .ta-bar-num { font-size: 13px; font-weight: 400; font-variant-numeric: tabular-nums; }
        .td-root .ta-chip b { font-weight: 500; }
        .td-root .ta-toggle button, .td-root .ta-connect, .td-root .ta-view-all { font-size: 13px; font-weight: 500; }
        .td-root .ta-fetched { font-size: 13px; }
        .td-root .gp-eyebrow { font-size: 12px; font-weight: 500; }
        .td-root .gp-count { font-size: 22px; font-weight: 500; }
        .td-root .gp-count-label, .td-root .gp-journey-note { font-size: 13px; font-weight: 400; }
        .td-root .gp-journey-note strong, .td-root .gp-journey-note b { font-weight: 500; }
        .td-root .gp-band-range, .td-root .gp-band-name { font-size: 12px; font-weight: 400; }
        .td-root .gp-journey-mrr-toggle { font-size: 13px; font-weight: 500; }
        .td-root .td-platform-name { font-size: 15px; font-weight: 500; }
        .td-root .td-stat-val { font-size: 20px; font-weight: 500; }
        .td-root .td-stat-label { font-size: 12px; }
        .td-root .td-platform-posts-label, .td-root .td-section-label { font-size: 12px; font-weight: 500; letter-spacing: .08em; }
        .td-root .td-post-caption, .td-root .td-blog-latest-title, .td-root .td-blog-next-due { font-size: 14px; }
        .td-root .td-post-meta { font-size: 12.5px; }
        .td-root .td-blog-latest-label { font-weight: 400; color: var(--text-dim); }
        .td-root .td-done-label { font-size: 15px; font-weight: 500; }
        .td-root .td-done-note { font-size: 14px; }
        .td-root .td-done-link { font-weight: 500; }

        /* responsive */
        @media (max-width: 640px) {
          .td-feed-row { flex-wrap: wrap; gap: 6px; }
          .td-card, .td-blog-card { padding: 18px 16px; }
          .td-connect-row { padding: 12px 14px; }
          .td-card-actions .td-cta-btn { flex: 1 1 100%; justify-content: center; }
          /* two per row; a third takes the full row instead of squeezing all three */
          .td-card-actions .td-ghost-btn { flex: 1 1 calc(50% - 4px); justify-content: center; padding: 9px 10px; white-space: nowrap; }
        }
      `}</style>
      {handoff.modal}
    </div>
  )
}
